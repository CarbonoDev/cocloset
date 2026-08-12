const { getSdk, handleError } = require('../api-util/sdk');
const { createRateLimiter } = require('../api-util/rateLimit');
const { resolveLiveInitialCleaningDays } = require('../api-util/liveInitialCleaning');

// How long must pass before THIS garment can be rented, according to its laundry's
// CURRENT configuration?
//
//   > "desde el momento de la carga de listingPage, se debe consultar las propiedades
//   >  de la laundry seleccionada para este listing para obtener los días que se
//   >  necesiten para el lavado siempre que onLaundry sea false"
//
// Request:  GET /api/listing-initial-cleaning?listingId=<uuid>
// Response (200): { data: { initialCleaningDays: <positive integer> } }
//            or   { data: {} }   -- no block applies, or no live answer available
//
// THE RESPONSE IS ONE NUMBER, AND THAT IS THE WHOLE SECURITY DESIGN.
// This endpoint is PUBLIC - ListingPage is public, and the customer who needs this
// number is by definition not logged in yet. The number itself is already visible to
// anyone: the calendar it feeds simply refuses the days it covers, so a caller could
// read it off the picker anyway. Everything AROUND it is not:
//
//   - Per-category CLEANING FEES live in the same laundry `privateData` blob that the
//     turnaround is read from (api-util/categoryPricing.js `categoryPricing`). They must
//     never reach the browser. So this endpoint does not forward, reshape, or summarise
//     privateData - it returns a single integer computed from it, and there is no shape
//     in which a fee could ride along.
//   - It does not say WHICH laundry, whether one is assigned, or anything about the
//     studio. `{ data: {} }` is returned for "at the laundry already", "no laundry
//     assigned", and "could not read the laundry", so the response cannot be used to
//     probe assignment state.
//   - Contrast api/laundries.js, which DOES require an authenticated caller: that one
//     returns the whole laundry directory, and anonymous access to it enumerated every
//     user in the marketplace. One derived number about one listing is a different
//     exposure, and it needs no session.
//
// WHY IT USES BOTH SDKS. The listing is read with the MARKETPLACE API (`getSdk`), from
// the caller's own - possibly anonymous - session: this endpoint must not become a way to
// read listings the caller cannot already see, and `metadata` on a listing is public
// anyway. Only the laundry user's `privateData` needs the Integration API, and that read
// happens inside api-util/liveInitialCleaning.js.
//
// WHY IT IS RATE LIMITED. It is public AND it makes an Integration API call, which is
// the combination api/laundries.js avoided by requiring auth. Without a limit, a script
// walking listing ids turns into unbounded Integration API quota burn. The limiter is
// per-IP with a global ceiling; see api-util/rateLimit.js for what it does and does not
// protect against.

// One ListingPage load makes exactly one of these calls, and only for a garment that has
// never reached a laundry. 120 per 10 minutes per IP is far above real browsing (a
// customer comparing garments) and far below a crawl. The global ceiling bounds the total
// Integration API cost of a distributed flood.
const limiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxPerKey: 120,
  maxTotal: 6000,
});

module.exports = (req, res) => {
  const { listingId } = req.query || {};

  if (!listingId || typeof listingId !== 'string') {
    res
      .status(400)
      .json({ error: 'Missing or invalid "listingId" query parameter.' })
      .end();
    return;
  }

  const { allowed, retryAfterSeconds } = limiter.check(req.ip);
  if (!allowed) {
    res
      .status(429)
      .set('Retry-After', String(retryAfterSeconds))
      .json({ error: 'Too many requests. Please try again later.' })
      .end();
    return;
  }

  const sdk = getSdk(req, res);

  sdk.listings
    .show({ id: listingId })
    .then(response => resolveLiveInitialCleaningDays({ listing: response?.data?.data }))
    .then(initialCleaningDays => {
      // No key at all rather than `initialCleaningDays: null`, so "there is no block"
      // and "the block is n days" are structurally different answers and a client that
      // forgets to check cannot read null as 0 or as NaN.
      const data = initialCleaningDays === null ? {} : { initialCleaningDays };

      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data })
        .end();
    })
    .catch(e => handleError(res, e));
};

module.exports.limiter = limiter;
