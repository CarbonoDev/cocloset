const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { authorizeLaundryCaller } = require('../api-util/laundryAuth');
const { readAssignedLaundryId } = require('../api-util/laundryAssignment');

// Values for `listing.metadata.readinessStatus` (design doc §8). Tracks the
// physical garment's state independent of any specific booking - e.g. a
// garment can be "incoming" or "stored" with no active transaction at all.
const READINESS_STATUSES = ['incoming', 'stored', 'available'];

// Readiness states that mean the garment is PHYSICALLY IN THE STUDIO, and so
// imply `metadata.onLaundry = true` (api-util/listingCustody.js).
//
//   > "Al momento en que una laundry recibe una prenda..."
//
// A laundry marking an incoming garment `stored` IS the moment it takes custody -
// making it say so twice, on two endpoints, would guarantee the two drift.
//
// `incoming` is not in this list, and does NOT set onLaundry to false either.
// `incoming` means the owner has shipped it and it has not arrived, so it is not
// evidence of custody in either direction; and §8 has readiness cycling per
// rental, so a re-entry into `incoming` on a garment the studio is holding must
// not release custody. This mapping is therefore MONOTONE - readiness can only
// ever assert custody, never revoke it. Revoking is a deliberate handover to the
// owner, which is server/api/listing-custody-status.js's job and is gated on
// there being no active transaction.
const READINESS_IMPLIES_ON_LAUNDRY = ['stored', 'available'];

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
//     `metadata.assignedLaundryId`.
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
//   - A readiness state that means the garment is in the studio also stamps
//     `metadata.onLaundry = true` (see READINESS_IMPLIES_ON_LAUNDRY above).
//
// Success response (200): { data: { readinessStatus, currentRack?, onLaundry? } }
//   `onLaundry` is present only when this call asserted it.
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
      const assignedLaundryId = readAssignedLaundryId(listing);

      return authorizeLaundryCaller(req, res, assignedLaundryId).then(() => {
        const claimsCustody = READINESS_IMPLIES_ON_LAUNDRY.includes(readinessStatus);
        const updateParams = {
          id: listingId,
          metadata: { readinessStatus, ...(claimsCustody ? { onLaundry: true } : {}) },
          ...(currentRack !== undefined ? { privateData: { currentRack } } : {}),
        };

        return integrationSdk.listings
          .update(updateParams, { expand: true })
          .then(() => ({ readinessStatus, currentRack, claimsCustody }));
      });
    })
    .then(({ readinessStatus: updatedStatus, currentRack: updatedRack, claimsCustody }) => {
      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({
          data: {
            readinessStatus: updatedStatus,
            ...(updatedRack !== undefined ? { currentRack: updatedRack } : {}),
            ...(claimsCustody ? { onLaundry: true } : {}),
          },
        })
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};

module.exports.READINESS_STATUSES = READINESS_STATUSES;
module.exports.READINESS_IMPLIES_ON_LAUNDRY = READINESS_IMPLIES_ON_LAUNDRY;
