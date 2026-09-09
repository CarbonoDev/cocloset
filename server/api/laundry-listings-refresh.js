const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { requireLaundryCaller } = require('../api-util/laundryAuth');
const { propagateAddressToAssignedListings } = require('../api-util/laundryAddress');
const { toLaundryDirectoryEntry } = require('../api-util/laundryDirectory');
const log = require('../log');

// Bring a studio's garments back in line with the studio's own profile.
//
//   > "Cuando se selecciona la laundry para un listing, guardamos el nombre de la laundry, su
//   >  dirección y su vecindario en los datos del listing; pero si laundry cambia su nombre, la
//   >  dirección o el vecindario los listings no se actualizan (...) que cuando laundry
//   >  actualice su información, actualice tambien en la api todos los productos que
//   >  pertenezcan a esa laundry" (Jonathan, 2026-09-09)
//
// POST /api/laundry-listings-refresh
// Request body: none. The caller's own session IS the studio.
//
// ---------------------------------------------------------------------------
// WHY THIS ENDPOINT EXISTS WHEN /api/laundry-address ALREADY PROPAGATES
// ---------------------------------------------------------------------------
// Assigning a laundry copies three of its fields onto the listing - the studio name, the
// pickup address and the geolocation - because a listing card, a search result and an email
// all print them and none of those can fetch a user. That copy is what goes stale.
//
// The ADDRESS path has propagated since it was built: /api/laundry-address writes the profile
// and refreshes the listings in the same request. But a studio changing only its NAME goes
// through the ordinary `currentUser.updateProfile`, which knows nothing about listings - so a
// renamed studio kept its old name on every garment it holds, indefinitely, with nothing on
// screen to suggest it.
//
// This is the missing half: the same propagation, callable after any profile save.
//
// ---------------------------------------------------------------------------
// WHY IT TAKES NO ARGUMENTS, WHICH IS ALSO ITS SECURITY STORY
// ---------------------------------------------------------------------------
// It reads the studio's profile from the API and writes THAT onto the studio's own listings.
// A caller cannot pass a name, an address, or a listing id: there is nothing here to steer.
// So although changing an address is permission-gated (`metadata.addressChangeAllowed`, see
// api-util/laundryAddress.js) and this is not, that gate is not weakened - this endpoint can
// only make listings agree with a profile the studio was already allowed to have.
//
// It is also IDEMPOTENT and cheap on a no-op: `propagateAddressToAssignedListings` skips every
// listing that already matches, so the common case - a studio saving its opening hours -
// writes nothing at all and reports why.
//
// ---------------------------------------------------------------------------
// THE NEIGHBOURHOOD IS IN HERE TOO, NOW
// ---------------------------------------------------------------------------
// It used to be read live off the studio - the search filter only needed it for its LABELS -
// so it could not go stale and there was nothing to propagate.
//
//   > "el vecindario tambien debe guardarse en el listing y debemos poder filtrar por
//   >  vecindario" (Jonathan, 2026-09-09)
//
// A filter that queries listings needs the value ON the listing, so it is now a copy like the
// name and the address - which means it is now something that can go stale, and therefore
// something this endpoint has to keep current. It rides along for free: the record below is
// built by the same function the assignment resolves a laundry with.
//
// Success response (200): { data: { listings: { updated, failed, skipped, scanned, truncated } } }
// Failure responses:
//   401 - no usable session
//   403 - caller is not a laundry user
//   otherwise: standard handleError() shape (see api-util/sdk.js).

module.exports = (req, res) => {
  const integrationSdk = getIntegrationSdk();

  requireLaundryCaller(req, res)
    .then(currentUser => {
      const profile = currentUser?.attributes?.profile || {};
      const laundryProfile = profile.publicData?.laundryProfile || {};
      const origin = laundryProfile.origin;

      // A studio that has not set an address yet has nothing to copy: the derived fields are
      // written together, and half of them is worse than none - a listing whose printed
      // address and map pin disagree. Reported as a no-op rather than as an error, because
      // saving a profile before setting an address is a perfectly ordinary thing to do.
      const hasUsableOrigin =
        Number.isFinite(origin?.lat) && Number.isFinite(origin?.lng) && !!laundryProfile.address;

      if (!hasUsableOrigin) {
        return {
          updated: [],
          failed: [],
          skipped: [],
          scanned: 0,
          truncated: false,
          reason: 'no-address-yet',
        };
      }

      return propagateAddressToAssignedListings({
        integrationSdk,
        laundryId: currentUser.id.uuid,
        // Built by the SAME function the assignment endpoint resolves a laundry with, rather
        // than spelled out here. That is what guarantees this writes byte for byte what an
        // assignment would have written - and it is why adding the neighbourhood to the
        // derived fields did not need a second edit in this file.
        laundry: toLaundryDirectoryEntry(currentUser),
      });
    })
    .then(listings => {
      if (listings.failed?.length > 0) {
        // A garment left printing a studio's old name is not visible to anyone who could fix
        // it, so it has to be visible here.
        log.error(
          new Error('Some listings could not be refreshed'),
          'laundry-listings-refresh-partial',
          { failed: listings.failed }
        );
      }

      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: { listings } })
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};
