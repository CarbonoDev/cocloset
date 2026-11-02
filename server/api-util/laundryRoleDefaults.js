// Sets the DEFAULT value of the `isLaundry` role flag on a user.
//
// WHY THIS EXISTS
// ---------------
// Every user must exist with an explicit `metadata.isLaundry = false`, so an
// operator opening the user in Sharetribe Console sees the key and can toggle
// it, instead of having to type a key name that isn't there. Until now nothing
// wrote it at all: a freshly created user has `metadata: {}` (verified against
// the Dev marketplace). Functionally that is already equivalent to `false` —
// every consumer checks `=== true` (src/util/userHelpers.js `isLaundryUser`,
// server/api-util/laundryDirectory.js `isLaundryUserEntity`) — so this is
// about making the flag *visible and toggleable*, not about behaviour.
//
// WHY IT NEEDS THE INTEGRATION API
// --------------------------------
// `isLaundry` deliberately lives in user *metadata* rather than publicData
// precisely so a user cannot self-assign the laundry role (design doc §2).
// Verified against the real API: `sdk.currentUser.updateProfile({ metadata })`
// is rejected with `400 validation-disallowed-key`. Metadata is writable only
// through the Integration API, i.e. only server-side, with full-admin
// credentials. That is why the signup default cannot be set from the browser
// and has to go through server/api/init-user-role.js.
//
// THE ONE PROPERTY THAT MATTERS: NEVER DEMOTE AN EXISTING LAUNDRY
// ---------------------------------------------------------------
// Because the write runs with admin credentials and is triggered at signup —
// and, being idempotent-by-design, may be triggered again later — a naive
// "always write false" would silently strip the laundry role from any user an
// admin had already promoted, taking with it their ability to advance
// transactions and set the cleaning fee customers are charged. So this module
// READS FIRST and only writes when the key is genuinely absent. See
// `needsLaundryRoleDefault` below for the exact rule, and the tests for the
// regression case (an `isLaundry: true` user must come out of this untouched).
//
// The value written is hard-coded, not a parameter. There is deliberately no
// way to call into this module and have it write `true`, or write to some
// other metadata key: that keeps the blast radius of the admin-credentialled
// endpoint in front of it to exactly one key and exactly one value.

const LAUNDRY_ROLE_KEY = 'isLaundry';

/**
 * Should we write the default onto this user's metadata?
 *
 * True only when the key is genuinely absent. Any value already present —
 * `true`, `false`, or anything unexpected an operator/script may have put
 * there — is left alone, because we cannot tell an intentional value from a
 * stale one and overwriting is the destructive option.
 *
 * `null` / `undefined` count as absent: the API never returns a metadata key
 * whose value is null (writing `null` deletes the key — verified against the
 * Dev API), so this is defence in depth rather than an observed shape.
 *
 * Pure (no SDK) so it is directly unit-testable.
 *
 * @param {Object|null|undefined} metadata - a user's `profile.metadata`
 * @returns {boolean}
 */
const needsLaundryRoleDefault = metadata => {
  if (!metadata || typeof metadata !== 'object') {
    return true;
  }
  const value = metadata[LAUNDRY_ROLE_KEY];
  return value === null || value === undefined;
};

/**
 * Ensure `metadata.isLaundry` exists on one user, defaulting it to `false`.
 *
 * Read-then-write, and a no-op when the key already has a value. Metadata
 * updates merge per top-level key server-side (verified against the Dev API),
 * so writing `{ isLaundry: false }` does not clobber the user's other
 * metadata.
 *
 * @param {Object} integrationSdk - an Integration SDK instance
 * @param {Object|string} userId - the target user's id (uuid string or UUID)
 * @returns {Promise<{ userId: string, isLaundry: *, updated: boolean,
 *   reason: string }>} `updated: false` with `reason: 'already-set'` when the
 *   key was already present; `updated: true` with `reason: 'defaulted'` when
 *   the default was written.
 */
const ensureLaundryRoleDefault = (integrationSdk, userId) => {
  const idForLog = userId?.uuid || userId;

  if (!userId) {
    return Promise.reject(new Error('ensureLaundryRoleDefault: missing userId.'));
  }

  return integrationSdk.users.show({ id: userId }).then(response => {
    const metadata = response?.data?.data?.attributes?.profile?.metadata;

    if (!needsLaundryRoleDefault(metadata)) {
      // Someone (an admin in Console, scripts/set-laundry-role.js) has already
      // decided this user's role. Never overwrite it — see the header comment.
      return {
        userId: idForLog,
        isLaundry: metadata[LAUNDRY_ROLE_KEY],
        updated: false,
        reason: 'already-set',
      };
    }

    return integrationSdk.users
      .updateProfile({ id: userId, metadata: { [LAUNDRY_ROLE_KEY]: false } }, { expand: true })
      .then(updateResponse => ({
        userId: idForLog,
        isLaundry: updateResponse?.data?.data?.attributes?.profile?.metadata?.[LAUNDRY_ROLE_KEY],
        updated: true,
        reason: 'defaulted',
      }));
  });
};

module.exports = {
  LAUNDRY_ROLE_KEY,
  needsLaundryRoleDefault,
  ensureLaundryRoleDefault,
};
