const { getSdk } = require('./sdk');

// Shared authorization logic for the laundry-facing endpoints
// (server/api/laundry-transaction-status.js, server/api/listing-readiness-status.js).
//
// Both endpoints need the same check: the caller must (a) be flagged
// `metadata.isLaundry` on their own user profile, and (b) be the specific
// laundry assigned to the resource (transaction's listing / listing) being
// acted on.
//
// A user's own `metadata` is visible via the ordinary Marketplace API (no
// Integration API needed to *read* it - see `sdk.currentUser.show()` below),
// so authorization is done with the caller's own request-scoped SDK
// (`getSdk(req, res)`), not the Integration API. Only the privileged write
// that each endpoint performs afterwards needs the Integration API.
//
// WHY THIS FILE IS STILL LOAD-BEARING NOW THAT REAL TRANSITIONS ARE USED
// An earlier version of this comment explained that the laundry endpoints
// deliberately did NOT call `transactions.transition()`, because Sharetribe
// has no "laundry" actor role. That is no longer the design:
// laundry-transaction-status.js now fires real `cocloset-booking` transitions.
// The reasoning has NOT been invalidated by that, it has been inverted. Those
// transitions are all `:actor.role/operator` and run through the full-admin
// Integration API, so the platform will happily let ANY caller who reaches
// this server drive ANY transaction's custody chain - including the payout on
// `laundry-mark-pending-cleaning` and the refund on `cancel-from-returned`.
// Sharetribe now enforces the ORDERING of the chain; it has no concept of who
// is entitled to drive it. That half is, and remains, ours.

const forbiddenError = message => {
  const error = new Error(message);
  error.status = 403;
  error.statusText = message;
  error.data = {};
  return error;
};

// Is this user a laundry?
//
// The flag lives in the user's own profile `metadata`, which only the operator /
// Integration API can write - a user cannot promote themselves. Extracted as a
// pure predicate (rather than inlined below, where it used to live) so
// api-util/listingOwnerAuth.js's laundry-OR-owner composition can ask the same
// question off a currentUser it has already fetched, instead of re-deriving the
// rule and drifting from it. Strictly additive: requireLaundryCaller's own
// behaviour is unchanged.
//
// @param {Object} [currentUser] - a currentUser API entity
// @returns {boolean}
const isLaundryUser = currentUser => currentUser?.attributes?.profile?.metadata?.isLaundry === true;

// Fetch the caller's own currentUser via the ordinary (cookie-based)
// Marketplace SDK and confirm they're flagged `metadata.isLaundry === true`.
//
// Returns a Promise resolving to the currentUser API entity on success, or
// rejecting with a 403-shaped error (see forbiddenError above) otherwise.
const requireLaundryCaller = (req, res) => {
  const sdk = getSdk(req, res);

  return sdk.currentUser.show().then(response => {
    const currentUser = response.data.data;

    if (!isLaundryUser(currentUser)) {
      throw forbiddenError('Caller is not a laundry user.');
    }

    return currentUser;
  });
};

// Confirm that `currentUser` (a laundry user, already checked via
// requireLaundryCaller) is the specific laundry assigned to a resource
// (a listing's `metadata.assignedLaundryId`, whether read directly off a listing
// or off a transaction's included listing - always through
// api-util/laundryAssignment.js's readAssignedLaundryId, never spelled out inline).
//
// THIS IS THE AUTHORIZATION ANCHOR OF THE WHOLE LAUNDRY FLOW, and it only became
// worth anything when that field moved out of `publicData`. While it lived there
// the owner could rewrite it straight against the Marketplace API, which meant an
// owner could hand any user - including themselves - authority over an in-flight
// custody chain and the payout on `laundry-mark-pending-cleaning`. `metadata` is
// Integration-API-only (verified against Dev: an owner's write is refused with
// 400 `validation-disallowed-key`), so the value compared here can now only have
// been set by this server, after the checks in
// server/api/listing-laundry-assignment.js.
//
// Throws a 403-shaped error if there's no assigned laundry at all, or if it
// doesn't match the caller.
const assertIsAssignedLaundry = (currentUser, assignedLaundryId) => {
  const callerId = currentUser?.id?.uuid;
  const assignedId = assignedLaundryId?.uuid || assignedLaundryId;

  if (!assignedId || callerId !== assignedId) {
    throw forbiddenError('Caller is not the laundry assigned to this resource.');
  }
};

// Convenience wrapper: check both the isLaundry flag and the assigned-laundry
// match in one call. Returns a Promise resolving to the currentUser entity
// on success, or rejecting with a 403-shaped error otherwise.
const authorizeLaundryCaller = (req, res, assignedLaundryId) =>
  requireLaundryCaller(req, res).then(currentUser => {
    assertIsAssignedLaundry(currentUser, assignedLaundryId);
    return currentUser;
  });

module.exports = {
  isLaundryUser,
  requireLaundryCaller,
  assertIsAssignedLaundry,
  authorizeLaundryCaller,
};
