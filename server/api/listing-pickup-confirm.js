/**
 * POST /api/listing-pickup-confirm
 * Request body: { listingId, token }
 *
 * The one write this whole feature exists for: the laundry, standing at the counter with a
 * provider who has shown them a scanned pickup QR, confirms the hand-back.
 *
 * DELIBERATELY A SIBLING OF server/api/listing-custody-status.js, NOT A REPLACEMENT FOR IT.
 * That endpoint remains the trust-based door the ops dashboard's HandBackToOwnerButton always
 * used - a laundy that already has a garment's owner in front of them with no QR at all (the
 * common case before this feature existed) still uses it exactly as before, and this change
 * does not touch it. This is a SECOND, more-verified door for the specific flow Jonathan
 * asked for: the provider pauses their listing, is shown a QR, and only THAT QR's token lets
 * the write through this path - see api-util/listingPickupQr.js for why the token is a real
 * credential here, unlike the identifier-only transaction handover QR.
 *
 * Both doors end at the SAME write (assertNoActiveTransaction + writeCustodyMetadata +
 * the owner notification) - see api-util/listingCustody.js - so there is exactly one
 * implementation of "what a hand-back does", never two that can drift.
 *
 * WHY THE LAUNDRY-SESSION CHECK STAYS, ON TOP OF THE TOKEN
 * "nadie mas puede recoger mi prenda" (2026-09-30) is enforced by BOTH factors together: the
 * token (something the provider showed them, at the counter) and the caller's own laundy
 * login being the SPECIFIC studio assigned to this garment (something only that studio has).
 * Either alone would be weaker - a token with no session check could be confirmed by anyone
 * who intercepted a shared link; a laundy session with no token check is exactly the
 * unverified trust model this feature was built to add a stronger option alongside, not to
 * replace.
 *
 * Success (200): { data: { onLaundry: false, role: 'laundry' } } - same shape as
 *   listing-custody-status.js's own response, so any future shared client code can treat the
 *   two interchangeably.
 * Failure:
 *   400 - missing listingId or token
 *   401 - no usable session
 *   403 - caller is not the laundry assigned to this listing
 *   409 - the listing has an active transaction, is not onLaundry, or the token does not match
 *   otherwise: standard handleError() shape
 */

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { authorizeLaundryCaller } = require('../api-util/laundryAuth');
const { assertNoActiveTransaction, writeCustodyMetadata } = require('../api-util/listingCustody');
const { readAssignedLaundryId } = require('../api-util/laundryAssignment');
const { notifyGarmentHandedBack } = require('../api-util/laundryMailer');
const { pickupTokensMatch, PICKUP_TOKEN_METADATA_KEY } = require('../api-util/listingPickupQr');
const log = require('../log');

const conflictError = message => {
  const error = new Error(message);
  error.status = 409;
  error.statusText = message;
  error.data = {};
  return error;
};

module.exports = (req, res) => {
  const { listingId, token } = req.body || {};

  if (!listingId) {
    res.status(400).json({ error: 'Missing required "listingId" in request body.' }).end();
    return;
  }
  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'Missing required "token" in request body.' }).end();
    return;
  }

  const integrationSdk = getIntegrationSdk();

  integrationSdk.listings
    // include: ['author'] is required for the same reason listing-custody-status.js needs it -
    // without it the owner notification has no email address to send to.
    .show({ id: listingId, include: ['author'] })
    .then(listingResponse => {
      const listing = listingResponse.data.data;
      const owner = (listingResponse.data.included || []).find(entity => entity.type === 'user');

      return authorizeLaundryCaller(req, res, readAssignedLaundryId(listing)).then(
        currentUser => {
          const onLaundry = listing?.attributes?.metadata?.onLaundry === true;
          const storedToken = listing?.attributes?.metadata?.[PICKUP_TOKEN_METADATA_KEY];

          // Checked AFTER authorization, deliberately: a caller who is not even the right
          // laundry should get the same 403 they would from the trust-based door, not a 409
          // that confirms a token exists to probe against.
          if (!onLaundry || !pickupTokensMatch(token, storedToken)) {
            throw conflictError(
              'This pickup code is invalid or has already been used. Ask the provider for a fresh QR.'
            );
          }

          return assertNoActiveTransaction({ integrationSdk, listingId })
            .then(() => writeCustodyMetadata({ integrationSdk, listingId, onLaundry: false }))
            .then(() => {
              try {
                notifyGarmentHandedBack({
                  to: owner?.attributes?.email,
                  ownerName: owner?.attributes?.profile?.displayName,
                  garmentTitle: listing?.attributes?.title,
                  laundryName:
                    currentUser?.attributes?.profile?.publicData?.laundryProfile?.studioName ||
                    currentUser?.attributes?.profile?.displayName,
                  handedBackAt: new Date(),
                  listingId: listingId?.uuid || listingId,
                });
              } catch (mailError) {
                log.error(mailError, 'garment-handed-back-mail-failed', {
                  listingId: listingId?.uuid || listingId,
                });
              }
              return 'laundry';
            });
        }
      );
    })
    .then(role => {
      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: { onLaundry: false, role } })
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};
