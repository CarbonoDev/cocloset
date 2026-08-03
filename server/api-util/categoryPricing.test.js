const {
  CATEGORY_LEVEL_KEYS,
  CATEGORY_PRICING_KEY,
  getListingCategoryValues,
  getCategoryPricingTable,
  resolveCleaningFeeEntry,
  resolveTurnaroundHoursEntry,
  resolveCategoryCleaningFee,
  resolveCategoryTurnaroundHours,
} = require('./categoryPricing');

// A studio with a studio-wide fallback plus per-category entries. Note the deliberate
// shapes: `midi_dress` prices without hours (hours are top-level only, so an hours key
// on a subcategory would simply never be read), and `silk` prices a third level.
const PRIVATE_DATA = {
  turnaroundHours: 48,
  cleaningFee: 10,
  [CATEGORY_PRICING_KEY]: {
    dresses: { turnaroundHours: 72, cleaningFee: 15 },
    midi_dress: { cleaningFee: 22 },
    silk: { cleaningFee: 30 },
    pants: { turnaroundHours: 24, cleaningFee: 6 },
  },
};

describe('CATEGORY_LEVEL_KEYS', () => {
  // This list is duplicated from src/util/fieldHelpers.js because src is ESM and this
  // module is CommonJS run untranspiled by node. Pin it explicitly: if Console grows a
  // fourth level and only one copy is updated, per-category pricing would silently
  // resolve one level short of the listing's real category. Changing this test should
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
    expect(getCategoryPricingTable(PRIVATE_DATA).dresses).toEqual({
      turnaroundHours: 72,
      cleaningFee: 15,
    });
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
// PRICE: HIGHEST MATCHING CATEGORY WINS.
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveCategoryCleaningFee()', () => {
  it('uses an exact leaf match', () => {
    // Only one level of the chain prices this: 22 on midi_dress vs 15 on dresses, and
    // 22 is also the higher of the two.
    expect(resolveCategoryCleaningFee(PRIVATE_DATA, ['dresses', 'midi_dress'])).toBe(22);
  });

  it('uses a parent match when the leaf has no entry at all', () => {
    // maxi_dress is not in the table; the parent `dresses` is. A price on the parent
    // covers its whole branch, mirroring how accepting a parent accepts the branch.
    expect(resolveCategoryCleaningFee(PRIVATE_DATA, ['dresses', 'maxi_dress'])).toBe(15);
  });

  it('takes the HIGHEST of several matching levels, not the deepest', () => {
    // THE RULE, stated by the client as "utilizaría el precio mas alto".
    // dresses = 15, maxi_dress = 18, silk = 30 -> 30. This example is ascending, so it
    // passes under a most-specific-wins rule too and proves nothing on its own; the
    // next test is the one that actually distinguishes them.
    const privateData = {
      cleaningFee: 10,
      [CATEGORY_PRICING_KEY]: {
        dresses: { cleaningFee: 15 },
        maxi_dress: { cleaningFee: 18 },
        silk: { cleaningFee: 30 },
      },
    };
    expect(resolveCategoryCleaningFee(privateData, ['dresses', 'maxi_dress', 'silk'])).toBe(30);
  });

  it('takes the PARENT price when the deeper category is CHEAPER', () => {
    // This is the test that separates "highest wins" from "most specific wins".
    // The client's own example: 10 on `dresses`, 8 on `midi_dress` -> charge 10.
    // A most-specific-wins implementation returns 8 here and fails.
    const privateData = {
      cleaningFee: 4,
      [CATEGORY_PRICING_KEY]: {
        dresses: { cleaningFee: 10 },
        midi_dress: { cleaningFee: 8 },
      },
    };
    expect(resolveCategoryCleaningFee(privateData, ['dresses', 'midi_dress'])).toBe(10);
  });

  it('takes the highest across three levels when the middle one is the maximum', () => {
    // Neither the shallowest nor the deepest wins — only a real max does.
    const privateData = {
      [CATEGORY_PRICING_KEY]: {
        dresses: { cleaningFee: 12 },
        maxi_dress: { cleaningFee: 40 },
        silk: { cleaningFee: 9 },
      },
    };
    expect(resolveCategoryCleaningFee(privateData, ['dresses', 'maxi_dress', 'silk'])).toBe(40);
  });

  it('falls back to the studio-wide value when no level in the chain matches', () => {
    expect(resolveCategoryCleaningFee(PRIVATE_DATA, ['coats', 'trench'])).toBe(10);
  });

  it('falls back to the studio-wide value when the listing has no category at all', () => {
    expect(resolveCategoryCleaningFee(PRIVATE_DATA, [])).toBe(10);
    expect(resolveCategoryCleaningFee(PRIVATE_DATA, undefined)).toBe(10);
  });

  it('does NOT let the studio-wide value compete in the max', () => {
    // The studio-wide number is a fallback for "no category priced this", not a floor.
    // A studio-wide 20 with a matching category entry of 8 charges 8.
    const privateData = {
      cleaningFee: 20,
      [CATEGORY_PRICING_KEY]: { midi_dress: { cleaningFee: 8 } },
    };
    expect(resolveCategoryCleaningFee(privateData, ['dresses', 'midi_dress'])).toBe(8);
  });

  it('returns null (caller applies the env default) when nothing is configured anywhere', () => {
    expect(resolveCategoryCleaningFee({}, ['dresses'])).toBeNull();
    expect(resolveCategoryCleaningFee(undefined, ['dresses'])).toBeNull();
    expect(
      resolveCategoryCleaningFee({ [CATEGORY_PRICING_KEY]: { pants: {} } }, ['pants'])
    ).toBeNull();
  });

  it('skips a category entry whose fee is BLANK and keeps considering the rest', () => {
    // A row the studio opened in the form and never filled in must not count as a
    // match, and must not suppress a real price set elsewhere in the chain.
    ['', '   ', null, undefined, NaN, 'free', {}].forEach(blank => {
      const privateData = {
        cleaningFee: 3,
        [CATEGORY_PRICING_KEY]: {
          dresses: { cleaningFee: 15 },
          midi_dress: { cleaningFee: blank },
        },
      };
      expect(resolveCategoryCleaningFee(privateData, ['dresses', 'midi_dress'])).toBe(15);
    });
  });

  it('falls through to the studio-wide value when the ONLY matching entry is blank', () => {
    const privateData = {
      cleaningFee: 7,
      [CATEGORY_PRICING_KEY]: { midi_dress: { cleaningFee: null } },
    };
    expect(resolveCategoryCleaningFee(privateData, ['dresses', 'midi_dress'])).toBe(7);
  });

  it('treats an explicit ZERO as a configured price — free, not blank', () => {
    // Zero has meant "this studio does not charge" for the studio-wide fee since it
    // existed, so it stays expressible per category. Note the interaction with the max
    // rule: a 0 only actually wins when no OTHER matching level prices the garment
    // higher (see the next test).
    const privateData = {
      cleaningFee: 10,
      [CATEGORY_PRICING_KEY]: { midi_dress: { cleaningFee: 0 } },
    };
    expect(resolveCategoryCleaningFee(privateData, ['dresses', 'midi_dress'])).toBe(0);
  });

  it('lets a priced parent beat a zeroed child, because highest wins', () => {
    // Documented consequence of the max rule, not an accident: "free for midi dresses"
    // cannot override a paid parent. Clear the parent's price to make it free.
    const privateData = {
      [CATEGORY_PRICING_KEY]: {
        dresses: { cleaningFee: 15 },
        midi_dress: { cleaningFee: 0 },
      },
    };
    expect(resolveCategoryCleaningFee(privateData, ['dresses', 'midi_dress'])).toBe(15);
  });

  it('rejects a NEGATIVE fee as a data error, not a discount', () => {
    const privateData = {
      cleaningFee: 10,
      [CATEGORY_PRICING_KEY]: { midi_dress: { cleaningFee: -5 } },
    };
    expect(resolveCategoryCleaningFee(privateData, ['dresses', 'midi_dress'])).toBe(10);
  });

  it('ignores a numeric STRING rather than guessing at real money', () => {
    // parseFloat('12,50') === 12 — charging 12.00 instead of 12.50 with no error
    // anywhere is worse than falling back to a value someone can see and reason about.
    // The form writes numbers; anything else is treated as unconfigured.
    const privateData = {
      cleaningFee: 10,
      [CATEGORY_PRICING_KEY]: { midi_dress: { cleaningFee: '22.50' } },
    };
    expect(resolveCategoryCleaningFee(privateData, ['dresses', 'midi_dress'])).toBe(10);
  });

  it('tolerates a malformed entry without throwing', () => {
    const privateData = {
      cleaningFee: 10,
      [CATEGORY_PRICING_KEY]: { midi_dress: 'not-an-object', dresses: ['also-wrong'] },
    };
    expect(resolveCategoryCleaningFee(privateData, ['dresses', 'midi_dress'])).toBe(10);
  });

  it('ignores non-string ids in the chain', () => {
    expect(resolveCategoryCleaningFee(PRIVATE_DATA, [null, '', 'midi_dress'])).toBe(22);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HOURS: TOP-LEVEL CATEGORY ONLY.
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveCategoryTurnaroundHours()', () => {
  it('uses the top-level category of the chain', () => {
    expect(resolveCategoryTurnaroundHours(PRIVATE_DATA, ['dresses', 'midi_dress'])).toBe(72);
    expect(resolveCategoryTurnaroundHours(PRIVATE_DATA, ['pants'])).toBe(24);
  });

  it('reads the top level even on a three-level chain', () => {
    expect(resolveCategoryTurnaroundHours(PRIVATE_DATA, ['dresses', 'maxi_dress', 'silk'])).toBe(
      72
    );
  });

  it('NEVER reads an hours value stored on a subcategory', () => {
    // Hours are "por categoría grande". A subcategory entry carrying turnaroundHours —
    // hand-written, or left behind by an earlier shape — is inert, and the top-level
    // value stands. Silently honouring it would make the availability buffer disagree
    // with what the form lets a studio configure.
    const privateData = {
      turnaroundHours: 48,
      [CATEGORY_PRICING_KEY]: {
        dresses: { turnaroundHours: 72 },
        midi_dress: { turnaroundHours: 6 },
      },
    };
    expect(resolveCategoryTurnaroundHours(privateData, ['dresses', 'midi_dress'])).toBe(72);
  });

  it('falls back to the studio-wide value when the top-level category has no entry', () => {
    expect(resolveCategoryTurnaroundHours(PRIVATE_DATA, ['coats', 'trench'])).toBe(48);
  });

  it('falls back to the studio-wide value when a subcategory is priced but the parent is not', () => {
    // `midi_dress` sets a fee only. Hours come from the studio, because `dresses` has
    // no entry — a fee entry on a child says nothing about scheduling.
    const privateData = {
      turnaroundHours: 48,
      [CATEGORY_PRICING_KEY]: { midi_dress: { cleaningFee: 22 } },
    };
    expect(resolveCategoryTurnaroundHours(privateData, ['dresses', 'midi_dress'])).toBe(48);
  });

  it('falls back to the studio-wide value when the listing has no category', () => {
    expect(resolveCategoryTurnaroundHours(PRIVATE_DATA, [])).toBe(48);
    expect(resolveCategoryTurnaroundHours(PRIVATE_DATA, undefined)).toBe(48);
  });

  it('returns null when nothing is configured at either level', () => {
    expect(resolveCategoryTurnaroundHours({}, ['dresses'])).toBeNull();
    expect(resolveCategoryTurnaroundHours(undefined, undefined)).toBeNull();
  });

  it('skips a BLANK top-level turnaround and falls back to the studio-wide value', () => {
    const privateData = {
      turnaroundHours: 48,
      [CATEGORY_PRICING_KEY]: { dresses: { turnaroundHours: null, cleaningFee: 15 } },
    };
    expect(resolveCategoryTurnaroundHours(privateData, ['dresses'])).toBe(48);
  });

  it('treats ZERO hours as unconfigured — unlike a zero fee', () => {
    // The asymmetry is intentional and load-bearing. A 0 fee is a business statement
    // ("free"); a 0-hour turnaround is an empty box that happened to parse, and
    // computeBufferDays throws on anything <= 0. availabilityHelpers'
    // resolveTurnaroundHours already rejects 0 at the studio level; this matches it.
    const privateData = {
      turnaroundHours: 48,
      [CATEGORY_PRICING_KEY]: { dresses: { turnaroundHours: 0 } },
    };
    expect(resolveCategoryTurnaroundHours(privateData, ['dresses'])).toBe(48);
    expect(resolveCategoryTurnaroundHours({ turnaroundHours: 0 }, [])).toBeNull();
  });

  it('rejects negative hours', () => {
    const privateData = {
      turnaroundHours: 48,
      [CATEGORY_PRICING_KEY]: { dresses: { turnaroundHours: -12 } },
    };
    expect(resolveCategoryTurnaroundHours(privateData, ['dresses'])).toBe(48);
  });
});

describe('the entry-returning variants', () => {
  it('report WHERE the fee came from, so callers can label it', () => {
    expect(resolveCleaningFeeEntry(PRIVATE_DATA, ['dresses', 'midi_dress'])).toEqual({
      value: 22,
      source: 'category',
      categoryId: 'midi_dress',
    });
    expect(resolveCleaningFeeEntry(PRIVATE_DATA, ['coats'])).toEqual({
      value: 10,
      source: 'studio',
      categoryId: null,
    });
    expect(resolveCleaningFeeEntry({}, ['coats'])).toBeNull();
  });

  it('name the category that supplied the WINNING (highest) fee, not the deepest', () => {
    const privateData = {
      [CATEGORY_PRICING_KEY]: {
        dresses: { cleaningFee: 10 },
        midi_dress: { cleaningFee: 8 },
      },
    };
    expect(resolveCleaningFeeEntry(privateData, ['dresses', 'midi_dress'])).toEqual({
      value: 10,
      source: 'category',
      categoryId: 'dresses',
    });
  });

  it('report WHERE the turnaround came from', () => {
    expect(resolveTurnaroundHoursEntry(PRIVATE_DATA, ['dresses', 'midi_dress'])).toEqual({
      value: 72,
      source: 'category',
      categoryId: 'dresses',
    });
    expect(resolveTurnaroundHoursEntry(PRIVATE_DATA, ['coats'])).toEqual({
      value: 48,
      source: 'studio',
      categoryId: null,
    });
    expect(resolveTurnaroundHoursEntry({}, ['coats'])).toBeNull();
  });

  it('resolve the two fields INDEPENDENTLY for the same listing', () => {
    // The same request takes its fee from the subcategory and its hours from the top
    // level. Resolving them together (one "winning entry" for both) would be wrong.
    const fee = resolveCleaningFeeEntry(PRIVATE_DATA, ['dresses', 'midi_dress']);
    const hours = resolveTurnaroundHoursEntry(PRIVATE_DATA, ['dresses', 'midi_dress']);
    expect(fee.categoryId).toBe('midi_dress');
    expect(hours.categoryId).toBe('dresses');
  });
});
