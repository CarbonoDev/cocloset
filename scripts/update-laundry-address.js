/**
 * Admin utility: move a laundry to a new address, and carry that address onto every
 * garment assigned to it.
 *
 *   > "una vez que se pueda cambiar la dirección, debe cambiar tambien la dirección
 *   >  de todos los listings asociados a ese laundry"
 *
 * WHAT IT WRITES
 *   1. The studio's own profile: `publicData.laundryProfile.address` and `.origin`
 *      (and `.studioName`, with --studio-name). Merged into the stored object, never
 *      replacing it - see server/api-util/laundryAddress.js `writeLaundryAddress`.
 *   2. Then, for EVERY listing with `metadata.assignedLaundryId === <this laundry>`:
 *      `publicData.pickupAddress`, `publicData.assignedLaundryName` and the listing's
 *      top-level `geolocation`.
 *
 * Step 2 goes through server/api-util/laundryAssignment.js
 * `writeLaundryDerivedListingFields`, which is the same params builder
 * server/api/listing-laundry-assignment.js uses when a laundry is first assigned. So
 * a propagated listing carries byte for byte what an assignment would have written,
 * and the two cannot drift apart.
 *
 * It does NOT re-stamp `metadata.assignedLaundryId` or `metadata.initialCleaningDays`.
 * A studio that moves has not re-assigned anybody's garment, and re-resolving the
 * initial-cleaning turnaround would silently resize the calendar block of a garment
 * whose booking may be in flight, for a change that has nothing to do with turnaround.
 *
 * ── LISTINGS WITH A RENTAL IN FLIGHT ARE INCLUDED. DELIBERATELY. ────────────────
 * `pickupAddress` and `geolocation` answer exactly one question: where does a
 * customer physically go to collect and return this garment. Once the studio has
 * moved, the answer is the new address for every garment the studio holds - including
 * the ones mid-rental. Skipping in-flight listings would leave precisely the
 * customers who are about to travel somewhere reading the address the studio has
 * left. So all of them are updated, in every listing state.
 *
 * What this does NOT do, stated rather than left implicit:
 *   - it does not notify a customer who has already read the old address;
 *   - it does not rewrite any address already copied into a transaction's own data;
 *   - it does not pause or re-price a booking.
 * If a studio moves mid-rental, somebody still has to tell the customers. This script
 * makes the marketplace consistent; it does not make the logistics correct.
 *
 * ── WHEN TO USE THIS VERSUS THE PERMISSION FLAG ────────────────────────────────
 * Use this when YOU are making the change (the usual answer to a support request):
 * it needs no permission flag and does the whole job in one run. Use
 * scripts/set-laundry-address-permission.js instead when you want the STUDIO to
 * enter its own new address on its settings page - that path (via
 * /api/laundry-address) propagates too, and clears the flag afterwards.
 *
 * SAFETY
 *   - `--dry-run` reports every write it would make and makes none.
 *   - It echoes which marketplace it is about to write to before writing, because it
 *     reads whatever `.env` happens to be present: a developer with production
 *     credentials would otherwise mutate production silently.
 *   - It refuses a user who is not flagged `metadata.isLaundry`.
 *   - The listing filter is applied in JS, on the stored values. `meta_*` query
 *     filters FAIL OPEN on this API - an unrecognised one returns every listing in
 *     the marketplace (verified against Dev; it has caused two security bugs in this
 *     project) - and here that would mean rewriting the pickup address of every
 *     garment in the marketplace to one studio's address. See
 *     server/api-util/laundryAddress.js `findListingsAssignedToLaundry`.
 *   - Every listing STATE is scanned, not just published: a draft left on the old
 *     address is a listing whose owner publishes a wrong pickup point later.
 *   - A per-listing failure does not abort the run; it is reported and the rest
 *     continue. Re-running is safe - the whole thing is idempotent, and listings that
 *     already match are reported as skipped rather than rewritten.
 *   - It never logs the bare error object - an axios error carries `config.headers`
 *     with the bearer token in it.
 *
 * Usage:
 *   node scripts/update-laundry-address.js <laundry-user-id> \
 *     --address "5 Rue des Rosiers, 75004 Paris" --lat 48.857 --lng 2.359 [--dry-run]
 *
 *   # by email instead of id
 *   node scripts/update-laundry-address.js --email laundry@example.com \
 *     --address "..." --lat 48.857 --lng 2.359 --dry-run
 *
 *   # rename the studio at the same time (propagates assignedLaundryName too)
 *   node scripts/update-laundry-address.js <laundry-user-id> \
 *     --address "..." --lat 48.857 --lng 2.359 --studio-name "Maison du Marais"
 */

require('dotenv').config();
const integrationSdk = require('sharetribe-flex-integration-sdk');
const { findUserByEmail } = require('../server/api-util/userLookup');
const {
  parseAddressInput,
  propagateAddressToAssignedListings,
  readLaundryAddressState,
  writeLaundryAddress,
} = require('../server/api-util/laundryAddress');
const { toLaundryDirectoryEntry } = require('../server/api-util/laundryDirectory');

// Tiny argv parser. Written out rather than using `args.indexOf('--x') + 1`, because
// this script takes both flags-with-values and one positional argument, and the naive
// version silently reads a flag's VALUE as the positional laundry id - which here means
// writing an address onto whatever that string happens to resolve to.
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
const address = flags.address;
const latArg = flags.lat;
const lngArg = flags.lng;
const studioNameArg = flags['studio-name'];

const usage =
  'Usage: node scripts/update-laundry-address.js <laundry-user-id | --email <email>> ' +
  '--address "<address>" --lat <lat> --lng <lng> [--studio-name "<name>"] [--dry-run]';

if ((!laundryIdArg && !emailArg) || !address || latArg === undefined || lngArg === undefined) {
  console.error(usage);
  process.exit(1);
}

// Parsed and validated to the SAME standard the picker applies, via the endpoint's own
// parser: an address that does not clear it would save "successfully" and leave the
// studio invisible in the picker.
const submitted = parseAddressInput({
  address,
  origin: { lat: Number.parseFloat(latArg), lng: Number.parseFloat(lngArg) },
});

if (!submitted) {
  console.error(
    'Invalid --address / --lat / --lng. An address string and two finite numbers are required.\n' +
      usage
  );
  process.exit(1);
}

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

const resolveLaundryId = () =>
  emailArg
    ? findUserByEmail(sdk, emailArg).then(user => user.id.uuid)
    : Promise.resolve(laundryIdArg);

const reportListings = listings => {
  console.log(
    `\nScanned ${listings.scanned} listings (all states): ` +
      `${listings.updated.length} ${isDryRun ? 'would be updated' : 'updated'}, ` +
      `${listings.skipped.length} already correct, ${listings.failed.length} failed.`
  );

  if (listings.truncated) {
    console.log(
      'WARNING: the listing scan hit its page cap, so this run is INCOMPLETE. Re-run it - ' +
        'it is idempotent and will skip everything it already fixed.'
    );
  }

  listings.updated.forEach(entry => {
    console.log(`  ${isDryRun ? 'would update' : 'updated'}  ${entry.description}`);
  });
  listings.skipped.forEach(entry => {
    console.log(`  already correct  ${entry.description}`);
  });
  listings.failed.forEach(entry => {
    console.log(`  FAILED  ${entry.description}\n      ${JSON.stringify(entry.error)}`);
  });
};

// Echo the target marketplace before any write, so it is impossible to run this
// against the wrong environment without seeing which one it is.
sdk.marketplace
  .show()
  .then(res => {
    const marketplace = res.data.data;
    console.log(
      `Marketplace: ${marketplace.attributes.name} (${marketplace.id.uuid})` +
        `${isDryRun ? '  [DRY RUN - no writes will be made]' : ''}`
    );
    return resolveLaundryId();
  })
  .then(laundryId =>
    // Throws a 403-shaped error if the target is not flagged metadata.isLaundry.
    readLaundryAddressState({ integrationSdk: sdk, laundryId }).then(state => {
      const stored = state.laundryProfile;
      const studioName = studioNameArg || stored.studioName;

      console.log(
        `\nTarget laundry: ${state.user.attributes.profile.displayName} (${laundryId})\n` +
          `  studio name  ${stored.studioName || '(none)'}` +
          `${studioNameArg ? `  ->  ${studioNameArg}` : ''}\n` +
          `  address      ${stored.address || '(none)'}  ->  ${submitted.address}\n` +
          `  origin       ${JSON.stringify(stored.origin || null)}  ->  ` +
          `${JSON.stringify(submitted.origin)}`
      );

      if (isDryRun) {
        console.log('\nDRY RUN: the studio profile would be updated. No write made.');
        // The listing pass still RUNS in a dry run - it only reads - so an admin can
        // see exactly which garments a real run would touch before committing.
        return propagateAddressToAssignedListings({
          integrationSdk: sdk,
          laundryId,
          laundry: {
            ...toLaundryDirectoryEntry(state.user),
            studioName,
            address: submitted.address,
            origin: submitted.origin,
          },
          dryRun: true,
        }).then(reportListings);
      }

      return writeLaundryAddress({
        integrationSdk: sdk,
        laundryId,
        // studioName rides along in the merged object, so --studio-name lands in the
        // same call as the address rather than needing a second write.
        laundryProfile: { ...stored, ...(studioNameArg ? { studioName: studioNameArg } : {}) },
        address: submitted.address,
        origin: submitted.origin,
        // An admin write is not spending a studio's grant. Passing anything else here
        // would clear a flag this run never used - and if the studio was mid-grant,
        // silently cancel the change it was about to make itself.
        reason: 'admin-override',
      }).then(updatedUser => {
        console.log('\nOK: studio profile updated.');

        // Built from the UPDATED entity through the same allowlisted mapping the
        // assignment endpoint uses, so the listings receive exactly what an
        // assignment would have written - not what this script's argv said.
        return propagateAddressToAssignedListings({
          integrationSdk: sdk,
          laundryId,
          laundry: toLaundryDirectoryEntry(updatedUser),
        }).then(reportListings);
      });
    })
  )
  .catch(err => {
    // Deliberately NOT logging the bare `err`: an axios error carries
    // `config.headers` with the bearer token in it.
    console.error('Failed:', err.data || err.message || 'Unknown error');
    process.exit(1);
  });
