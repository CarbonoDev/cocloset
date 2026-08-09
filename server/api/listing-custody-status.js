const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { authorizeLaundryOrOwnerCaller } = require('../api-util/listingOwnerAuth');
const { assertNoActiveTransaction, writeCustodyMetadata } = require('../api-util/listingCustody');

// Hand a garment over: `listing.metadata.onLaundry`.
//
//   > "Si el producto ya fue devuelto a la lavandería, se queda en estatus para el
//   >  listing de onLaundry true, pero si se devuelve al dueño de la prenda cambia
//   >  a false, este status lo puede modificar laundry o el dueño (siempre que no
//   >  este en una transacción activa)"
//
// POST /api/listing-custody-status
// Request body: { listingId, onLaundry }
//
// ---------------------------------------------------------------------------
// WHY THIS IS A SIBLING OF listing-readiness-status.js AND NOT A BRANCH INSIDE IT
// ---------------------------------------------------------------------------
// The two endpoints look adjacent - both are laundry-facing writes onto a listing
// outside any booking - and were considered as one. Three things make them
// different endpoints:
//
//   1. DIFFERENT PRINCIPALS. listing-readiness-status.js is laundry-only, gated by
//      authorizeLaundryCaller. This one is laundry-OR-owner. Merging them would
//      put two authorization modes in one handler, and the only thing standing
//      between "the owner may write onLaundry" and "the owner may write
//      readinessStatus/currentRack" would be a field-partitioning `if`. That is
//      precisely the shape that fails in the dangerous direction when someone
//      later adds a field and forgets which branch it belongs to.
//      `incoming`/`stored`/`available` and "Rack A-04" are a studio's internal ops
//      vocabulary; a garment owner has no business writing either.
//   2. DIFFERENT PRECONDITIONS. This endpoint refuses to run while the listing has
//      an active transaction (the client's parenthesis, above). Readiness must NOT
//      grow that rule: a laundry legitimately moves a garment between racks and
//      through readiness states in the middle of a rental, and blocking that would
//      break the ops dashboard.
//   3. DIFFERENT MEANING. Readiness is a forecast about bookability; custody is a
//      physical fact about location. §8 already separates listing lifecycle from
//      transaction lifecycle for the same reason.
//
// ---------------------------------------------------------------------------
// WHY THE ACTIVE-TRANSACTION GATE APPLIES IN BOTH DIRECTIONS
// ---------------------------------------------------------------------------
// The client's rule is about the handover, which in practice is true -> false. The
// gate is applied to false -> true as well, because that is what the sentence
// says and because an EXPLICIT custody claim mid-rental has no legitimate
// meaning: while a transaction is live, custody is not something anyone types in,
// it is something the process observes. Which is exactly what the two IMPLICIT
// writers do, and they are deliberately not gated:
//
//   * server/api/laundry-transaction-status.js, on laundry-confirm-return[-late]:
//     the garment has physically come back and Sharetribe has recorded it. The
//     transaction is by definition active at that moment (`returned`).
//   * server/api/listing-readiness-status.js, on readinessStatus stored/available:
//     a laundry receiving an incoming garment. Monotone - it only ever sets true.
//
// Both record an observation the platform just made; this endpoint records a
// decision a human is making. Only the latter needs a precondition.
//
// Success response (200): { data: { onLaundry, role } }
//   `role` is 'owner' or 'laundry' - which of the two principals was recognised.
// Failure responses:
//   400 - missing listingId, or onLaundry not a boolean
//   401 - no usable session
//   403 - caller is neither the assigned laundry nor the owner
//   409 - the listing has an active transaction (or we could not prove it hasn't)
//   otherwise: standard handleError() shape (see api-util/sdk.js).

module.exports = (req, res) => {
  const { listingId, onLaundry } = req.body || {};

  if (!listingId) {
    res
      .status(400)
      .json({ error: 'Missing required "listingId" in request body.' })
      .end();
    return;
  }
  // Strict boolean. A missing or string value must not be coerced: `onLaundry:
  // "false"` is truthy, and quietly claiming custody of a garment that is with
  // its owner is the failure this whole field exists to prevent.
  if (typeof onLaundry !== 'boolean') {
    res
      .status(400)
      .json({ error: 'Missing or invalid "onLaundry" in request body. Must be a boolean.' })
      .end();
    return;
  }

  const integrationSdk = getIntegrationSdk();

  integrationSdk.listings
    .show({ id: listingId })
    .then(listingResponse => {
      const listing = listingResponse.data.data;

      return authorizeLaundryOrOwnerCaller(req, res, listing).then(({ role }) =>
        assertNoActiveTransaction({ integrationSdk, listingId })
          .then(() => writeCustodyMetadata({ integrationSdk, listingId, onLaundry }))
          .then(() => role)
      );
    })
    .then(role => {
      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: { onLaundry, role } })
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};
