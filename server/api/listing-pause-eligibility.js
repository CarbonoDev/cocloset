const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { requireListingAuthorCaller } = require('../api-util/listingOwnerAuth');
const { assertNoActiveTransaction } = require('../api-util/listingCustody');

// May this listing be paused right now? The guard `ManageListingsPage.js`'s "Pause
// Listing" click runs before letting `sdk.ownListings.close()` fire.
//
// Jonathan, 2026-10-13: pausing a listing to go collect it from the laundry (the whole
// premise of LaundryPickupNotice/PickupQrCode) was blocked outright by the 2026-09-29
// guard, which read `metadata.onLaundry` - true for essentially every idle garment,
// since "stored at the laundry between rentals" is this marketplace's resting state
// (see listingCustody.js's own header: "A garment can be onLaundry: true with no
// transaction at all"). The guard's REAL intent - don't strand a transaction that
// still needs this listing - has nothing to do with onLaundry; it is whether an
// ACTIVE transaction exists, which `findActiveTransactions` already answers and
// `listing-laundry-assignment.js` already asks for the exact same reason. Reused
// here rather than re-derived.
//
// The write itself (`sdk.ownListings.close`) stays an ordinary, unprivileged
// Marketplace API call from the browser - pausing your own listing needs no
// elevated permission. This endpoint only answers the one question that needs the
// Integration API: is a transaction still relying on this listing right now. The
// caller treats a true 409 and any other failure here the same way - don't pause -
// since the one thing worth verifying is exactly the thing that fails closed.
//
// POST /api/listing-pause-eligibility
// Request body: { listingId }
//
// Success response (200): { data: { allowed: true } }
// Failure responses:
//   400 - missing listingId
//   401 - no usable session
//   403 - caller is not the listing's owner
//   409 - the listing has an active transaction (or we could not prove it doesn't -
//         assertNoActiveTransaction fails closed)
//   otherwise: standard handleError() shape (see api-util/sdk.js).
module.exports = (req, res) => {
  const { listingId } = req.body || {};

  if (!listingId) {
    res
      .status(400)
      .json({ error: 'Missing required "listingId" in request body.' })
      .end();
    return;
  }

  const integrationSdk = getIntegrationSdk();

  integrationSdk.listings
    // include: ['author'] is REQUIRED: without it the response carries no
    // `relationships` at all, so the ownership check below reads undefined and
    // rejects the real owner. See api-util/listingOwnerAuth.js.
    .show({ id: listingId, include: ['author'] })
    .then(listingResponse => {
      const listing = listingResponse.data.data;

      return requireListingAuthorCaller(req, res, listing).then(() =>
        assertNoActiveTransaction({ integrationSdk, listingId })
      );
    })
    .then(() => {
      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: { allowed: true } })
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};
