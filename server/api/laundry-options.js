const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { createRateLimiter } = require('../api-util/rateLimit');
const { buildLaundryOptions, fetchAllUsers } = require('../api-util/laundryDirectory');

// The laundries a customer can filter the search by, as a name and an id and nothing else.
//
//   > "Arma un endpoint publico para mostrar laundries"
//
// Request:  GET /api/laundry-options
// Response (200): { data: [ { id, name } ] }
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT `/api/laundries` WITH THE AUTH TAKEN OFF
// ---------------------------------------------------------------------------
// That endpoint answers a different question for a different reader. It feeds the listing
// wizard's assignment step, so each record carries the studio's address, coordinates, business
// hours, accepted categories and turnaround - the last of which is RESOLVED FROM THE LAUNDRY'S
// privateData, the same blob per-category cleaning FEES live in. It requires a session because
// an anonymous version of it enumerated every user in the marketplace (see the header of
// api/laundries.js).
//
// The search filter needs two strings. Relaxing the auth on the rich endpoint would publish
// a studio directory - addresses, hours, coordinates - to anyone who curls it, in order to
// populate a dropdown. So this is a separate endpoint with its own, minimal shape, and the
// rich one keeps its session.
//
// WHAT IS ACTUALLY EXPOSED, AND WHY IT IS ALREADY PUBLIC. The name is
// `publicData.laundryProfile.studioName`, and every listing assigned to that studio already
// carries it in its own `publicData.assignedLaundryName` - it is printed on the listing page
// and on every card. The id is `metadata.assignedLaundryId`, likewise on every listing and
// already usable as a search filter by anyone who reads a URL. This endpoint saves a caller
// the work of scraping listings for a list it could assemble anyway; it does not disclose a
// studio that has no garments, which is the one thing it adds - and a studio in the partner
// directory is not a secret.
//
// NO ADDRESS, NO COORDINATES, NO HOURS, NO TURNAROUND. Adding a field here is adding it to a
// public surface; the test asserts the exact key set so that has to be a decision rather than
// a spread.
//
// RATE LIMITED for the reason api/listing-initial-cleaning.js is: public AND backed by
// Integration API calls, which is the combination api/laundries.js avoided by requiring a
// session. This one walks the user list, so it is the more expensive of the two - hence a
// tighter per-IP budget. The answer changes only when a studio is added or renamed.
const limiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxPerKey: 60,
  maxTotal: 3000,
});

module.exports = (req, res) => {
  const { allowed, retryAfterSeconds } = limiter.check(req.ip);
  if (!allowed) {
    res
      .status(429)
      .set('Retry-After', String(retryAfterSeconds))
      .json({ error: 'Too many requests. Please try again later.' })
      .end();
    return;
  }

  // Promise.resolve() first so a synchronous failure - getIntegrationSdk() throws on missing
  // env vars - becomes a rejection rather than an escaping exception.
  Promise.resolve()
    .then(() => fetchAllUsers(getIntegrationSdk()))
    // DESTRUCTURED, because `fetchAllUsers` resolves to `{ users, truncated }` rather than to
    // the array. Passing the wrapper straight through produced a 200 with an empty list -
    // `buildLaundryOptions` treats a non-array as "nothing", correctly - so the filter simply
    // did not appear, with no error anywhere. Found by calling the endpoint, not by a test:
    // the unit tests hand the builder an array directly, which is the one shape it was never
    // going to be given here.
    .then(({ users }) => {
      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: buildLaundryOptions(users) })
        .end();
    })
    .catch(e => handleError(res, e));
};

module.exports.limiter = limiter;
