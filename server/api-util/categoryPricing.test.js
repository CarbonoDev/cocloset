const {
  CATEGORY_LEVEL_KEYS,
  CATEGORY_PRICING_KEY,
  getListingCategoryValues,
  getCategoryPricingTable,
  resolveTurnaroundDaysEntry,
  resolveCategoryTurnaroundDays,
} = require('./categoryPricing');

// A studio with a studio-wide fallback plus per-category entries. Note the deliberate
// shapes: `midi_dress` carries a days value even though days are top-level only (so it
// must never be read), and there is an entry for a second top-level branch.
const PRIVATE_DATA = {
  turnaroundDays: 2,
  [CATEGORY_PRICING_KEY]: {
    dresses: { turnaroundDays: 3 },
    midi_dress: { turnaroundDays: 1 },
    pants: { turnaroundDays: 1 },
  },
};

describe('CATEGORY_LEVEL_KEYS', () => {
  // This list is duplicated from src/util/fieldHelpers.js because src is ESM and this
  // module is CommonJS run untranspiled by node. Pin it explicitly: if Console grows a
  // fourth level and only one copy is updated, per-category resolution would silently
  // work one level short of the listing's real category. Changing this test should
  // mean you changed both copies.
  it('matches the numbered category keys Console writes', () => {
    expect(CATEGORY_LEVEL_KEYS).toEqual(['categoryLevel1', 'categoryLevel2', 'categoryLevel3']);
  });
});

describe('getListingCategoryValues()', () => {
  it('reads the numbered levels, most general first', () => {
    expect(
      getListingCategoryValues({ categoryLevel1: 'dresses', categoryLevel2: 'midi_dress' })
    ).toEqual(['dresses', 'midi_dress']);
  });

  it('reads all three levels when set', () => {
    expect(
      getListingCategoryValues({
        categoryLevel1: 'dresses',
        categoryLevel2: 'maxi_dress',
        categoryLevel3: 'silk',
      })
    ).toEqual(['dresses', 'maxi_dress', 'silk']);
  });

  it('skips a gap rather than emitting a hole', () => {
    expect(getListingCategoryValues({ categoryLevel1: 'dresses', categoryLevel3: 'silk' })).toEqual(
      ['dresses', 'silk']
    );
  });

  it('ignores a legacy single `category` key, which Console never writes', () => {
    expect(getListingCategoryValues({ category: 'Eveningwear' })).toEqual([]);
  });

  it('tolerates missing public data', () => {
    expect(getListingCategoryValues(undefined)).toEqual([]);
    expect(getListingCategoryValues(null)).toEqual([]);
    expect(getListingCategoryValues({})).toEqual([]);
  });
});

describe('getCategoryPricingTable()', () => {
  it('returns the stored table', () => {
    expect(getCategoryPricingTable(PRIVATE_DATA).dresses).toEqual({ turnaroundDays: 3 });
  });

  it('returns an empty table for anything that is not a plain object', () => {
    // An array is the trap: `typeof [] === 'object'`, so a naive guard lets it through
    // and every lookup silently returns undefined forever.
    expect(getCategoryPricingTable({ [CATEGORY_PRICING_KEY]: [] })).toEqual({});
    expect(getCategoryPricingTable({ [CATEGORY_PRICING_KEY]: 'nope' })).toEqual({});
    expect(getCategoryPricingTable({ [CATEGORY_PRICING_KEY]: null })).toEqual({});
    expect(getCategoryPricingTable({})).toEqual({});
    expect(getCategoryPricingTable(undefined)).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NO CLEANING FEE LIVES HERE ANY MORE.
// ─────────────────────────────────────────────────────────────────────────────
describe('cleaning fees', () => {
  // The fee moved into the server environment (CLEANING_FEE_<CATEGORY_ID>, see
  // cleaningFeeEnv.js). This module must not resolve one, and in particular must not
  // grow the old readers back: a stored fee that still priced rentals after the form
  // stopped collecting it is the exact bug that change removed. The resolution rules
  // themselves (highest-in-the-chain wins, zero is free, negatives rejected) are now
  // asserted in cleaningFeeEnv.test.js against env vars.
  it('exports no fee resolver at all', () => {
    const categoryPricing = require('./categoryPricing');
    expect(categoryPricing.resolveCleaningFeeEntry).toBeUndefined();
    expect(categoryPricing.resolveCategoryCleaningFee).toBeUndefined();
  });

  it('does not read a stored cleaningFee for any purpose', () => {
    // A profile carrying only fees resolves nothing: the fee keys are inert data.
    const privateData = {
      cleaningFee: 12,
      [CATEGORY_PRICING_KEY]: { dresses: { cleaningFee: 15 } },
    };
    expect(resolveCategoryTurnaroundDays(privateData, ['dresses'])).toBeNull();
    expect(resolveTurnaroundDaysEntry(privateData, ['dresses'])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TURNAROUND (DAYS): TOP-LEVEL CATEGORY ONLY.
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveCategoryTurnaroundDays()', () => {
  it('uses the top-level category of the chain', () => {
    expect(resolveCategoryTurnaroundDays(PRIVATE_DATA, ['dresses', 'midi_dress'])).toBe(3);
    expect(resolveCategoryTurnaroundDays(PRIVATE_DATA, ['pants'])).toBe(1);
  });

  it('reads the top level even on a three-level chain', () => {
    expect(resolveCategoryTurnaroundDays(PRIVATE_DATA, ['dresses', 'maxi_dress', 'silk'])).toBe(3);
  });

  it('NEVER reads a turnaround stored on a subcategory', () => {
    // Turnaround is "por categoría grande". A subcategory entry carrying turnaroundDays —
    // hand-written, or left behind by an earlier shape — is inert, and the top-level
    // value stands. Silently honouring it would make the availability buffer disagree
    // with what the form lets a studio configure. PRIVATE_DATA stores 1 day on
    // midi_dress precisely so this cannot pass by accident.
    expect(resolveCategoryTurnaroundDays(PRIVATE_DATA, ['dresses', 'midi_dress'])).toBe(3);
  });

  it('reads turnaroundDays, never a legacy turnaroundHours key', () => {
    // Old profiles may still carry hours. Reading them as days would turn a 48-hour
    // turnaround into a 48-DAY calendar block — the unit bug this rename exists to make
    // impossible. Hours keys are simply not a configured value.
    const privateData = {
      turnaroundHours: 48,
      [CATEGORY_PRICING_KEY]: { dresses: { turnaroundHours: 72 } },
    };
    expect(resolveCategoryTurnaroundDays(privateData, ['dresses'])).toBeNull();
  });

  it('falls back to the studio-wide value when the top-level category has no entry', () => {
    expect(resolveCategoryTurnaroundDays(PRIVATE_DATA, ['coats', 'trench'])).toBe(2);
  });

  it('falls back to the studio-wide value when only a subcategory has an entry', () => {
    const privateData = {
      turnaroundDays: 2,
      [CATEGORY_PRICING_KEY]: { midi_dress: { turnaroundDays: 5 } },
    };
    expect(resolveCategoryTurnaroundDays(privateData, ['dresses', 'midi_dress'])).toBe(2);
  });

  it('falls back to the studio-wide value when the listing has no category', () => {
    expect(resolveCategoryTurnaroundDays(PRIVATE_DATA, [])).toBe(2);
    expect(resolveCategoryTurnaroundDays(PRIVATE_DATA, undefined)).toBe(2);
  });

  it('returns null when nothing is configured at either level', () => {
    expect(resolveCategoryTurnaroundDays({}, ['dresses'])).toBeNull();
    expect(resolveCategoryTurnaroundDays(undefined, undefined)).toBeNull();
  });

  it('skips a BLANK top-level turnaround and falls back to the studio-wide value', () => {
    const privateData = {
      turnaroundDays: 2,
      [CATEGORY_PRICING_KEY]: { dresses: { turnaroundDays: null } },
    };
    expect(resolveCategoryTurnaroundDays(privateData, ['dresses'])).toBe(2);
  });

  it('treats ZERO days as unconfigured', () => {
    // A 0-day turnaround is an empty box that happened to parse, not a business
    // statement: computeBufferDays throws on anything <= 0, and availabilityHelpers'
    // resolveTurnaroundDays already rejects 0 at the studio level; this matches it.
    const privateData = {
      turnaroundDays: 2,
      [CATEGORY_PRICING_KEY]: { dresses: { turnaroundDays: 0 } },
    };
    expect(resolveCategoryTurnaroundDays(privateData, ['dresses'])).toBe(2);
    expect(resolveCategoryTurnaroundDays({ turnaroundDays: 0 }, [])).toBeNull();
  });

  it('rejects negative days', () => {
    const privateData = {
      turnaroundDays: 2,
      [CATEGORY_PRICING_KEY]: { dresses: { turnaroundDays: -3 } },
    };
    expect(resolveCategoryTurnaroundDays(privateData, ['dresses'])).toBe(2);
  });

  it('ignores a numeric STRING rather than guessing', () => {
    // The form writes numbers; anything else is treated as unconfigured. (The picker
    // cards apply a deliberately more lenient read — see laundryDirectory.js.)
    const privateData = {
      turnaroundDays: 2,
      [CATEGORY_PRICING_KEY]: { dresses: { turnaroundDays: '5' } },
    };
    expect(resolveCategoryTurnaroundDays(privateData, ['dresses'])).toBe(2);
  });

  it('tolerates a malformed entry without throwing', () => {
    const privateData = {
      turnaroundDays: 2,
      [CATEGORY_PRICING_KEY]: { dresses: 'not-an-object', pants: ['also-wrong'] },
    };
    expect(resolveCategoryTurnaroundDays(privateData, ['dresses'])).toBe(2);
    expect(resolveCategoryTurnaroundDays(privateData, ['pants'])).toBe(2);
  });

  it('ignores non-string ids in the chain', () => {
    expect(resolveCategoryTurnaroundDays(PRIVATE_DATA, [null])).toBe(2);
  });
});

describe('resolveTurnaroundDaysEntry()', () => {
  it('reports WHERE the turnaround came from, so callers can label it', () => {
    expect(resolveTurnaroundDaysEntry(PRIVATE_DATA, ['dresses', 'midi_dress'])).toEqual({
      value: 3,
      source: 'category',
      categoryId: 'dresses',
    });
    expect(resolveTurnaroundDaysEntry(PRIVATE_DATA, ['coats'])).toEqual({
      value: 2,
      source: 'studio',
      categoryId: null,
    });
    expect(resolveTurnaroundDaysEntry({}, ['coats'])).toBeNull();
  });
});
