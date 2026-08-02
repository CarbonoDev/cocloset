const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { authorizeLaundryCaller } = require('../api-util/laundryAuth');
const { LAUNDRY_STATUSES, isLegalNextLaundryStatus } = require('../api-util/laundryStatusHelpers');

// Lets an authenticated laundry user advance a transaction's granular
// laundry sub-phase, tracked as `transaction.metadata.laundryStatus` (see
// design doc §8/§9 and server/api-util/laundryStatusHelpers.js for the
// legal-sequence definition).
//
// IMPORTANT: this is metadata layered on top of the existing, unmodified
// `default-booking` transaction process - NOT a new process state/transition.
// The underlying Sharetribe transaction stays in whatever real state it's
// actually in (`accepted` for the whole rental+cleaning cycle, until the
// real `complete`/`operator-complete` transition eventually fires elsewhere)
// while `laundryStatus` tracks the granular sub-phase for display on the
// laundry ops dashboard. "Laundry Shop" is not a native Sharetribe process
// actor, so this deliberately does not call `transactions.transition()`.
//
// Request body: {
//   transactionId,           // transaction UUID (transit-encoded)
//   status,                  // one of LAUNDRY_STATUSES - the requested next status
//   damaged,                 // optional, boolean - only meaningful when status === 'returned'
//   damageNote,              // optional, string - only meaningful when status === 'returned'
// }
//
// Behavior:
//   - Fetches the transaction (Integration API) with its listing included,
//     to find `listing.publicData.assignedLaundryId`.
//   - Authorizes the caller (ordinary request-scoped SDK): must be flagged
//     `metadata.isLaundry` AND be the transaction's assigned laundry.
//   - Validates `status` is a legal next step from the transaction's current
//     `metadata.laundryStatus` (see laundryStatusHelpers.js) - rejects
//     out-of-order jumps, allows the same-status idempotent retry.
//   - On success, writes `metadata.laundryStatus` (and, when status is
//     'returned' and damage info was supplied, `metadata.damageReported`)
//     via the Integration API.
//
// Success response (200): {
//   data: { laundryStatus, damageReported? }
// }
// Failure response: standard handleError() shape (see api-util/sdk.js).
module.exports = (req, res) => {
  const { transactionId, status, damaged, damageNote } = req.body || {};

  if (!transactionId) {
    res
      .status(400)
      .json({ error: 'Missing required "transactionId" in request body.' })
      .end();
    return;
  }
  if (!status || !LAUNDRY_STATUSES.includes(status)) {
    res
      .status(400)
      .json({
        error: `Missing or invalid "status" in request body. Must be one of: ${LAUNDRY_STATUSES.join(
          ', '
        )}.`,
      })
      .end();
    return;
  }

  const integrationSdk = getIntegrationSdk();

  integrationSdk.transactions
    .show({ id: transactionId, include: ['listing'] })
    .then(transactionResponse => {
      const { data, included = [] } = transactionResponse.data;

      const listingRef = data.relationships?.listing?.data;
      const listing = listingRef
        ? included.find(i => i.type === 'listing' && i.id.uuid === listingRef.id.uuid)
        : null;

      if (!listing) {
        const message = `laundry-transaction-status: transaction ${transactionId.uuid} has no listing relationship.`;
        const error = new Error(message);
        error.status = 422;
        error.statusText = message;
        error.data = {};
        throw error;
      }

      const assignedLaundryId = listing.attributes?.publicData?.assignedLaundryId;

      return authorizeLaundryCaller(req, res, assignedLaundryId).then(() => {
        const currentLaundryStatus = data.attributes?.metadata?.laundryStatus;

        if (!isLegalNextLaundryStatus(currentLaundryStatus, status)) {
          const message = `laundry-transaction-status: illegal status transition from "${currentLaundryStatus}" to "${status}".`;
          const error = new Error(message);
          error.status = 409;
          error.statusText = message;
          error.data = {};
          throw error;
        }

        const metadataUpdate = { laundryStatus: status };
        let damageReported;

        if (status === 'returned' && typeof damaged === 'boolean') {
          damageReported = { flag: damaged, note: damageNote || '' };
          metadataUpdate.damageReported = damageReported;
        }

        return integrationSdk.transactions
          .updateMetadata({ id: transactionId, metadata: metadataUpdate }, { expand: true })
          .then(() => ({ laundryStatus: status, damageReported }));
      });
    })
    .then(({ laundryStatus, damageReported }) => {
      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: { laundryStatus, ...(damageReported ? { damageReported } : {}) } })
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};
