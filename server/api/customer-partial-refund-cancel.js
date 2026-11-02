const Stripe = require('stripe');

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { getSdk, handleError } = require('../api-util/sdk');
const { uuidString } = require('../api-util/uuid');
const { readAssignedLaundryId } = require('../api-util/laundryAssignment');
const { notifyPartialRefundBookingCancelled } = require('../api-util/laundryMailer');
const { TRANSITIONS, isCoclosetBookingListing } = require('../api-util/coclosetBookingProcess');
const log = require('../log');

/**
 * POST /api/customer-partial-refund-cancel   body: { transactionId }
 *
 * Customer self-cancellation AFTER the garment has already reached the laundry for its first
 * wash (`state/initial-cleaning`, via `transition/laundry-receive-from-provider`). Unlike the
 * earlier full-refund self-cancel (a different, already-merged feature that fires an
 * unprivileged `transition/customer-cancel` directly from the browser), this one cannot be a
 * plain SDK transition: the refund here is PARTIAL (total minus the cleaning fee, since the
 * laundry already did real work receiving and inspecting the garment), and Sharetribe's own
 * refund actions (`calculate-full-refund`, `stripe-refund-payment`) are always 100%-or-nothing
 * - see the EDN's own comment on `transition/partial-refund-cancel-from-initial-cleaning` for
 * the full argument and the client's explicit sign-off on bypassing Sharetribe's refund/payout
 * bookkeeping for this one path. So the money movement happens HERE, against Stripe directly,
 * and the transition is fired only once that has genuinely succeeded.
 *
 * ---------------------------------------------------------------------------
 * THIS ENDPOINT IS THE PRIMARY ACTION, NOT A SIDE EFFECT
 * ---------------------------------------------------------------------------
 * Unlike server/api/customer-cancel-notify-laundry.js (a fire-and-continue notifier for a
 * transition that already succeeded, which always returns 200), this endpoint IS the thing
 * the customer is waiting on - the browser shows a non-dismissible "processing" state while
 * this is in flight (the client's own UX requirement) - so every response has to be an honest,
 * final answer about what actually happened to the customer's money and the booking.
 *
 * Modelled on server/api/auto-accept-booking.js for the auth/idempotency shape (authenticate,
 * verify the caller is a real party, verify the process, verify the precondition, make the
 * call, respond with the real entity), but adapted rather than copied: this endpoint also
 * moves money through a second system (Stripe) that Sharetribe's own transition retry
 * semantics know nothing about, which is what makes idempotency here a genuine three-state
 * state machine rather than auto-accept's simple "already done or not".
 *
 * ---------------------------------------------------------------------------
 * THE STATE MACHINE THIS ENDPOINT RESUMES FROM, AND WHY IT IS NOT BINARY
 * ---------------------------------------------------------------------------
 * A naive "did the transition fire yet?" check misses the one state that matters most: Stripe
 * succeeded but the Sharetribe transition call that was supposed to follow it failed (network
 * blip, Sharetribe hiccup, the request got cut off after the refund settled). That is real
 * money already moved with the booking not yet reflecting it - checked for and resumed from
 * BEFORE any new Stripe call is attempted, via `metadata.partialRefundStripeId` (written right
 * after the refund succeeds, before the transition is even attempted - see the ordering below).
 * Concretely, on every call this endpoint first asks, in order:
 *
 *   1. Has `transition/partial-refund-cancel-from-initial-cleaning` already fired? ->
 *      Everything already happened; report the stored result as a success, no new work.
 *   2. Is `metadata.partialRefundStripeId` already set (Stripe succeeded, transition did not)?
 *      -> Resume from the transition step only. NEVER call Stripe again on this path - that
 *      would risk a double refund on a retry.
 *   3. Neither -> the full flow: eligibility, amount, Stripe, audit write, transition.
 */

// ext/server/api-util/lineItemHelpers.js defines LINE_ITEM_CLEANING_FEE as this exact string
// but does not export it; every other reader of this code in this codebase (lineItems.test.js,
// lineItemHelpers.test.js) also matches it as a literal rather than importing a constant that
// is not exported, so this follows the same precedent rather than widening that file's exports
// for one caller.
const LINE_ITEM_CLEANING_FEE = 'line-item/cleaning-fee';

const httpError = (status, message, data = {}) => {
  const error = new Error(message);
  error.status = status;
  error.statusText = message;
  error.data = data;
  return error;
};

const isCustomerOfTransaction = (transaction, currentUserId) => {
  const customerId = transaction?.relationships?.customer?.data?.id?.uuid;
  return !!currentUserId && currentUserId === customerId;
};

const findIncluded = (included, ref, type) =>
  ref ? included.find(i => i.type === type && i.id.uuid === ref.id.uuid) : null;

// Fire-and-continue, exactly like every other laundry notification in this codebase (see the
// header of server/api-util/laundryMailer.js): the refund and the transition have ALREADY
// succeeded by the time this runs, so a missing laundry assignment or an unreachable Mailgun
// account must never affect the response already being sent to the customer.
const notifyLaundryMaybe = ({ integrationSdk, listing, customer, transactionId, txIdForLog }) => {
  const assignedLaundryId = readAssignedLaundryId(listing);
  if (!assignedLaundryId) {
    return;
  }
  integrationSdk.users
    .show({ id: assignedLaundryId })
    .then(laundryResponse => {
      const laundryUser = laundryResponse.data.data;
      const laundryProfile = laundryUser.attributes?.profile || {};
      return notifyPartialRefundBookingCancelled({
        to: laundryUser.attributes?.email,
        laundryName: laundryProfile.publicData?.laundryProfile?.studioName,
        garmentTitle: listing?.attributes?.title,
        customerName: customer?.attributes?.profile?.displayName,
        transactionId: txIdForLog,
      });
    })
    .catch(e => {
      log.error(e, 'customer-partial-refund-cancel-laundry-notify-failed', {
        txId: txIdForLog,
        transactionId,
      });
    });
};

/**
 * Fire the Sharetribe transition and send the final response. Shared by the fresh-success path
 * and the "Stripe already succeeded, transition did not" resume path - both are, at this point,
 * exactly the same remaining work.
 */
const fireTransitionAndRespond = ({
  res,
  integrationSdk,
  transactionId,
  txIdForLog,
  listing,
  customer,
  refundAmount,
  refundCurrency,
}) => {
  return integrationSdk.transactions
    .transition(
      { id: transactionId, transition: TRANSITIONS.PARTIAL_REFUND_CANCEL_FROM_INITIAL_CLEANING, params: {} },
      { expand: true }
    )
    .then(transitionResponse => {
      notifyLaundryMaybe({ integrationSdk, listing, customer, transactionId, txIdForLog });

      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({
          data: {
            refunded: true,
            cancelled: true,
            requiresManualFollowUp: false,
            refundAmount,
            refundCurrency,
            transition: TRANSITIONS.PARTIAL_REFUND_CANCEL_FROM_INITIAL_CLEANING,
            transaction: transitionResponse?.data?.data || null,
          },
        })
        .end();
      return null;
    })
    .catch(e => {
      // THE HIGH-STAKES CASE. Stripe's refund has ALREADY settled (either just now, or on a
      // previous attempt this call is resuming) and this transition call failed anyway. Money
      // has moved; the booking does not yet say so. A plain error response here would invite a
      // retry that calls Stripe a second time if the retry path were ever wrong - it is not,
      // see the idempotency checks above - but more importantly, telling the customer "it
      // failed, try again" when they have already been charged correctly (refunded, in this
      // case) is the wrong failure mode. So this responds 200, honestly: the refund happened,
      // the cancellation itself has not yet been recorded, and it says so explicitly rather
      // than hiding it behind a generic error.
      //
      // LOGGED UNDER A DELIBERATELY DISTINCT, LOUD CODE an ops person grepping logs would
      // recognise immediately as needing manual follow-up (fire the transition by hand via the
      // Integration API, or Console).
      log.error(e, 'partial-refund-succeeded-transition-failed', {
        txId: txIdForLog,
        refundAmount,
        refundCurrency,
        message: e?.message,
      });

      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({
          data: {
            refunded: true,
            cancelled: false,
            requiresManualFollowUp: true,
            refundAmount,
            refundCurrency,
            transition: null,
            transaction: null,
          },
        })
        .end();
      return null;
    });
};

module.exports = (req, res) => {
  // Same normalisation as every other endpoint here - see api-util/uuid.js.
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

      // 2. AUTHENTICATION done above (401). 4. AUTHORIZATION: must be the CUSTOMER on this
      // transaction - never the provider, never a stranger with a guessed id.
      if (!isCustomerOfTransaction(transaction, currentUserId)) {
        log.error(
          new Error('customer-partial-refund-cancel called by a non-customer'),
          'customer-partial-refund-cancel-forbidden',
          { txId: txIdForLog, currentUserId }
        );
        throw httpError(403, 'Caller is not the customer on this transaction.');
      }

      const listingRef = transaction.relationships?.listing?.data;
      const customerRef = transaction.relationships?.customer?.data;
      const listing = findIncluded(included, listingRef, 'listing');
      const customer = findIncluded(included, customerRef, 'user');

      // 5. PROCESS CHECK: this endpoint has no business on any process but cocloset-booking.
      if (!isCoclosetBookingListing(listing)) {
        throw httpError(422, 'Not a cocloset-booking transaction.', {
          error: 'not-a-cocloset-booking',
        });
      }

      const lastTransition = transaction.attributes?.lastTransition;
      const metadata = transaction.attributes?.metadata || {};

      // 7a. IDEMPOTENCY, FULLY DONE: the transition already fired (a retry/double-click after
      // a request that already completed end to end). Report the stored result as a success -
      // no new Stripe call, no new transition attempt.
      if (lastTransition === TRANSITIONS.PARTIAL_REFUND_CANCEL_FROM_INITIAL_CLEANING) {
        res
          .status(200)
          .set('Content-Type', 'application/json')
          .send({
            data: {
              refunded: true,
              cancelled: true,
              requiresManualFollowUp: false,
              refundAmount: metadata.partialRefundAmount ?? null,
              refundCurrency: metadata.partialRefundCurrency ?? null,
              transition: TRANSITIONS.PARTIAL_REFUND_CANCEL_FROM_INITIAL_CLEANING,
              transaction,
              alreadyDone: true,
            },
          })
          .end();
        return null;
      }

      // 6. ELIGIBILITY: must currently be sitting in state/initial-cleaning, i.e. the last
      // transition that actually fired on this transaction was laundry-receive-from-provider.
      // A clear, distinguishable 409 - the client UI needs to tell the customer *why* this
      // didn't work, not just "something went wrong".
      if (lastTransition !== TRANSITIONS.LAUNDRY_RECEIVE_FROM_PROVIDER) {
        throw httpError(409, 'Transaction is not eligible for a partial-refund cancellation.', {
          error: 'not-eligible',
          reason: 'wrong-state',
        });
      }

      // 7b. IDEMPOTENCY, STRIPE-SUCCEEDED-BUT-TRANSITION-NOT-YET-FIRED. A previous attempt's
      // Stripe call succeeded (metadata.partialRefundStripeId was written right after it, see
      // below) but the transition call that was supposed to follow never landed. Resume from
      // the transition only - calling Stripe again here would risk a second, real refund.
      if (metadata.partialRefundStripeId) {
        return fireTransitionAndRespond({
          res,
          integrationSdk,
          transactionId,
          txIdForLog,
          listing,
          customer,
          refundAmount: metadata.partialRefundAmount,
          refundCurrency: metadata.partialRefundCurrency,
        });
      }

      // 8. RESOLVE THE STRIPE PAYMENT INTENT ID. Written onto transaction.attributes.metadata
      // by the capturePaymentIntentIdMaybe mechanism (server/api/initiate-privileged.js /
      // transition-privileged.js - see the ledger branch referenced in this task's own
      // instructions) right after the PaymentIntent is created, because Sharetribe deletes it
      // from protectedData once payment is confirmed. A transaction that predates that
      // mechanism has none - EXPECTED, not a bug - and gets a clear, distinct 422 rather than a
      // crash or a confusing Stripe error.
      const stripePaymentIntentId = metadata.stripePaymentIntentId;
      if (!stripePaymentIntentId) {
        throw httpError(422, 'No Stripe PaymentIntent on record for this transaction.', {
          error: 'no-payment-intent-on-record',
          reason: 'predates-ledger',
        });
      }

      // 9. COMPUTE THE REFUND AMOUNT: payinTotal minus the cleaning-fee line item, in the
      // currency's smallest unit - the same unit both Sharetribe's Money type and Stripe's
      // `amount` parameter use, so no conversion is needed.
      const payinTotal = transaction.attributes?.payinTotal;
      const lineItems = Array.isArray(transaction.attributes?.lineItems)
        ? transaction.attributes.lineItems
        : [];
      const cleaningFeeLineItem = lineItems.find(li => li.code === LINE_ITEM_CLEANING_FEE);

      if (!cleaningFeeLineItem) {
        // There's nothing to withhold, so the fallback is a full refund of payinTotal rather
        // than failing the request - but this should not happen for a transaction that reached
        // initial-cleaning (the cleaning fee line item is added whenever the category is
        // priceable; see lineItemHelpers.getCleaningFeeLineItemMaybe), so it is logged loudly.
        log.error(
          new Error('customer-partial-refund-cancel: no cleaning-fee line item found'),
          'customer-partial-refund-cancel-no-cleaning-fee-line-item',
          { txId: txIdForLog }
        );
      }

      const payinAmount = payinTotal?.amount;
      const currency = payinTotal?.currency;
      const cleaningFeeAmount = cleaningFeeLineItem?.lineTotal?.amount || 0;

      if (!Number.isInteger(payinAmount) || !currency) {
        throw httpError(500, 'Unexpected: missing or invalid payinTotal on transaction.', {
          error: 'invalid-payin-total',
        });
      }

      const refundAmount = payinAmount - cleaningFeeAmount;

      if (!Number.isInteger(refundAmount) || refundAmount <= 0) {
        log.error(
          new Error('customer-partial-refund-cancel: computed non-positive refund amount'),
          'customer-partial-refund-cancel-invalid-refund-amount',
          { txId: txIdForLog, payinAmount, cleaningFeeAmount, refundAmount }
        );
        throw httpError(500, 'Unexpected: computed non-positive refund amount.', {
          error: 'invalid-refund-amount',
        });
      }

      // 10. CALL STRIPE DIRECTLY. Its own try/catch, distinct from everything else in this
      // request: if THIS throws, no money has moved at all, and the response says so plainly
      // so the UI does not scare the customer into thinking they were charged twice on retry.
      const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

      return stripe.refunds
        .create({ payment_intent: stripePaymentIntentId, amount: refundAmount })
        .catch(stripeError => {
          log.error(stripeError, 'customer-partial-refund-cancel-stripe-failed', {
            txId: txIdForLog,
            stripePaymentIntentId,
            refundAmount,
            currency,
          });
          throw httpError(
            502,
            'The refund could not be processed. Nothing was charged or refunded. Please try again or contact support.',
            { error: 'stripe-refund-failed' }
          );
        })
        .then(refund => {
          // 11. AUDIT WRITE, BEFORE the transition and in its own try/catch. If the transition
          // call below fails, this write is what lets a retry (or a human) know the money
          // already moved - see 7b above. If even THIS write fails, the Stripe refund record
          // itself is still the fallback source of truth, so this logs as critically as
          // possible and continues to the transition anyway rather than giving up on a refund
          // that genuinely happened.
          return integrationSdk.transactions
            .updateMetadata({
              id: transactionId,
              metadata: {
                partialRefundStripeId: refund.id,
                partialRefundAmount: refundAmount,
                partialRefundCurrency: currency,
                partialRefundAt: new Date().toISOString(),
              },
            })
            .catch(auditError => {
              log.error(
                auditError,
                'customer-partial-refund-cancel-audit-write-failed-MONEY-MOVED',
                {
                  txId: txIdForLog,
                  stripeRefundId: refund.id,
                  refundAmount,
                  currency,
                }
              );
              return null;
            })
            .then(() =>
              // 12. FIRE THE TRANSITION.
              fireTransitionAndRespond({
                res,
                integrationSdk,
                transactionId,
                txIdForLog,
                listing,
                customer,
                refundAmount,
                refundCurrency: currency,
              })
            );
        });
    })
    .catch(e => {
      log.error(e, 'customer-partial-refund-cancel-failed', {
        txId: txIdForLog,
        status: e?.status,
        message: e?.message,
      });
      handleError(res, e);
    });
};
