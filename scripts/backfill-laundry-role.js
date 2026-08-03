/**
 * Admin utility: backfill the `isLaundry` metadata DEFAULT onto existing users.
 *
 * New users get `metadata.isLaundry = false` at signup (see
 * server/api/init-user-role.js and server/api/auth/createUserWithIdp.js), but
 * every user created before that shipped has `metadata: {}` — the key simply
 * isn't there. This script adds it to those users, once, so an operator can see
 * and toggle the flag in Console for the whole marketplace.
 *
 * SAFETY — this NEVER demotes anyone:
 * It only writes to users where the `isLaundry` key is ABSENT. Any user that
 * already has a value (`true` from an admin/scripts/set-laundry-role.js, or
 * `false` from a previous run) is skipped untouched. The value written is
 * hard-coded `false` — there is no flag to make this script write `true`.
 *
 * SAFETY — why the filtering happens in JS, not in the query:
 * The Integration API's `users.query` FAILS OPEN on unrecognised filter params:
 * it silently ignores them and returns every user, exactly like `users.query({})`
 * (verified against Dev — see server/api-util/laundryDirectory.js). A user-scope
 * search schema for `meta_isLaundry` now exists, but relying on the filter alone
 * would mean a single schema/marketplace mismatch silently turns "users missing
 * the key" into "every user in the marketplace". This exact fail-open behaviour
 * has already caused two security bugs in this project, so this script does not
 * pass the filter at all: it pages through every user and re-checks the actual
 * metadata value in JS, which is the only authoritative source.
 *
 * The script also echoes which marketplace it is about to write to before
 * writing, because it reads whatever `.env` happens to be present: a developer
 * with production credentials in `.env` would otherwise mutate production
 * silently.
 *
 * Usage:
 *   node scripts/backfill-laundry-role.js --dry-run
 *   node scripts/backfill-laundry-role.js
 */

require('dotenv').config();
const integrationSdk = require('sharetribe-flex-integration-sdk');
const {
  LAUNDRY_ROLE_KEY,
  needsLaundryRoleDefault,
} = require('../server/api-util/laundryRoleDefaults');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

const PER_PAGE = 100;

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

// Page through every user in the marketplace. No extended-data filter is passed
// on purpose — see the header comment.
const fetchAllUsers = (page = 1, collected = []) =>
  sdk.users.query({ page, perPage: PER_PAGE }).then(res => {
    const users = collected.concat(res.data.data || []);
    const { totalPages } = res.data.meta || {};
    return page < (totalPages || 1) ? fetchAllUsers(page + 1, users) : users;
  });

// Sequential rather than Promise.all: this is admin tooling run rarely against
// the whole user base, and a burst of parallel writes is the fastest way to hit
// the Integration API's rate limits mid-run and leave a half-finished backfill.
const writeSequentially = users =>
  users.reduce(
    (chain, user) =>
      chain.then(done =>
        sdk.users
          .updateProfile({ id: user.id, metadata: { [LAUNDRY_ROLE_KEY]: false } }, { expand: true })
          .then(res => {
            const written = res.data.data.attributes.profile.metadata[LAUNDRY_ROLE_KEY];
            console.log(`  set ${user.attributes.email} (${user.id.uuid}) -> ${written}`);
            return done.concat(user.id.uuid);
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
        `${isDryRun ? '  [DRY RUN — no writes will be made]' : ''}`
    );
    return fetchAllUsers();
  })
  .then(users => {
    // The authoritative check. `needsLaundryRoleDefault` is the same helper the
    // signup endpoint uses, so the script and the runtime can never disagree
    // about what "missing" means.
    const missing = users.filter(u => needsLaundryRoleDefault(u.attributes?.profile?.metadata));
    const alreadySet = users.length - missing.length;

    console.log(
      `Scanned ${users.length} users: ${missing.length} missing "${LAUNDRY_ROLE_KEY}", ` +
        `${alreadySet} already set (left untouched).`
    );

    if (missing.length === 0) {
      console.log('Nothing to do.');
      return null;
    }

    if (isDryRun) {
      missing.forEach(user => {
        console.log(`  would set ${user.attributes.email} (${user.id.uuid}) -> false`);
      });
      console.log(`DRY RUN: would update ${missing.length} users. No writes made.`);
      return null;
    }

    return writeSequentially(missing).then(updatedIds => {
      console.log(`OK: set ${LAUNDRY_ROLE_KEY} = false on ${updatedIds.length} users.`);
    });
  })
  .catch(err => {
    // Deliberately NOT logging the bare `err`: an axios error carries
    // `config.headers` with the bearer token in it.
    console.error('Failed:', err.data || err.message || 'Unknown error');
    process.exit(1);
  });
