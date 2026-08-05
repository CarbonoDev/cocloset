// Per-category laundry pricing: the single implementation of "what does THIS garment
// cost to clean, and how long does THIS garment take", for one laundry.
//
// WHY THIS IS A SEPARATE, PURE MODULE (no SDK, no Express, no env reads):
// two very different consumers need the identical answer, and they must never drift.
//   * server/api-util/lineItemHelpers.js — the cleaning fee on the customer's invoice.
//   * server/api/create-availability-buffer.js + laundry-transaction-status.js — the
//     turnaround that sizes the availability window blocked around a booking.
// A third consumer (server/api-util/laundryDirectory.js) resolves turnaround for the
// wizard's picker cards. Keeping the rule here means it is unit-testable directly and
// there is exactly one place a fallback bug can live.
//
// ── STORAGE SHAPE ────────────────────────────────────────────────────────────
// On the laundry user's own profile `privateData` (owner + operator only — a fee table
// is a commercial input, not public information):
//
//   privateData: {
//     turnaroundHours: 48,        // studio-wide fallback
//     cleaningFee: 12.5,          // studio-wide fallback
//     categoryPricing: {          // keyed by CONSOLE CATEGORY ID
//       dresses:    { turnaroundHours: 72, cleaningFee: 15 },
//       midi_dress: { cleaningFee: 22 },
//       silk:       { cleaningFee: 30 },
//     },
//   }
//
// Keys are Console category ids (`midi_dress`), never labels — the same vocabulary
// `acceptedCategories` and a listing's `categoryLevel1/2/3` speak. Labels were the
// original bug in the accepted-category check; do not reintroduce them here.
//
// The two fields live in one table but obey DIFFERENT rules, because they model
// different things:
//
//   cleaningFee     — settable on a category at ANY level. Price is per garment type,
//                     and a silk dress genuinely costs more to clean than a cotton one.
//   turnaroundHours — settable on TOP-LEVEL categories ONLY. Per the client: "las horas
//                     estan bien por categoría grande". Scheduling capacity is a
//                     property of the machine and the process, not of the trim. An
//                     entry on a subcategory is simply never read for hours.
//
// ── RESOLUTION: PRICE — HIGHEST MATCH WINS ───────────────────────────────────
// A listing carries its whole category chain (`dresses`, then `midi_dress`, then
// possibly a third level), general first. For the cleaning fee:
//
//   1. Of every entry in that chain that configures a fee, take the HIGHEST.
//      Per the client: "Utilizaría el precio mas alto". So a listing filed
//      dresses > midi_dress, with 10 on `dresses` and 8 on `midi_dress`, is charged
//      10 — the deeper value does NOT win just for being deeper.
//   2. If NO category in the chain configures a fee, fall back to the studio-wide
//      `privateData.cleaningFee`. The studio-wide value is a fallback, not a
//      candidate: it never competes in the max. A studio-wide 20 with a `midi_dress`
//      entry of 8 charges 8.
//   3. If that is not configured either, the caller applies its env default
//      (DEFAULT_CLEANING_FEE) — this module returns null rather than inventing a
//      number, so the caller keeps ownership of the last fallback.
//
// ── RESOLUTION: HOURS — TOP-LEVEL CATEGORY, THEN STUDIO-WIDE ─────────────────
// Only the FIRST (most general) id in the listing's chain is consulted. There is at
// most one candidate, so no max is needed. Then the studio-wide
// `privateData.turnaroundHours`, then the caller's env default
// (DEFAULT_LAUNDRY_BUFFER_HOURS) via availabilityHelpers.resolveTurnaroundHours.
//
// ── PRUNING: WE RETAIN, WE DO NOT PRUNE ──────────────────────────────────────
// An entry whose category is later un-ticked in `acceptedCategories`, or removed from
// Console, is KEPT in storage. Retention cannot corrupt pricing, because resolution
// only ever consults entries whose id appears in the LISTING's own category chain — an
// entry for a category no listing can be filed under is unreachable by construction.
// Pruning, by contrast, is destructive on a signal we do not control: Console's tree
// arrives as a hosted asset, so a failed or empty asset fetch would make every category
// look "removed" and would wipe a studio's whole fee table from a transient network
// error. The form surfaces retained-but-unaccepted entries so a studio can clear them
// deliberately (see LaundryProfileForm).

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

// Is a cleaning fee a configured value?
//
// Zero counts: an explicit 0 means "this studio does not charge for this", and has
// meant exactly that for the studio-wide fee since it existed (there is a regression
// test on resolveCleaningFeeInSubunits pinning it). Negative does not: a negative fee
// is not a discount, it is a data error, and paying the customer to rent is not a
// failure mode worth supporting.
const isConfiguredFee = number => number !== null && number >= 0;

// Is a turnaround a configured value?
//
// Zero does NOT count, unlike the fee. A zero-hour turnaround is not a business
// statement, it is an empty box that happened to parse; computeBufferDays throws on
// anything <= 0, and availabilityHelpers.resolveTurnaroundHours already rejects 0 and
// negatives at the studio level.
const isConfiguredHours = number => number !== null && number > 0;

// Read a studio-wide scalar off privateData with the same validity rule as its
// per-category counterpart.
const readStudioNumber = (privateData, key, isConfigured) => {
  const value = privateData?.[key];
  const number = typeof value === 'number' && Number.isFinite(value) ? value : null;
  return isConfigured(number) ? number : null;
};

/**
 * Resolve the cleaning fee for one listing against one laundry's stored pricing.
 *
 * HIGHEST MATCHING CATEGORY WINS, then the studio-wide fallback. See the module
 * docblock for the full rule and the client's wording.
 *
 * @param {Object} privateData the laundry user's profile privateData
 * @param {Array<string>} listingCategoryValues the listing's chain, general -> specific
 * @returns {{ value: number, source: 'category'|'studio', categoryId: string|null }|null}
 *   the resolved fee in MAJOR currency units with where it came from, or null when
 *   nothing is configured at any level (the caller then applies its env default)
 */
const resolveCleaningFeeEntry = (privateData, listingCategoryValues) => {
  const table = getCategoryPricingTable(privateData);
  const chain = Array.isArray(listingCategoryValues) ? listingCategoryValues : [];

  // Collect EVERY configured match in the chain, then take the highest. Deliberately
  // not a first-match-wins walk: depth is not what decides this.
  const winner = chain.reduce((best, categoryId) => {
    const number = readEntryNumber(table, categoryId, 'cleaningFee');
    if (!isConfiguredFee(number)) {
      return best;
    }
    return best === null || number > best.value
      ? { value: number, source: 'category', categoryId }
      : best;
  }, null);

  if (winner !== null) {
    return winner;
  }

  // No category in the chain priced this garment. The studio-wide value is the
  // deliberate fallback for exactly that case — it is not a competitor in the max.
  const studioNumber = readStudioNumber(privateData, 'cleaningFee', isConfiguredFee);
  return studioNumber !== null ? { value: studioNumber, source: 'studio', categoryId: null } : null;
};

/**
 * Resolve the turnaround for one listing against one laundry's stored pricing.
 *
 * TOP-LEVEL CATEGORY ONLY, then the studio-wide fallback. Only the first (most
 * general) id in the chain is consulted; an entry on a subcategory is never read.
 *
 * @param {Object} privateData the laundry user's profile privateData
 * @param {Array<string>} listingCategoryValues the listing's chain, general -> specific
 * @returns {{ value: number, source: 'category'|'studio', categoryId: string|null }|null}
 *   the resolved hours with where it came from, or null when nothing is configured at
 *   either level (the caller then applies its env default)
 */
const resolveTurnaroundHoursEntry = (privateData, listingCategoryValues) => {
  const table = getCategoryPricingTable(privateData);
  const chain = Array.isArray(listingCategoryValues) ? listingCategoryValues : [];
  const topLevelId = chain[0];

  const number = readEntryNumber(table, topLevelId, 'turnaroundHours');
  if (isConfiguredHours(number)) {
    return { value: number, source: 'category', categoryId: topLevelId };
  }

  const studioNumber = readStudioNumber(privateData, 'turnaroundHours', isConfiguredHours);
  return studioNumber !== null ? { value: studioNumber, source: 'studio', categoryId: null } : null;
};

/**
 * Cleaning fee only, in MAJOR currency units (e.g. euros — the same unit the laundry
 * types into its profile and the same unit DEFAULT_CLEANING_FEE uses).
 *
 * @param {Object} privateData
 * @param {Array<string>} listingCategoryValues
 * @returns {number|null}
 */
const resolveCategoryCleaningFee = (privateData, listingCategoryValues) =>
  resolveCleaningFeeEntry(privateData, listingCategoryValues)?.value ?? null;

/**
 * Turnaround only, in hours.
 *
 * Returns null rather than a default so it composes with the existing
 * availabilityHelpers.resolveTurnaroundHours(value, envDefault) chain untouched:
 * `resolveTurnaroundHours(resolveCategoryTurnaroundHours(...), env)`.
 *
 * @param {Object} privateData
 * @param {Array<string>} listingCategoryValues
 * @returns {number|null}
 */
const resolveCategoryTurnaroundHours = (privateData, listingCategoryValues) =>
  resolveTurnaroundHoursEntry(privateData, listingCategoryValues)?.value ?? null;

module.exports = {
  CATEGORY_LEVEL_KEYS,
  CATEGORY_PRICING_KEY,
  getListingCategoryValues,
  getCategoryPricingTable,
  resolveCleaningFeeEntry,
  resolveTurnaroundHoursEntry,
  resolveCategoryCleaningFee,
  resolveCategoryTurnaroundHours,
};
