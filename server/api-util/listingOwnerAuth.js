const { getSdk } = require('./sdk');
const { isLaundryUser, assertIsAssignedLaundry } = require('./laundryAuth');
const { readAssignedLaundryId } = require('./laundryAssignment');

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
// WHY THE OWNER CHECK IS `relationships.author`, NOT EXTENDED DATA
// A listing's author is a first-class API relationship, set by Sharetribe at
// creation and not writable by anyone at all - not even the operator. Extended
// data is a weaker guarantee even at its strongest: `metadata.assignedLaundryId`
// is now Integration-API-only (see api-util/laundryAssignment.js), which is what
// makes it safe to authorize a LAUNDRY against, but it is still a value this
// application writes, so it can be wrong for ordinary bug reasons.
// `relationships.author` cannot. When the question is "is this the owner", ask
// the relationship.
//
// ...BUT THE RELATIONSHIP HAS TO BE ASKED FOR
// `listings.show({ id })` returns NO `relationships` key at all unless the call
// passes `include: ['author']` - verified against the Dev Integration API, where
// the bare call yields `relationships: undefined`. That is how this shipped
// broken: every owner got "Caller is not the owner of this listing." because the
// check compared their id against `undefined`, which is not the owner of
// anything. Both conditions read false the same way, so the bug wore the
// costume of a working authorization rule.
//
// Hence assertAuthorRelationshipPresent below. A missing author relationship is
// now a 500 naming the real fault, NOT a 403 about ownership: we must never again
// tell an owner they are not the owner because we forgot to fetch the field. If
// you add a new caller, fetch the listing with `include: ['author']`.

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

const misconfiguredError = () => {
  const message =
    'Listing was fetched without its author relationship; ' +
    'ownership cannot be determined. Fetch it with include: ["author"].';
  const error = new Error(message);
  error.status = 500;
  error.statusText = 'Listing author relationship missing.';
  error.data = {};
  return error;
};

/**
 * Fail loudly when the listing carries no author relationship.
 *
 * This separates "we did not ask the API for the owner" (our bug, 500) from
 * "the caller is not the owner" (their problem, 403). Collapsing the two is
 * precisely the defect this function exists to prevent - see the header.
 *
 * @param {Object} [listing] - a listing API entity
 * @throws when the author relationship is absent
 */
const assertAuthorRelationshipPresent = listing => {
  if (!listing?.relationships?.author?.data?.id?.uuid) {
    throw misconfiguredError();
  }
};

/**
 * Is `currentUser` the author of `listing`?
 *
 * Pure. `listing` is an API listing entity that was fetched WITH
 * `include: ['author']` - neither API returns the relationship otherwise.
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
 * @param {Object} listing - a listing API entity fetched with include: ['author']
 * @returns {Promise<Object>} the currentUser entity
 */
const requireListingAuthorCaller = (req, res, listing) =>
  Promise.resolve()
    .then(() => assertAuthorRelationshipPresent(listing))
    .then(() => resolveCaller(req, res))
    .then(currentUser => {
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
 * The author relationship is asserted BEFORE either branch runs. Without it an
 * owner silently fails the first check and falls through to the laundry one,
 * which rejects them from their own listing for the wrong reason entirely.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Object} listing - a listing API entity fetched with include: ['author']
 * @returns {Promise<{currentUser: Object, role: 'owner'|'laundry'}>}
 */
const authorizeLaundryOrOwnerCaller = (req, res, listing) =>
  Promise.resolve()
    .then(() => assertAuthorRelationshipPresent(listing))
    .then(() => resolveCaller(req, res))
    .then(currentUser => {
      if (isListingAuthor(currentUser, listing)) {
        return { currentUser, role: 'owner' };
      }

      if (isLaundryUser(currentUser)) {
        assertIsAssignedLaundry(currentUser, readAssignedLaundryId(listing));
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
