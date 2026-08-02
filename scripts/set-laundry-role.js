/**
 * Admin utility: flip a user's `isLaundry` metadata flag via the Integration API.
 *
 * `isLaundry` is intentionally stored as user *metadata* (not publicData) so a user
 * can never self-assign it — metadata is writable only through the Integration API.
 * There is no in-app admin UI for this yet (Phase 1), so this script is the interim
 * way to grant/revoke the laundry role. See:
 * /workspace/vault/Projects/Cocloset/Design - Laundry Process & Data Model.md (§2)
 *
 * SAFETY NOTE — why this uses `users.show({ email })` and then re-checks the email:
 * `users.query({ emailAddress })` does NOT filter. The Integration API silently
 * drops unrecognised query params, so it returns every user in the marketplace and
 * `data[0]` is whoever sorts first. Verified against Dev: asking for
 * `test-laundry-cocloset@example.com` returned `test-cocloset-tom-brady@example.com`.
 * This script previously used that call and would happily have granted the laundry
 * role — and with it the ability to advance transactions and set the cleaning fee
 * customers are charged — to an unrelated user, while printing success.
 *
 * The script also echoes which marketplace it is about to write to before writing,
 * because it reads whatever `.env` happens to be present: a developer with
 * production credentials in `.env` would otherwise mutate production silently.
 *
 * Usage:
 *   node scripts/set-laundry-role.js user@example.com true
 *   node scripts/set-laundry-role.js user@example.com false
 *   node scripts/set-laundry-role.js user@example.com true --dry-run
 */

require('dotenv').config();
const integrationSdk = require('sharetribe-flex-integration-sdk');
const { findUserByEmail } = require('../server/api-util/userLookup');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const [email, flagArg] = args.filter(arg => !arg.startsWith('--'));

if (!email || !['true', 'false'].includes(flagArg)) {
  console.error('Usage: node scripts/set-laundry-role.js <email> <true|false> [--dry-run]');
  process.exit(1);
}

const isLaundry = flagArg === 'true';

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

// Echo the target marketplace before any write, so it is impossible to run this
// against the wrong environment without seeing which one it is.
sdk.marketplace
  .show()
  .then(res => {
    const marketplace = res.data.data;
    console.log(
      `Marketplace: ${marketplace.attributes.name} (${marketplace.id.uuid})` +
        `${isDryRun ? '  [DRY RUN — no write will be made]' : ''}`
    );
    return findUserByEmail(sdk, email);
  })
  .then(user => {
    const currentFlag = user.attributes.profile.metadata?.isLaundry;
    console.log(
      `Target user: ${user.attributes.profile.displayName} <${user.attributes.email}> ` +
        `(${user.id.uuid}), isLaundry currently = ${currentFlag}`
    );

    if (isDryRun) {
      console.log(`DRY RUN: would set isLaundry = ${isLaundry}. No write made.`);
      return null;
    }

    return sdk.users
      .updateProfile({ id: user.id, metadata: { isLaundry } }, { expand: true })
      .then(res => {
        const updated = res.data.data;
        console.log(
          `OK: ${email} (${updated.id.uuid}) isLaundry = ` +
            `${updated.attributes.profile.metadata.isLaundry}`
        );
      });
  })
  .catch(err => {
    // Deliberately NOT logging the bare `err`: an axios error carries
    // `config.headers` with the bearer token in it.
    console.error('Failed:', err.data || err.message || 'Unknown error');
    process.exit(1);
  });
