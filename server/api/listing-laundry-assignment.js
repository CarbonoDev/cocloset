const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { requireListingAuthorCaller } = require('../api-util/listingOwnerAuth');

// The assigned-laundry guard.
//
//   > "No se debe cambiar la laundry seleccionada por el provider para un listing
//   >  a menos que ya se haya devuelto la prenda onLaundry = false"
//
// POST /api/listing-laundry-assignment
// Request body: { listingId, assignedLaundryId }
//
// ---------------------------------------------------------------------------
// READ THIS BEFORE TRUSTING THIS ENDPOINT: IT IS A DECISION, NOT A WRITE GATE
// ---------------------------------------------------------------------------
// `publicData.assignedLaundryId` is written by the wizard from the BROWSER:
// EditListingLaundryPanel -> EditListingPage.duck.js -> `sdk.ownListings.update()`
// -> the Marketplace API. Our Express server is not in that path, and Sharetribe
// exposes no write-time validation hook, so there is no position from which this
// process can refuse that request.
//
// Moving the write into server/api/ would NOT change that, which is why this
// endpoint deliberately does not do it. `publicData` is owner-writable BY DESIGN:
// an owner holding their own access token can PUT
// `publicData.assignedLaundryId` straight at the Marketplace API, and neither our
// server nor Sharetribe will stop them. A server-side write path would add a
// second writer and a Redux-sync problem while closing exactly none of the bypass.
//
// So what IS enforced here, precisely:
//   * The DECISION is server-side and cannot be forged. `onLaundry` lives in
//     `metadata`, which only the operator / Integration API can write (see
//     api-util/listingCustody.js), and it is read HERE from the API rather than
//     accepted from the request. A client cannot claim a garment is home.
//   * The caller must be the listing's own author (api-util/listingOwnerAuth.js).
//   * A stale wizard page loses. The picker is locked client-side from the same
//     `metadata.onLaundry`, but a page loaded while the garment was home and
//     submitted after it came back gets a 409 from this call.
//
// What is NOT enforced: a caller who simply does not make this call. The two ways
// to actually close that, neither of which is this change's scope:
//   (a) Relocate `assignedLaundryId` from `publicData` to `metadata`. Airtight -
//       the Marketplace API would refuse an owner's write outright. Costs a data
//       migration plus edits to EditListingLaundryPanel, the `pub_assignedLaundryId`
//       queries in server/api/laundry-orders.js and server/api-util/laundryDirectory.js,
//       and the planned `flex-cli search` schema for that key.
//   (b) A detect-and-revert worker on the Integration API event stream - the same
//       missing worker server/api/create-availability-buffer.js already documents
//       as its residual gap.
//
// Success response (200): { data: { allowed: true, changed, onLaundry,
//   currentAssignedLaundryId } }
// Failure responses:
//   400 - missing listingId / assignedLaundryId
//   401 - no usable session
//   403 - caller is not the listing's owner
//   409 - the garment is at the laundry (`onLaundry === true`) and this is a change
//   otherwise: standard handleError() shape (see api-util/sdk.js).

const conflictError = message => {
  const error = new Error(message);
  error.status = 409;
  error.statusText = message;
  error.data = {};
  return error;
};

/**
 * The rule itself, pure and separately testable.
 *
 * Re-saving the SAME laundry is allowed while the garment is at the laundry. The
 * wizard's LAUNDRY tab is re-submitted whenever an owner walks back through it,
 * and refusing a no-op change would make the tab impossible to pass rather than
 * making the assignment immutable.
 *
 * A missing `onLaundry` (every listing predating this field) reads as false. That
 * is the right default and not merely a lenient one: the field is only ever set
 * true by an event that physically happened, so absence genuinely means "no
 * laundry has ever reported holding this garment".
 *
 * @param {Object} params
 * @param {string} [params.currentAssignedLaundryId]
 * @param {string} params.nextAssignedLaundryId
 * @param {*} [params.onLaundry] - `listing.metadata.onLaundry`, as stored
 * @returns {{allowed: boolean, changed: boolean}}
 */
const evaluateLaundryAssignment = ({
  currentAssignedLaundryId,
  nextAssignedLaundryId,
  onLaundry,
}) => {
  const changed = (currentAssignedLaundryId || null) !== (nextAssignedLaundryId || null);
  return { allowed: !changed || onLaundry !== true, changed };
};

module.exports = (req, res) => {
  const { listingId, assignedLaundryId } = req.body || {};

  if (!listingId) {
    res
      .status(400)
      .json({ error: 'Missing required "listingId" in request body.' })
      .end();
    return;
  }
  if (!assignedLaundryId || typeof assignedLaundryId !== 'string') {
    res
      .status(400)
      .json({ error: 'Missing or invalid "assignedLaundryId" in request body.' })
      .end();
    return;
  }

  const integrationSdk = getIntegrationSdk();

  integrationSdk.listings
    .show({ id: listingId })
    .then(listingResponse => {
      const listing = listingResponse.data.data;

      return requireListingAuthorCaller(req, res, listing).then(() => {
        const currentAssignedLaundryId = listing.attributes?.publicData?.assignedLaundryId;
        const onLaundry = listing.attributes?.metadata?.onLaundry;

        const { allowed, changed } = evaluateLaundryAssignment({
          currentAssignedLaundryId,
          nextAssignedLaundryId: assignedLaundryId,
          onLaundry,
        });

        if (!allowed) {
          throw conflictError(
            'The garment is currently at the laundry. The assigned laundry cannot be changed ' +
              'until it has been returned to its owner (onLaundry = false).'
          );
        }

        return { changed, onLaundry: onLaundry === true, currentAssignedLaundryId };
      });
    })
    .then(({ changed, onLaundry, currentAssignedLaundryId }) => {
      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({
          data: {
            allowed: true,
            changed,
            onLaundry,
            currentAssignedLaundryId: currentAssignedLaundryId || null,
          },
        })
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};

module.exports.evaluateLaundryAssignment = evaluateLaundryAssignment;
