const { types: sdkTypes } = require('sharetribe-flex-integration-sdk');
const { computeBufferDays, resolveTurnaroundDays } = require('./availabilityHelpers');
const { getListingCategoryValues, resolveCategoryTurnaroundDays } = require('./categoryPricing');
const { findActiveTransactions } = require('./listingCustody');
const { isLaundryUserEntity, toLaundryDirectoryEntry } = require('./laundryDirectory');

// The assigned laundry: `listing.metadata.assignedLaundryId`.
//
// ── WHY THIS IS metadata AND NOT publicData ──────────────────────────────────
// This field is the AUTHORIZATION ANCHOR for the entire laundry flow.
// api-util/laundryAuth.js's assertIsAssignedLaundry compares the caller against
// it to decide whether they may drive a transaction's custody chain - including
// `laundry-mark-pending-cleaning`, which fires the provider payout, and
// `cancel-from-returned`, which opens the refund window.
//
// It used to live in `publicData`, which is owner-writable BY DESIGN: an owner
// holding their own access token can PUT `publicData.<anything>` straight at the
// Marketplace API, and neither this server nor Sharetribe is in that path. Two
// consequences, both of which were documented on the previous branch as
// unfixable from where the code then stood:
//
//   1. The client's rule - "se puede editar la laundry mientras que no este en
//      una transaction activa y que onLaundry sea false" - was unenforceable,
//      because our server was not a party to the write.
//   2. Worse: swapping laundries mid-rental handed the NEW laundry authority over
//      an in-flight custody chain (and its payout) while the studio physically
//      holding the garment lost it.
//
// `metadata` is writable only via the Integration API. VERIFIED EMPIRICALLY
// against the real Dev marketplace, which is the whole premise of this module:
// `ownListings.update({ id, metadata: {...} })` as the listing's own author is
// refused by the Marketplace API with HTTP 400 `validation-disallowed-key`,
// `{"path":["metadata"],"type":"body"}` - the same refusal that already protects
// `metadata.onLaundry` and a user's own `metadata.isLaundry`. The platform itself
// now says no, so every change has to come through server/api/listing-laundry-assignment.js,
// which is where the rule can actually be applied.
//
// ── THE DERIVED FIELDS ───────────────────────────────────────────────────────
// Assigning a laundry also stamps three fields copied FROM that laundry:
// `publicData.assignedLaundryName`, `publicData.pickupAddress`, and the listing's
// top-level `geolocation`. Those three are still owner-writable and cannot be
// moved: `geolocation` is a core listing attribute (not extended data), and it is
// what the search index and the map read.
//
// They are nevertheless written HERE, in the same Integration API call as the id,
// and resolved server-side from the laundry's own profile rather than accepted
// from the request body. Verified: the Integration API accepts `geolocation`,
// `publicData` and `metadata` in a single `listings.update` call, so the four
// fields land together or not at all. That removes the interesting failure - a
// caller submitting an id and a pickup address that disagree - and means the
// trio always matches the id at the moment of assignment.
//
// What it does NOT remove, stated plainly: an owner can still PUT
// `publicData.pickupAddress` or `geolocation` afterwards and desync them from the
// id. That is a data-integrity and customer-trust problem, not an authorization
// one - nothing reads those fields to decide who may act - and the only real fix
// is the same detect-and-revert worker on the Integration API event stream that
// server/api/create-availability-buffer.js already documents as its residual gap.

const ASSIGNED_LAUNDRY_KEY = 'assignedLaundryId';

// ── THE INITIAL CLEANING TURNAROUND, SNAPSHOTTED ─────────────────────────────
// `metadata.initialCleaningDays`: how long this garment will take to be cleaned
// the FIRST time, before it has ever been rented.
//
//   > "Al hacer booking, el calendario muestra el siguiente día como disponible,
//   >  pero no esta considerando los tiempos de lavado inicial"
//
// WHY IT IS STORED AT ALL, RATHER THAN LOOKED UP WHEN NEEDED
// The two places that need it - the booking calendar in the browser and the
// privileged-endpoint gate in api-util/bookingRules.js - both sit on the checkout
// path, and neither may make an Integration API call: the browser must never hold
// admin credentials, and this branch deliberately REMOVED the Integration API
// lookup from the checkout path rather than adding one. The laundry's turnaround
// lives in its `privateData`, which only the Integration API can read. So the
// number is resolved once, here, at the only moment a laundry is chosen, and
// stored on the listing where both sides can read it.
//
// WHY `metadata` AND NOT `publicData`
// The same reason as ASSIGNED_LAUNDRY_KEY above, and here it is what makes the
// rule an actual rule: `metadata` is Integration-API-only, so a garment owner
// cannot delete their own `initialCleaningDays` to make their listing bookable
// tomorrow. In `publicData` the whole gate would be advisory.
//
// A stored snapshot does drift if the laundry later changes its turnaround. That
// is accepted, and it is the lesser of the two errors: the value only matters until
// the garment first reaches a studio (see resolveInitialCleaningBlockDays), it is
// refreshed on any re-save of the LAUNDRY tab, and the alternative is an admin-
// credentialled round trip between a customer and their payment.
const INITIAL_CLEANING_DAYS_KEY = 'initialCleaningDays';

/**
 * Read the assigned laundry off a listing entity.
 *
 * ALWAYS GO THROUGH THIS, never `listing.attributes.metadata.assignedLaundryId`
 * inline. There are seven readers of this field across server/ and a missed one
 * does not throw - it reads `undefined`, and `undefined` flowing into
 * assertIsAssignedLaundry or resolveCleaningFeeInSubunits degrades silently. This
 * codebase has already shipped one rule that never fired for exactly that reason
 * (`publicData.category`, see EditListingLaundryPanel), so the accessor is named
 * and grep-able rather than spelled out eight times.
 *
 * Works on both Marketplace and Integration API listing entities.
 *
 * @param {Object} [listing] - a listing API entity
 * @returns {string|undefined} the laundry's user id, or undefined
 */
const readAssignedLaundryId = listing => listing?.attributes?.metadata?.[ASSIGNED_LAUNDRY_KEY];

/**
 * The initial cleaning turnaround for ONE garment at ONE laundry, in whole days.
 *
 * Deliberately the SAME resolution chain server/api/create-availability-buffer.js
 * uses to size the buffer around an accepted booking: the laundry's per-top-level-
 * category turnaround, then its studio-wide `privateData.turnaroundDays`, then
 * DEFAULT_LAUNDRY_BUFFER_DAYS, then a hardcoded 2 days. Two different numbers for
 * "how long does this studio take to clean this garment" would be a bug waiting to
 * be reported as "the calendar and the block window disagree", so the chain is
 * reused rather than restated - see api-util/categoryPricing.js for the rules and
 * api-util/availabilityHelpers.js for the fallbacks.
 *
 * Rounded UP through computeBufferDays for the same reason that function exists: a
 * fractional 1.5 days out of an env var is 2 days of cleaning, not 1. Under-
 * blocking here means offering a customer a garment that is still in the wash.
 *
 * ALWAYS RETURNS A USABLE POSITIVE INTEGER. There is no "unknown" answer: the chain
 * bottoms out in HARDCODED_DEFAULT_BUFFER_DAYS, and a laundry that has configured
 * nothing still needs time to clean.
 *
 * @param {Object} params
 * @param {Object} [params.laundryPrivateData] - the laundry USER's profile privateData
 * @param {Object} [params.listingPublicData] - the listing's publicData (for its category chain)
 * @param {*} [params.envDefaultBufferDays] - process.env.DEFAULT_LAUNDRY_BUFFER_DAYS
 * @returns {number} an integer >= 1
 */
const resolveInitialCleaningDays = ({
  laundryPrivateData,
  listingPublicData,
  envDefaultBufferDays,
}) => {
  const turnaroundDays = resolveTurnaroundDays(
    resolveCategoryTurnaroundDays(laundryPrivateData, getListingCategoryValues(listingPublicData)),
    envDefaultBufferDays
  );

  return computeBufferDays(turnaroundDays).totalBufferDays;
};

// `reason` rides along in `error.data`, which api-util/sdk.js's handleError
// forwards to the client verbatim. The wizard needs to say WHICH condition
// refused the change, and it has to say it in the owner's own language: passing
// `statusText` through to the UI would put an English server sentence on a
// translated page. So the message here is for logs and for a developer with curl,
// and `data.reason` is the part the client switches a translated string on.
const conflictError = (reason, message) => {
  const error = new Error(message);
  error.status = 409;
  error.statusText = message;
  error.data = { reason };
  return error;
};

const notFoundError = message => {
  const error = new Error(message);
  error.status = 422;
  error.statusText = message;
  error.data = {};
  return error;
};

/**
 * The rule itself, pure and separately testable.
 *
 *   > "se puede editar la laundry mientras que no este en una transaction activa
 *   >  y que onLaundry sea false"
 *
 * BOTH conditions, and they are not redundant. `onLaundry` is where the garment
 * physically is; an active transaction is whether a booking is in flight. A
 * garment can be at the laundry with no transaction at all (dropped off early),
 * and a transaction can be active with the garment still at home (`accepted`,
 * before pickup). Either one alone would leave a real reassignment window open.
 *
 * Re-saving the SAME laundry is allowed under both, and deliberately does not even
 * consult them. The wizard's LAUNDRY tab is re-submitted whenever an owner walks
 * back through it, and Dev already has a listing mid-rental at `picked-up`: gating
 * a no-op would make that owner's tab impassable - they would save successfully,
 * be redirected forward, be bounced straight back, and never be told why - while
 * making the assignment no more immutable than it already is.
 *
 * A missing `onLaundry` reads as false. That is the right default and not merely a
 * lenient one: the field is only ever set true by an event that physically
 * happened, so absence genuinely means "no laundry has ever reported holding this
 * garment". Only a real boolean `true` locks - `'true'`, `1` and `{}` are bad data,
 * and bad data must not be able to freeze an owner's listing forever.
 *
 * @param {Object} params
 * @param {string} [params.currentAssignedLaundryId]
 * @param {string} params.nextAssignedLaundryId
 * @param {*} [params.onLaundry] - `listing.metadata.onLaundry`, as stored
 * @param {*} [params.hasActiveTransaction] - the observed fact, from findActiveTransactions
 * @returns {{allowed: boolean, changed: boolean, reason: string|null}}
 *   `reason` is 'on-laundry' | 'active-transaction' | null, so the caller can say
 *   which condition failed instead of blaming the wrong one.
 */
const evaluateLaundryAssignment = ({
  currentAssignedLaundryId,
  nextAssignedLaundryId,
  onLaundry,
  hasActiveTransaction,
}) => {
  const changed = (currentAssignedLaundryId || null) !== (nextAssignedLaundryId || null);

  if (!changed) {
    return { allowed: true, changed: false, reason: null };
  }
  // onLaundry is checked first only because it is the more specific message: an
  // owner whose garment is sitting in a studio is better served by "it is at the
  // laundry" than by "there is an active transaction", and mid-rental both are
  // usually true at once.
  if (onLaundry === true) {
    return { allowed: false, changed: true, reason: 'on-laundry' };
  }
  if (hasActiveTransaction === true) {
    return { allowed: false, changed: true, reason: 'active-transaction' };
  }
  return { allowed: true, changed: true, reason: null };
};

/**
 * Resolve the chosen laundry into the exact values that will be written.
 *
 * Reuses api-util/laundryDirectory.js rather than re-reading the profile shape:
 * `isLaundryUserEntity` is the same security filter /api/laundries applies, and
 * `toLaundryDirectoryEntry` is the same allowlisted mapping - including
 * `parseOrigin`, which is what stops a laundry with a garbage `origin` from
 * writing no `geolocation` and leaving the listing permanently unpublishable.
 *
 * A user who is not flagged `metadata.isLaundry` is refused outright. Without
 * that, an owner could point this field at their own account: they would become
 * the "assigned laundry" of their own garment and could then drive its custody
 * chain, including the transition that pays them out. lineItemHelpers.js already
 * defends the fee against exactly that; this closes it at the source.
 *
 * `privateData` and `email` ride along on the returned record, which the allowlisted
 * directory entry deliberately does not carry. `privateData` is needed by
 * resolveInitialCleaningDays - the per-category turnaround table lives there and only
 * the Integration API can read it. `email` is the account email, which the Marketplace
 * API would not expose for a third party at all, and is needed to send the §3.12 New
 * Incoming Garment notification.
 *
 * Neither reaches an HTTP response: the endpoint's 200 body is built from
 * writeLaundryAssignment's explicit `written` object, not from this record. Taking the
 * email off the `users.show` call this function already makes is also what keeps the
 * assignment endpoint at one Integration API round trip per laundry instead of two.
 *
 * @param {Object} params
 * @param {Object} params.integrationSdk
 * @param {string} params.assignedLaundryId
 * @returns {Promise<{id: string, displayName: string, studioName: string|null, address: string, origin: {lat: number, lng: number}, privateData: Object, email: string|undefined}>}
 */
const resolveAssignedLaundry = ({ integrationSdk, assignedLaundryId }) =>
  integrationSdk.users
    .show({ id: assignedLaundryId }, { expand: true })
    .catch(() => {
      throw notFoundError('The chosen laundry does not exist.');
    })
    .then(response => {
      const user = response?.data?.data;

      if (!isLaundryUserEntity(user)) {
        throw notFoundError('The chosen user is not a laundry.');
      }

      const entry = toLaundryDirectoryEntry(user);
      if (!entry.address || !entry.origin) {
        throw notFoundError(
          'The chosen laundry has no usable address or location, so it cannot be assigned.'
        );
      }
      return {
        ...entry,
        privateData: user?.attributes?.profile?.privateData || {},
        email: user?.attributes?.email,
      };
    });

/**
 * THE THREE DERIVED FIELDS, as values. The single definition of what a laundry
 * implies for a listing.
 *
 * Two callers now write these — an assignment (writeLaundryAssignment) and an
 * address change (writeLaundryDerivedListingFields) — and a third reads them back
 * for reporting (scripts/update-laundry-address.js). They are built here, once, so
 * "which name wins" and "what shape geolocation is" cannot be answered two
 * different ways in two different files. A disagreement between them would show up
 * as a listing whose map pin and whose printed address are different places, and
 * nothing in the system would notice.
 *
 * @param {Object} laundry - `{ displayName, studioName, address, origin: {lat,lng} }`
 * @returns {{assignedLaundryName: string|null, pickupAddress: string, geolocation: {lat: number, lng: number}}}
 */
const laundryDerivedListingFields = laundry => ({
  assignedLaundryName: laundry.displayName || laundry.studioName || null,
  pickupAddress: laundry.address,
  geolocation: { lat: laundry.origin.lat, lng: laundry.origin.lng },
});

/**
 * The same three fields, shaped as `listings.update` params.
 *
 * `geolocation` is a top-level listing attribute rather than extended data, so it
 * has to be an SDK `LatLng` and not the plain object above — which is the whole
 * reason this is a second function rather than a spread of the first.
 *
 * @param {Object} laundry - as laundryDerivedListingFields
 * @returns {{geolocation: Object, publicData: {assignedLaundryName: string|null, pickupAddress: string}}}
 */
const laundryDerivedListingParams = laundry => {
  const { assignedLaundryName, pickupAddress } = laundryDerivedListingFields(laundry);

  return {
    geolocation: new sdkTypes.LatLng(laundry.origin.lat, laundry.origin.lng),
    publicData: { assignedLaundryName, pickupAddress },
  };
};

/**
 * Write the assignment: the id and the initial cleaning turnaround into `metadata`,
 * the three derived fields alongside them, in ONE Integration API call.
 *
 * Extended-data updates are merged per top-level key server-side, so this does
 * not need to read-and-spread the listing's other `metadata` / `publicData` keys.
 * RE-VERIFIED against the real Dev marketplace for THIS write, because
 * `initialCleaningDays` is the first metadata key with a second, independent writer
 * that must not clobber it (api-util/listingCustody.js `writeCustodyMetadata`, which
 * writes `onLaundry`/`readyAt` on custody events). Observed sequence on a real
 * listing, Integration API, both orders:
 *
 *   update({ metadata: { initialCleaningDays: 7 } })
 *     -> { initialCleaningDays: 7 }
 *   update({ metadata: { onLaundry: true, readyAt: '…' } })
 *     -> { initialCleaningDays: 7, onLaundry: true, readyAt: '…' }
 *   update({ metadata: { initialCleaningDays: 3 } })
 *     -> { initialCleaningDays: 3, onLaundry: true, readyAt: '…' }
 *
 * i.e. per-key merge in both directions, and `null` deletes a key rather than
 * storing null. Neither writer needs to know about the other's fields.
 *
 * `geolocation` is a top-level attribute rather than extended data, so it is
 * passed as an SDK `LatLng` and not a plain object. It is included in this same
 * call - verified accepted by the Integration API - specifically so the id and the
 * location it implies cannot land separately.
 *
 * `initialCleaningDays` goes in the same call for the same reason: an assignment
 * whose turnaround failed to land would leave the calendar offering tomorrow for a
 * garment that is not there, which is the exact bug this field exists to fix.
 *
 * @param {Object} params
 * @param {Object} params.integrationSdk
 * @param {Object|string} params.listingId
 * @param {Object} params.laundry - a record from resolveAssignedLaundry
 * @param {number} params.initialCleaningDays - from resolveInitialCleaningDays
 * @returns {Promise<{assignedLaundryId: string, initialCleaningDays: number, assignedLaundryName: string, pickupAddress: string, geolocation: {lat: number, lng: number}}>}
 */
const writeLaundryAssignment = ({ integrationSdk, listingId, laundry, initialCleaningDays }) => {
  const derived = laundryDerivedListingFields(laundry);
  const written = {
    [ASSIGNED_LAUNDRY_KEY]: laundry.id,
    [INITIAL_CLEANING_DAYS_KEY]: initialCleaningDays,
    ...derived,
  };

  return integrationSdk.listings
    .update(
      {
        id: listingId,
        ...laundryDerivedListingParams(laundry),
        metadata: {
          [ASSIGNED_LAUNDRY_KEY]: laundry.id,
          [INITIAL_CLEANING_DAYS_KEY]: initialCleaningDays,
        },
      },
      { expand: true }
    )
    .then(() => written);
};

/**
 * Re-write ONLY the three laundry-derived fields on a listing, from a laundry
 * record — no `metadata`, no re-decision, nothing else touched.
 *
 * WHY IT EXISTS
 *   > "una vez que se pueda cambiar la dirección, debe cambiar tambien la
 *   >  dirección de todos los listings asociados a ese laundry"
 *
 * A studio that moves does not re-assign anybody's garment: the assignment is
 * unchanged, only the place it is picked up from. So the address change needs a
 * writer that refreshes the derived trio WITHOUT re-stamping
 * `assignedLaundryId` / `initialCleaningDays`. Re-stamping the id would be a
 * harmless no-op, but re-resolving `initialCleaningDays` would silently resize
 * the calendar block of a garment whose booking may be in flight, for a change
 * that has nothing to do with turnaround.
 *
 * IT SHARES laundryDerivedListingParams WITH writeLaundryAssignment ON PURPOSE.
 * Two writers of `pickupAddress` + `geolocation` that each spelled the fields out
 * would be two chances to disagree about, say, whether `assignedLaundryName`
 * prefers `displayName` or `studioName` — and the symptom of that disagreement is
 * a listing whose map and whose printed address point at different places, which
 * nothing would flag. The params are built in exactly one place.
 *
 * Used by server/api/laundry-address.js (the studio's own sanctioned change) and
 * by scripts/update-laundry-address.js (the admin's). Both therefore write byte
 * for byte what an assignment would have written.
 *
 * @param {Object} params
 * @param {Object} params.integrationSdk
 * @param {Object|string} params.listingId
 * @param {Object} params.laundry - `{ displayName, studioName, address, origin }`,
 *   the same record shape resolveAssignedLaundry / toLaundryDirectoryEntry return
 * @returns {Promise<{assignedLaundryName: string, pickupAddress: string, geolocation: {lat: number, lng: number}}>}
 */
const writeLaundryDerivedListingFields = ({ integrationSdk, listingId, laundry }) =>
  integrationSdk.listings
    .update({ id: listingId, ...laundryDerivedListingParams(laundry) }, { expand: true })
    .then(() => laundryDerivedListingFields(laundry));

/**
 * Apply the rule to a listing and throw the right 409 if it refuses.
 *
 * The active-transaction query is only made when the assignment actually CHANGES.
 * That is not an optimisation: `findActiveTransactions` fails closed (an
 * Integration API hiccup answers "assume there is one"), so asking on a no-op
 * re-save would turn a transient network fault into a dead-ended wizard tab for an
 * owner who was not changing anything.
 *
 * The definition of "active" is NOT re-derived here. findActiveTransactions owns
 * it, and it derives ACTIVE_LAST_TRANSITIONS from the process transcription in
 * api-util/coclosetBookingProcess.js precisely so a hand-typed list cannot drift
 * and make an active transaction invisible.
 *
 * @param {Object} params
 * @param {Object} params.integrationSdk
 * @param {Object} params.listing - the listing API entity, as fetched
 * @param {Object|string} params.listingId
 * @param {string} params.nextAssignedLaundryId
 * @returns {Promise<{changed: boolean, onLaundry: boolean, currentAssignedLaundryId: string|null}>}
 */
const assertLaundryAssignmentAllowed = ({
  integrationSdk,
  listing,
  listingId,
  nextAssignedLaundryId,
}) => {
  const currentAssignedLaundryId = readAssignedLaundryId(listing);
  // Read from the stored listing, never from the request body. A client that
  // could assert its own `onLaundry` is a client that has no guard at all.
  const onLaundry = listing?.attributes?.metadata?.onLaundry;

  const isChange = (currentAssignedLaundryId || null) !== (nextAssignedLaundryId || null);

  const activePromise = isChange
    ? findActiveTransactions({ integrationSdk, listingId })
    : Promise.resolve({ active: false, states: [], unknown: false });

  return activePromise.then(active => {
    const { allowed, changed, reason } = evaluateLaundryAssignment({
      currentAssignedLaundryId,
      nextAssignedLaundryId,
      onLaundry,
      hasActiveTransaction: active.active,
    });

    if (!allowed) {
      throw conflictError(
        reason,
        reason === 'on-laundry'
          ? 'The garment is currently at the laundry. The assigned laundry cannot be changed ' +
              'until it has been returned to its owner (onLaundry = false).'
          : active.unknown
          ? 'Could not verify whether this listing has an active transaction; refusing to ' +
            'change the assigned laundry.'
          : 'This listing has an active transaction ' +
            `(${active.states.join(', ') || 'state unknown'}). The assigned laundry cannot be ` +
            'changed until it has finished.'
      );
    }

    return {
      changed,
      onLaundry: onLaundry === true,
      currentAssignedLaundryId: currentAssignedLaundryId || null,
    };
  });
};

module.exports = {
  ASSIGNED_LAUNDRY_KEY,
  INITIAL_CLEANING_DAYS_KEY,
  readAssignedLaundryId,
  resolveInitialCleaningDays,
  evaluateLaundryAssignment,
  resolveAssignedLaundry,
  laundryDerivedListingFields,
  laundryDerivedListingParams,
  writeLaundryAssignment,
  writeLaundryDerivedListingFields,
  assertLaundryAssignmentAllowed,
};
