import {
  categoryPricingFieldName,
  categoryPricingFromFormValues,
  categoryPricingToFormValues,
  flattenCategoryTree,
  getCategoryLabels,
  getCategoryPricingGroups,
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

/* ================ Per-category laundry pricing ================ */

describe('categoryPricingFieldName', () => {
  it('builds a FLAT field name, with no dots for final-form to parse as a path', () => {
    // React Final Form reads `a.b` as a path into the values object. Console category
    // ids are operator input, so an id containing a dot in a nested field name would
    // write somewhere else entirely: the studio types a price, sees it accepted, and
    // saves nothing. The name must stay flat.
    const name = categoryPricingFieldName('cleaningFee', 'midi_dress');
    expect(name).toBe('categoryPricing__cleaningFee__midi_dress');
    expect(name).not.toContain('.');
    expect(name).not.toContain('[');
  });
});

describe('categoryPricingToFormValues', () => {
  it('flattens the stored table into form fields', () => {
    expect(
      categoryPricingToFormValues({
        dresses: { turnaroundHours: 72, cleaningFee: 15 },
        midi_dress: { cleaningFee: 22 },
      })
    ).toEqual({
      categoryPricing__turnaroundHours__dresses: 72,
      categoryPricing__cleaningFee__dresses: 15,
      categoryPricing__cleaningFee__midi_dress: 22,
    });
  });

  it('omits blanks rather than prefilling boxes with nulls', () => {
    expect(
      categoryPricingToFormValues({
        dresses: { turnaroundHours: null, cleaningFee: 15 },
        pants: { cleaningFee: 'nope' },
      })
    ).toEqual({ categoryPricing__cleaningFee__dresses: 15 });
  });

  it('tolerates a missing or malformed table', () => {
    expect(categoryPricingToFormValues(undefined)).toEqual({});
    expect(categoryPricingToFormValues(null)).toEqual({});
    expect(categoryPricingToFormValues([])).toEqual({});
    expect(categoryPricingToFormValues({ dresses: 'not-an-object' })).toEqual({});
  });

  it('round-trips through categoryPricingFromFormValues', () => {
    const stored = { dresses: { turnaroundHours: 72, cleaningFee: 15 }, silk: { cleaningFee: 30 } };
    expect(categoryPricingFromFormValues(categoryPricingToFormValues(stored))).toEqual(stored);
  });
});

describe('categoryPricingFromFormValues', () => {
  it('rebuilds the nested table and ignores every other form field', () => {
    expect(
      categoryPricingFromFormValues({
        studioName: 'Studio Pigalle',
        turnaroundHours: 48,
        cleaningFee: 10,
        acceptedCategories: ['dresses'],
        categoryPricing__turnaroundHours__dresses: 72,
        categoryPricing__cleaningFee__dresses: 15,
        categoryPricing__cleaningFee__midi_dress: 22,
      })
    ).toEqual({
      dresses: { turnaroundHours: 72, cleaningFee: 15 },
      midi_dress: { cleaningFee: 22 },
    });
  });

  it('DROPS a cleared input instead of storing a null', () => {
    // An empty box means "no specific value, use the studio-wide one", which is
    // expressed by the key being absent. Storing null would fill the table with rows
    // that mean nothing and have to be skipped on every read.
    expect(
      categoryPricingFromFormValues({
        categoryPricing__cleaningFee__dresses: null,
        categoryPricing__turnaroundHours__dresses: 72,
      })
    ).toEqual({ dresses: { turnaroundHours: 72 } });
  });

  it('emits no entry at all for a category whose every input was cleared', () => {
    expect(
      categoryPricingFromFormValues({
        categoryPricing__cleaningFee__dresses: null,
        categoryPricing__turnaroundHours__dresses: undefined,
      })
    ).toEqual({});
  });

  it('keeps an explicit zero, which is a real price ("free"), not a blank', () => {
    expect(categoryPricingFromFormValues({ categoryPricing__cleaningFee__dresses: 0 })).toEqual({
      dresses: { cleaningFee: 0 },
    });
  });

  it('ignores a field name that looks close but is not one of ours', () => {
    expect(
      categoryPricingFromFormValues({
        categoryPricing__depositAmount__dresses: 5,
        categoryPricing__cleaningFee__: 5,
        categoryPricing__cleaningFee: 5,
      })
    ).toEqual({});
  });

  it('tolerates missing values', () => {
    expect(categoryPricingFromFormValues(undefined)).toEqual({});
    expect(categoryPricingFromFormValues({})).toEqual({});
  });
});

describe('getCategoryPricingGroups', () => {
  it('groups accepted categories under their top-level branch', () => {
    expect(getCategoryPricingGroups(CATEGORY_TREE, ['dresses', 'midi_dress', 'pants'])).toEqual([
      {
        id: 'dresses',
        name: 'Dresses',
        priceCategories: [
          { id: 'dresses', name: 'Dresses', level: 1, path: ['Dresses'] },
          { id: 'midi_dress', name: 'Midi Dress', level: 2, path: ['Dresses', 'Midi Dress'] },
        ],
      },
      {
        id: 'pants',
        name: 'Pants',
        priceCategories: [{ id: 'pants', name: 'Pants', level: 1, path: ['Pants'] }],
      },
    ]);
  });

  it('still emits the top-level group when ONLY a subcategory is accepted', () => {
    // Hours are configured per top-level category, and a midi-dress listing resolves
    // its turnaround from `dresses` whether or not the studio ticked `dresses`. Without
    // the group there would be no input for the value the buffer actually reads.
    const groups = getCategoryPricingGroups(CATEGORY_TREE, ['silk']);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('dresses');
    expect(groups[0].priceCategories).toEqual([
      { id: 'silk', name: 'Silk', level: 3, path: ['Dresses', 'Maxi Dress', 'Silk'] },
    ]);
  });

  it('omits branches the studio accepts nothing in', () => {
    expect(getCategoryPricingGroups(CATEGORY_TREE, ['pants']).map(g => g.id)).toEqual(['pants']);
  });

  it('ignores pre-migration free text, which matches no category', () => {
    expect(getCategoryPricingGroups(CATEGORY_TREE, ['Eveningwear', 'Sequins'])).toEqual([]);
  });

  it('tolerates a missing tree or an empty accepted list', () => {
    expect(getCategoryPricingGroups(CATEGORY_TREE, [])).toEqual([]);
    expect(getCategoryPricingGroups(CATEGORY_TREE)).toEqual([]);
    expect(getCategoryPricingGroups(undefined, ['dresses'])).toEqual([]);
    expect(getCategoryPricingGroups(null, null)).toEqual([]);
  });
});

describe('getOrphanedPricingCategories', () => {
  it('reports stored pricing the studio can no longer see or edit', () => {
    // Values are retained, never pruned, when a category is un-ticked or leaves
    // Console. Retained-but-invisible money is how a "why are we charging that?" bug
    // survives for months, so the form has to surface it.
    expect(
      getOrphanedPricingCategories(
        { dresses: { cleaningFee: 15 }, retired_category: { cleaningFee: 40 } },
        ['dresses']
      )
    ).toEqual(['retired_category']);
  });

  it('reports nothing when every stored entry has a visible row', () => {
    expect(
      getOrphanedPricingCategories({ dresses: { cleaningFee: 15 } }, ['dresses', 'pants'])
    ).toEqual([]);
  });

  it('ignores debris that holds no actual number', () => {
    expect(
      getOrphanedPricingCategories({ empty: {}, junk: 'nope', blank: { cleaningFee: null } }, [])
    ).toEqual([]);
  });

  it('tolerates missing input', () => {
    expect(getOrphanedPricingCategories(undefined, ['dresses'])).toEqual([]);
    expect(getOrphanedPricingCategories({ dresses: { cleaningFee: 1 } })).toEqual(['dresses']);
  });
});
