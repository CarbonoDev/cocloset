// Changing a laundry's own address, and carrying that change through to every
// garment assigned to it.
//
//   > "Igual podemos hacer una llamada secundaria que solo guarde la dirección, el
//   >  resto se sigue guardando igual, pero la dirección (aun en publicData) se
//   >  guarda a través de integration API, asi validamos que tenga habilitada la
//   >  opción (ya que un admin lo va a habilitar para poder cambiar el address) y si
//   >  puede cambiarla entonces hace el cambio"
//
//   > "una vez que se pueda cambiar la dirección, debe cambiar tambien la dirección
//   >  de todos los listings asociados a ese laundry"
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS GATE DOES AND DOES NOT CLOSE. READ THIS BEFORE TRUSTING IT.
// ─────────────────────────────────────────────────────────────────────────────
// The address lives in the laundry USER's `publicData.laundryProfile`, and a user
// can write their own `publicData` directly against the Marketplace API with
// `currentUser.updateProfile` — no server of ours is in that path. Nothing in this
// file changes that.
//
// So, precisely: this module gates OUR path, and our path is the only one that also
// propagates. A laundry that goes around it can still change its own stored address;
// what it cannot do that way is have that change reflected on the garments assigned
// to it, because that write needs the Integration API. The permission flag is
// therefore an operator workflow control (and a correctness one, since the
// sanctioned path keeps the listings in step), not an access control.
//
// This design was chosen by the client with that limitation stated. Do not write a
// comment, message or translation here claiming the address is protected or cannot
// be changed — it can.
//
// THE CHEAP HARDENING, IF IT IS EVER WANTED: make the two things that CONSUME the
// address — directory eligibility (api-util/laundryDirectory.js) and assignment
// inheritance (api-util/laundryAssignment.js `resolveAssignedLaundry`) — read a
// server-written copy in the laundry's `metadata` instead of `publicData`. A studio
// overwriting its own `publicData` would then be changing cosmetics on its own
// profile and could not move the pickup point of somebody else's garment. That is a
// data-model change, deliberately not done here.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE PERMISSION FLAG IS IN `metadata`
// ─────────────────────────────────────────────────────────────────────────────
// A flag the laundry can write is not a permission. `metadata` on a user is
// writable only through the Integration API — the same property that makes
// `metadata.isLaundry` a real role rather than a self-assigned one (verified
// against Dev: a user's own write is refused with 400 `validation-disallowed-key`;
// see api-util/laundryAssignment.js). ABSENT MEANS NOT ALLOWED, and only a real
// boolean `true` grants: `'true'`, `1` and `{}` are bad data, and bad data must not
// unlock anything.

const {
  ASSIGNED_LAUNDRY_KEY,
  readAssignedLaundryId,
  writeLaundryDerivedListingFields,
} = require('./laundryAssignment');
const {
  hasUsableLaundryProfile,
  isLaundryUserEntity,
  toLaundryDirectoryEntry,
} = require('./laundryDirectory');

const ADDRESS_CHANGE_ALLOWED_KEY = 'addressChangeAllowed';

const LISTINGS_PER_PAGE = 100;

// Every state a listing can be in. Omitting this parameter does NOT mean "all":
// `listings.query` defaults to published only, which would silently skip drafts —
// and a draft left pointing at the studio's old address is a listing whose owner
// publishes a wrong pickup point later.
const ALL_LISTING_STATES = ['draft', 'pendingApproval', 'published', 'closed'];

// Safety cap so one call cannot turn into an unbounded crawl of a large
// marketplace. Mirrors server/api/laundry-orders.js. A run that hits it reports
// `truncated` rather than silently doing half the job.
const MAX_LISTING_PAGES = 20;

/**
 * Is this laundry currently permitted to change its own address?
 *
 * Strict `=== true` for the reason in the header: this is the whole permission.
 *
 * @param {Object} [user] - a user API entity (Marketplace or Integration)
 * @returns {boolean}
 */
const readAddressChangeAllowed = user =>
  user?.attributes?.profile?.metadata?.[ADDRESS_CHANGE_ALLOWED_KEY] === true;

/**
 * THE RULE, pure and separately testable.
 *
 * Three branches, in this order:
 *
 *   1. NO USABLE ADDRESS YET -> allowed, no flag required. Onboarding must always
 *      work. A studio that has never set an address is invisible in the picker
 *      (api-util/laundryDirectory.js drops it) and cannot be assigned anything, so
 *      requiring an admin grant before the FIRST address would strand every new
 *      studio behind a support ticket for something no rule is protecting. Note
 *      this branch is entered by a studio that has an address string but no usable
 *      `origin` too — it is excluded just as hard, so it is just as much "not set
 *      up yet".
 *   2. USABLE ADDRESS + the flag granted -> allowed.
 *   3. Otherwise -> refused.
 *
 * `reason` is what the caller switches on, both for the response `data.code` and
 * for deciding whether there is a grant to spend (branch 1 consumes nothing).
 *
 * @param {Object} params
 * @param {boolean} params.hasUsableStoredAddress - hasUsableLaundryProfile of the STORED profile
 * @param {boolean} params.addressChangeAllowed - readAddressChangeAllowed of the stored user
 * @returns {{allowed: boolean, reason: 'no-address-yet'|'change-granted'|'change-not-allowed'}}
 */
const evaluateAddressChange = ({ hasUsableStoredAddress, addressChangeAllowed }) => {
  if (!hasUsableStoredAddress) {
    return { allowed: true, reason: 'no-address-yet' };
  }
  if (addressChangeAllowed === true) {
    return { allowed: true, reason: 'change-granted' };
  }
  return { allowed: false, reason: 'change-not-allowed' };
};

/**
 * Normalise and validate a submitted address + coordinates.
 *
 * Coordinates are validated to the SAME standard api-util/laundryDirectory.js
 * `parseOrigin` applies, because that is the standard that decides whether the
 * studio appears in the picker at all. Accepting a looser origin here would let a
 * studio save an address, be told it succeeded, and stay invisible.
 *
 * @param {Object} [input] - `{ address, origin: { lat, lng } }` from a request body
 * @returns {{address: string, origin: {lat: number, lng: number}}|null} null when unusable
 */
const parseAddressInput = input => {
  const address = typeof input?.address === 'string' ? input.address.trim() : '';
  const lat = input?.origin?.lat;
  const lng = input?.origin?.lng;
  const hasUsableOrigin =
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    typeof lng === 'number' &&
    Number.isFinite(lng);

  return address && hasUsableOrigin ? { address, origin: { lat, lng } } : null;
};

/**
 * Read a laundry user through the Integration API and describe its address state.
 *
 * Deliberately NOT derived from the `currentUser` payload the caller's own session
 * returns, for the reason server/api/init-user-role.js gives: the decision below is
 * the thing this endpoint exists to enforce, so it is taken from the same
 * authoritative source that performs the write, not from a payload fetched for
 * authentication.
 *
 * The stored-address question is answered by `hasUsableLaundryProfile` — the exact
 * predicate `/api/laundries` uses to decide whether this studio is offerable —
 * rather than a second opinion about what "has an address" means.
 *
 * @param {Object} params
 * @param {Object} params.integrationSdk
 * @param {string} params.laundryId
 * @returns {Promise<{user: Object, entry: Object, laundryProfile: Object, hasUsableStoredAddress: boolean, addressChangeAllowed: boolean}>}
 */
const readLaundryAddressState = ({ integrationSdk, laundryId }) =>
  integrationSdk.users.show({ id: laundryId }).then(response => {
    const user = response?.data?.data;

    if (!isLaundryUserEntity(user)) {
      const error = new Error('The target user is not a laundry.');
      error.status = 403;
      error.statusText = error.message;
      error.data = { code: 'not-a-laundry' };
      throw error;
    }

    const entry = toLaundryDirectoryEntry(user);

    return {
      user,
      entry,
      laundryProfile: user?.attributes?.profile?.publicData?.laundryProfile || {},
      hasUsableStoredAddress: hasUsableLaundryProfile(entry),
      addressChangeAllowed: readAddressChangeAllowed(user),
    };
  });

/**
 * Write the new address onto the laundry's own profile.
 *
 * READ-MODIFY-WRITE, AND IT HAS TO BE. Sharetribe merges extended data by
 * TOP-LEVEL key only, and `laundryProfile` is one top-level key holding a nested
 * object. Sending `publicData: { laundryProfile: { address, origin } }` therefore
 * REPLACES the whole object and silently destroys `studioName` and `businessHours`
 * — a studio-wide data loss that would look like a successful save. The existing
 * keys are read from the entity fetched by readLaundryAddressState and spread back.
 *
 * `origin` is written as PLAIN JSON, not as an SDK `LatLng`. `publicData` is opaque
 * to the transit codec, so a script/Integration write stores plain objects and a
 * browser write stores a LatLng — which is exactly why the form rehydrates it (see
 * LaundryProfilePage's `toLatLng`). Plain JSON is the shape every server-side
 * reader here already parses.
 *
 * THE FLAG IS SPENT, NOT LEFT ON. When the write used a grant
 * (`reason === 'change-granted'`) the flag is set back to `false` in the same call.
 * An admin enables it *in order to* make one change; a flag left true forever
 * quietly re-opens the thing it was added to control. It is written as an explicit
 * `false` rather than deleted, matching how `metadata.isLaundry` is defaulted in
 * api-util/laundryRoleDefaults.js — an operator reading Console sees a decision
 * rather than an absence.
 *
 * ONLY 'change-granted' SPENDS. Every other reason sends no `metadata` at all:
 * onboarding ('no-address-yet') had no grant to spend, and an ADMIN write
 * (scripts/update-laundry-address.js passes 'admin-override') is not the studio
 * spending its own grant — clearing the flag there would silently cancel a change
 * the studio was about to make itself.
 *
 * @param {Object} params
 * @param {Object} params.integrationSdk
 * @param {string} params.laundryId
 * @param {Object} params.laundryProfile - the STORED laundryProfile, to merge into
 * @param {string} params.address
 * @param {{lat: number, lng: number}} params.origin
 * @param {string} params.reason - from evaluateAddressChange
 * @returns {Promise<Object>} the updated user API entity
 */
const writeLaundryAddress = ({
  integrationSdk,
  laundryId,
  laundryProfile,
  address,
  origin,
  reason,
}) =>
  integrationSdk.users
    .updateProfile(
      {
        id: laundryId,
        publicData: {
          laundryProfile: { ...laundryProfile, address, origin: { ...origin } },
        },
        ...(reason === 'change-granted'
          ? { metadata: { [ADDRESS_CHANGE_ALLOWED_KEY]: false } }
          : {}),
      },
      { expand: true }
    )
    .then(response => response?.data?.data);

/**
 * Every listing assigned to one laundry, in every state.
 *
 * TWO FILTERS, AND THE JS ONE IS THE LOAD-BEARING ONE. `meta_assignedLaundryId` is
 * passed so this scales the day a metadata-scope search schema exists, but the
 * Integration API FAILS OPEN on a filter param it does not recognise — a bogus
 * value returns EVERY listing in the marketplace (verified against Dev; it has
 * already caused two security bugs in this project, see
 * server/api/laundry-orders.js). Here the consequence of trusting it would be
 * rewriting the pickup address of every garment in the marketplace to one studio's
 * address. So the stored value is re-checked in JS, through
 * `readAssignedLaundryId`, and that check must never be "optimised" away.
 *
 * @param {Object} params
 * @param {Object} params.integrationSdk
 * @param {string} params.laundryId
 * @returns {Promise<{listings: Array, scanned: number, truncated: boolean}>}
 */
const findListingsAssignedToLaundry = ({ integrationSdk, laundryId }) => {
  // Guarded rather than assumed. With no id, the JS comparison below would be
  // `undefined === undefined` for every UNASSIGNED listing in the marketplace, i.e.
  // the security filter would invert into a match-almost-everything filter. Callers
  // do validate the id (the endpoint answers 401 without a session, the script exits
  // on a missing argument), but this filter is the last line and must not depend on
  // them getting it right.
  if (!laundryId || typeof laundryId !== 'string') {
    return Promise.reject(new Error('findListingsAssignedToLaundry requires a laundry user id.'));
  }

  const collected = [];
  let scanned = 0;

  const fetchPage = page =>
    integrationSdk.listings
      .query({
        // No-op unless a metadata-scope search schema exists. Never the real
        // filter - that is the JS pass below.
        [`meta_${ASSIGNED_LAUNDRY_KEY}`]: laundryId,
        page,
        perPage: LISTINGS_PER_PAGE,
        states: ALL_LISTING_STATES,
      })
      .then(response => {
        const { data = [], meta = {} } = response.data || {};
        scanned += data.length;
        // THE REAL FILTER.
        data.forEach(listing => {
          if (readAssignedLaundryId(listing) === laundryId) {
            collected.push(listing);
          }
        });

        const totalPages = meta.totalPages || 1;
        const hasMore = page < totalPages;
        if (hasMore && page < MAX_LISTING_PAGES) {
          return fetchPage(page + 1);
        }
        return { truncated: hasMore };
      });

  return fetchPage(1).then(({ truncated }) => ({ listings: collected, scanned, truncated }));
};

const describeListing = listing =>
  `${listing?.attributes?.title || '(untitled)'} [${listing?.attributes?.state}] (${
    listing?.id?.uuid
  })`;

/**
 * Push a laundry's current address onto every listing assigned to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LISTINGS WITH A RENTAL IN FLIGHT ARE INCLUDED. THIS IS DELIBERATE.
 * ─────────────────────────────────────────────────────────────────────────────
 * `pickupAddress` and `geolocation` answer one question — where does a customer
 * physically go to collect and return this garment — and after the studio moves,
 * the answer is the new address for every garment the studio holds, including the
 * ones mid-rental. Skipping in-flight listings would leave precisely the customers
 * who are about to travel somewhere reading the address the studio has left. The
 * assignment itself is untouched (see writeLaundryDerivedListingFields): the same
 * studio, at its new address, so none of the reasons the assignment is frozen
 * mid-rental (`onLaundry`, active transaction) apply to this write.
 *
 * WHAT IS NOT HANDLED, STATED PLAINLY: a customer who already read the old address
 * is not notified, and any address already copied into a transaction's own data
 * (e.g. a delivery/pickup snapshot) is not rewritten. Both are out of scope here.
 *
 * Sequential rather than Promise.all: a burst of parallel Integration API writes is
 * the fastest way to hit the rate limit mid-run and leave half the studio's
 * garments on the old address. Same reasoning as
 * scripts/migrate-assigned-laundry-to-metadata.js.
 *
 * A per-listing failure does NOT abort the run. Stopping on the first error would
 * leave an arbitrary prefix updated with no record of where it stopped; instead
 * every failure is collected and reported so the caller can retry (this function is
 * idempotent).
 *
 * @param {Object} params
 * @param {Object} params.integrationSdk
 * @param {string} params.laundryId
 * @param {Object} params.laundry - `{ displayName, studioName, address, origin }`
 * @param {boolean} [params.dryRun] - report what would change, write nothing
 * @returns {Promise<{updated: Array, failed: Array, skipped: Array, scanned: number, truncated: boolean, dryRun: boolean}>}
 */
const propagateAddressToAssignedListings = ({ integrationSdk, laundryId, laundry, dryRun }) =>
  findListingsAssignedToLaundry({ integrationSdk, laundryId }).then(
    ({ listings, scanned, truncated }) => {
      const updated = [];
      const failed = [];
      // Already correct on both fields, so there is nothing to write. Reported
      // rather than silently folded into "updated": an operator re-running this
      // needs to see that it converged, not a second full count of writes that
      // did not happen.
      const skipped = [];

      const jobs = listings.filter(listing => {
        const publicData = listing?.attributes?.publicData || {};
        const geolocation = listing?.attributes?.geolocation || {};
        const alreadyCorrect =
          publicData.pickupAddress === laundry.address &&
          geolocation.lat === laundry.origin.lat &&
          geolocation.lng === laundry.origin.lng &&
          publicData.assignedLaundryName === (laundry.displayName || laundry.studioName || null);

        if (alreadyCorrect) {
          skipped.push({ id: listing.id.uuid, description: describeListing(listing) });
        }
        return !alreadyCorrect;
      });

      const result = () => ({
        updated,
        failed,
        skipped,
        scanned,
        truncated,
        dryRun: !!dryRun,
      });

      if (dryRun) {
        jobs.forEach(listing => {
          updated.push({ id: listing.id.uuid, description: describeListing(listing) });
        });
        return result();
      }

      return jobs
        .reduce(
          (chain, listing) =>
            chain.then(() =>
              writeLaundryDerivedListingFields({
                integrationSdk,
                listingId: listing.id,
                laundry,
              })
                .then(() => {
                  updated.push({ id: listing.id.uuid, description: describeListing(listing) });
                })
                .catch(e => {
                  // NEVER the bare error: an axios error carries `config.headers`
                  // with the bearer token in it.
                  failed.push({
                    id: listing.id.uuid,
                    description: describeListing(listing),
                    error: e?.data || e?.message || 'Unknown error',
                  });
                })
            ),
          Promise.resolve()
        )
        .then(result);
    }
  );

module.exports = {
  ADDRESS_CHANGE_ALLOWED_KEY,
  ALL_LISTING_STATES,
  readAddressChangeAllowed,
  evaluateAddressChange,
  parseAddressInput,
  readLaundryAddressState,
  writeLaundryAddress,
  findListingsAssignedToLaundry,
  propagateAddressToAssignedListings,
  describeListing,
};
