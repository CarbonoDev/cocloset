import {
  flattenCategoryTree,
  getCategoryLabels,
  getListingCategoryValues,
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
