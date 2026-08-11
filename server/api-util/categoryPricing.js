// Per-category laundry turnaround: the single implementation of "how long does THIS
// garment take", for one laundry.
//
// WHY THIS IS A SEPARATE, PURE MODULE (no SDK, no Express, no env reads):
// two very different consumers need the identical answer, and they must never drift.
//   * server/api/create-availability-buffer.js — the turnaround that sizes the
//     availability window blocked around a booking.
//   * server/api/laundry-transaction-status.js — the same, recomputed from the moment
//     the garment physically comes back.
// A third consumer (server/api-util/laundryDirectory.js) resolves turnaround for the
// wizard's picker cards. Keeping the rule here means it is unit-testable directly and
// there is exactly one place a fallback bug can live.
//
// ── WHAT USED TO BE HERE: CLEANING FEES ──────────────────────────────────────
// This module also resolved the per-category cleaning fee out of the same stored table.
// It no longer does, and nothing may read a fee from a laundry's `privateData` again.
// Fees are now marketplace-level environment configuration (`CLEANING_FEE_<CATEGORY_ID>`
// — see api-util/cleaningFeeEnv.js), because that is what the client decided: "El precio
// por categoría que establece la laundry será establecido por una variable env".
// Existing `cleaningFee` values may still be sitting in storage on old profiles; they
// are DEAD DATA and are deliberately never read, because a stale stored fee that still
// priced rentals after the input was removed from the form is the exact bug this change
// exists to remove.
//
// ── STORAGE SHAPE ────────────────────────────────────────────────────────────
// On the laundry user's own profile `privateData` (owner + operator only — how fast a
// studio can turn work around is a commercial input, not public information):
//
//   privateData: {
//     turnaroundDays: 2,         // studio-wide fallback
//     categoryPricing: {         // keyed by CONSOLE CATEGORY ID
//       dresses: { turnaroundDays: 3 },
//       tops:    { turnaroundDays: 1 },
//     },
//   }
//
// Keys are Console category ids (`dresses`), never labels — the same vocabulary
// `acceptedCategories` and a listing's `categoryLevel1/2/3` speak. Labels were the
// original bug in the accepted-category check; do not reintroduce them here.
//
// ── DAYS, NOT HOURS ──────────────────────────────────────────────────────────
// The canonical unit is DAYS everywhere: `privateData.turnaroundDays`,
// `categoryPricing.<id>.turnaroundDays`, the env fallback DEFAULT_LAUNDRY_BUFFER_DAYS,
// and every variable that carries the value. It used to be hours, which was a unit the
// product never actually used: the availability calendar it feeds is day-granular
// (Sharetribe daily bookings and exceptions sit on UTC day boundaries), so every hour
// figure was immediately rounded up to a whole day anyway. Per the client the studio
// now states days directly, and NOTHING in this codebase converts between the two — a
// field in days feeding a variable named `...Hours` is how unit bugs ship.
//
// ── RESOLUTION: TOP-LEVEL CATEGORY, THEN STUDIO-WIDE ─────────────────────────
// Turnaround is settable on TOP-LEVEL categories ONLY. Per the client: "las horas estan
// bien por categoría grande". Scheduling capacity is a property of the machine and the
// process, not of the trim, so an entry on a subcategory is simply never read.
//
// Only the FIRST (most general) id in the listing's chain is consulted. There is at most
// one candidate, so no max is needed. Then the studio-wide `privateData.turnaroundDays`,
// then the caller's env default (DEFAULT_LAUNDRY_BUFFER_DAYS) via
// availabilityHelpers.resolveTurnaroundDays.
//
// ── PRUNING: WE RETAIN, WE DO NOT PRUNE ──────────────────────────────────────
// An entry whose category is later un-ticked in `acceptedCategories`, or removed from
// Console, is KEPT in storage. Retention cannot corrupt resolution, because it only ever
// consults entries whose id appears in the LISTING's own category chain — an entry for a
// category no listing can be filed under is unreachable by construction. Pruning, by
// contrast, is destructive on a signal we do not control: Console's tree arrives as a
// hosted asset, so a failed or empty asset fetch would make every category look
// "removed" and would wipe a studio's whole table from a transient network error. The
// form surfaces retained-but-unaccepted entries so a studio can clear them deliberately
// (see LaundryProfileForm).

// Console writes a listing's category into these fixed, numbered keys — never a single
// `category` key. This mirrors CATEGORY_LEVEL_KEYS in src/util/fieldHelpers.js; the two
// cannot import each other (src is ESM and transpiled, server/ is plain CommonJS run by
// node directly), so the list is duplicated deliberately. If Console ever grows a fourth
// level, BOTH must change — categoryPricing.test.js asserts this list explicitly so the
// duplication fails loudly rather than silently resolving one level short.
const CATEGORY_LEVEL_KEYS = ['categoryLevel1', 'categoryLevel2', 'categoryLevel3'];

// The privateData key holding the per-category table.
const CATEGORY_PRICING_KEY = 'categoryPricing';

/**
 * Read a listing's category chain out of its publicData, most general first.
 *
 * CommonJS twin of src/util/fieldHelpers.js `getListingCategoryValues` — same keys,
 * same gap-skipping, same tolerance for missing publicData.
 *
 * @param {Object} publicData a listing's publicData (may be undefined)
 * @returns {Array<string>} set category ids, general -> specific, gaps removed
 */
const getListingCategoryValues = publicData =>
  CATEGORY_LEVEL_KEYS.map(key => publicData?.[key]).filter(
    value => typeof value === 'string' && value !== ''
  );

// Read the table, tolerating every shape a hand-edited or API-written profile can hold.
// Arrays are rejected as well as primitives: `typeof [] === 'object'` would otherwise
// let an array through and `[]['dresses']` would quietly be undefined forever.
const getCategoryPricingTable = privateData => {
  const table = privateData?.[CATEGORY_PRICING_KEY];
  return table && typeof table === 'object' && !Array.isArray(table) ? table : {};
};

// Pull one numeric field off one entry. Returns null for anything that is not a finite
// number — a blank input, a missing key, a string, an object. A row a studio opened in
// the form and never filled in is an empty box, not a decision, and must not shadow a
// value set elsewhere.
const readEntryNumber = (table, categoryId, key) => {
  if (typeof categoryId !== 'string' || categoryId === '') {
    return null;
  }
  const entry = table[categoryId];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }
  const value = entry[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

// Is a turnaround a configured value?
//
// Zero does NOT count. A zero-day turnaround is not a business statement, it is an empty
// box that happened to parse; computeBufferDays throws on anything <= 0, and
// availabilityHelpers.resolveTurnaroundDays already rejects 0 and negatives at the
// studio level.
const isConfiguredDays = number => number !== null && number > 0;

// Read a studio-wide scalar off privateData with the same validity rule as its
// per-category counterpart.
const readStudioNumber = (privateData, key, isConfigured) => {
  const value = privateData?.[key];
  const number = typeof value === 'number' && Number.isFinite(value) ? value : null;
  return isConfigured(number) ? number : null;
};

/**
 * Resolve the turnaround for one listing against one laundry's stored configuration.
 *
 * TOP-LEVEL CATEGORY ONLY, then the studio-wide fallback. Only the first (most
 * general) id in the chain is consulted; an entry on a subcategory is never read.
 *
 * @param {Object} privateData the laundry user's profile privateData
 * @param {Array<string>} listingCategoryValues the listing's chain, general -> specific
 * @returns {{ value: number, source: 'category'|'studio', categoryId: string|null }|null}
 *   the resolved turnaround IN DAYS with where it came from, or null when nothing is
 *   configured at either level (the caller then applies its env default)
 */
const resolveTurnaroundDaysEntry = (privateData, listingCategoryValues) => {
  const table = getCategoryPricingTable(privateData);
  const chain = Array.isArray(listingCategoryValues) ? listingCategoryValues : [];
  const topLevelId = chain[0];

  const number = readEntryNumber(table, topLevelId, 'turnaroundDays');
  if (isConfiguredDays(number)) {
    return { value: number, source: 'category', categoryId: topLevelId };
  }

  const studioNumber = readStudioNumber(privateData, 'turnaroundDays', isConfiguredDays);
  return studioNumber !== null ? { value: studioNumber, source: 'studio', categoryId: null } : null;
};

/**
 * Turnaround only, in days.
 *
 * Returns null rather than a default so it composes with the existing
 * availabilityHelpers.resolveTurnaroundDays(value, envDefault) chain untouched:
 * `resolveTurnaroundDays(resolveCategoryTurnaroundDays(...), env)`.
 *
 * @param {Object} privateData
 * @param {Array<string>} listingCategoryValues
 * @returns {number|null}
 */
const resolveCategoryTurnaroundDays = (privateData, listingCategoryValues) =>
  resolveTurnaroundDaysEntry(privateData, listingCategoryValues)?.value ?? null;

module.exports = {
  CATEGORY_LEVEL_KEYS,
  CATEGORY_PRICING_KEY,
  getListingCategoryValues,
  getCategoryPricingTable,
  resolveTurnaroundDaysEntry,
  resolveCategoryTurnaroundDays,
};
