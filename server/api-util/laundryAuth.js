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
// (`getSdk(req, res)`), not the Integration API. Only the actual metadata
// *write* that each endpoint performs afterwards needs the Integration API.

const forbiddenError = message => {
  const error = new Error(message);
  error.status = 403;
  error.statusText = message;
  error.data = {};
  return error;
};

// Fetch the caller's own currentUser via the ordinary (cookie-based)
// Marketplace SDK and confirm they're flagged `metadata.isLaundry === true`.
//
// Returns a Promise resolving to the currentUser API entity on success, or
// rejecting with a 403-shaped error (see forbiddenError above) otherwise.
const requireLaundryCaller = (req, res) => {
  const sdk = getSdk(req, res);

  return sdk.currentUser.show().then(response => {
    const currentUser = response.data.data;
    const isLaundry = currentUser?.attributes?.profile?.metadata?.isLaundry === true;

    if (!isLaundry) {
      throw forbiddenError('Caller is not a laundry user.');
    }

    return currentUser;
  });
};

// Confirm that `currentUser` (a laundry user, already checked via
// requireLaundryCaller) is the specific laundry assigned to a resource
// (a listing's `publicData.assignedLaundryId`, whether read directly off a
// listing or off a transaction's included listing).
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
  requireLaundryCaller,
  assertIsAssignedLaundry,
  authorizeLaundryCaller,
};
