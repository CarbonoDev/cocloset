import {
  categoryPricingFieldName,
  categoryPricingFromFormValues,
  categoryPricingToFormValues,
  flattenCategoryTree,
  getCategoryLabels,
  getTurnaroundCategoryIds,
  getListingCategoryValues,
  getOrphanedPricingCategories,
  isCategoryAcceptedByLaundry,
  splitAcceptedCategories,
} from './fieldHelpers';

describe('getListingCategoryValues', () => {
  // Console writes a listing's category into categoryLevel1/2/3 and never a single
  // `category` key. Code that read `publicData.category` got undefined on every listing,
  // which silently disabled the accepted-category check in the laundry assignment step —
  // no error, no warning, just a rule that never fired.
  it('reads the numbered category levels, most general first', () => {
    const publicData = {
      categoryLevel1: 'dresses',
      categoryLevel2: 'maxi_dress',
      title: 'irrelevant',
    };

    expect(getListingCategoryValues(publicData)).toEqual(['dresses', 'maxi_dress']);
  });

  it('reads all three levels when set', () => {
    const publicData = {
      categoryLevel1: 'dresses',
      categoryLevel2: 'maxi_dress',
      categoryLevel3: 'silk',
    };

    expect(getListingCategoryValues(publicData)).toEqual(['dresses', 'maxi_dress', 'silk']);
  });

  it('returns an empty array when no category is set', () => {
    expect(getListingCategoryValues({ title: 'A garment' })).toEqual([]);
  });

  it('ignores a legacy `category` key', () => {
    // Guards the original bug directly: a listing carrying the key the old code looked for
    // must still report no categories, because Console never writes it.
    expect(getListingCategoryValues({ category: 'Eveningwear' })).toEqual([]);
  });

  it('skips a gap rather than emitting a hole', () => {
    expect(getListingCategoryValues({ categoryLevel1: 'dresses', categoryLevel3: 'silk' })).toEqual(
      ['dresses', 'silk']
    );
  });

  it('drops empty strings', () => {
    expect(getListingCategoryValues({ categoryLevel1: 'dresses', categoryLevel2: '' })).toEqual([
      'dresses',
    ]);
  });

  it('tolerates missing public data', () => {
    expect(getListingCategoryValues(undefined)).toEqual([]);
    expect(getListingCategoryValues(null)).toEqual([]);
  });
});

// The tree Console delivers, exercising every shape it produces in practice: a branch
// with children, a child whose own `subcategories` key is absent, a child with an
// explicitly empty array, three levels of nesting, and a childless top-level category.
const CATEGORY_TREE = [
  {
    name: 'Dresses',
    id: 'dresses',
    subcategories: [
      {
        name: 'Maxi Dress',
        id: 'maxi_dress',
        subcategories: [{ name: 'Silk', id: 'silk', subcategories: [] }],
      },
      { name: 'Midi Dress', id: 'midi_dress' },
    ],
  },
  { name: 'Pants', id: 'pants', subcategories: [] },
];

describe('flattenCategoryTree', () => {
  it('walks the tree depth-first, recording level and ancestor names', () => {
    expect(flattenCategoryTree(CATEGORY_TREE)).toEqual([
      { id: 'dresses', name: 'Dresses', level: 1, path: ['Dresses'], hasSubcategories: true },
      {
        id: 'maxi_dress',
        name: 'Maxi Dress',
        level: 2,
        path: ['Dresses', 'Maxi Dress'],
        hasSubcategories: true,
      },
      {
        id: 'silk',
        name: 'Silk',
        level: 3,
        path: ['Dresses', 'Maxi Dress', 'Silk'],
        hasSubcategories: false,
      },
      {
        id: 'midi_dress',
        name: 'Midi Dress',
        level: 2,
        path: ['Dresses', 'Midi Dress'],
        hasSubcategories: false,
      },
      { id: 'pants', name: 'Pants', level: 1, path: ['Pants'], hasSubcategories: false },
    ]);
  });

  it('tolerates an absent, empty or malformed tree', () => {
    expect(flattenCategoryTree()).toEqual([]);
    expect(flattenCategoryTree([])).toEqual([]);
    expect(flattenCategoryTree(null)).toEqual([]);
    expect(flattenCategoryTree({ id: 'not-an-array' })).toEqual([]);
  });

  it('falls back to the id when a node has no name', () => {
    expect(flattenCategoryTree([{ id: 'orphan' }])[0].name).toBe('orphan');
  });
});

describe('getCategoryLabels', () => {
  it('turns Console ids into the names an operator configured', () => {
    expect(getCategoryLabels(CATEGORY_TREE, ['dresses', 'midi_dress'])).toEqual([
      'Dresses',
      'Midi Dress',
    ]);
  });

  it('renders the full branch when asked', () => {
    expect(getCategoryLabels(CATEGORY_TREE, ['silk'], { withPath: true })).toEqual([
      'Dresses › Maxi Dress › Silk',
    ]);
  });

  // Free text stored before the multi-select existed already reads as a label.
  it('passes unrecognised values through unchanged', () => {
    expect(getCategoryLabels(CATEGORY_TREE, ['Eveningwear', 'pants'])).toEqual([
      'Eveningwear',
      'Pants',
    ]);
  });

  it('tolerates missing input', () => {
    expect(getCategoryLabels(CATEGORY_TREE)).toEqual([]);
    expect(getCategoryLabels(undefined, ['dresses'])).toEqual(['dresses']);
  });
});

describe('splitAcceptedCategories', () => {
  it('separates configured ids from pre-migration free text', () => {
    expect(
      splitAcceptedCategories(CATEGORY_TREE, ['dresses', 'Eveningwear', 'silk', 'Sequins'])
    ).toEqual({ known: ['dresses', 'silk'], legacy: ['Eveningwear', 'Sequins'] });
  });

  it('drops blanks and non-strings rather than storing them', () => {
    expect(splitAcceptedCategories(CATEGORY_TREE, ['', '   ', null, 42, 'pants'])).toEqual({
      known: ['pants'],
      legacy: [],
    });
  });

  it('tolerates missing input', () => {
    expect(splitAcceptedCategories(CATEGORY_TREE)).toEqual({ known: [], legacy: [] });
    expect(splitAcceptedCategories(CATEGORY_TREE, null)).toEqual({ known: [], legacy: [] });
  });
});

describe('isCategoryAcceptedByLaundry', () => {
  // THE HIERARCHY RULE: a match on any level of the listing's chain counts.
  it('accepts a subcategory listing when the laundry accepted its parent', () => {
    expect(isCategoryAcceptedByLaundry(['dresses', 'midi_dress'], ['dresses'])).toBe(true);
  });

  it('accepts a listing when the laundry accepted the exact leaf', () => {
    expect(isCategoryAcceptedByLaundry(['dresses', 'midi_dress'], ['midi_dress'])).toBe(true);
  });

  it('accepts a three-level listing on a top-level match', () => {
    expect(isCategoryAcceptedByLaundry(['dresses', 'maxi_dress', 'silk'], ['dresses'])).toBe(true);
  });

  // The converse does NOT hold: accepting one child says nothing about its siblings or
  // about garments filed only at the parent level.
  it('rejects a sibling subcategory', () => {
    expect(isCategoryAcceptedByLaundry(['dresses', 'maxi_dress'], ['midi_dress'])).toBe(false);
  });

  it('rejects an unrelated branch', () => {
    expect(isCategoryAcceptedByLaundry(['pants'], ['dresses', 'midi_dress'])).toBe(false);
  });

  // Ids vs labels was the whole bug: "Eveningwear" can never equal a Console id, and
  // that mismatch must read as "not accepted" rather than as a crash.
  it('never matches pre-migration free text against ids', () => {
    expect(isCategoryAcceptedByLaundry(['dresses'], ['Eveningwear', 'Sequins'])).toBe(false);
  });

  // Silence on either side is not a mismatch — don't warn a garment owner about a
  // laundry that simply hasn't configured its list yet.
  it('treats an empty list on either side as no objection', () => {
    expect(isCategoryAcceptedByLaundry([], ['dresses'])).toBe(true);
    expect(isCategoryAcceptedByLaundry(['dresses'], [])).toBe(true);
    expect(isCategoryAcceptedByLaundry()).toBe(true);
  });
});

/* ================ Per-category laundry turnaround ================ */

describe('categoryPricingFieldName', () => {
  it('builds a FLAT field name, with no dots for final-form to parse as a path', () => {
    // React Final Form reads `a.b` as a path into the values object. Console category
    // ids are operator input, so an id containing a dot in a nested field name would
    // write somewhere else entirely: the studio types a price, sees it accepted, and
    // saves nothing. The name must stay flat.
    const name = categoryPricingFieldName('turnaroundDays', 'midi_dress');
    expect(name).toBe('categoryPricing__turnaroundDays__midi_dress');
    expect(name).not.toContain('.');
    expect(name).not.toContain('[');
  });
});

describe('categoryPricingToFormValues', () => {
  it('flattens the stored table into form fields', () => {
    expect(
      categoryPricingToFormValues({
        dresses: { turnaroundDays: 3 },
        pants: { turnaroundDays: 1 },
      })
    ).toEqual({
      categoryPricing__turnaroundDays__dresses: 3,
      categoryPricing__turnaroundDays__pants: 1,
    });
  });

  it('omits a stored cleaningFee, which is no longer a form field', () => {
    // Fees are env configuration now. An old profile can still be carrying fee rows, and
    // seeding them into the form would resurrect them on the next save.
    expect(
      categoryPricingToFormValues({
        dresses: { turnaroundDays: 3, cleaningFee: 15 },
        midi_dress: { cleaningFee: 22 },
      })
    ).toEqual({ categoryPricing__turnaroundDays__dresses: 3 });
  });

  it('omits blanks rather than prefilling boxes with nulls', () => {
    expect(
      categoryPricingToFormValues({
        dresses: { turnaroundDays: null },
        pants: { turnaroundDays: 'nope' },
        tops: { turnaroundDays: 1 },
      })
    ).toEqual({ categoryPricing__turnaroundDays__tops: 1 });
  });

  it('tolerates a missing or malformed table', () => {
    expect(categoryPricingToFormValues(undefined)).toEqual({});
    expect(categoryPricingToFormValues(null)).toEqual({});
    expect(categoryPricingToFormValues([])).toEqual({});
    expect(categoryPricingToFormValues({ dresses: 'not-an-object' })).toEqual({});
  });

  it('round-trips through categoryPricingFromFormValues', () => {
    const stored = { dresses: { turnaroundDays: 3 }, pants: { turnaroundDays: 1 } };
    expect(categoryPricingFromFormValues(categoryPricingToFormValues(stored))).toEqual(stored);
  });
});

describe('categoryPricingFromFormValues', () => {
  it('rebuilds the nested table and ignores every other form field', () => {
    expect(
      categoryPricingFromFormValues({
        studioName: 'Studio Pigalle',
        turnaroundDays: 2,
        acceptedCategories: ['dresses'],
        categoryPricing__turnaroundDays__dresses: 3,
        categoryPricing__turnaroundDays__pants: 1,
      })
    ).toEqual({
      dresses: { turnaroundDays: 3 },
      pants: { turnaroundDays: 1 },
    });
  });

  it('DROPS a cleared input instead of storing a null', () => {
    // An empty box means "no specific value, use the studio-wide one", which is
    // expressed by the key being absent. Storing null would fill the table with rows
    // that mean nothing and have to be skipped on every read.
    expect(
      categoryPricingFromFormValues({
        categoryPricing__turnaroundDays__dresses: null,
        categoryPricing__turnaroundDays__pants: 1,
      })
    ).toEqual({ pants: { turnaroundDays: 1 } });
  });

  it('emits no entry at all for a category whose input was cleared', () => {
    expect(
      categoryPricingFromFormValues({
        categoryPricing__turnaroundDays__dresses: null,
        categoryPricing__turnaroundDays__pants: undefined,
      })
    ).toEqual({});
  });

  it('never rebuilds a cleaningFee out of a leftover form value', () => {
    // The fee is not a form field any more, so a stray value under the old name must not
    // be written back into storage where the server would once have read it.
    expect(
      categoryPricingFromFormValues({
        categoryPricing__cleaningFee__dresses: 15,
        categoryPricing__turnaroundDays__dresses: 3,
      })
    ).toEqual({ dresses: { turnaroundDays: 3 } });
  });

  it('ignores a field name that looks close but is not one of ours', () => {
    expect(
      categoryPricingFromFormValues({
        categoryPricing__depositAmount__dresses: 5,
        categoryPricing__turnaroundDays__: 5,
        categoryPricing__turnaroundDays: 5,
      })
    ).toEqual({});
  });

  it('tolerates missing values', () => {
    expect(categoryPricingFromFormValues(undefined)).toEqual({});
    expect(categoryPricingFromFormValues({})).toEqual({});
  });
});

describe('getTurnaroundCategoryIds', () => {
  it('returns the top-level branch of every accepted category, in Console order', () => {
    expect(getTurnaroundCategoryIds(CATEGORY_TREE, ['dresses', 'midi_dress', 'pants'])).toEqual([
      'dresses',
      'pants',
    ]);
  });

  it('returns each branch once, however many of its members are accepted', () => {
    expect(getTurnaroundCategoryIds(CATEGORY_TREE, ['dresses', 'maxi_dress', 'silk'])).toEqual([
      'dresses',
    ]);
  });

  it('still returns the top-level id when ONLY a deep subcategory is accepted', () => {
    // Turnaround is configured per top-level category, and a silk-maxi-dress listing
    // resolves it from `dresses` whether or not the studio ticked `dresses`. Without this
    // there would be no input for the value the availability buffer actually reads.
    expect(getTurnaroundCategoryIds(CATEGORY_TREE, ['silk'])).toEqual(['dresses']);
  });

  it('omits branches the studio accepts nothing in', () => {
    expect(getTurnaroundCategoryIds(CATEGORY_TREE, ['pants'])).toEqual(['pants']);
  });

  it('never returns a SUBcategory id, which would render an input nothing reads', () => {
    const ids = getTurnaroundCategoryIds(CATEGORY_TREE, ['midi_dress', 'silk']);
    expect(ids).not.toContain('midi_dress');
    expect(ids).not.toContain('silk');
  });

  it('ignores pre-migration free text, which matches no category', () => {
    expect(getTurnaroundCategoryIds(CATEGORY_TREE, ['Eveningwear', 'Sequins'])).toEqual([]);
  });

  it('tolerates a missing tree or an empty accepted list', () => {
    expect(getTurnaroundCategoryIds(CATEGORY_TREE, [])).toEqual([]);
    expect(getTurnaroundCategoryIds(CATEGORY_TREE)).toEqual([]);
    expect(getTurnaroundCategoryIds(undefined, ['dresses'])).toEqual([]);
    expect(getTurnaroundCategoryIds(null, null)).toEqual([]);
  });
});

describe('getOrphanedPricingCategories', () => {
  it('reports stored pricing the studio can no longer see or edit', () => {
    // Values are retained, never pruned, when a category is un-ticked or leaves
    // Console. A retained-but-invisible turnaround is how a studio ends up blocking its
    // calendar for a reason nobody can locate, so the form has to surface it.
    expect(
      getOrphanedPricingCategories(
        { dresses: { turnaroundDays: 3 }, retired_category: { turnaroundDays: 4 } },
        ['dresses']
      )
    ).toEqual(['retired_category']);
  });

  it('reports nothing when every stored entry has a visible row', () => {
    expect(
      getOrphanedPricingCategories({ dresses: { turnaroundDays: 3 } }, ['dresses', 'pants'])
    ).toEqual([]);
  });

  it('ignores an entry holding only a legacy cleaningFee', () => {
    // A fee row is dead data, not configuration the studio can act on: surfacing it would
    // offer a "clear this" control for a value nothing reads.
    expect(getOrphanedPricingCategories({ midi_dress: { cleaningFee: 22 } }, [])).toEqual([]);
  });

  it('ignores debris that holds no actual number', () => {
    expect(
      getOrphanedPricingCategories({ empty: {}, junk: 'nope', blank: { turnaroundDays: null } }, [])
    ).toEqual([]);
  });

  it('tolerates missing input', () => {
    expect(getOrphanedPricingCategories(undefined, ['dresses'])).toEqual([]);
    expect(getOrphanedPricingCategories({ dresses: { turnaroundDays: 1 } })).toEqual(['dresses']);
  });
});
