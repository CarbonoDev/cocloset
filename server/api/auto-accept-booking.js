const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { getSdk, handleError } = require('../api-util/sdk');
const { uuidString } = require('../api-util/uuid');
const { buildBufferForAcceptedTransaction } = require('../api-util/availabilityBuffer');
const {
  ACCEPT_TRANSITIONS,
  STATES,
  TRANSITIONS,
  isCoclosetBookingListing,
  stateFromLastTransition,
} = require('../api-util/coclosetBookingProcess');
const log = require('../log');

/**
 * POST /api/auto-accept-booking   body: { transactionId }
 *
 * Accept a paid booking on the operator's behalf when the garment is ALREADY at its laundry.
 *
 *   > "si la prenda esta onLaundry = true, no tiene caso que el provider acepte, se debe
 *   >  confirmar automáticamente, no representaría hacer un segundo flujo, si no actualizar
 *   >  el mismo para que el provider acepte o un administrador acepte para que lleguen al
 *   >  mismo step"
 *
 * ---------------------------------------------------------------------------
 * NO PROCESS CHANGE WAS NEEDED
 * ---------------------------------------------------------------------------
 * `transition/operator-accept` already exists in `cocloset-booking`, with the same two
 * actions as `transition/accept` (`accept-booking`, `stripe-capture-payment-intent`), the
 * same `preauthorized -> accepted`, and notifications to both parties. So the client's
 * "el provider acepta o un administrador acepta y llegan al mismo step" was already true of
 * the process; what did not exist was anything that FIRES the operator's half.
 *
 * It could not be a process rule either. A Sharetribe transition cannot read a listing's
 * `metadata`, so "accept automatically if this garment is at its studio" is not expressible
 * in the EDN at all - the condition lives outside the state machine, which is why the trigger
 * has to live here.
 *
 * ---------------------------------------------------------------------------
 * THE CONDITION, AND WHERE IT IS READ FROM
 * ---------------------------------------------------------------------------
 * `listing.metadata.onLaundry === true`, read from the STORED listing and never from the
 * request. That field is Integration-API-only (the Marketplace API refuses an owner's write
 * with 400 `validation-disallowed-key`, verified against Dev - see api-util/laundryAssignment.js),
 * so it cannot be asserted by whoever calls this endpoint. `=== true` rather than truthiness,
 * matching every other reader of this flag: only a real boolean is custody, and bad data must
 * not be able to auto-accept a booking for a garment sitting in its owner's wardrobe.
 *
 * When the garment is NOT at its studio, this does nothing and says so. The provider's own
 * accept is then the only way forward, exactly as before - this endpoint adds a door, it does
 * not close one.
 *
 * ---------------------------------------------------------------------------
 * AUTHORIZATION, AND WHY IT IS LIGHT
 * ---------------------------------------------------------------------------
 * The caller must be authenticated and a party to the transaction. That is deliberately all,
 * because being a party buys nothing here: the endpoint takes no argument that changes what
 * it does. Whether it accepts is decided entirely by the transaction's own state and the
 * listing's own metadata, both read server-side. A customer calling it for their own booking
 * gets the same answer the provider would, and the same answer a second call gets.
 *
 * What that means for the provider is worth stating plainly: for a garment already at its
 * studio, the provider no longer gets to decline. That is the client's intent - "no tiene
 * caso que el provider acepte" - not an oversight.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENT
 * ---------------------------------------------------------------------------
 * The browser fires this after payment confirmation, and a customer who reloads or
 * double-submits must not produce a second attempt at a transition Sharetribe would 409. So
 * an already-accepted transaction is a 200 with `reason: 'already-accepted'`, not an error:
 * the caller wanted the booking accepted, and it is.
 */

const httpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  error.statusText = message;
  error.data = {};
  return error;
};

const isPartyToTransaction = (transaction, currentUserId) => {
  const relationships = transaction?.relationships || {};
  const customerId = relationships.customer?.data?.id?.uuid;
  const providerId = relationships.provider?.data?.id?.uuid;
  return !!currentUserId && (currentUserId === customerId || currentUserId === providerId);
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
  // NORMALISED BEFORE IT TOUCHES THE INTEGRATION SDK. The browser sends the order's own
  // `UUID`, which arrives here as a FLEX-SDK UUID after the transit decode - and the
  // Integration SDK's query serializer only accepts its own UUID class, so the id fell past
  // every branch and threw "Don't know how to serialize query parameter 'id': [object
  // Object]". Every auto-accept has been failing on that, logged and swallowed, since the
  // call site moved to step 3. See api-util/uuid.js.
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
        .show({ id: transactionId, include: ['listing', 'booking', 'customer', 'provider'] })
        .then(transactionResponse => ({ currentUserId, transactionResponse }));
    })
    .then(({ currentUserId, transactionResponse }) => {
      const { data: transaction, included = [] } = transactionResponse.data;

      if (!isPartyToTransaction(transaction, currentUserId)) {
        log.error(
          new Error('auto-accept-booking called by a non-party'),
          'auto-accept-booking-forbidden',
          { txId: txIdForLog, currentUserId }
        );
        throw httpError(403, 'Caller is not a party to this transaction.');
      }

      const listingRef = transaction.relationships?.listing?.data;
      const listing = listingRef
        ? included.find(i => i.type === 'listing' && i.id.uuid === listingRef.id.uuid)
        : null;

      // Every other process in this template accepts differently, and none of them has a
      // laundry to be at.
      if (!isCoclosetBookingListing(listing)) {
        return nothingToDo(res, 'not-a-cocloset-booking');
      }

      const lastTransition = transaction.attributes?.lastTransition;

      if (ACCEPT_TRANSITIONS.includes(lastTransition)) {
        return nothingToDo(res, 'already-accepted');
      }

      // Only `preauthorized` can be accepted. Anything else - still awaiting payment, already
      // declined, already past accept - is a state this endpoint has no business moving, and
      // Sharetribe would refuse it anyway.
      if (stateFromLastTransition(lastTransition) !== STATES.PREAUTHORIZED) {
        return nothingToDo(res, 'not-awaiting-acceptance');
      }

      // THE WHOLE CONDITION. A garment that is not at its studio still needs its owner to
      // hand it over, so the provider's own accept remains the only way forward.
      if (listing?.attributes?.metadata?.onLaundry !== true) {
        return nothingToDo(res, 'garment-not-at-laundry');
      }

      return integrationSdk.transactions
        .transition(
          { id: transactionId, transition: TRANSITIONS.OPERATOR_ACCEPT, params: {} },
          { expand: true }
        )
        .then(transitionResponse =>
          // The calendar block normally rides on a browser hook fired after the PROVIDER
          // accepts (server/api/create-availability-buffer.js). That hook cannot run here -
          // nobody accepted from a sale page - so the same work happens inline, through the
          // one shared implementation. Without it an auto-accepted garment would stay
          // bookable for the whole of its own rental.
          buildBufferForAcceptedTransaction({
            integrationSdk,
            transaction,
            included,
            txIdForLog,
          })
            .catch(e => {
              // The booking IS accepted at this point. A failed block is serious - the garment
              // is double-bookable until someone notices - but it is not a reason to tell the
              // customer their payment did not go through. Logged loudly, reported in the body.
              log.error(e, 'auto-accept-booking-buffer-failed', {
                txId: txIdForLog,
                message: e?.message,
              });
              return { skipped: true, reason: 'buffer-failed' };
            })
            .then(bufferResult => ({
              bufferResult,
              acceptedTransaction: transitionResponse?.data?.data || null,
            }))
        )
        .then(({ bufferResult, acceptedTransaction }) => {
          res
            .status(200)
            .set('Content-Type', 'application/json')
            .send({
              data: {
                accepted: true,
                transition: TRANSITIONS.OPERATOR_ACCEPT,
                // THE ACCEPTED TRANSACTION ITSELF.
                //
                //   > "se hace el autoaccept y esto funciona, pero el customer debe hacer
                //   >  refresh para ver el nuevo status" (Jonathan, 2026-09-07)
                //
                // The caller persisted the order BEFORE calling this, so what its page is
                // rendering is the pre-acceptance transaction. It has been sitting here all
                // along - `expand: true` on the transition above returns it - and returning
                // it lets the browser replace what it stored instead of waiting for a
                // reload.
                //
                // The ENTITY, not a flag the client turns back into one: a locally patched
                // `lastTransition` would be a second source of truth for a state the process
                // owns, and the first time our guess and Sharetribe's record diverged, nobody
                // would see it.
                transaction: acceptedTransaction,
                buffer: bufferResult?.skipped ? null : bufferResult,
                bufferSkippedReason: bufferResult?.skipped ? bufferResult.reason : null,
              },
            })
            .end();
          return null;
        });
    })
    .catch(e => {
      log.error(e, 'auto-accept-booking-failed', {
        txId: txIdForLog,
        status: e?.status,
        message: e?.message,
      });
      handleError(res, e);
    });
};
