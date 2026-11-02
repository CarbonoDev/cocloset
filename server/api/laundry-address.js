const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { requireLaundryCaller } = require('../api-util/laundryAuth');
const {
  evaluateAddressChange,
  parseAddressInput,
  propagateAddressToAssignedListings,
  readLaundryAddressState,
  writeLaundryAddress,
} = require('../api-util/laundryAddress');
const { toLaundryDirectoryEntry } = require('../api-util/laundryDirectory');
const log = require('../log');

// Save a laundry's OWN address (and coordinates), and carry the change through to
// every garment assigned to it.
//
//   > "Igual podemos hacer una llamada secundaria que solo guarde la dirección, el
//   >  resto se sigue guardando igual, pero la dirección (aun en publicData) se
//   >  guarda a través de integration API, asi validamos que tenga habilitada la
//   >  opción (ya que un admin lo va a habilitar para poder cambiar el address) y si
//   >  puede cambiarla entonces hace el cambio"
//
// POST /api/laundry-address
// Request body: { address, origin: { lat, lng } }
//
// ---------------------------------------------------------------------------
// SCOPE: THIS IS THE ADDRESS AND NOTHING ELSE
// ---------------------------------------------------------------------------
// The rest of the studio profile (studio name, business hours, turnaround,
// accepted categories) keeps saving exactly as before, straight from the browser
// with `sdk.currentUser.updateProfile` — see LaundryProfilePage. Only the address
// comes here, because only the address is gated and only the address has to be
// mirrored onto other people's listings.
//
// The two writes are ordered by the client (profile first, then this one) and this
// handler READ-MODIFY-WRITES `publicData.laundryProfile`, so it merges into whatever
// the profile save just stored rather than clobbering it. See
// api-util/laundryAddress.js `writeLaundryAddress` — Sharetribe merges extended data
// by top-level key only, and `laundryProfile` is one key holding a nested object.
//
// ---------------------------------------------------------------------------
// AUTHORIZATION
// ---------------------------------------------------------------------------
//   * THE TARGET IS ALWAYS THE CALLER. The laundry id comes exclusively from the
//     caller's own cookie-scoped session (`requireLaundryCaller`, the identity
//     pattern used by init-user-role.js and api-util/laundryAuth.js). The body
//     carries an address and coordinates and nothing else — there is no id
//     parameter anywhere in this handler, so no caller can aim it at another studio.
//   * The caller must be flagged `metadata.isLaundry === true`, checked twice: once
//     on the session entity by `requireLaundryCaller`, and again on the
//     Integration-API read that the decision is actually taken from.
//   * The change itself must be permitted — see evaluateAddressChange. Either the
//     studio has no usable address yet (onboarding, always allowed) or an admin has
//     granted `metadata.addressChangeAllowed === true`.
//
// ---------------------------------------------------------------------------
// WHAT THIS DOES NOT CLOSE
// ---------------------------------------------------------------------------
// The address is in the laundry's own `publicData`, which it can write directly
// against the Marketplace API with `currentUser.updateProfile`. This endpoint gates
// OUR path; it does not close that one. What the direct write cannot do is
// propagate — the listings live behind the Integration API — so a studio that goes
// around this ends up with a profile that disagrees with its own garments. The
// permission is an operator workflow control, not an access control. The client
// chose this design with that limitation stated. See the header of
// api-util/laundryAddress.js for the cheap hardening if it is ever wanted.
//
// ---------------------------------------------------------------------------
// PROPAGATION HAPPENS HERE, NOT LATER
// ---------------------------------------------------------------------------
// Every listing with `metadata.assignedLaundryId === <caller>` gets its
// `publicData.pickupAddress`, `publicData.assignedLaundryName` and top-level
// `geolocation` refreshed, through the SAME writer the assignment endpoint uses
// (api-util/laundryAssignment.js `writeLaundryDerivedListingFields`), so the two
// cannot drift. Doing it inline rather than leaving it to
// scripts/update-laundry-address.js is what makes the sanctioned path
// self-consistent instead of dependent on somebody remembering to run a script.
//
// Listings mid-rental are included on purpose — the new address IS the pickup
// address for a garment the studio is holding. Argued in full in
// api-util/laundryAddress.js `propagateAddressToAssignedListings`.
//
// A propagation failure does NOT fail the response. The profile write has already
// landed by then, so a 500 here would tell the studio its address did not save when
// it did, and a retry would then be refused as "not allowed" because the flag has
// been spent. Failures are reported in the body (`listings.failed`) and logged.
//
// Success response (200): { data: {
//   address, origin, reason, addressChangeAllowed,
//   listings: { updated: [...], failed: [...], skipped: [...], scanned, truncated } } }
//   - `reason`: 'no-address-yet' (first address, no grant used) |
//               'change-granted' (a grant was spent and is now false)
// Failure responses:
//   400 - missing/invalid address or origin
//   401 - no usable session
//   403 - caller is not a laundry (`data.code: 'not-a-laundry'`), or the change is
//         not currently permitted (`data.code: 'change-not-allowed'`). The code is
//         what the form switches its translated message on - never the English
//         `statusText`, which would put a server sentence on a translated page.
//   otherwise: standard handleError() shape (see api-util/sdk.js).

const badRequest = message => {
  const error = new Error(message);
  error.status = 400;
  error.statusText = message;
  error.data = { code: 'invalid-address' };
  return error;
};

const forbidden = (message, code) => {
  const error = new Error(message);
  error.status = 403;
  error.statusText = message;
  error.data = { code };
  return error;
};

module.exports = (req, res) => {
  const integrationSdk = getIntegrationSdk();

  // Identity from the session, never from the request. Note there is deliberately
  // no `req.body` read other than the address and coordinates below.
  requireLaundryCaller(req, res)
    .then(currentUser => {
      const laundryId = currentUser?.id?.uuid;

      if (!laundryId) {
        const error = new Error('Could not resolve the calling user.');
        error.status = 401;
        error.statusText = error.message;
        error.data = {};
        throw error;
      }

      const submitted = parseAddressInput(req.body);

      if (!submitted) {
        throw badRequest(
          'Missing or invalid "address" / "origin" in request body. Both an address ' +
            'string and finite numeric origin.lat / origin.lng are required.'
        );
      }

      return readLaundryAddressState({ integrationSdk, laundryId }).then(state => {
        const decision = evaluateAddressChange({
          hasUsableStoredAddress: state.hasUsableStoredAddress,
          addressChangeAllowed: state.addressChangeAllowed,
        });

        if (!decision.allowed) {
          throw forbidden(
            'This studio already has an address, and an administrator has not enabled ' +
              'an address change for it.',
            decision.reason
          );
        }

        return writeLaundryAddress({
          integrationSdk,
          laundryId,
          laundryProfile: state.laundryProfile,
          address: submitted.address,
          origin: submitted.origin,
          reason: decision.reason,
        }).then(updatedUser => {
          // Built from the UPDATED entity, through the same allowlisted mapping the
          // assignment endpoint resolves a laundry with. That is what guarantees the
          // listings receive exactly what an assignment would have written - rather
          // than the request body, which is one step removed from what actually
          // landed in storage.
          const laundry = toLaundryDirectoryEntry(updatedUser);

          return propagateAddressToAssignedListings({
            integrationSdk,
            laundryId,
            laundry,
          }).then(listings => {
            if (listings.failed.length > 0) {
              log.error(
                new Error('Laundry address propagation partially failed'),
                'laundry-address-propagation-failed',
                {
                  laundryId,
                  failedCount: listings.failed.length,
                  updatedCount: listings.updated.length,
                }
              );
            }

            return {
              address: laundry.address,
              origin: laundry.origin,
              reason: decision.reason,
              // Always false after a successful change: either it was never set
              // (onboarding) or the grant has just been spent.
              addressChangeAllowed: false,
              listings,
            };
          });
        });
      });
    })
    .then(result => {
      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: result })
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};

// Re-exported so the rule stays reachable from this module's own test file.
module.exports.evaluateAddressChange = evaluateAddressChange;
