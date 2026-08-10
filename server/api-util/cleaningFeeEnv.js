// Per-category cleaning fees, resolved from the SERVER ENVIRONMENT.
//
// WHY THE ENVIRONMENT AND NOT THE LAUNDRY'S PROFILE:
// the fee a customer pays to have a garment cleaned is a marketplace-level commercial
// decision, not a per-studio one. Per the client: "El precio por categoría que establece
// la laundry será establecido por una variable env, por lo que hay que ocultar el form y
// que el precio venga de una env". So the laundry no longer types a fee anywhere, and
// nothing here reads a laundry's `privateData` — see resolveCleaningFeeInSubunits in
// lineItemHelpers.js, which no longer looks a laundry up at all for pricing.
//
// ── THE NAMING CONVENTION ────────────────────────────────────────────────────
//   CLEANING_FEE_<CATEGORY_ID>
// where <CATEGORY_ID> is the Console category id upper-cased, with every character
// outside [A-Z0-9] replaced by `_`:
//
//   dresses           -> CLEANING_FEE_DRESSES
//   midi_dress        -> CLEANING_FEE_MIDI_DRESS
//   jumpsuits_rompers -> CLEANING_FEE_JUMPSUITS_ROMPERS
//
// The value is a PLAIN NUMBER in the marketplace's major currency unit (e.g. `12.5`
// for EUR 12.50) — the same unit DEFAULT_CLEANING_FEE has always used, and the unit
// cleaningFeeToSubunits converts from.
//
// SERVER-ONLY. Never prefix these with REACT_APP_: a fee table in the browser bundle
// is a pricing input a customer could read and, more importantly, one the client could
// be tempted to compute from. The charge is computed server-side, from these vars only.
//
// THE POINT OF THE PREFIX IS THAT ADDING A CATEGORY IS NOT A CODE CHANGE. There is no
// list of known categories in this module, and there must never be one: the resolver is
// handed the chain a LISTING carries and derives the var name from it. A new Console
// category becomes priceable the moment someone sets `CLEANING_FEE_<ITS_ID>` in the
// environment and restarts the server.
//
// ── RESOLUTION: HIGHEST CONFIGURED CATEGORY IN THE CHAIN WINS ────────────────
// A listing carries its whole category chain (categoryLevel1/2/3), general first.
//
//   1. Of every category in that chain that has a fee configured, take the HIGHEST.
//      Per the client: "Utilizaría el precio mas alto". A listing filed
//      dresses > midi_dress with CLEANING_FEE_DRESSES=10 and CLEANING_FEE_MIDI_DRESS=8
//      is charged 10 — the deeper value does NOT win just for being deeper.
//   2. If NO category in the chain is configured, fall back to DEFAULT_CLEANING_FEE.
//      That is a FALLBACK, not a candidate: it never competes in the max. A
//      DEFAULT_CLEANING_FEE of 20 with CLEANING_FEE_MIDI_DRESS=8 charges 8.
//   3. If DEFAULT_CLEANING_FEE is unset too, this returns null and the caller charges
//      nothing (a zero fee adds no line item at all).
//
// This is deliberately the same rule the per-laundry table used to obey, because it is
// the rule the client decided on; only the storage moved.
//
// ── MALFORMED VALUES ARE IGNORED AND LOGGED, NEVER COERCED ───────────────────
// `CLEANING_FEE_TOPS=twelve` (or `-5`, or `abc`) is a deployment mistake, and the
// dangerous failure mode is the quiet one: silently reading it as 0 produces a checkout
// that works perfectly and charges the wrong price, which nobody notices until a
// laundry asks where its money went. So a malformed value is skipped — resolution
// continues to the next rung, exactly as if the var were unset — and reported through
// server/log.js WITH THE OFFENDING VAR NAME so it can be fixed.
//
// Reported ONCE per var name per process. This runs on the checkout path (every price
// preview, every booking request), so an un-deduplicated log would emit thousands of
// identical lines and bury the signal it exists to raise.
const log = require('../log');

const CLEANING_FEE_ENV_PREFIX = 'CLEANING_FEE_';

// The marketplace-wide fallback, used only when no category in the chain is priced.
const DEFAULT_CLEANING_FEE_ENV_VAR = 'DEFAULT_CLEANING_FEE';

// Var names already reported as malformed. Module-level, so "once" means once per
// server process rather than once per request. resetReportedMalformedEnvVars() exists
// for tests, which need each case to be observable.
const reportedMalformedEnvVars = new Set();

/**
 * The env var name holding the cleaning fee for one Console category id.
 *
 * Normalisation is total rather than validating: a Console id is free-form operator
 * input and could contain a dash, a space or an accent, none of which can appear in a
 * portable env var name. Mapping every non-[A-Z0-9] character to `_` means there is
 * always exactly one name to document and one name to set.
 *
 * @param {string} categoryId Console category id (e.g. 'midi_dress')
 * @returns {string|null} e.g. 'CLEANING_FEE_MIDI_DRESS', or null for an unusable id
 */
const cleaningFeeEnvVarName = categoryId => {
  if (typeof categoryId !== 'string' || categoryId === '') {
    return null;
  }
  return `${CLEANING_FEE_ENV_PREFIX}${categoryId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
};

// Report a malformed value once per var name. Uses log.error (console.error + Sentry
// when configured) rather than console.warn: a mispriced rental is not a warning.
const reportMalformed = (envVar, rawValue) => {
  if (reportedMalformedEnvVars.has(envVar)) {
    return;
  }
  reportedMalformedEnvVars.add(envVar);
  log.error(
    new Error(
      `${envVar} is not a valid cleaning fee: expected a non-negative plain number in ` +
        `major currency units (e.g. 12.5). The value was IGNORED — pricing fell back to ` +
        `the next configured level.`
    ),
    'cleaning-fee-env-invalid',
    { envVar, rawValue }
  );
};

/**
 * Read one cleaning-fee env var.
 *
 * @param {string} envVar the var name
 * @param {Object} env the environment to read (defaults to process.env)
 * @returns {number|null} the fee in major units, or null when unset/blank/malformed
 */
const readCleaningFeeEnvVar = (envVar, env) => {
  const source = env && typeof env === 'object' ? env : process.env;
  const rawValue = envVar ? source[envVar] : undefined;

  // Unset, or set to nothing. `FOO=` in a .env file is how people comment a value out
  // in a hurry; treating it as a deployment error would be noise, not a signal.
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return null;
  }

  // Number(), not parseFloat(): parseFloat('12abc') is 12, which is exactly the silent
  // mispricing this module refuses to do.
  const parsed = Number(String(rawValue).trim());

  // Zero IS a valid fee — "this category is cleaned for free" is a real statement, and
  // a zero fee simply adds no line item. Negative is not: a negative fee is not a
  // discount, it is a data error, and paying a customer to rent is not a supported
  // outcome.
  if (!Number.isFinite(parsed) || parsed < 0) {
    reportMalformed(envVar, String(rawValue));
    return null;
  }

  return parsed;
};

/**
 * Resolve the cleaning fee for one listing's category chain, with provenance.
 *
 * @param {Array<string>} listingCategoryValues the chain, general -> specific
 * @param {Object} [env] environment to read (defaults to process.env)
 * @returns {{ value: number, source: 'category'|'default', envVar: string,
 *   categoryId: string|null }|null} the fee in MAJOR currency units and where it came
 *   from, or null when nothing is configured anywhere
 */
const resolveCleaningFeeEntry = (listingCategoryValues, env = process.env) => {
  const chain = Array.isArray(listingCategoryValues) ? listingCategoryValues : [];

  // Every configured match in the chain, then the highest. Deliberately not a
  // first-match-wins walk: depth is not what decides this.
  const winner = chain.reduce((best, categoryId) => {
    const envVar = cleaningFeeEnvVarName(categoryId);
    const value = readCleaningFeeEnvVar(envVar, env);
    if (value === null) {
      return best;
    }
    return best === null || value > best.value
      ? { value, source: 'category', envVar, categoryId }
      : best;
  }, null);

  if (winner !== null) {
    return winner;
  }

  // Nothing in the chain priced this garment. The marketplace-wide default is the
  // deliberate fallback for exactly that case — it is not a competitor in the max.
  const defaultValue = readCleaningFeeEnvVar(DEFAULT_CLEANING_FEE_ENV_VAR, env);
  return defaultValue !== null
    ? {
        value: defaultValue,
        source: 'default',
        envVar: DEFAULT_CLEANING_FEE_ENV_VAR,
        categoryId: null,
      }
    : null;
};

/**
 * The cleaning fee for one listing's category chain, in MAJOR currency units.
 *
 * @param {Array<string>} listingCategoryValues the chain, general -> specific
 * @param {Object} [env] environment to read (defaults to process.env)
 * @returns {number|null} fee in major units, or null when nothing is configured
 */
const resolveCleaningFeeMajorUnits = (listingCategoryValues, env = process.env) =>
  resolveCleaningFeeEntry(listingCategoryValues, env)?.value ?? null;

// Tests only: forget which vars have already been reported, so each malformed-value
// case can assert its own log line.
const resetReportedMalformedEnvVars = () => reportedMalformedEnvVars.clear();

module.exports = {
  CLEANING_FEE_ENV_PREFIX,
  DEFAULT_CLEANING_FEE_ENV_VAR,
  cleaningFeeEnvVarName,
  readCleaningFeeEnvVar,
  resolveCleaningFeeEntry,
  resolveCleaningFeeMajorUnits,
  resetReportedMalformedEnvVars,
};
