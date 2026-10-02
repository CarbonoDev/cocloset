const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { authorizeLaundryCaller } = require('../api-util/laundryAuth');
const { readAssignedLaundryId, resolveInitialCleaningDays } = require('../api-util/laundryAssignment');
const { writeCustodyMetadata, computeReadiness } = require('../api-util/listingCustody');
const {
  LISTING_CODE_KEY,
  TRANSACTION_CODE_KEY,
  buildListingCodeRecord,
  validateLaundryCode,
} = require('../api-util/laundryCode');
const {
  STATES,
  TRANSITIONS,
  stateFromLastTransition,
  isInvalidTransitionError,
} = require('../api-util/coclosetBookingProcess');
const log = require('../log');

// The studio taking a garment IN from its owner, at the start of a rental.
//
//   > "cuando el provider va a entregar una prenda a la laundry, la laundry debe ingresar un
//   >  ticket y luego iniciar el proceso de lavado, actualmente su acción es ingresar el
//   >  ticket y luego se marca como ready para el renter"
//   > "Si onLaundry es true, el siguiente paso es del renter quien va a laundry a recoger la
//   >  prenda que ya esta lista previamente" (Jonathan, 2026-09-08)
//
// POST /api/laundry-receive-garment
// Request body: { transactionId, laundryCode? }
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS AS A STEP OF ITS OWN
// ---------------------------------------------------------------------------
// Reception and "ready for the renter" were ONE action. So a studio taking a coat over the
// counter typed its shelf code, pressed the only button on offer, and the customer was told
// the garment was ready to collect - before it had been washed. The wash is the whole reason
// the garment comes here first.
//
// Splitting them needs no process change, and that is not a coincidence: the thing that
// distinguishes the two situations is already stored, and is the same flag the client named.
// `metadata.onLaundry` is whether the studio is holding the garment. A rental that begins
// with the garment at its owner's home starts `false`, and this endpoint is what turns it
// true; a rental on a garment already sitting on the studio's rack starts `true`, and this
// endpoint has nothing to do - the next thing that happens is the renter arriving to collect.
// So the ops screens offer THIS step while the flag is false and `laundry-mark-ready` once it
// is true, and no new transaction state was invented to say what a listing already knew.
//
// FIRES transition/laundry-receive-from-provider (2026-09-21), moving the transaction from
// `accepted` to `initial-cleaning`:
//
//   > "cuando laundry ingrese el ticket para iniciar el lavado, entre a un status de IN
//   >  CLEANING, en ambas direcciones, es decir, cuando el provider lleve la prenda por
//   >  primera vez" (Jonathan, 2026-09-21)
//
// This used to be a metadata-only write with NO transition, specifically to avoid the cost of
// a `flex-cli process push` plus an alias update for a first pass. That trade-off no longer
// applies: a push is happening anyway (bundled with the review-flow change this same day), so
// the garment being physically received gets a real, visible state instead of hiding inside
// `accepted`. The custody and code writes below are unchanged - only the missing transition
// call is new.
//
// ---------------------------------------------------------------------------
// WHY THE CUSTODY WRITE IS NOT GATED HERE
// ---------------------------------------------------------------------------
// server/api/listing-custody-status.js refuses to run while the listing has an active
// transaction, on purpose: an explicit custody claim mid-rental has no legitimate meaning.
// This is not that. It is the same kind of writer as the one on `laundry-confirm-return` -
// the garment is physically on the counter and the platform is recording an observation, not
// a decision - and its transaction is by definition active (`accepted`). It is also monotone:
// it only ever sets `true`. Handing the garment back stays with the gated endpoint.
//
// ---------------------------------------------------------------------------
// WHY THIS ALSO WRITES `readyAt` NOW - THE "PICKUP TODAY" BUG
// ---------------------------------------------------------------------------
//   > "el UX debe permitirnos hacer el booking a partir del día de hoy... solo en aquellos
//   >  listings que (...) hayan terminado su proceso de lavado" (Jonathan, 2026-09-28)
//   > "hay que asegurarnos de que un listing no muestre pickup today si la laundry no ha
//   >  terminado de finalizar el lavado" (Jonathan, 2026-10-02)
//
// `resolveInitialCleaningDays` (util/cleaningFloor.js) returns NO floor at all - null, same
// as a listing nobody has ever assigned - the instant `onLaundry` is true. That rule predates
// same-day booking and is correct for its own question ("can tomorrow be offered"): a garment
// that has physically reached its studio will always have had a full day by tomorrow. It
// answers the WRONG question for "can TODAY be offered": a garment received five minutes ago,
// mid FIRST wash, also reads `onLaundry: true` with no floor, so `canBeCollectedToday` saw
// nothing to block it and showed the badge before the wash had even started.
//
// The fix reuses the exact mechanism already built for the OTHER side of a rental
// (api-util/listingCustody.js `computeReadiness`, fired on `laundry-confirm-return` with
// "wash starts tomorrow, not today") rather than inventing a second one: on reception, this
// garment's custody clock starts now exactly the way a return's does, so it gets the same
// `readyAt` estimate - today's reception plus this studio's resolved turnaround, washing days
// starting tomorrow. `earliestBookableStart` already prefers `readyAt` over the (now-null)
// initial-cleaning floor, so the badge and the booking picker both start blocking today
// immediately, with no client change needed.
//
// NOT A GUARANTEE EITHER, and said so rather than hidden: this is an ESTIMATE made at
// reception, the same status every other turnaround number in this codebase already has (the
// pre-arrival lead time it replaces was exactly as approximate, and the RETURN flow's own
// `readyAt` - api-util/listingCustody.js `writeReadiness`, fired on `laundry-confirm-return` -
// has lived with the identical trade-off since it shipped: nothing re-opens or re-closes the
// floor if the actual wash finishes earlier or later than the number it was computed from).
// Over-blocking is recoverable by nobody noticing a badge that could have shown a day sooner;
// a studio that runs long opens the floor before the real wash finishes, same residual risk
// `writeReadiness` already carries. Tightening that for BOTH flows - reacting to the actual
// `ready-for-pickup`/`laundry-mark-ready` moment rather than an estimate made in advance - is
// a larger change than this fix and left for later.
//
// Success response (200): { data: { onLaundry: true, laundryCode } }
// Failure responses:
//   400 - missing transactionId, or an invalid laundryCode
//   401 - no usable session
//   403 - caller is not the laundry assigned to this listing
//   409 - the rental is not at `accepted`, or the studio already holds the garment
//   otherwise: standard handleError() shape (see api-util/sdk.js).

const httpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  error.statusText = message;
  error.data = {};
  return error;
};

module.exports = (req, res) => {
  const { transactionId, laundryCode } = req.body || {};

  if (!transactionId) {
    res
      .status(400)
      .json({ error: 'Missing required "transactionId" in request body.' })
      .end();
    return;
  }

  const codeCheck = validateLaundryCode(laundryCode);
  if (!codeCheck.valid) {
    res
      .status(400)
      .json({ error: 'Invalid "laundryCode" in request body.' })
      .end();
    return;
  }

  const integrationSdk = getIntegrationSdk();

  integrationSdk.transactions
    .show({ id: transactionId, include: ['listing'] })
    .then(response => {
      const transaction = response.data.data;
      const listing = (response.data.included || []).find(entity => entity.type === 'listing');

      if (!listing) {
        throw httpError(422, 'This transaction has no listing.');
      }

      return authorizeLaundryCaller(req, res, readAssignedLaundryId(listing)).then(currentUser => {
        const state = stateFromLastTransition(transaction?.attributes?.lastTransition);
        // Reception only happens at the start of the rental. Later states have their own
        // steps, and a studio pressing this from a stale screen must not silently claim
        // custody of a garment that is out with a customer.
        if (state !== STATES.ACCEPTED) {
          throw httpError(
            409,
            `This rental is not awaiting drop-off (it is ${state || 'unknown'}).`
          );
        }
        // Already here, so there is nothing to receive - this is the rental that skips
        // straight to the renter collecting. Refused rather than treated as a no-op: a
        // button that appears to do something and does nothing is worse than an error.
        if (listing?.attributes?.metadata?.onLaundry === true) {
          throw httpError(409, 'This garment is already at the studio.');
        }

        return { listing, currentUser };
      });
    })
    .then(({ listing, currentUser }) =>
      // THE TRANSITION FIRST (2026-09-21), because Sharetribe's own legality check is the
      // authoritative one - the state check above can be stale by the time this runs, exactly
      // like every other endpoint that fires a real transition (laundry-transaction-status.js,
      // auto-accept-booking.js). If the platform disagrees, nothing else in this request should
      // run.
      integrationSdk.transactions
        .transition(
          { id: transactionId, transition: TRANSITIONS.LAUNDRY_RECEIVE_FROM_PROVIDER, params: {} },
          { expand: true }
        )
        .then(() => ({ listing, currentUser }))
    )
    .then(({ listing, currentUser }) => {
      // The estimated `readyAt`, computed the same way a return's is - see the header comment
      // on why reception needs one at all now. Resolved from THIS studio's own configured
      // turnaround for the garment's category, same chain `/api/laundry-orders` already uses
      // to show it on the ops table.
      const cleaningDays = resolveInitialCleaningDays({
        laundryPrivateData: currentUser?.attributes?.profile?.privateData,
        listingPublicData: listing?.attributes?.publicData,
        envDefaultBufferDays: process.env.DEFAULT_LAUNDRY_BUFFER_DAYS,
      });
      const timeZone = listing?.attributes?.availabilityPlan?.timezone;
      const { readyAt } = computeReadiness({ returnedAt: new Date(), cleaningDays, timeZone });

      // The custody flag NEXT, because it is what the ops screens read to decide which step
      // to offer next. The code writes below are useful but not load-bearing: if one of them
      // fails the studio can type the code again, whereas a lost custody write leaves the
      // step it just completed still on offer.
      return writeCustodyMetadata({
        integrationSdk,
        listingId: listing.id,
        onLaundry: true,
        readyAt,
      }).then(() => listing);
    })
    .then(listing => {
      // The code goes on the TRANSACTION (what this rental was given) and on the LISTING
      // (what this garment currently carries, stamped with the studio that issued it - see
      // api-util/laundryCode.js). Fire-and-continue, exactly like the equivalent writes in
      // laundry-transaction-status.js: custody has already been recorded, and failing the
      // request over a label would make the ops screen retry a reception that happened.
      if (codeCheck.value) {
        Promise.resolve()
          .then(() =>
            integrationSdk.transactions.updateMetadata({
              id: transactionId,
              metadata: { [TRANSACTION_CODE_KEY]: codeCheck.value },
            })
          )
          .then(() =>
            integrationSdk.listings.update({
              id: listing.id,
              metadata: {
                [LISTING_CODE_KEY]: buildListingCodeRecord({
                  code: codeCheck.value,
                  laundryId: readAssignedLaundryId(listing),
                }),
              },
            })
          )
          .catch(codeError => {
            log.error(codeError, 'laundry-receive-garment-code-write-failed', {
              txId: transactionId,
            });
          });
      }

      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: { onLaundry: true, laundryCode: codeCheck.value || null } })
        .end();
    })
    .catch(e => {
      // Sharetribe refusing transition/laundry-receive-from-provider as illegal from the
      // current state is an expected, client-visible outcome (a stale ops screen), not a
      // server fault - same reshaping as laundry-transaction-status.js.
      if (isInvalidTransitionError(e)) {
        handleError(
          res,
          httpError(
            409,
            `This rental is not awaiting drop-off (transaction ${transactionId} is not at accepted).`
          )
        );
        return;
      }
      handleError(res, e);
    });
};
