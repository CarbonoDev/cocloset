const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { requireListingAuthorCaller } = require('../api-util/listingOwnerAuth');
const {
  assertLaundryAssignmentAllowed,
  evaluateLaundryAssignment,
  resolveAssignedLaundry,
  writeLaundryAssignment,
} = require('../api-util/laundryAssignment');

// Assign a laundry to a listing. THE ONLY WRITE PATH for that assignment.
//
//   > "se puede editar la laundry mientras que no este en una transaction activa
//   >  y que onLaundry sea false"
//
// POST /api/listing-laundry-assignment
// Request body: { listingId, assignedLaundryId }
//
// ---------------------------------------------------------------------------
// THIS ENDPOINT USED TO BE A DECISION, NOT A WRITE GATE. THAT WAS THE BUG.
// ---------------------------------------------------------------------------
// Until this change the wizard wrote `publicData.assignedLaundryId` from the
// BROWSER (EditListingLaundryPanel -> EditListingPage.duck.js ->
// `sdk.ownListings.update()` -> the Marketplace API) and merely ASKED this
// endpoint for permission first. `publicData` is owner-writable by design, so an
// owner who simply did not make the call - or who used their own access token
// directly - was unaffected by any rule this process cared to state. The previous
// header said exactly that, and named relocating the field to `metadata` as the
// airtight fix. That is what has now been done, with the client's approval:
//
//   > "puedes cambiar esta propiedad a metadata como lo necesites, esto resuelve
//   >  el punto 2"
//
// `metadata` is Integration-API-only. Verified against the real Dev marketplace:
// an owner's own `ownListings.update({ id, metadata: {...} })` is refused by the
// Marketplace API with 400 `validation-disallowed-key`. So there is no longer a
// second writer to race, and the rule below IS the rule - not a suggestion the
// browser may decline to follow. See api-util/laundryAssignment.js for the full
// argument, including what remains owner-writable (the derived fields) and why.
//
// What is enforced here, all of it server-side and none of it forgeable:
//   * The caller is the listing's own author (api-util/listingOwnerAuth.js,
//     checked against `relationships.author`, which nobody can write).
//   * The listing has NO active transaction AND `metadata.onLaundry !== true`.
//     Both, per the client's sentence. Both are read from the API - the stored
//     listing entity and `transactions.query` - never from the request body.
//   * The target is genuinely a user flagged `metadata.isLaundry`, with a usable
//     address and origin. An owner cannot appoint themselves their own laundry.
//   * The three derived fields (`publicData.assignedLaundryName`,
//     `publicData.pickupAddress`, top-level `geolocation`) are resolved from that
//     laundry's own profile and written in the SAME call as the id, so a caller
//     cannot submit an id and a pickup address that disagree.
//
// A no-op re-save (the same laundry again) skips both conditions on purpose - see
// evaluateLaundryAssignment's docblock for why gating it would dead-end the
// wizard tab rather than protect anything.
//
// Success response (200): { data: { allowed: true, changed, onLaundry,
//   currentAssignedLaundryId, assignedLaundryId, assignedLaundryName,
//   pickupAddress, geolocation } }
// Failure responses:
//   400 - missing listingId / assignedLaundryId
//   401 - no usable session
//   403 - caller is not the listing's owner
//   409 - the garment is at the laundry, or the listing has an active transaction
//         (or we could not prove it hasn't - findActiveTransactions fails closed)
//   422 - the chosen laundry does not exist, is not a laundry, or has no usable profile
//   otherwise: standard handleError() shape (see api-util/sdk.js).

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
    // include: ['author'] is REQUIRED, not decorative: without it the response
    // carries no `relationships` at all, so every ownership check below reads
    // undefined and rejects the real owner. See api-util/listingOwnerAuth.js.
    .show({ id: listingId, include: ['author'] })
    .then(listingResponse => {
      const listing = listingResponse.data.data;

      // Authorization first, so a caller who is not the owner cannot use this
      // endpoint as an oracle for which users happen to be flagged as laundries.
      return requireListingAuthorCaller(req, res, listing)
        .then(() =>
          assertLaundryAssignmentAllowed({
            integrationSdk,
            listing,
            listingId,
            nextAssignedLaundryId: assignedLaundryId,
          })
        )
        .then(decision =>
          resolveAssignedLaundry({ integrationSdk, assignedLaundryId })
            .then(laundry => writeLaundryAssignment({ integrationSdk, listingId, laundry }))
            .then(written => ({ ...decision, ...written }))
        );
    })
    .then(result => {
      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: { allowed: true, ...result } })
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};

// Re-exported so the rule stays reachable from this module's own test file, where
// its counter-examples and their history are documented.
module.exports.evaluateLaundryAssignment = evaluateLaundryAssignment;
