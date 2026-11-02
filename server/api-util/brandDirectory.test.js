const { cleanBrand, brandComparisonKey, buildBrandDirectory } = require('./brandDirectory');

const listing = brand => ({ attributes: { publicData: { brand } } });

describe('cleanBrand', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanBrand('  Club   Monaco ')).toBe('Club Monaco');
  });

  // The rule the client asked about, answered by the real data rather than by preference.
  // Title case would make `Lulu'S`; lowercase would destroy `ZARA`. Clothing brands are
  // trademarks with deliberate capitalisation.
  it('never changes the case', () => {
    ['ZARA', 'agnès b.', 'H&M', "Lulu's", 'rag & bone', 'COS'].forEach(brand => {
      expect(cleanBrand(brand)).toBe(brand);
    });
  });

  it('treats an empty or non-string value as no brand', () => {
    [null, undefined, '', '   ', 42, {}, []].forEach(value => {
      expect(cleanBrand(value)).toBeNull();
    });
  });
});

describe('brandComparisonKey', () => {
  it('folds case and accents, so one brand is one option', () => {
    expect(brandComparisonKey('Belle Étoile')).toBe(brandComparisonKey('belle etoile'));
    expect(brandComparisonKey('ZARA')).toBe(brandComparisonKey('Zara'));
  });

  it('keeps genuinely different brands apart', () => {
    expect(brandComparisonKey('Reformation')).not.toBe(brandComparisonKey('Reformations'));
  });
});

describe('buildBrandDirectory', () => {
  it('returns each brand once, alphabetically', () => {
    const result = buildBrandDirectory([
      listing('Reformation'),
      listing('Club Monaco'),
      listing('Reformation'),
    ]);

    expect(result).toEqual([
      { brand: 'Club Monaco', count: 1 },
      { brand: 'Reformation', count: 2 },
    ]);
  });

  // Grouping folds case; the OUTPUT keeps a real spelling. Showing both `Zara` and `ZARA` a step
  // apart in a dropdown is exactly the mess the autocomplete is meant to end.
  it('collapses spellings of one brand and shows the most used one', () => {
    const result = buildBrandDirectory([listing('Zara'), listing('ZARA'), listing('ZARA')]);

    expect(result).toEqual([{ brand: 'ZARA', count: 3 }]);
  });

  // Otherwise the dropdown's spelling would depend on which page of listings came back first.
  it('breaks a tie alphabetically rather than by listing order', () => {
    const forwards = buildBrandDirectory([listing('ZARA'), listing('Zara')]);
    const backwards = buildBrandDirectory([listing('Zara'), listing('ZARA')]);

    expect(forwards).toEqual(backwards);
  });

  it('ignores listings with no usable brand', () => {
    const result = buildBrandDirectory([
      listing('Reformation'),
      listing(null),
      listing('  '),
      listing(42),
      {},
      null,
    ]);

    expect(result).toEqual([{ brand: 'Reformation', count: 1 }]);
  });

  // A brand somebody typed is a brand some listing is filed under. `Dres the Population` is
  // really on Dev, and hiding it would hide that listing from the filter - the fix for a typo
  // is to edit the listing, not to make the option invisible.
  it('keeps a misspelled brand rather than hiding the listings behind it', () => {
    const result = buildBrandDirectory([
      listing('Dres the Population'),
      listing('Dress the Population'),
    ]);

    expect(result.map(entry => entry.brand)).toEqual([
      'Dres the Population',
      'Dress the Population',
    ]);
  });

  it('survives a non-array', () => {
    expect(buildBrandDirectory(undefined)).toEqual([]);
    expect(buildBrandDirectory(null)).toEqual([]);
    expect(buildBrandDirectory('nope')).toEqual([]);
  });
});
