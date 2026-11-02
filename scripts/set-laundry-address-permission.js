/**
 * Admin utility: grant or revoke a laundry's permission to change its own address,
 * via the Integration API.
 *
 *   metadata.addressChangeAllowed = true | false
 *
 * WHY THIS EXISTS
 * A studio cannot change its own address once it has one. The client's rule:
 *
 *   > "debemos indicar al usuario que no puede cambiar su dirección y que si desea
 *   >  modificar la dirección, debe solicitar apoyo al administrador o soporte"
 *
 * and the mechanism he chose for the "once it can be changed" half:
 *
 *   > "la dirección (aun en publicData) se guarda a través de integration API, asi
 *   >  validamos que tenga habilitada la opción (ya que un admin lo va a habilitar
 *   >  para poder cambiar el address) y si puede cambiarla entonces hace el cambio"
 *
 * So: an admin grants the flag here, the studio makes ONE change through
 * /api/laundry-address (which also propagates it to every garment assigned to that
 * studio), and the endpoint clears the flag again. There is no in-app admin UI
 * (Phase 1), so this script is that grant.
 *
 * `addressChangeAllowed` is user *metadata* and not publicData for the reason
 * `isLaundry` is: metadata is writable only through the Integration API, so a
 * laundry cannot grant itself the permission. A flag the laundry could set would not
 * be a permission at all.
 *
 * ── WHAT THIS PERMISSION IS AND IS NOT ──────────────────────────────────────────
 * It gates OUR write path, which is also the only path that keeps the studio's
 * listings in step. The address itself lives in the laundry's own `publicData`,
 * which it can write directly against the Marketplace API with
 * `currentUser.updateProfile` — no server of ours is in that path, and nothing here
 * changes that. A studio that goes around the endpoint ends up with a profile that
 * disagrees with its own garments, but it is not prevented.
 *
 * Treat this as an operator workflow control, not an access control. See the header
 * of server/api-util/laundryAddress.js for the cheap hardening that would make it
 * one.
 *
 * ── WHEN TO USE THE OTHER SCRIPT INSTEAD ────────────────────────────────────────
 * If YOU are making the change on the studio's behalf (the usual case for a support
 * request), use scripts/update-laundry-address.js: it writes the address and
 * propagates it in one go, and needs no flag. Grant the flag only when you want the
 * STUDIO to enter its own new address.
 *
 * SAFETY
 *   - `users.show({ email })` then a re-check of the email, never
 *     `users.query({ emailAddress })`: the Integration API silently drops
 *     unrecognised query params, so query returns every user in the marketplace and
 *     `data[0]` is whoever sorts first. Verified against Dev - this has already
 *     granted the wrong user a role once in this project. Handled by
 *     server/api-util/userLookup.js `findUserByEmail`.
 *   - It refuses a user who is not flagged `metadata.isLaundry`. The flag is
 *     meaningless on anyone else, and setting it would be a confusing artefact in
 *     Console.
 *   - It echoes which marketplace it is about to write to before writing, because it
 *     reads whatever `.env` happens to be present: a developer with production
 *     credentials would otherwise mutate production silently.
 *   - It never logs the bare error object - an axios error carries `config.headers`
 *     with the bearer token in it.
 *
 * Usage:
 *   node scripts/set-laundry-address-permission.js laundry@example.com true
 *   node scripts/set-laundry-address-permission.js laundry@example.com false
 *   node scripts/set-laundry-address-permission.js laundry@example.com true --dry-run
 */

require('dotenv').config();
const integrationSdk = require('sharetribe-flex-integration-sdk');
const { findUserByEmail } = require('../server/api-util/userLookup');
const { ADDRESS_CHANGE_ALLOWED_KEY } = require('../server/api-util/laundryAddress');
const { isLaundryUserEntity } = require('../server/api-util/laundryDirectory');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const [email, flagArg] = args.filter(arg => !arg.startsWith('--'));

if (!email || !['true', 'false'].includes(flagArg)) {
  console.error(
    'Usage: node scripts/set-laundry-address-permission.js <email> <true|false> [--dry-run]'
  );
  process.exit(1);
}

const addressChangeAllowed = flagArg === 'true';

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
        `${isDryRun ? '  [DRY RUN - no write will be made]' : ''}`
    );
    return findUserByEmail(sdk, email);
  })
  .then(user => {
    const profile = user.attributes.profile || {};
    const currentFlag = profile.metadata?.[ADDRESS_CHANGE_ALLOWED_KEY];
    const laundryProfile = profile.publicData?.laundryProfile || {};

    console.log(
      `Target user: ${profile.displayName} <${user.attributes.email}> (${user.id.uuid})\n` +
        `  isLaundry            = ${profile.metadata?.isLaundry}\n` +
        `  current address      = ${laundryProfile.address || '(none)'}\n` +
        `  ${ADDRESS_CHANGE_ALLOWED_KEY} currently = ${currentFlag}`
    );

    if (!isLaundryUserEntity(user)) {
      console.error(
        `Refusing: ${email} is not flagged metadata.isLaundry = true. The address ` +
          `permission is meaningless on a non-laundry user. Use ` +
          `scripts/set-laundry-role.js first if this really is a studio.`
      );
      process.exit(1);
      return null;
    }

    // Said out loud rather than left for someone to discover: a studio with no
    // usable address may already change it (that is the onboarding branch in
    // server/api-util/laundryAddress.js), so granting here changes nothing.
    if (!laundryProfile.address || !laundryProfile.origin) {
      console.log(
        `\nNOTE: this studio has no usable address yet, so it can ALREADY set one ` +
          `without any grant (onboarding must always work). Granting the flag has no ` +
          `effect until it has an address.`
      );
    }

    if (isDryRun) {
      console.log(
        `\nDRY RUN: would set ${ADDRESS_CHANGE_ALLOWED_KEY} = ${addressChangeAllowed}. ` +
          `No write made.`
      );
      return null;
    }

    return sdk.users
      .updateProfile(
        { id: user.id, metadata: { [ADDRESS_CHANGE_ALLOWED_KEY]: addressChangeAllowed } },
        { expand: true }
      )
      .then(response => {
        const updated = response.data.data;
        console.log(
          `\nOK: ${email} (${updated.id.uuid}) ${ADDRESS_CHANGE_ALLOWED_KEY} = ` +
            `${updated.attributes.profile.metadata[ADDRESS_CHANGE_ALLOWED_KEY]}`
        );
        if (addressChangeAllowed) {
          console.log(
            'The studio may now change its address ONCE on its Studio settings page. ' +
              'The change propagates to every listing assigned to it, and this flag is ' +
              'cleared automatically when it is used.'
          );
        }
      });
  })
  .catch(err => {
    // Deliberately NOT logging the bare `err`: an axios error carries
    // `config.headers` with the bearer token in it.
    console.error('Failed:', err.data || err.message || 'Unknown error');
    process.exit(1);
  });
