const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { getSdk, handleError } = require('../api-util/sdk');
const { buildLaundryDirectory } = require('../api-util/laundryDirectory');

// List of laundries (users flagged with metadata.isLaundry) used by the listing
// wizard's "Laundry Assignment" step. Only obtainable via the Integration API
// (no public user search exists in the Marketplace API, for privacy reasons).
//
// SECURITY — two things this endpoint deliberately does NOT do:
//
// 1. It does not pass `meta_isLaundry` to `users.query`. That filter is
//    silently ignored: the Integration API drops unrecognised query params
//    rather than rejecting them, so `users.query({ meta_isLaundry: true })`
//    returns EVERY user in the marketplace. Verified against Dev — `true`,
//    `false`, and an entirely invented key all return the identical full set.
//    Filtering user extended data requires a user-scope search schema
//    (`flex-cli search`), which this marketplace does not have. The real
//    filter is therefore done in JS, on the actual metadata value, in
//    api-util/laundryDirectory.js. Do not "optimise" it back into the query.
//
// 2. It does not forward the laundry's `publicData` blob. The response is an
//    explicit allowlist (see laundryDirectory.toLaundryDirectoryEntry) so that
//    a future key added to a laundry's profile can't silently become public.
//
// The endpoint also requires an authenticated caller. It is only ever used
// from the listing wizard, which is behind auth anyway, and without this an
// anonymous request enumerated every user in the marketplace.
//
// Response (200): { data: [ { id, displayName, studioName, address, origin,
//   businessHours, acceptedCategories, turnaroundHours } ], meta: {
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

module.exports = (req, res) => {
  const sdk = getSdk(req, res);

  // Authenticated callers only. currentUser.show() rejects for anonymous
  // sessions, which handleError turns into the SDK's own 401/403 response.
  sdk.currentUser
    .show()
    .then(() => fetchUsersPage(getIntegrationSdk(), 1, []))
    .then(({ users, truncated }) => {
      const { laundries, meta } = buildLaundryDirectory(users);

      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: laundries, meta: { ...meta, truncated } })
        .end();
    })
    .catch(e => handleError(res, e));
};
