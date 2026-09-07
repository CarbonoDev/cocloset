const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { authorizeLaundryCaller } = require('../api-util/laundryAuth');
const { assertNoActiveTransaction, writeCustodyMetadata } = require('../api-util/listingCustody');
const { readAssignedLaundryId } = require('../api-util/laundryAssignment');
const { notifyGarmentHandedBack } = require('../api-util/laundryMailer');
const log = require('../log');

// Hand a garment over: `listing.metadata.onLaundry`.
//
//   > "Si el producto ya fue devuelto a la lavandería, se queda en estatus para el
//   >  listing de onLaundry true, pero si se devuelve al dueño de la prenda cambia
//   >  a false, este status lo puede modificar laundry o el dueño (siempre que no
//   >  este en una transacción activa)"
//
// THE OWNER WAS TAKEN OFF THIS, and it is worth stating plainly rather than quietly
// overwriting the sentence above:
//
//   > "Es preferible que el provider no pueda cambiar el status, siempre tiene que estar en
//   >  la transacción o en el inventario de laundry, pero laundry siempre tiene que estar ahi
//   >  para recolectar la prenda" (Jonathan, 2026-09-07)
//
// The physical fact is that a studio hands the garment over the counter. An owner who could
// flip this alone could take a garment out of the studio's inventory without anyone at the
// studio agreeing that it left - and the two things this flag feeds, whether the laundry can
// be reassigned and whether the studio still lists the garment as theirs, would then disagree
// with the shelf. So: LAUNDRY ONLY. The owner collecting is still the common case; it is the
// studio that records it, because the studio is the one who was there.
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
//   `role` is always 'laundry'. The field is kept rather than dropped: it is part of a
//   response shape a client already reads, and narrowing the principals is not a reason to
//   change what the answer looks like.
// Failure responses:
//   400 - missing listingId, or onLaundry not a boolean
//   401 - no usable session
//   403 - caller is not the laundry assigned to this listing
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
    // include: ['author'] is REQUIRED, not decorative: without it the response
    // carries no `relationships` at all, so every ownership check below reads
    // undefined and rejects the real owner. See api-util/listingOwnerAuth.js.
    .show({ id: listingId, include: ['author'] })
    .then(listingResponse => {
      const listing = listingResponse.data.data;
      // `include: ['author']` above is what puts the owner in `included`; the Integration
      // API is also the only place their email address is readable at all.
      const owner = (listingResponse.data.included || []).find(entity => entity.type === 'user');

      return authorizeLaundryCaller(req, res, readAssignedLaundryId(listing)).then(currentUser =>
        assertNoActiveTransaction({ integrationSdk, listingId })
          .then(() => writeCustodyMetadata({ integrationSdk, listingId, onLaundry }))
          .then(() => {
            // TELLING THE OWNER, AFTER THE FACT AND WITHOUT BLOCKING IT.
            //
            //   > "se debe enviar un correo al provider confirmando la operación"
            //
            // Only on the handover itself: `onLaundry: true` is a studio receiving a
            // garment, which already has its own notification, and mailing an owner "your
            // garment is at the studio" the moment they dropped it off is noise.
            //
            // Fire-and-continue, like every other mail on this project: the custody write
            // has already succeeded and the garment has physically changed hands. Failing
            // the request over a mail would make the ops screen retry a handover that
            // already happened.
            if (onLaundry === false) {
              try {
                notifyGarmentHandedBack({
                  to: owner?.attributes?.email,
                  ownerName: owner?.attributes?.profile?.displayName,
                  garmentTitle: listing?.attributes?.title,
                  // The studio's own name, not the account holder's - the same rule every
                  // other surface follows (api-util/laundryDirectory.js).
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
            }
            return 'laundry';
          })
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
