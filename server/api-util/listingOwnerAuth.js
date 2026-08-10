const { getSdk } = require('./sdk');
const { isLaundryUser, assertIsAssignedLaundry } = require('./laundryAuth');

// Authorization for the endpoints a garment's OWNER may call, and for the one
// question that has two right answers: garment custody.
//
// WHY THIS IS A SEPARATE MODULE FROM laundryAuth.js
// laundryAuth.js answers exactly one question - "is the caller the laundry
// assigned to this resource?" - and every write endpoint that has ever needed
// authorization until now has been laundry-only. `listing.metadata.onLaundry`
// is the first field two different principals may write:
//
//   > "este status lo puede modificar laundry o el dueño (siempre que no este
//   >  en una transacción activa)"
//
// The owner case is NOT a relaxation of the laundry case, and must not be
// implemented as one. Widening requireLaundryCaller() to also pass non-laundry
// users would silently widen every OTHER endpoint that depends on it -
// laundry-transaction-status.js drives the payout and the refund window through
// it. So laundryAuth.js is imported here UNCHANGED and the owner check is a new,
// independent predicate.
//
// WHY THE OWNER CHECK IS `relationships.author`, NOT `publicData`
// A listing's author is a first-class API relationship, set by Sharetribe at
// creation and not writable by anyone. Anything in extended data - including
// `publicData.assignedLaundryId`, which the owner CAN write - would be checking
// authorization against a value the caller controls.

const forbiddenError = message => {
  const error = new Error(message);
  error.status = 403;
  error.statusText = message;
  error.data = {};
  return error;
};

const unauthorizedError = () => {
  const error = new Error('Authentication required.');
  error.status = 401;
  error.statusText = 'Authentication required.';
  error.data = {};
  return error;
};

/**
 * Is `currentUser` the author of `listing`?
 *
 * Pure. `listing` is an API listing entity (Marketplace or Integration - both
 * carry `relationships.author`).
 *
 * @param {Object} [currentUser] - a currentUser API entity
 * @param {Object} [listing] - a listing API entity
 * @returns {boolean}
 */
const isListingAuthor = (currentUser, listing) => {
  const authorId = listing?.relationships?.author?.data?.id?.uuid;
  const callerId = currentUser?.id?.uuid;
  return !!authorId && !!callerId && authorId === callerId;
};

// Resolve the caller from their own cookie-scoped Marketplace session, mapping a
// failed session onto a 401 rather than letting an SDK error surface as a 500.
// Deliberately NOT the Integration API: "who is calling" must come from the
// caller's own credentials, never from a full-admin token.
const resolveCaller = (req, res) =>
  getSdk(req, res)
    .currentUser.show()
    .catch(() => {
      throw unauthorizedError();
    })
    .then(response => response.data.data);

/**
 * Require that the caller is the listing's own author.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Object} listing - a listing API entity (must carry relationships.author)
 * @returns {Promise<Object>} the currentUser entity
 */
const requireListingAuthorCaller = (req, res, listing) =>
  resolveCaller(req, res).then(currentUser => {
    if (!isListingAuthor(currentUser, listing)) {
      throw forbiddenError('Caller is not the owner of this listing.');
    }
    return currentUser;
  });

/**
 * Require that the caller is EITHER the listing's assigned laundry OR its owner.
 *
 * The order is owner-first on purpose. A user can be both (a laundry that also
 * lists a garment of its own), and being the listing's author is the stronger
 * claim: checking the laundry branch first would run assertIsAssignedLaundry on
 * an owner who happens to carry the isLaundry flag and reject them from their own
 * listing.
 *
 * A laundry that is not THIS listing's assigned laundry is rejected by
 * assertIsAssignedLaundry exactly as it is everywhere else - the laundry rule is
 * imported, not restated.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Object} listing - a listing API entity
 * @returns {Promise<{currentUser: Object, role: 'owner'|'laundry'}>}
 */
const authorizeLaundryOrOwnerCaller = (req, res, listing) =>
  resolveCaller(req, res).then(currentUser => {
    if (isListingAuthor(currentUser, listing)) {
      return { currentUser, role: 'owner' };
    }

    if (isLaundryUser(currentUser)) {
      assertIsAssignedLaundry(currentUser, listing?.attributes?.publicData?.assignedLaundryId);
      return { currentUser, role: 'laundry' };
    }

    throw forbiddenError(
      'Caller is neither the laundry assigned to this listing nor the listing owner.'
    );
  });

module.exports = {
  isListingAuthor,
  requireListingAuthorCaller,
  authorizeLaundryOrOwnerCaller,
};
