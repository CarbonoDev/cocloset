/**
 * Admin utility: relocate the assigned laundry from `publicData` to `metadata`.
 *
 *   publicData.assignedLaundryId  ->  metadata.assignedLaundryId
 *
 * WHY THIS EXISTS
 * `assignedLaundryId` is the authorization anchor for the whole laundry flow:
 * server/api-util/laundryAuth.js compares a caller against it to decide whether
 * they may drive a transaction's custody chain, including the transition that
 * fires the provider payout. In `publicData` it was owner-writable straight
 * against the Marketplace API, so the rule "the assigned laundry cannot change
 * while the garment is at the laundry / a rental is in flight" was unenforceable
 * and an owner could hand a stranger authority over an in-flight rental. In
 * `metadata` the platform itself refuses the owner's write (verified: HTTP 400
 * `validation-disallowed-key`), so every change goes through
 * server/api/listing-laundry-assignment.js. See
 * server/api-util/laundryAssignment.js for the full argument.
 *
 * Every reader was moved to `metadata` in the same change. So until this script
 * runs, existing listings read as having NO laundry - which does not throw, it
 * silently returns `undefined`: the ops dashboard loses them, the cleaning fee
 * falls back to the env default, and `assertIsAssignedLaundry` rejects the studio
 * actually holding the garment. Dev already has a listing mid-rental at
 * `picked-up` and three that completed the full laundry cycle.
 *
 * WHY IT ALSO CLEARS THE OLD KEY (and how to not)
 * By default each listing is fixed in ONE Integration API call that writes the new
 * key and removes the old one (`publicData: { assignedLaundryId: null }` - verified
 * against Dev: null removes an extended-data key rather than storing a null). So
 * per listing it is atomic; there is no window where a listing has both, or
 * neither.
 *
 * Leaving the old copy behind was considered and rejected. A stale duplicate of an
 * authorization anchor is precisely the trap that produced the bugs this change
 * fixes: it stays owner-writable, it still LOOKS authoritative, and the next person
 * to grep `assignedLaundryId` finds two homes with no way to tell which one is
 * read. Removing it makes the single source of truth actually single.
 *
 * `--keep-public-data` exists for one specific situation: a staged deploy where the
 * PREVIOUS build might still be serving traffic. That build reads `publicData`, so
 * clearing it there is an outage rather than a cleanup. In that case run with the
 * flag, deploy, then run again without it - the script is idempotent and the second
 * pass only clears.
 *
 * SAFETY
 *   - It never overwrites an existing `metadata.assignedLaundryId`.
 *   - A listing carrying BOTH keys with DIFFERENT values is a conflict this script
 *     refuses to resolve: it reports the listing and skips it, rather than picking
 *     a winner. Guessing wrong here reassigns a garment.
 *   - No extended-data query filter is used. The Integration API FAILS OPEN on
 *     unrecognised filter params - `pub_assignedLaundryId` with a bogus value
 *     returns every listing in the marketplace (verified against Dev) - so the
 *     decision is made in JS on the actual stored values, which are the only
 *     authoritative source. This fail-open behaviour has already caused two
 *     security bugs in this project.
 *   - Every listing STATE is scanned, not just published. Drafts carry the field
 *     too (Dev has two), and a draft that migrates late is a listing whose owner
 *     cannot publish.
 *   - It echoes which marketplace it is about to write to before writing, because
 *     it reads whatever `.env` happens to be present: a developer with production
 *     credentials would otherwise mutate production silently.
 *
 * Usage:
 *   node scripts/migrate-assigned-laundry-to-metadata.js --dry-run
 *   node scripts/migrate-assigned-laundry-to-metadata.js
 *   node scripts/migrate-assigned-laundry-to-metadata.js --keep-public-data
 */

require('dotenv').config();
const integrationSdk = require('sharetribe-flex-integration-sdk');
const { ASSIGNED_LAUNDRY_KEY } = require('../server/api-util/laundryAssignment');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const keepPublicData = args.includes('--keep-public-data');

const PER_PAGE = 100;

// Every state a listing can be in. Omitting this parameter does NOT mean "all":
// `listings.query` defaults to published only, which would silently skip drafts.
const ALL_STATES = ['draft', 'pendingApproval', 'published', 'closed'];

const CLIENT_ID = process.env.SHARETRIBE_INTEGRATION_SDK_CLIENT_ID;
const CLIENT_SECRET = process.env.SHARETRIBE_INTEGRATION_SDK_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    'Missing SHARETRIBE_INTEGRATION_SDK_CLIENT_ID / SHARETRIBE_INTEGRATION_SDK_CLIENT_SECRET in .env'
  );
  process.exit(1);
}

const sdk = integrationSdk.createInstance({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
});

// Page through every listing in the marketplace. No extended-data filter is
// passed on purpose - see the header comment.
const fetchAllListings = (page = 1, collected = []) =>
  sdk.listings.query({ page, perPage: PER_PAGE, states: ALL_STATES }).then(res => {
    const listings = collected.concat(res.data.data || []);
    const { totalPages } = res.data.meta || {};
    return page < (totalPages || 1) ? fetchAllListings(page + 1, listings) : listings;
  });

const describe = listing =>
  `${listing.attributes?.title || '(untitled)'} [${listing.attributes?.state}] (${
    listing.id.uuid
  })`;

/**
 * Sort every listing into exactly one bucket. Pure, so the decision is readable
 * and the dry run and the real run cannot disagree about it.
 */
const classify = listings => {
  const toMigrate = [];
  const toClearOnly = [];
  const conflicts = [];
  const untouched = [];

  listings.forEach(listing => {
    const attrs = listing.attributes || {};
    const publicValue = attrs.publicData?.[ASSIGNED_LAUNDRY_KEY];
    const metaValue = attrs.metadata?.[ASSIGNED_LAUNDRY_KEY];

    if (!publicValue && !metaValue) {
      untouched.push(listing);
    } else if (!publicValue) {
      // Already migrated and already cleaned up. Nothing left to do.
      untouched.push(listing);
    } else if (!metaValue) {
      toMigrate.push({ listing, publicValue });
    } else if (metaValue === publicValue) {
      // Migrated but the old copy survived (a `--keep-public-data` run, or a run
      // interrupted between the two).
      toClearOnly.push({ listing, publicValue });
    } else {
      conflicts.push({ listing, publicValue, metaValue });
    }
  });

  return { toMigrate, toClearOnly, conflicts, untouched };
};

// One call per listing: set the new key and (unless asked not to) remove the old
// one together, so a listing is never left holding both or neither.
const updateParamsFor = ({ listing, publicValue, copy }) => ({
  id: listing.id,
  ...(copy ? { metadata: { [ASSIGNED_LAUNDRY_KEY]: publicValue } } : {}),
  ...(keepPublicData ? {} : { publicData: { [ASSIGNED_LAUNDRY_KEY]: null } }),
});

// Sequential rather than Promise.all: this is admin tooling run rarely over the
// whole listing base, and a burst of parallel writes is the fastest way to hit the
// Integration API's rate limits mid-run and leave a half-finished migration.
const writeSequentially = jobs =>
  jobs.reduce(
    (chain, job) =>
      chain.then(done =>
        sdk.listings.update(updateParamsFor(job), { expand: true }).then(res => {
          const attrs = res.data.data.attributes;
          const wrote = attrs.metadata?.[ASSIGNED_LAUNDRY_KEY];
          const leftover = attrs.publicData?.[ASSIGNED_LAUNDRY_KEY];
          console.log(
            `  ${describe(job.listing)}\n` +
              `      metadata.${ASSIGNED_LAUNDRY_KEY} = ${wrote}` +
              `${
                leftover ? `  (publicData copy kept: ${leftover})` : '  (publicData copy removed)'
              }`
          );
          return done.concat(job.listing.id.uuid);
        })
      ),
    Promise.resolve([])
  );

// Echo the target marketplace before any write, so it is impossible to run this
// against the wrong environment without seeing which one it is.
sdk.marketplace
  .show()
  .then(res => {
    const marketplace = res.data.data;
    console.log(
      `Marketplace: ${marketplace.attributes.name} (${marketplace.id.uuid})` +
        `${isDryRun ? '  [DRY RUN - no writes will be made]' : ''}` +
        `${keepPublicData ? '  [--keep-public-data: the old key will NOT be removed]' : ''}`
    );
    return fetchAllListings();
  })
  .then(listings => {
    const { toMigrate, toClearOnly, conflicts, untouched } = classify(listings);

    console.log(
      `\nScanned ${listings.length} listings (all states): ` +
        `${toMigrate.length} to migrate, ${toClearOnly.length} already migrated with a stale ` +
        `publicData copy, ${conflicts.length} conflicting, ${untouched.length} with no assigned ` +
        `laundry at all.`
    );

    if (conflicts.length > 0) {
      // Loud, and never resolved automatically. Both values are real ids; picking
      // one reassigns somebody's garment.
      console.log(
        `\nCONFLICTS - these carry BOTH keys with DIFFERENT values and are SKIPPED.\n` +
          `Resolve each by hand (the metadata value is the one every reader now uses):`
      );
      conflicts.forEach(({ listing, publicValue, metaValue }) => {
        console.log(
          `  ${describe(listing)}\n      publicData=${publicValue}\n      metadata=${metaValue}`
        );
      });
    }

    const jobs = [
      ...toMigrate.map(entry => ({ ...entry, copy: true })),
      // Nothing to copy - the value is already in metadata. These only need the
      // stale publicData key removed, so they are skipped entirely under
      // --keep-public-data.
      ...(keepPublicData ? [] : toClearOnly.map(entry => ({ ...entry, copy: false }))),
    ];

    if (jobs.length === 0) {
      console.log('\nNothing to do.');
      return null;
    }

    if (isDryRun) {
      console.log('');
      jobs.forEach(({ listing, publicValue, copy }) => {
        console.log(
          `  would ${copy ? 'set' : 'leave'} metadata.${ASSIGNED_LAUNDRY_KEY} = ${publicValue}` +
            `${keepPublicData ? '' : ` and remove publicData.${ASSIGNED_LAUNDRY_KEY}`}\n` +
            `      on ${describe(listing)}`
        );
      });
      console.log(`\nDRY RUN: would update ${jobs.length} listings. No writes made.`);
      return null;
    }

    return writeSequentially(jobs).then(updatedIds => {
      console.log(`\nOK: updated ${updatedIds.length} listings.`);
      if (conflicts.length > 0) {
        console.log(`${conflicts.length} conflicting listings were skipped - see above.`);
      }
    });
  })
  .catch(err => {
    // Deliberately NOT logging the bare `err`: an axios error carries
    // `config.headers` with the bearer token in it.
    console.error('Failed:', err.data || err.message || 'Unknown error');
    process.exit(1);
  });
