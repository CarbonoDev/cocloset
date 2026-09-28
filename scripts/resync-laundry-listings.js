/**
 * Admin utility: bring every garment back in line with the profile its studio has RIGHT NOW.
 *
 *   > "Puedes arreglar el segundo punto para que aparezca el nombre del studio y no del user?"
 *   >   (Jonathan, 2026-09-28)
 *
 * WHAT IT FIXES, AND WHY THE RUNNING CODE IS NOT THE BUG
 *
 * Assigning a laundry COPIES four of its fields onto the listing - studio name, pickup address,
 * neighbourhood, geolocation - because a listing card, a search result and an email all print
 * them and none of those can fetch a user. Every one of those copies can go stale, and two
 * paths already keep them fresh: /api/laundry-address propagates when a studio moves, and
 * /api/laundry-listings-refresh propagates after any profile save (LaundryProfilePage calls it).
 *
 * What neither path can do is reach BACKWARDS. A garment stamped before those paths existed -
 * or before its studio had filled in `studioName` at all - keeps whatever was written then,
 * indefinitely, until that studio happens to save its profile again. On Dev that shows up as a
 * listing whose pickup card names the ACCOUNT HOLDER ("Alison C") while the studio is called
 * "Triple A Cleaners": at assignment time there was no `studioName`, so the derivation fell back
 * to `displayName`, exactly as it is supposed to.
 *
 * So this is a data repair, not a rule change. It writes nothing of its own: it reads each
 * studio's stored profile and hands it to `propagateAddressToAssignedListings` - the same
 * function both live paths use, which in turn uses the same params builder as a first
 * assignment. A listing this script touches ends up byte for byte what an assignment would
 * write today, and there is no new copy of "which name wins" anywhere.
 *
 * NO PROFILE IS MODIFIED. Contrast scripts/update-laundry-address.js, which takes a new address
 * and writes it to the studio first. This one is strictly listings-side: if a studio's stored
 * name is wrong, fix the profile (there or on its settings page) and run this afterwards.
 *
 * SAFETY
 *   - `--dry-run` reports every write it would make and makes none. Run it first.
 *   - It echoes which marketplace it is about to write to before writing, because it reads
 *     whatever `.env` is present: a developer holding production credentials would otherwise
 *     mutate production silently.
 *   - Idempotent. `propagateAddressToAssignedListings` skips every listing that already matches
 *     on all four fields and reports it as skipped rather than rewriting it, so a second run on
 *     a converged marketplace writes nothing.
 *   - A studio with no usable address is SKIPPED rather than propagated. Such a studio cannot
 *     be assigned anything through the picker anyway, and propagating a half-filled profile
 *     would stamp a blank pickup address onto garments that currently have a usable one.
 *   - A per-studio failure does not abort the run; it is reported and the rest continue.
 *   - It never logs the bare error object - an axios error carries `config.headers` with the
 *     bearer token in it.
 *
 * Usage:
 *   node scripts/resync-laundry-listings.js --dry-run           # every studio, report only
 *   node scripts/resync-laundry-listings.js                     # every studio, for real
 *   node scripts/resync-laundry-listings.js <laundry-user-id>   # one studio
 *   node scripts/resync-laundry-listings.js --email s@x.com     # one studio, by email
 */

require('dotenv').config();
const integrationSdk = require('sharetribe-flex-integration-sdk');
const { findUserByEmail } = require('../server/api-util/userLookup');
const { propagateAddressToAssignedListings } = require('../server/api-util/laundryAddress');
const {
  hasUsableLaundryProfile,
  isLaundryUserEntity,
  toLaundryDirectoryEntry,
} = require('../server/api-util/laundryDirectory');

// Same argv shape as scripts/update-laundry-address.js, and written out for the same reason:
// the naive `indexOf('--x') + 1` version reads a flag's VALUE as the positional user id.
const BOOLEAN_FLAGS = ['dry-run'];

const { flags, positional } = process.argv.slice(2).reduce(
  (acc, arg) => {
    if (acc.pendingFlag) {
      acc.flags[acc.pendingFlag] = arg;
      acc.pendingFlag = null;
    } else if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (BOOLEAN_FLAGS.includes(name)) {
        acc.flags[name] = true;
      } else {
        acc.pendingFlag = name;
      }
    } else {
      acc.positional.push(arg);
    }
    return acc;
  },
  { flags: {}, positional: [], pendingFlag: null }
);

const isDryRun = flags['dry-run'] === true;
const laundryIdArg = positional[0];
const emailArg = flags.email;

const { SHARETRIBE_INTEGRATION_SDK_CLIENT_ID, SHARETRIBE_INTEGRATION_SDK_CLIENT_SECRET } =
  process.env;

if (!SHARETRIBE_INTEGRATION_SDK_CLIENT_ID || !SHARETRIBE_INTEGRATION_SDK_CLIENT_SECRET) {
  console.error(
    'Missing SHARETRIBE_INTEGRATION_SDK_CLIENT_ID / SHARETRIBE_INTEGRATION_SDK_CLIENT_SECRET.'
  );
  process.exit(1);
}

const sdk = integrationSdk.createInstance({
  clientId: SHARETRIBE_INTEGRATION_SDK_CLIENT_ID,
  clientSecret: SHARETRIBE_INTEGRATION_SDK_CLIENT_SECRET,
});

// Every laundry in the marketplace, or the one that was named. The full scan is a plain
// users.query filtered in JS on `metadata.isLaundry`: `meta_*` query filters FAIL OPEN on this
// API - an unrecognised one returns every user - and this script's whole job is to write, so a
// filter that silently matched everybody would propagate one studio's address across the
// marketplace. Same argument as findListingsAssignedToLaundry in api-util/laundryAddress.js.
const USERS_PER_PAGE = 100;
const MAX_USER_PAGES = 20;

const fetchAllLaundries = () => {
  const collected = [];

  const fetchPage = page =>
    sdk.users.query({ page, perPage: USERS_PER_PAGE }).then(response => {
      const users = response?.data?.data || [];
      users.filter(isLaundryUserEntity).forEach(user => collected.push(user));

      const totalPages = response?.data?.meta?.totalPages || 1;
      const hasMore = page < totalPages;
      if (hasMore && page < MAX_USER_PAGES) {
        return fetchPage(page + 1);
      }
      return { truncated: hasMore };
    });

  return fetchPage(1).then(({ truncated }) => ({ laundries: collected, truncated }));
};

const resolveTargets = () => {
  if (laundryIdArg) {
    return sdk.users.show({ id: laundryIdArg }).then(r => ({
      laundries: [r.data.data],
      truncated: false,
    }));
  }
  if (emailArg) {
    return findUserByEmail(sdk, emailArg).then(user => {
      if (!user) {
        throw new Error(`No user found with email ${emailArg}`);
      }
      return { laundries: [user], truncated: false };
    });
  }
  return fetchAllLaundries();
};

const describeUser = user =>
  `${user?.attributes?.profile?.publicData?.laundryProfile?.studioName ||
    user?.attributes?.profile?.displayName ||
    '(unnamed)'} (${user?.id?.uuid})`;

const run = async () => {
  console.log(
    `Marketplace: ${(await sdk.marketplace.show()).data.data.attributes.name}` +
      `${isDryRun ? '  [DRY RUN - nothing will be written]' : '  [WRITING]'}`
  );

  const { laundries, truncated } = await resolveTargets();
  if (truncated) {
    console.warn(
      `WARNING: stopped after ${MAX_USER_PAGES} pages of users; some studios were not scanned.`
    );
  }

  const notLaundries = laundries.filter(u => !isLaundryUserEntity(u));
  if (notLaundries.length > 0) {
    console.error(
      `Refusing: ${notLaundries.map(describeUser).join(', ')} is not flagged metadata.isLaundry.`
    );
    process.exit(1);
  }

  console.log(`Studios to check: ${laundries.length}\n`);

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const user of laundries) {
    const laundry = toLaundryDirectoryEntry(user);

    // Not set up yet. Propagating would stamp a blank pickup address over a usable one.
    if (!hasUsableLaundryProfile(laundry)) {
      console.log(`- ${describeUser(user)}: no usable address yet, skipped`);
      continue;
    }

    try {
      const result = await propagateAddressToAssignedListings({
        integrationSdk: sdk,
        laundryId: user.id.uuid,
        laundry,
        dryRun: isDryRun,
      });

      totalUpdated += result.updated.length;
      totalSkipped += result.skipped.length;
      totalFailed += result.failed.length;

      const verb = isDryRun ? 'would update' : 'updated';
      console.log(
        `- ${describeUser(user)}: scanned ${result.scanned}, ${verb} ${result.updated.length}, ` +
          `already correct ${result.skipped.length}, failed ${result.failed.length}` +
          `${result.truncated ? '  [TRUNCATED - re-run]' : ''}`
      );
      result.updated.forEach(l => console.log(`    -> ${l.description}`));
      result.failed.forEach(l => console.log(`    !! ${l.description}: ${l.error}`));
    } catch (e) {
      totalFailed += 1;
      // Never the bare error: an axios error carries the bearer token in config.headers.
      console.error(`- ${describeUser(user)}: FAILED (${e.status || ''} ${e.message})`);
    }
  }

  console.log(
    `\n${isDryRun ? 'Would update' : 'Updated'} ${totalUpdated} listing(s); ` +
      `${totalSkipped} already correct; ${totalFailed} failure(s).`
  );
};

run().catch(e => {
  console.error(`Run failed: ${e.status || ''} ${e.message}`);
  process.exit(1);
});
