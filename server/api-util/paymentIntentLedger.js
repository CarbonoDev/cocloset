// Stashing the Stripe PaymentIntent id somewhere Sharetribe never clears.
//
// THE PROBLEM THIS EXISTS TO SOLVE
// Sharetribe exposes a transaction's Stripe PaymentIntent id at
// `protectedData.stripePaymentIntents.default.stripePaymentIntentId`, but
// ONLY between `:action/stripe-create-payment-intent` running and
// `:action/stripe-confirm-payment-intent` running - Sharetribe itself deletes
// that protectedData key once the PaymentIntent is confirmed. After that (i.e.
// for the rest of the booking's life: accepted, initial-cleaning, ...) there
// is NO way to retrieve the PaymentIntent/charge id for a transaction through
// either the Marketplace API or the Integration API. Verified against
// Sharetribe's own docs.
//
// A later feature (partial refunds via direct Stripe calls, tracked
// separately) needs this id against an already-far-along transaction, so it
// has to be captured at the ONE moment it is visible - right after the
// PaymentIntent is created, in the SAME request that creates it - and written
// into `metadata`, which Sharetribe never clears.
//
// WHERE THIS IS CALLED FROM
// server/api/initiate-privileged.js and server/api/transition-privileged.js,
// in the same fire-and-continue slot as `generateHandoverQrMaybe` (see
// api-util/handoverQr.js for the GENERATION TIMING precedent this follows).
// Those call sites - not this module - apply the Cocloset-listing and
// speculative/transition gating, exactly the way `ensureHandoverQr` itself
// does not know about `isCoclosetBookingListing`; that check lives in each
// endpoint's own wrapper. This module only knows how to capture an id, not
// when it is appropriate to.
//
// NEVER REJECTS, same contract as `ensureHandoverQr`. This runs AFTER the
// booking response has already been sent to the browser, so a failure here
// must never surface to the user or retry the booking - it is logged and
// swallowed.
//
// The write is `integrationSdk.transactions.updateMetadata`, the same
// top-level-shallow-merge Integration API call `ensureHandoverQr` uses:
// sibling metadata keys (`handoverQr`, `ticketCode`, `cleaningPhase`,
// `offers`, ...) survive untouched.

// The metadata key. One place, because it is a wire contract between this
// module and whatever the (separate, not-yet-built) partial-refund feature
// reads it back with.
const PAYMENT_INTENT_METADATA_KEY = 'stripePaymentIntentId';

/**
 * Capture `transaction`'s Stripe PaymentIntent id into `metadata`, if one
 * exists and has not already been captured.
 *
 * No-ops (does not call the Integration API) when:
 *   - the transaction has no PaymentIntent id in `protectedData` right now.
 *     Not every transition that reaches this code path actually created a
 *     PaymentIntent - push-payment methods use a different action, for one -
 *     so absence is a normal case, not an error.
 *   - `metadata.stripePaymentIntentId` is already set to that SAME value.
 *     This is the idempotency guard: a retried/duplicate call (e.g. the
 *     caller's own fire-and-continue running twice for any reason) must not
 *     error or double-write.
 *
 * NEVER REJECTS. Catches everything, logs with `log.error(e,
 * 'payment-intent-ledger-capture-failed', { txId, ... })` on failure, and
 * resolves regardless - see the module header for why.
 *
 * @param {Object} params
 * @param {Object} params.integrationSdk - from api-util/integrationSdk
 * @param {Object} params.transaction - the transaction entity just
 *   returned by `transactions.initiate`/`initiateSpeculative`/`transition`/
 *   `transitionSpeculative` (i.e. `apiResponse.data.data`)
 * @param {Object} [params.log] - server/log.js (optional; injectable for tests)
 * @returns {Promise<{captured: boolean, stripePaymentIntentId?: string, error?: Error}>}
 */
const capturePaymentIntentIdMaybe = ({ integrationSdk, transaction, log }) => {
  const transactionUuid = transaction?.id?.uuid || transaction?.id;
  const stripePaymentIntentId =
    transaction?.attributes?.protectedData?.stripePaymentIntents?.default?.stripePaymentIntentId;

  if (!stripePaymentIntentId) {
    return Promise.resolve({ captured: false });
  }

  const alreadyCaptured =
    transaction?.attributes?.metadata?.[PAYMENT_INTENT_METADATA_KEY] === stripePaymentIntentId;
  if (alreadyCaptured) {
    return Promise.resolve({ captured: false });
  }

  return Promise.resolve()
    .then(() =>
      integrationSdk.transactions.updateMetadata({
        id: transactionUuid,
        metadata: { [PAYMENT_INTENT_METADATA_KEY]: stripePaymentIntentId },
      })
    )
    .then(() => ({ captured: true, stripePaymentIntentId }))
    .catch(error => {
      if (log?.error) {
        log.error(error, 'payment-intent-ledger-capture-failed', {
          txId: transactionUuid || 'unknown',
          message: error?.message,
        });
      }
      return { captured: false, error };
    });
};

module.exports = {
  PAYMENT_INTENT_METADATA_KEY,
  capturePaymentIntentIdMaybe,
};
