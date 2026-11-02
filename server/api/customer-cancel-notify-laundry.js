const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { getSdk, handleError } = require('../api-util/sdk');
const { uuidString } = require('../api-util/uuid');
const { readAssignedLaundryId } = require('../api-util/laundryAssignment');
const { notifyBookingCancelled } = require('../api-util/laundryMailer');
const {
  TRANSITIONS,
  isCoclosetBookingListing,
} = require('../api-util/coclosetBookingProcess');
const log = require('../log');

/**
 * POST /api/customer-cancel-notify-laundry   body: { transactionId }
 *
 * The LAUNDRY-SIDE EFFECT of a customer's self-cancellation.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ENDPOINT EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * `transition/customer-cancel` is NOT privileged (same three actions as the operator's
 * `transition/cancel` - see that transition's comment in process.edn), so the browser fires
 * it directly through `sdk.transactions.transition()` via the existing generic
 * `makeTransitionThunk` in TransactionPage.duck.js. No new transition-dispatch plumbing is
 * needed for the cancellation itself.
 *
 * What IS missing is the laundry notification. Sharetribe's own notification mechanism can
 * only address `:actor.role/customer` or `:actor.role/provider` - never a laundry, which is
 * not a transaction party in the Sharetribe sense - so that half has always gone through our
 * own Mailgun wiring (see the header of server/api-util/laundryMailer.js). And because
 * `transition/customer-cancel` is not privileged, there is no server hook anywhere in its own
 * path to fire that mail from. This endpoint is that hook: the browser calls it right after
 * the transition itself succeeds (see the `maybeNotifyLaundryOfCustomerCancel` fire-and-continue
 * call in TransactionPage.duck.js, which mirrors `maybeCreateAvailabilityBuffer` in the same
 * file), so the laundry stops expecting a drop-off or a pickup for this booking.
 *
 * ---------------------------------------------------------------------------
 * TRUST NOTHING THE CLIENT SAYS HAPPENED
 * ---------------------------------------------------------------------------
 * The body carries only a transaction id - no claim about what transition fired. Whether a
 * customer-cancel actually happened is read straight off the stored transaction
 * (`attributes.lastTransition === TRANSITIONS.CUSTOMER_CANCEL`), the same philosophy
 * server/api/auto-accept-booking.js uses for its own checks. A caller that has not actually
 * cancelled gets a no-op, not a laundry email.
 *
 * ---------------------------------------------------------------------------
 * AUTHORIZATION: THE CUSTOMER ONLY, NOT THE PROVIDER
 * ---------------------------------------------------------------------------
 * Unlike auto-accept-booking.js (either party may trigger it, because the decision is the
 * listing's, not the caller's), this is scoped to the CUSTOMER specifically: the cancellation
 * itself already restricts `transition/customer-cancel` to `:actor.role/customer`, and this
 * side-effect notification should not be triggerable by the provider pretending the renter
 * cancelled.
 *
 * ---------------------------------------------------------------------------
 * NEVER FAILS THE SURROUNDING FLOW
 * ---------------------------------------------------------------------------
 * The cancellation transition has ALREADY SUCCEEDED by the time the browser calls this. A
 * missing laundry assignment, an unreachable Mailgun account, or any other failure here must
 * never make the browser think the cancellation itself failed - see the header of
 * server/api-util/laundryMailer.js and server/api-util/mailgun.js for the same philosophy
 * applied to every other laundry notification. So this endpoint ALWAYS responds 200; the
 * `notifyBookingCancelled` -> `send()` chain already turns "not configured" and "no
 * recipient" into a logged skip rather than an error, and a missing `assignedLaundryId` is
 * resolved as "nothing to notify", not a failure.
 */

const httpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  error.statusText = message;
  error.data = {};
  return error;
};

// Scoped to the CUSTOMER only, unlike auto-accept-booking.js's isPartyToTransaction (which
// deliberately accepts either party). See the header above for why.
const isCustomerOfTransaction = (transaction, currentUserId) => {
  const customerId = transaction?.relationships?.customer?.data?.id?.uuid;
  return !!currentUserId && currentUserId === customerId;
};

const nothingToDo = (res, reason) => {
  res
    .status(200)
    .set('Content-Type', 'application/json')
    .send({ data: null, reason })
    .end();
  return null;
};

module.exports = (req, res) => {
  // Same normalisation as auto-accept-booking.js: the browser's transit-decoded UUID is not
  // the Integration SDK's own UUID class, so it has to be unwrapped to a plain string before
  // it reaches `transactions.show`. See api-util/uuid.js.
  const transactionId = uuidString(req.body?.transactionId);
  const txIdForLog = transactionId || 'unknown';

  if (!transactionId) {
    res
      .status(400)
      .json({ error: 'Missing required "transactionId" in request body.' })
      .end();
    return Promise.resolve();
  }

  const sdk = getSdk(req, res);
  const integrationSdk = getIntegrationSdk();

  return sdk.currentUser
    .show()
    .catch(() => {
      throw httpError(401, 'Authentication required.');
    })
    .then(currentUserResponse => {
      const currentUserId = currentUserResponse?.data?.data?.id?.uuid;

      return integrationSdk.transactions
        .show({ id: transactionId, include: ['listing', 'customer', 'provider'] })
        .then(transactionResponse => ({ currentUserId, transactionResponse }));
    })
    .then(({ currentUserId, transactionResponse }) => {
      const { data: transaction, included = [] } = transactionResponse.data;

      if (!isCustomerOfTransaction(transaction, currentUserId)) {
        log.error(
          new Error('customer-cancel-notify-laundry called by a non-customer'),
          'customer-cancel-notify-laundry-forbidden',
          { txId: txIdForLog, currentUserId }
        );
        throw httpError(403, 'Caller is not the customer on this transaction.');
      }

      const listingRef = transaction.relationships?.listing?.data;
      const listing = listingRef
        ? included.find(i => i.type === 'listing' && i.id.uuid === listingRef.id.uuid)
        : null;

      if (!isCoclosetBookingListing(listing)) {
        return nothingToDo(res, 'not-a-cocloset-booking');
      }

      // DO NOT TRUST THE CLIENT'S SAY-SO. Verified server-side, off the stored transaction,
      // exactly as auto-accept-booking.js verifies its own precondition.
      //
      // BOTH CUSTOMER-CANCEL DOORS (2026-10-15): CUSTOMER_CANCEL_FROM_ACCEPTED_ON_LAUNDRY is
      // the same self-cancel event as CUSTOMER_CANCEL, reachable from the second state the
      // accepted/accepted-on-laundry split added - see that transition's comment in
      // process.edn. Checking only CUSTOMER_CANCEL here would have silently stopped notifying
      // the laundry for that booking shape the moment the split shipped.
      if (
        ![TRANSITIONS.CUSTOMER_CANCEL, TRANSITIONS.CUSTOMER_CANCEL_FROM_ACCEPTED_ON_LAUNDRY].includes(
          transaction.attributes?.lastTransition
        )
      ) {
        return nothingToDo(res, 'not-a-customer-cancel');
      }

      const assignedLaundryId = readAssignedLaundryId(listing);
      if (!assignedLaundryId) {
        // Not every listing has a laundry assigned (e.g. the garment never reached one in the
        // first place). A valid "nothing to notify", not an error - notifyBookingCancelled
        // would turn a missing recipient into a logged skip anyway, but there is no point
        // making an Integration API call to discover that.
        return nothingToDo(res, 'no-laundry-assigned');
      }

      const customerRef = transaction.relationships?.customer?.data;
      const customer = customerRef
        ? included.find(i => i.type === 'user' && i.id.uuid === customerRef.id.uuid)
        : null;

      return integrationSdk.users.show({ id: assignedLaundryId }).then(laundryResponse => {
        const laundryUser = laundryResponse.data.data;
        const laundryProfile = laundryUser.attributes?.profile || {};

        return notifyBookingCancelled({
          to: laundryUser.attributes?.email,
          laundryName: laundryProfile.publicData?.laundryProfile?.studioName,
          garmentTitle: listing.attributes?.title,
          customerName: customer?.attributes?.profile?.displayName,
          ticketCode: transaction.attributes?.metadata?.ticketCode,
          transactionId: txIdForLog,
        }).then(mailResult => {
          res
            .status(200)
            .set('Content-Type', 'application/json')
            .send({ data: { notified: true, mail: mailResult } })
            .end();
          return null;
        });
      });
    })
    .catch(e => {
      // AUTH FAILURES ARE REAL ERRORS (401/403) - everything else about the laundry mail
      // itself is swallowed above by notifyBookingCancelled/send(), which never rejects. This
      // catch only ever sees authentication/authorization failures or an unexpected Integration
      // API error (e.g. the laundry user lookup itself failing), and even those must not look
      // like the cancellation failed - this is a side-effect notifier for a transition that
      // has already succeeded.
      log.error(e, 'customer-cancel-notify-laundry-failed', {
        txId: txIdForLog,
        status: e?.status,
        message: e?.message,
      });
      if (e?.status === 401 || e?.status === 403) {
        handleError(res, e);
        return null;
      }
      return nothingToDo(res, 'error');
    });
};
