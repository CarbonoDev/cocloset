const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { createRateLimiter } = require('../api-util/rateLimit');
const { buildBrandDirectory, fetchAllPublishedListings } = require('../api-util/brandDirectory');

// The brands that exist on published listings, for the brand autocomplete.
//
//   > "Podemos usar brand como un autocomplete de todas las brands que existen, a si mismo,
//   >  podemos usar un selector de brands que ya existen para mostrarlos en el filtro, pero no
//   >  podemos mostrar un select de brands ni poder agregar todas las brands en console"
//
// Request:  GET /api/brands
// Response (200): { data: [ { brand, count } ], meta: { truncated } }
//
// ---------------------------------------------------------------------------
// PUBLIC, LIKE api/laundry-options.js AND FOR THE SAME REASON
// ---------------------------------------------------------------------------
// The search page's brand filter is used by anonymous visitors, so this cannot require a
// session the way api/laundries.js does.
//
// Nothing here is a disclosure. Every value returned is `publicData.brand` off a PUBLISHED
// listing - already printed on that listing's page and on its card, and already usable as a
// search filter by anyone who edits a URL. This endpoint saves a caller the work of scraping
// listings for a list it could assemble anyway.
//
// BRAND AND A COUNT, NOTHING ELSE. No listing ids, no authors. Adding a field here is adding it
// to a public surface, and the test asserts the exact key set so that has to be a decision
// rather than a spread. The count is what lets the autocomplete rank common brands first; it
// says how many public listings carry the brand, which is countable from the search page.
//
// RATE LIMITED because it is public AND backed by Integration API calls - the combination
// api/laundries.js avoids by requiring a session. This one walks the LISTING list, which grows
// faster than the user list api/laundry-options.js walks, so it gets the tighter budget of the
// two. The answer changes only when a listing is published or its brand edited.
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
    .then(() => fetchAllPublishedListings(getIntegrationSdk()))
    // DESTRUCTURED: fetchAllPublishedListings resolves to `{ listings, truncated }`, not to the
    // array. Passing the wrapper straight through would hand the builder a non-array, which it
    // reads as "no listings" - a 200 with an empty list and no error anywhere. That exact
    // mistake already happened once, in api/laundry-options.js; the note there is worth reading.
    .then(({ listings, truncated }) => {
      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: buildBrandDirectory(listings), meta: { truncated } })
        .end();
    })
    .catch(e => handleError(res, e));
};

module.exports.limiter = limiter;
