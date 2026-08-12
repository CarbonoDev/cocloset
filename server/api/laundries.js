const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { getSdk, handleError } = require('../api-util/sdk');
const { buildLaundryDirectory } = require('../api-util/laundryDirectory');

// List of laundries (users flagged with metadata.isLaundry) used by the listing
// wizard's "Laundry Assignment" step. Only obtainable via the Integration API
// (no public user search exists in the Marketplace API, for privacy reasons).
//
// SECURITY — two things this endpoint deliberately does NOT do:
//
// 1. It does not pass `meta_isLaundry` to `users.query`, and the JS filter in
//    api-util/laundryDirectory.js is the load-bearing one. Do not "optimise" it
//    back into the query.
//
//    The stated reason has CHANGED, so read this before acting on it. The
//    user-scope search schema now EXISTS on Dev — re-measured 2026-08-12:
//    `meta_isLaundry=true` returns 4 and `=false` returns 11, against a real
//    distribution of 4 true / 11 false / 12 absent. The earlier note here, that
//    `true`, `false` and an invented key all returned the identical full set, is
//    no longer true of the first two.
//
//    What is still true is the part that matters: an unrecognised KEY is silently
//    ignored and returns every user (`meta_totallyMadeUpKey` returned all 27), so
//    the API fails OPEN. A schema can also be unset, or be missing on Test/Live
//    while present on Dev, and this endpoint decides who is a laundry — so it must
//    not depend on a schema being pushed in whichever environment it runs in.
//
//    Beware how you re-verify: a bogus VALUE does not test for a schema. On a
//    boolean field a garbage value is coerced to `false` rather than rejected
//    (`meta_isLaundry="nonsense"` returns the 11 false users), which looks like a
//    broken filter when the schema is fine. Probe with an unknown key instead.
//
// 2. It does not forward the laundry's `publicData` blob. The response is an
//    explicit allowlist (see laundryDirectory.toLaundryDirectoryEntry) so that
//    a future key added to a laundry's profile can't silently become public.
//
// The endpoint also requires an authenticated caller. It is only ever used
// from the listing wizard, which is behind auth anyway, and without this an
// anonymous request enumerated every user in the marketplace.
//
// Request: GET /api/laundries[?categories=dresses,midi_dress]
//
// `categories` is the category chain (general -> specific) of the garment the owner is
// picking a laundry for — i.e. the listing's categoryLevel1/2/3. It is OPTIONAL and
// purely presentational: when given, each entry's `turnaroundDays` is resolved for
// THAT garment (a laundry sets days per top-level category) instead of being the
// studio-wide number, and `turnaroundDaysIsCategorySpecific` marks which it is.
// Omitting it returns exactly what this endpoint returned before.
//
// Nothing security-relevant hangs off the parameter: it selects between numbers the
// laundry has already agreed to publish on its own card, and it cannot widen the set
// of users returned. It is length-capped anyway so a caller can't turn one request
// into unbounded per-user work.
//
// Response (200): { data: [ { id, displayName, studioName, address, origin,
//   businessHours, acceptedCategories, turnaroundDays,
//   turnaroundDaysIsCategorySpecific } ], meta: {
//   totalUsersScanned, laundryUserCount, incompleteProfileCount, truncated } }
//
// Laundries with no usable profile (no address/origin) are omitted from `data`
// and counted in `meta.incompleteProfileCount` — assigning one would write no
// `geolocation` and leave the listing permanently unpublishable.

// users.query returns one page at a time. A marketplace with more users than
// one page would silently truncate the laundry list, so page through. MAX_PAGES
// bounds the Integration API quota this endpoint can burn on one request; if it
// is ever hit, `meta.truncated` says so rather than pretending the list is
// complete. (Revisit once a user search schema exists — then the query itself
// can do the filtering and this loop becomes unnecessary.)
const PER_PAGE = 100;
const MAX_PAGES = 20;

const fetchUsersPage = (integrationSdk, page, collected) =>
  integrationSdk.users.query({ page, perPage: PER_PAGE }, { expand: true }).then(response => {
    const { data = [], meta = {} } = response.data || {};
    const users = collected.concat(data);
    const totalPages = Number.isFinite(meta.totalPages) ? meta.totalPages : page;

    if (page < totalPages && page < MAX_PAGES) {
      return fetchUsersPage(integrationSdk, page + 1, users);
    }
    return { users, truncated: page < totalPages };
  });

// Console supports three category levels, so a legitimate chain is never longer than
// that. Cap rather than reject: an over-long or malformed `categories` param is a
// client bug, and degrading to "resolve from the levels that make sense" keeps the
// picker working instead of 400-ing an owner out of the wizard.
const MAX_CATEGORY_LEVELS = 3;

const parseCategoriesParam = value =>
  (typeof value === 'string' ? value.split(',') : [])
    .map(entry => entry.trim())
    .filter(entry => entry !== '')
    .slice(0, MAX_CATEGORY_LEVELS);

module.exports = (req, res) => {
  const sdk = getSdk(req, res);
  const listingCategoryValues = parseCategoriesParam(req.query?.categories);

  // Authenticated callers only. currentUser.show() rejects for anonymous
  // sessions, which handleError turns into the SDK's own 401/403 response.
  sdk.currentUser
    .show()
    .then(() => fetchUsersPage(getIntegrationSdk(), 1, []))
    .then(({ users, truncated }) => {
      const { laundries, meta } = buildLaundryDirectory(users, listingCategoryValues);

      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: laundries, meta: { ...meta, truncated } })
        .end();
    })
    .catch(e => handleError(res, e));
};
