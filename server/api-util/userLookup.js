// Safe user-by-email lookup for Integration API admin tooling.
//
// WHY: `users.query({ emailAddress })` DOES NOT FILTER. The Integration API
// drops unrecognised query params instead of rejecting them, so the call
// returns every user in the marketplace and `data[0]` is simply whoever sorts
// first. Verified against Dev: querying for `test-laundry-cocloset@example.com`
// returned `test-cocloset-tom-brady@example.com`. Any write keyed off that
// result targets an arbitrary user.
//
// `users.show({ email })` is the correct API and does resolve exactly one user
// (verified). This module wraps it and then re-checks the returned user's email
// against what was asked for — defence in depth against exactly this class of
// silently-ignored-filter bug, in case `show` ever degrades the same way.

// Sharetribe email addresses are case-insensitive; compare normalised.
const normalizeEmail = email => (typeof email === 'string' ? email.trim().toLowerCase() : '');

/**
 * Throw unless `user` is really the user that `requestedEmail` asked for.
 *
 * Pure (no SDK), so the guard itself is unit-testable — see userLookup.test.js.
 *
 * @param {Object} user - a `user` API entity
 * @param {string} requestedEmail - the email that was looked up
 * @returns {Object} the same user entity, when it matches
 * @throws {Error} when there is no user, no email on it, or a mismatch
 */
const assertUserMatchesEmail = (user, requestedEmail) => {
  const wanted = normalizeEmail(requestedEmail);
  const got = normalizeEmail(user?.attributes?.email);

  if (!user) {
    throw new Error(`No user found with email ${requestedEmail}`);
  }
  if (!got) {
    throw new Error(
      `Refusing to continue: the user returned for ${requestedEmail} has no email address ` +
        `on it, so the lookup cannot be verified.`
    );
  }
  if (got !== wanted) {
    throw new Error(
      `Refusing to continue: asked for ${requestedEmail} but the API returned ` +
        `${user.attributes.email} (${user.id?.uuid}). This is the signature of a silently ` +
        `ignored query filter — do NOT write to this user.`
    );
  }

  return user;
};

/**
 * Look up exactly one user by email via the Integration API, verified.
 *
 * @param {Object} sdk - an Integration SDK instance
 * @param {string} email
 * @returns {Promise<Object>} the matching user API entity
 */
const findUserByEmail = (sdk, email) =>
  sdk.users.show({ email }).then(res => assertUserMatchesEmail(res?.data?.data, email));

module.exports = {
  normalizeEmail,
  assertUserMatchesEmail,
  findUserByEmail,
};
