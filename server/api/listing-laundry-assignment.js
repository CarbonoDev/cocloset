const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { requireListingAuthorCaller } = require('../api-util/listingOwnerAuth');
const { getListingCategoryValues } = require('../api-util/categoryPricing');
const { notifyNewIncomingGarment } = require('../api-util/laundryMailer');
const log = require('../log');
const {
  assertLaundryAssignmentAllowed,
  evaluateLaundryAssignment,
  resolveAssignedLaundry,
  resolveInitialCleaningDays,
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
//   * `metadata.initialCleaningDays` - the turnaround for the FIRST wash of this
//     garment at this laundry, resolved from the same profile (see
//     api-util/laundryAssignment.js `resolveInitialCleaningDays`) and written in
//     that same call. This is the only place it is ever written. It is in
//     `metadata` and not `publicData` deliberately: the booking calendar and the
//     privileged-endpoint gate in api-util/bookingRules.js both refuse dates based
//     on it, so an owner-writable copy would make that refusal advisory. Storing it
//     is also what keeps the checkout path free of any Integration API call - the
//     laundry's turnaround lives in `privateData`, which only this API can read.
//
// A no-op re-save (the same laundry again) skips both conditions on purpose - see
// evaluateLaundryAssignment's docblock for why gating it would dead-end the
// wizard tab rather than protect anything.
//
// SIDE EFFECT: the §3.12 "New Incoming Garment" notification to the chosen studio,
// fired here because this is the moment an owner commits to shipping a garment
// somewhere and there is no transaction to hang a process notification off. It is
// gated on `decision.changed`, so the no-op re-save above sends no mail - three
// clicks on Save must not be three emails - and it is fire-and-continue: it cannot
// reject and is never awaited, so it can neither fail nor delay the write that has
// already landed. See api-util/laundryMailer.js.
//
// Success response (200): { data: { allowed: true, changed, onLaundry,
//   currentAssignedLaundryId, assignedLaundryId, initialCleaningDays,
//   assignedLaundryName, pickupAddress, geolocation } }
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
      const included = listingResponse.data.included || [];
      const authorRef = listing?.relationships?.author?.data;
      const author = authorRef
        ? included.find(entity => entity.type === 'user' && entity.id?.uuid === authorRef.id?.uuid)
        : null;
      const ownerName = author?.attributes?.profile?.displayName;

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
          resolveAssignedLaundry({ integrationSdk, assignedLaundryId }).then(laundry =>
            writeLaundryAssignment({
              integrationSdk,
              listingId,
              laundry,
              // Resolved HERE, from the laundry's own privateData and this
              // garment's category chain, and never accepted from the request
              // body: it is the number the booking calendar and
              // api-util/bookingRules.js will both honour, so a caller who could
              // supply it could make their garment bookable tomorrow.
              initialCleaningDays: resolveInitialCleaningDays({
                laundryPrivateData: laundry.privateData,
                listingPublicData: listing.attributes?.publicData,
                envDefaultBufferDays: process.env.DEFAULT_LAUNDRY_BUFFER_DAYS,
              }),
            }).then(written => {
              // §3.12 New Incoming Garment. The owner has just picked this studio
              // and will now physically ship the garment to it, so this is the
              // moment the studio needs to know to expect it. It is the trigger
              // this notification never had: there is no transaction here to hang
              // a process notification off (design §8), and until the write moved
              // server-side into this endpoint there was no server-side moment at
              // all.
              //
              // ONLY ON A REAL CHANGE. `decision.changed` is the endpoint's
              // existing no-op detector (evaluateLaundryAssignment: the stored id
              // versus the requested one). The wizard lets an owner re-open the
              // LAUNDRY tab and press Save on the same studio as often as they
              // like, and each of those is a legitimate 200 that must not send
              // another email. Gating on `changed` rather than on some new flag
              // also means the mail follows exactly the same definition of
              // "assignment changed" that the 409 rules and the response body use.
              //
              // FIRE-AND-CONTINUE, exactly as create-availability-buffer.js does
              // for notifyPickupScheduled: not awaited, and it cannot reject (see
              // api-util/laundryMailer.js). The assignment has already been
              // written by this point; a mail problem must not turn a completed
              // write into a failed response and send the owner back to re-save.
              // With no Mailgun account yet this always takes the skip path, which
              // now logs rather than passing silently.
              //
              // The try/catch is not belt-and-braces, for the same reason it is
              // not in laundry-transaction-status.js: this call sits inside the
              // `.then()` whose rejections land in this endpoint's catch, so a
              // synchronous throw from anywhere in here would turn a write that
              // ALREADY SUCCEEDED into a 500 and send the owner back to re-save an
              // assignment that was in fact saved.
              try {
                if (decision.changed) {
                  notifyNewIncomingGarment({
                    to: laundry.email,
                    laundryName: laundry.studioName || laundry.displayName,
                    garmentTitle: listing.attributes?.title,
                    ownerName,
                    listingId: typeof listingId === 'string' ? listingId : listingId?.uuid,
                    // Most specific set level, which is what a studio triages on.
                    category: getListingCategoryValues(listing.attributes?.publicData).slice(-1)[0],
                  });
                }
              } catch (mailError) {
                log.error(mailError, 'new-incoming-garment-notification-failed', {
                  listingId: typeof listingId === 'string' ? listingId : listingId?.uuid,
                });
              }

              return { ...decision, ...written };
            })
          )
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
