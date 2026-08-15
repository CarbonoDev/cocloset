const { getSdk, handleError } = require('../api-util/sdk');
const { createRateLimiter } = require('../api-util/rateLimit');
const { resolveLiveInitialCleaningDays } = require('../api-util/liveInitialCleaning');
const { resolveCleaningGapsForListing } = require('../api-util/listingCleaningGaps');
const log = require('../log');

// How long must pass before THIS garment can be rented, according to its laundry's
// CURRENT configuration?
//
//   > "desde el momento de la carga de listingPage, se debe consultar las propiedades
//   >  de la laundry seleccionada para este listing para obtener los días que se
//   >  necesiten para el lavado siempre que onLaundry sea false"
//
// Request:  GET /api/listing-initial-cleaning?listingId=<uuid>
// Response (200): { data: {
//                    initialCleaningDays?: <positive integer>,   -- omitted when no block applies
//                    cleaningTurnaroundDays?: <integer>,         -- omitted when the read failed
//                    cleaningGaps?: [{ start, end }],            -- omitted when the read failed
//                  } }
//
// IT ALSO ANSWERS A SECOND QUESTION NOW, and the two belong together because they feed the
// same picker on the same page load. `initialCleaningDays` is the lead time before a garment
// can be rented for the FIRST time. `cleaningGaps` are the day ranges that cannot be a rental
// START because another rental's wash is owed then - the days after a booking that has not
// been returned yet. See api-util/cleaningGaps.js for why the calendar cannot work that out
// on its own, and why this is not the only place the rule is enforced.
//
// The gaps expose nothing the calendar does not: a booking's dates are already visible as
// unavailable days through the public availability API, and these are derived from exactly
// those dates plus a turnaround that the picker refuses days for anyway.
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
    .then(response => {
      const listing = response?.data?.data;

      return Promise.all([
        resolveLiveInitialCleaningDays({ listing }),
        // THE DAYS ALREADY SPOKEN FOR BY ANOTHER RENTAL'S WASH. Resolved here rather than
        // left to the picker because the picker cannot see them: the calendar shows a
        // garment as free the day its previous rental ends, and only the transaction behind
        // that rental knows a turnaround is still owed. See api-util/cleaningGaps.js.
        //
        // NEVER FAILS THE RESPONSE. A listing page that 500s because a transactions query
        // hiccupped is worse than a picker missing a few blocked days - and the server gate
        // refuses those days at checkout regardless, which is the point of it being the
        // authoritative copy. The gaps are simply omitted.
        resolveCleaningGapsForListing({ listing }).catch(e => {
          log.error(e, 'listing-cleaning-gaps-failed', { listingId });
          return null;
        }),
      ]);
    })
    .then(([initialCleaningDays, cleaningGaps]) => {
      // No key at all rather than `initialCleaningDays: null`, so "there is no block"
      // and "the block is n days" are structurally different answers and a client that
      // forgets to check cannot read null as 0 or as NaN.
      const initialCleaningMaybe = initialCleaningDays === null ? {} : { initialCleaningDays };

      // Same shape rule for the gaps: absent means "not known", an empty array means "asked,
      // and there are none". The picker must not read a failed read as a clear calendar.
      //
      // The condition is on `gaps`, not on the wrapper: a resolution that could not read the
      // bookings still comes back as an object, with `gaps: null` inside it.
      const gapsMaybe = cleaningGaps?.gaps
        ? {
            cleaningTurnaroundDays: cleaningGaps.turnaroundDays,
            cleaningGaps: cleaningGaps.gaps.map(gap => ({
              start: gap.start.toISOString(),
              end: gap.end.toISOString(),
            })),
          }
        : {};

      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: { ...initialCleaningMaybe, ...gapsMaybe } })
        .end();
    })
    .catch(e => handleError(res, e));
};

module.exports.limiter = limiter;
