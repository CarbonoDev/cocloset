const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { authorizeLaundryCaller } = require('../api-util/laundryAuth');
const { readAssignedLaundryId } = require('../api-util/laundryAssignment');
const { writeCustodyMetadata } = require('../api-util/listingCustody');
const {
  LISTING_CODE_KEY,
  TRANSACTION_CODE_KEY,
  buildListingCodeRecord,
  validateLaundryCode,
} = require('../api-util/laundryCode');
const { STATES, stateFromLastTransition } = require('../api-util/coclosetBookingProcess');
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
// NO TRANSITION IS FIRED. The transaction stays in `accepted` for the length of the initial
// wash, which is what it means: the booking is agreed and the garment is not with the
// customer. `accepted -> accepted` would have been expressible (see
// `transition/laundry-start-cleaning`, a self-transition on `cleaning`), but it costs a
// `flex-cli process push` plus an alias update, and it would strand any transaction accepted
// under the old version. What is recorded instead is the physical fact, on the listing, which
// is where custody lives for every other reader already.
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

      return authorizeLaundryCaller(req, res, readAssignedLaundryId(listing)).then(() => {
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

        return { listing };
      });
    })
    .then(({ listing }) =>
      // The custody flag FIRST, because it is what the ops screens read to decide which step
      // to offer next. The code writes below are useful but not load-bearing: if one of them
      // fails the studio can type the code again, whereas a lost custody write leaves the
      // step it just completed still on offer.
      writeCustodyMetadata({ integrationSdk, listingId: listing.id, onLaundry: true }).then(
        () => listing
      )
    )
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
      handleError(res, e);
    });
};
