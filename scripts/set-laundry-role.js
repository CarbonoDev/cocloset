/**
 * Admin utility: flip a user's `isLaundry` metadata flag via the Integration API.
 *
 * `isLaundry` is intentionally stored as user *metadata* (not publicData) so a user
 * can never self-assign it — metadata is writable only through the Integration API.
 * There is no in-app admin UI for this yet (Phase 1), so this script is the interim
 * way to grant/revoke the laundry role. See:
 * /workspace/vault/Projects/Cocloset/Design - Laundry Process & Data Model.md (§2)
 *
 * Usage:
 *   node scripts/set-laundry-role.js user@example.com true
 *   node scripts/set-laundry-role.js user@example.com false
 */

require('dotenv').config();
const integrationSdk = require('sharetribe-flex-integration-sdk');

const [, , email, flagArg] = process.argv;

if (!email || !['true', 'false'].includes(flagArg)) {
  console.error('Usage: node scripts/set-laundry-role.js <email> <true|false>');
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

sdk.users
  .query({ emailAddress: email })
  .then(res => {
    const user = res.data.data[0];
    if (!user) {
      throw new Error(`No user found with email ${email}`);
    }
    return sdk.users.updateProfile(
      {
        id: user.id,
        metadata: { isLaundry },
      },
      { expand: true }
    );
  })
  .then(res => {
    const updated = res.data.data;
    console.log(
      `OK: ${email} (${updated.id.uuid}) isLaundry = ${updated.attributes.profile.metadata.isLaundry}`
    );
  })
  .catch(err => {
    console.error('Failed:', err.data || err.message || err);
    process.exit(1);
  });
