const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { getSdk, handleError } = require('../api-util/sdk');
const { uuidString } = require('../api-util/uuid');
const log = require('../log');
const { buildBufferForAcceptedTransaction } = require('../api-util/availabilityBuffer');
const { ACCEPT_TRANSITIONS } = require('../api-util/coclosetBookingProcess');

// Creates the "buffer window" availability exception (seats: 0, i.e.
// unavailable) around a booking once it's been accepted, so the listing
// can't be double-booked while the garment is with the laundry: it covers
// buffer-before + the rental dates themselves + buffer-after (see design
// doc §5/§13 and server/api-util/availabilityHelpers.js for the buffer-day
// rounding rule).
//
// This must run via the Integration API rather than a trusted
// customer/provider token exchange (cf. transition-privileged.js) because:
//   - it needs to act on the GARMENT OWNER's listing regardless of which
//     party (customer or operator) triggered the `accept` transition, and
//   - `accept` is not itself a privileged transition in this process (see
//     isPrivileged() in src/transactions/transactionProcessBooking.js), so
//     there's no existing trusted-token flow to piggyback on here.
//
// ---------------------------------------------------------------------------
// AUTHORIZATION
// ---------------------------------------------------------------------------
// This endpoint makes full-admin Integration API *writes* (availability
// exceptions on someone else's listing, plus transaction metadata), so it
// cannot be open. It previously had no auth check at all: since both parties
// know the transaction id (it is in the TransactionPage URL), anyone could
// POST it and block days on the owner's calendar.
//
// It can't use api-util/laundryAuth.js like its two sibling endpoints do -
// the caller here is the provider (or an operator acting for them) at the
// moment of `accept`, not the assigned laundry. So instead, following the
// caller-identity pattern from transition-privileged.js (`getSdk(req, res)`,
// the caller's own cookie-scoped Marketplace SDK):
//
//   1. the caller must be authenticated (currentUser.show() must succeed), and
//   2. the caller must be a party to this specific transaction (its customer
//      or its provider), and
//   3. the transaction must actually be in an accepted state
//      (lastTransition ∈ accept / operator-accept).
//
// (3) is what stops a customer from POSTing immediately after *requesting* a
// booking to block the owner's calendar. There is no marketplace-level
// "is operator" flag exposed on a user, so an operator acting through
// `login-as` is authorized by (2) as the user they are logged in as.
//
// ---------------------------------------------------------------------------
// KNOWN RESIDUAL GAP - this endpoint is client-triggered
// ---------------------------------------------------------------------------
// The call is fired from the browser (TransactionPage.duck.js) after the
// accept transition has already succeeded. That means the buffer is NOT
// created when:
//
//   a) the user closes the tab before the request completes;
//   b) **an operator accepts the booking from Sharetribe Console** - the
//      client code never runs at all;
//   c) any automatic/expiry transition moves the transaction to accepted.
//
// In all three cases the listing stays bookable during the rental + cleaning
// window, and nobody is told. This CANNOT be fixed from the client. The
// proper fix is a server-side worker subscribed to Sharetribe's transaction
// events (Integration API `events.query`, polled with a stored sequence id)
// that reconciles buffers for accepted transactions independently of the
// browser - deliberately out of scope here, and tracked as a known
// limitation. Until that exists, treat "the buffer exists" as best-effort.
//
// What IS fixed here: failures are no longer silent. Every failure path logs
// through server/log.js (console.error + Sentry when configured) with the
// transaction id, and returns a real error status to the caller instead of
// resolving as if it had worked.
//
// ---------------------------------------------------------------------------
// OVERLAP RECONCILIATION
// ---------------------------------------------------------------------------
// The API rejects an availability exception that overlaps an existing one
// (verified: 400 validation-invalid-value). Owners are explicitly expected to
// block weeks manually (design §13), and back-to-back bookings produce
// abutting buffers, so overlap is normal. This endpoint therefore queries the
// existing exceptions in the target range first and only creates the
// sub-ranges that are not already blocked (see
// availabilityHelpers.subtractBlockedRanges). That also makes the whole
// endpoint idempotent: re-running it after a partial failure creates only
// what is still missing, instead of 400ing forever.
//
// ---------------------------------------------------------------------------
// WHAT MOVED OUT OF HERE
// ---------------------------------------------------------------------------
// This endpoint used to also generate the cosmetic ticket code (design §11).
// It now lives on `transition/laundry-mark-ready` in
// server/api/laundry-transaction-status.js, where it rides an existing
// privileged-update-metadata instead of costing its own write, cannot be
// skipped by the client-hook gap above, and is generated at the moment the
// laundry actually prepares and labels the garment rather than at `accept`.
// The full argument is in that file, next to the code.
//
// ---------------------------------------------------------------------------
// PICKUP SCHEDULED NOTIFICATION
// ---------------------------------------------------------------------------
// This is also where the §3.12 "Pickup Scheduled" laundry email fires. It is a
// natural home rather than an afterthought: this is the only place in the
// codebase that already resolves the assigned laundry's user record at the
// moment a booking is confirmed. Sending is fire-and-continue - a mail failure
// must never fail the availability write - and is skipped silently when
// Mailgun is unconfigured.
//
// Note the notification carries no ticket code any more (see above); the
// template drops that row when it is absent.
//
// Request body: { transactionId } (a transaction UUID, transit-encoded).
// Success response (200): { data: { exceptionIds, listingId, start, end,
//   segmentsCreated, alreadyBlocked, unblockedOverlaps, bufferBeforeDays,
//   bufferAfterDays, totalBufferDays } }
//   - `alreadyBlocked: true` means the window was already fully covered.
//   - `unblockedOverlaps` lists ids of overlapping exceptions with seats > 0,
//     which leave the listing bookable inside the buffer window. Non-empty
//     means a human needs to look.
// "Nothing to do" response (200): { data: null, reason: '<why-skipped>' }
//   - used for expected-but-unconfigured states (no assigned laundry).
// Failure response: standard handleError() shape (see api-util/sdk.js).
//
// ACCEPT_TRANSITIONS comes from the cocloset-booking process mirror. Worth
// stating explicitly because it looks like a no-op: `cocloset-booking` is a
// fork of `default-booking` and did NOT rename `transition/accept` or
// `transition/operator-accept`, so the same two strings gate both processes.
// Sourcing them from the process module rather than inlining them means a
// future rename is caught in one place.

const httpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  error.statusText = message;
  error.data = {};
  return error;
};

// Is the authenticated caller the customer or the provider of this transaction?
const isPartyToTransaction = (transaction, currentUserId) => {
  const relationships = transaction?.relationships || {};
  const customerId = relationships.customer?.data?.id?.uuid;
  const providerId = relationships.provider?.data?.id?.uuid;
  return !!currentUserId && (currentUserId === customerId || currentUserId === providerId);
};

module.exports = (req, res) => {
  // THE SAME FAULT AS auto-accept-booking, on the endpoint that has been reported broken
  // three times. TransactionPage.duck sends `new UUID(params.id)` - a FLEX-SDK UUID - which
  // the Integration SDK's query serializer cannot accept, because it tests `instanceof` its
  // OWN UUID class and cross-package `instanceof` is always false. Every browser-fired buffer
  // creation threw "Don't know how to serialize query parameter 'id'" before reaching the
  // API, and this endpoint's failures are logged and swallowed by design.
  //
  // That is very likely why the buffer exception "does not exist on Dev" while driving this
  // handler IN-PROCESS produced the right window every time: an in-process call passes a
  // string. Recorded as the probable cause rather than a proven one - the earlier
  // investigation concluded the browser trigger was not landing, and it was landing and dying
  // here. See api-util/uuid.js.
  const transactionId = uuidString(req.body?.transactionId);
  const txIdForLog = transactionId || 'unknown';

  if (!transactionId) {
    res
      .status(400)
      .json({ error: 'Missing required "transactionId" in request body.' })
      .end();
    return;
  }

  const sdk = getSdk(req, res);
  const integrationSdk = getIntegrationSdk();

  // Step 1: establish caller identity from their own cookie-scoped session.
  sdk.currentUser
    .show()
    .catch(() => {
      throw httpError(401, 'Authentication required.');
    })
    .then(currentUserResponse => {
      const currentUserId = currentUserResponse?.data?.data?.id?.uuid;

      return integrationSdk.transactions
        .show({
          id: transactionId,
          include: ['listing', 'booking', 'customer', 'provider'],
        })
        .then(transactionResponse => ({ currentUserId, transactionResponse }));
    })
    .then(({ currentUserId, transactionResponse }) => {
      const { data, included = [] } = transactionResponse.data;

      // Step 2: the caller must be a party to THIS transaction.
      if (!isPartyToTransaction(data, currentUserId)) {
        log.error(
          new Error('create-availability-buffer called by a non-party'),
          'create-availability-buffer-forbidden',
          { txId: txIdForLog, currentUserId }
        );
        throw httpError(403, 'Caller is not a party to this transaction.');
      }

      // Step 3: the transaction must actually have been accepted.
      const lastTransition = data.attributes?.lastTransition;
      if (!ACCEPT_TRANSITIONS.includes(lastTransition)) {
        throw httpError(
          409,
          `Transaction is not in an accepted state (lastTransition: ${lastTransition}).`
        );
      }

      // Everything from here - resolving the studio's turnaround, sending the §3.12 Pickup
      // Scheduled mail, and blocking the window - is shared with
      // server/api/auto-accept-booking.js, which reaches the same point by a different door.
      // One copy, in api-util/availabilityBuffer.js.
      return buildBufferForAcceptedTransaction({
        integrationSdk,
        transaction: data,
        included,
        txIdForLog,
      });
    })
    .then(result => {
      if (result.skipped) {
        res
          .status(200)
          .set('Content-Type', 'application/json')
          .send({ data: null, reason: result.reason })
          .end();
        return null;
      }

      const { skipped, ...data } = result;
      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data })
        .end();
      return null;
    })
    .catch(e => {
      // A failure here means the listing may be double-bookable during the
      // rental + cleaning window, which has physical consequences (a second
      // customer books a garment that is at the laundry). The client treats
      // this call as best-effort and will not show the user anything, so this
      // log is the only signal - keep it explicit and greppable.
      log.error(e, 'create-availability-buffer-failed', {
        txId: txIdForLog,
        status: e?.status,
        message: e?.message,
      });
      handleError(res, e);
    });
};
