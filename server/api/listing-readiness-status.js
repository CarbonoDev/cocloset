const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { authorizeLaundryCaller } = require('../api-util/laundryAuth');

// Values for `listing.metadata.readinessStatus` (design doc §8). Tracks the
// physical garment's state independent of any specific booking - e.g. a
// garment can be "incoming" or "stored" with no active transaction at all.
const READINESS_STATUSES = ['incoming', 'stored', 'available'];

// Lets an authenticated laundry user update a listing's physical readiness
// state: `listing.metadata.readinessStatus` (enum, see READINESS_STATUSES)
// and `listing.privateData.currentRack` (free text, e.g. "Rack A-04").
//
// Unlike laundry-transaction-status.js, this isn't tied to a booking at all
// - it's inventory tracking for the garment itself (design doc §8).
//
// Request body: { listingId, readinessStatus, currentRack? }
//
// Behavior:
//   - Fetches the listing (Integration API) to find its
//     `publicData.assignedLaundryId`.
//   - Authorizes the caller: must be flagged `metadata.isLaundry` AND be the
//     listing's assigned laundry.
//   - Writes via the Integration API's `listings.update`. Extended-data
//     updates (`metadata`, `privateData`) on the Marketplace/Integration API
//     are merged per top-level key server-side, not full-replace - so this
//     does NOT need to read-and-spread the listing's other existing
//     `publicData`/`metadata`/`privateData` keys (verified against the real
//     Dev API - see /workspace/vault/Projects/Cocloset/logs for the
//     verification run). `currentRack` is only included in the update when
//     supplied, so omitting it never touches the existing value.
//
// Success response (200): { data: { readinessStatus, currentRack? } }
// Failure response: standard handleError() shape (see api-util/sdk.js).
module.exports = (req, res) => {
  const { listingId, readinessStatus, currentRack } = req.body || {};

  if (!listingId) {
    res
      .status(400)
      .json({ error: 'Missing required "listingId" in request body.' })
      .end();
    return;
  }
  if (!readinessStatus || !READINESS_STATUSES.includes(readinessStatus)) {
    res
      .status(400)
      .json({
        error: `Missing or invalid "readinessStatus" in request body. Must be one of: ${READINESS_STATUSES.join(
          ', '
        )}.`,
      })
      .end();
    return;
  }

  const integrationSdk = getIntegrationSdk();

  integrationSdk.listings
    .show({ id: listingId })
    .then(listingResponse => {
      const listing = listingResponse.data.data;
      const assignedLaundryId = listing.attributes?.publicData?.assignedLaundryId;

      return authorizeLaundryCaller(req, res, assignedLaundryId).then(() => {
        const updateParams = {
          id: listingId,
          metadata: { readinessStatus },
          ...(currentRack !== undefined ? { privateData: { currentRack } } : {}),
        };

        return integrationSdk.listings
          .update(updateParams, { expand: true })
          .then(() => ({ readinessStatus, currentRack }));
      });
    })
    .then(({ readinessStatus: updatedStatus, currentRack: updatedRack }) => {
      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({
          data: {
            readinessStatus: updatedStatus,
            ...(updatedRack !== undefined ? { currentRack: updatedRack } : {}),
          },
        })
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};

module.exports.READINESS_STATUSES = READINESS_STATUSES;
