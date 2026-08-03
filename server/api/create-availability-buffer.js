const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { getSdk, handleError } = require('../api-util/sdk');
const log = require('../log');
const {
  computeAvailabilityBufferWindow,
  resolveTurnaroundHours,
} = require('../api-util/availabilityHelpers');
const { reconcileBufferWindow } = require('../api-util/availabilityBuffer');
const { ACCEPT_TRANSITIONS } = require('../api-util/coclosetBookingProcess');
const { notifyPickupScheduled } = require('../api-util/laundryMailer');

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
  const { transactionId } = req.body || {};
  // transactionId may be a UUID object or a plain string; normalise for logs
  // (the old code interpolated `.uuid` unconditionally and logged `undefined`).
  const txIdForLog = transactionId?.uuid || transactionId || 'unknown';

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

      const listingRef = data.relationships?.listing?.data;
      const bookingRef = data.relationships?.booking?.data;

      const listing = listingRef
        ? included.find(i => i.type === 'listing' && i.id.uuid === listingRef.id.uuid)
        : null;
      const booking = bookingRef
        ? included.find(i => i.type === 'booking' && i.id.uuid === bookingRef.id.uuid)
        : null;

      if (!listing) {
        throw httpError(
          422,
          `create-availability-buffer: transaction ${txIdForLog} has no listing relationship.`
        );
      }
      if (!booking || !booking.attributes?.start || !booking.attributes?.end) {
        throw httpError(
          422,
          `create-availability-buffer: transaction ${txIdForLog} has no booking dates.`
        );
      }

      const assignedLaundryId = listing.attributes?.publicData?.assignedLaundryId;
      const { start: bookingStart, end: bookingEnd } = booking.attributes;

      if (!assignedLaundryId) {
        // Not every listing is guaranteed to have a laundry assigned (e.g.
        // partial rollout, or listings created before this feature). This
        // is a valid "nothing to do" state, not a server error.
        return { skipped: true, reason: 'no-laundry-assigned' };
      }

      const customerRef = data.relationships?.customer?.data;
      const customer = customerRef
        ? included.find(i => i.type === 'user' && i.id.uuid === customerRef.id.uuid)
        : null;

      return integrationSdk.users.show({ id: assignedLaundryId }).then(userResponse => {
        const laundryUser = userResponse.data.data;
        const laundryProfile = laundryUser.attributes?.profile || {};
        const turnaroundHours = resolveTurnaroundHours(
          laundryProfile.privateData?.turnaroundHours,
          process.env.DEFAULT_LAUNDRY_BUFFER_HOURS
        );

        return {
          skipped: false,
          listing,
          bookingStart,
          bookingEnd,
          turnaroundHours,
          laundry: {
            // `users.show` on the Integration API returns the account email,
            // which the Marketplace API would not expose for a third party.
            email: laundryUser.attributes?.email,
            studioName: laundryProfile.publicData?.laundryProfile?.studioName,
          },
          customerName: customer?.attributes?.profile?.displayName,
        };
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

      const { listing, bookingStart, bookingEnd, turnaroundHours, laundry, customerName } = result;
      const {
        start,
        end,
        bufferBeforeDays,
        bufferAfterDays,
        totalBufferDays,
      } = computeAvailabilityBufferWindow(bookingStart, bookingEnd, turnaroundHours);

      // §3.12 Pickup Scheduled. Fired before the calendar work rather than
      // after it, and never awaited: the laundry needs to know a rental is
      // confirmed regardless of whether an exception write succeeds, and this
      // promise cannot reject (see api-util/laundryMailer.js).
      notifyPickupScheduled({
        to: laundry.email,
        laundryName: laundry.studioName,
        garmentTitle: listing.attributes?.title,
        customerName,
        pickupDate: bookingStart,
        rack: listing.attributes?.privateData?.currentRack,
        transactionId: txIdForLog,
      });

      // Reconcile against what is already blocked, rather than blindly
      // creating (which 400s on any overlap - see the header comment).
      return reconcileBufferWindow({
        integrationSdk,
        listingId: listing.id,
        start,
        end,
        txIdForLog,
      }).then(exceptionResult => {
        res
          .status(200)
          .set('Content-Type', 'application/json')
          .send({
            data: {
              ...exceptionResult,
              listingId: listing.id.uuid,
              start,
              end,
              bufferBeforeDays,
              bufferAfterDays,
              totalBufferDays,
            },
          })
          .end();
      });
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
