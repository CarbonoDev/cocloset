// Pure helpers backing server/api/laundries.js — the laundry-picker directory.
//
// WHY THIS EXISTS AS A SEPARATE, PURE MODULE:
// The Integration API's `users.query` **fails open** on unrecognised filter
// params: `users.query({ meta_isLaundry: true })` returns *every* user in the
// marketplace, exactly like `users.query({})`. Verified against Dev — passing
// `false`, or an entirely invented key, returns the identical full result set.
// Filtering users by extended data would need a user-scope search schema
// registered via `flex-cli search`, which does not exist for this marketplace.
//
// So the ONLY thing standing between "list the laundries" and "leak every user
// in the marketplace" is the JS-side filter below. It is security-relevant, it
// must never be skipped, and it is kept here (pure, no SDK, no Express) so it
// can be unit-tested directly — including with a negative case: a non-laundry
// user that must NOT appear in the output.

// Field allowlist for the public-ish directory response. Deliberately explicit
// rather than spreading `publicData`: `publicData` is user-writable, so
// spreading it turns this endpoint into an open pipe for whatever a laundry
// happens to have stored on its profile now or in future.
//
// `turnaroundHours` lives in the laundry's *privateData* and is surfaced here
// on purpose — the picker cards (mockup 12.jpg) show it to garment owners
// before any relationship exists. `cleaningFee`, the other privateData field
// on the laundry profile, is NOT exposed: it is a server-side pricing input.

// A laundry's `origin` has to be a real coordinate pair, because the listing
// wizard copies it onto the listing's own `geolocation` (see
// EditListingLaundryPanel). A missing/garbage origin is what makes a listing
// permanently unpublishable, so it's validated here rather than downstream.
const parseOrigin = origin => {
  const lat = origin?.lat;
  const lng = origin?.lng;
  const isValid =
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    typeof lng === 'number' &&
    Number.isFinite(lng);
  return isValid ? { lat, lng } : null;
};

// turnaroundHours can legitimately arrive as a string: the LaundryProfileForm
// parses it to an int, but Console / the Integration API / set-laundry-role.js
// can all write a raw string. Coerce here so consumers get a number or null,
// never `'36'` (which `Number.isFinite` rejects — see resolveTurnaroundHours).
const parseTurnaroundHours = value => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * True only if the API entity is a user genuinely flagged as a laundry.
 *
 * This is the authoritative check — never trust a query param for it.
 *
 * @param {Object} user - a `user` API entity from users.query/users.show
 * @returns {boolean}
 */
const isLaundryUserEntity = user => user?.attributes?.profile?.metadata?.isLaundry === true;

/**
 * Map a user API entity onto the allowlisted directory record.
 *
 * @param {Object} user - a `user` API entity
 * @returns {Object} flat record: id, displayName, studioName, address, origin,
 *   businessHours, acceptedCategories, turnaroundHours
 */
const toLaundryDirectoryEntry = user => {
  const profile = user?.attributes?.profile || {};
  const publicData = profile.publicData || {};
  const privateData = profile.privateData || {};
  const laundryProfile = publicData.laundryProfile || {};
  const acceptedCategories = publicData.acceptedCategories;

  return {
    id: user?.id?.uuid || null,
    displayName: profile.displayName || null,
    studioName: laundryProfile.studioName || null,
    address: laundryProfile.address || null,
    origin: parseOrigin(laundryProfile.origin),
    businessHours: laundryProfile.businessHours || null,
    acceptedCategories: Array.isArray(acceptedCategories) ? acceptedCategories : [],
    turnaroundHours: parseTurnaroundHours(privateData.turnaroundHours),
  };
};

/**
 * A directory entry is only *usable* if the wizard can actually do something
 * with it. Assigning a laundry with no `origin` writes no `geolocation`, which
 * leaves the wizard's LAUNDRY tab permanently incomplete and the owner unable
 * to publish, with no error shown (see EditListingWizard's tabCompleted).
 *
 * @param {Object} entry - a record from toLaundryDirectoryEntry
 * @returns {boolean}
 */
const hasUsableLaundryProfile = entry => !!(entry?.id && entry?.address && entry?.origin);

/**
 * Build the laundry directory from a raw list of user API entities.
 *
 * Two filters, in order:
 *   1. `metadata.isLaundry === true` — the security filter. Everything else in
 *      the marketplace is dropped here.
 *   2. a usable `laundryProfile` (address + origin) — the usability filter.
 *      Reported separately in `meta.incompleteProfileCount` so an operator can
 *      tell "no laundries exist" apart from "the laundry never set up its
 *      profile", instead of both looking like an empty picker.
 *
 * @param {Array} users - user API entities (possibly the whole marketplace)
 * @returns {{ laundries: Array, meta: { totalUsersScanned: number,
 *   laundryUserCount: number, incompleteProfileCount: number } }}
 */
const buildLaundryDirectory = users => {
  const allUsers = Array.isArray(users) ? users : [];
  const laundryUsers = allUsers.filter(isLaundryUserEntity);
  const entries = laundryUsers.map(toLaundryDirectoryEntry);
  const laundries = entries.filter(hasUsableLaundryProfile);

  return {
    laundries,
    meta: {
      totalUsersScanned: allUsers.length,
      laundryUserCount: laundryUsers.length,
      incompleteProfileCount: laundryUsers.length - laundries.length,
    },
  };
};

module.exports = {
  isLaundryUserEntity,
  toLaundryDirectoryEntry,
  hasUsableLaundryProfile,
  buildLaundryDirectory,
};
