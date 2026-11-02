const { getSdk, handleError } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { findActiveTransactions } = require('../api-util/listingCustody');
const { mapWithConcurrency } = require('../api-util/concurrency');

// Which of these listings have a genuinely active transaction right now?
//
// Jonathan, 2026-10-13: now that pausing is allowed whenever no transaction is
// actually active (see listing-pause-eligibility.js), he wants the UI to say so
// UP FRONT - an icon/label on the card - rather than let the provider click
// "Pause" and find out from an error. That needs this answered for every
// listing on the page at once, not just the one a click names.
//
// GET /api/listings-active-transactions?ids=<comma-separated listing ids>
//
// WHY TWO DIFFERENT SDKS, SPLIT THE WAY THEY ARE
//   - Ownership is checked with the MARKETPLACE API, from the caller's own
//     session (`getSdk`): `ownListings.show` is scoped to the caller's own
//     listings by Sharetribe's own design, the same guarantee
//     `ownListings.query` already relies on elsewhere in this app - no second
//     Integration API round trip is spent proving what the session already
//     proves for free. An id that is not the caller's own, or does not exist,
//     is silently OMITTED from the response rather than erroring the whole
//     request - one bad id must not blank the badge for every other listing
//     on the page.
//   - Whether a transaction is active is Integration-API-only
//     (`findActiveTransactions`), same helper `listing-pause-eligibility.js`
//     uses for the identical question on a single listing.
//
// WHY THIS FANS OUT PER LISTING
// `transactions.query` has no "any of these listing ids" filter (verified
// against Dev - see server/api/laundry-orders.js's header for the same
// constraint). One query per id is therefore unavoidable; `mapWithConcurrency`
// bounds how many run at once, exactly as laundry-orders.js already does for
// its own per-listing fan-out.
//
// MAX_IDS caps a single call's cost: this is a page-load convenience read, not
// something a caller should be able to turn into an unbounded Integration API
// crawl by naming a thousand ids.
//
// Success response (200): { data: { active: { [listingId]: boolean } } } -
// only ids that were both verifiably the caller's own AND successfully
// checked appear as keys at all. A missing key means "could not determine" -
// treat it the same as `false` for display (no badge), since the authoritative
// gate is still listing-pause-eligibility.js at click time, not this read.
const MAX_IDS = 100;
const ACTIVE_TRANSACTION_QUERY_CONCURRENCY = 5;

module.exports = (req, res) => {
  const idsParam = typeof req.query?.ids === 'string' ? req.query.ids : '';
  const ids = [
    ...new Set(
      idsParam
        .split(',')
        .map(id => id.trim())
        .filter(Boolean)
    ),
  ];

  if (ids.length === 0) {
    res.status(200).json({ data: { active: {} } }).end();
    return;
  }

  if (ids.length > MAX_IDS) {
    res
      .status(400)
      .json({ error: `Too many ids - at most ${MAX_IDS} per request.` })
      .end();
    return;
  }

  const sdk = getSdk(req, res);
  const integrationSdk = getIntegrationSdk();

  mapWithConcurrency(ids, ACTIVE_TRANSACTION_QUERY_CONCURRENCY, id =>
    sdk.ownListings
      .show({ id })
      .then(() => findActiveTransactions({ integrationSdk, listingId: id }))
      .then(result => ({ id, active: result.active }))
      .catch(() => null)
  )
    .then(results => {
      const active = {};
      results.filter(Boolean).forEach(result => {
        active[result.id] = result.active;
      });

      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: { active } })
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};
