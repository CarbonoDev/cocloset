import { getListingCategoryValues } from './fieldHelpers';

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
