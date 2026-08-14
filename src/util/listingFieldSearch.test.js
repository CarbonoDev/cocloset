import { isSearchableListingField, listingFieldSearchParams } from './listingFieldSearch';

// The client asked for the brand to link to a filtered search, and said outright that the
// field may change shape:
//
//   > "por ahora es un texto libre pero puede cambiar a multiselect, considera ambos"
//
// So the point of these tests is that the query is derived from the field's CONFIG. The day
// `brand` becomes a multi-select in Console the link has to start filtering properly with no
// code change, and the day it is an enum with no search schema pushed it has to NOT pretend
// to filter.

const field = (schemaType, indexForSearch) => ({
  key: 'brand',
  schemaType,
  filterConfig: { indexForSearch },
});

describe('listingFieldSearchParams', () => {
  it('filters on an indexed enum', () => {
    expect(listingFieldSearchParams(field('enum', true), 'Galvan')).toEqual({
      pub_brand: 'Galvan',
    });
  });

  it('uses has_any for an indexed multi-enum', () => {
    // A bare value is read as "has_all" by some filters and would match nothing.
    expect(listingFieldSearchParams(field('multi-enum', true), 'Galvan')).toEqual({
      pub_brand: 'has_any:Galvan',
    });
  });

  it('falls back to a keyword search for free text', () => {
    // Sharetribe cannot filter an unindexed text key at all: `pub_brand=` would be IGNORED
    // and the customer would get the whole marketplace, which reads as a broken link.
    expect(listingFieldSearchParams(field('text', false), 'Galvan')).toEqual({
      keywords: 'Galvan',
    });
  });

  it('falls back to keywords for an enum with no search schema pushed', () => {
    // Being an enum is not the same as being filterable - the schema has to exist
    // (`flex-cli search`), and an absent one fails OPEN. A keyword search that finds roughly
    // the right listings beats a filter that quietly finds everything.
    expect(listingFieldSearchParams(field('enum', false), 'Galvan')).toEqual({
      keywords: 'Galvan',
    });
  });

  it('trims the value, since it becomes a URL', () => {
    expect(listingFieldSearchParams(field('text', false), '  Galvan  ')).toEqual({
      keywords: 'Galvan',
    });
  });

  it.each([
    ['an empty string', ''],
    ['whitespace', '   '],
    ['undefined', undefined],
    ['null', null],
  ])('returns null for %s rather than linking to an empty search', (_label, value) => {
    expect(listingFieldSearchParams(field('text', false), value)).toBeNull();
  });

  it('returns null for a value that is not a single scalar', () => {
    // A listing holding several multi-enum values has no ONE thing the reader clicked.
    expect(listingFieldSearchParams(field('multi-enum', true), ['a', 'b'])).toBeNull();
  });

  it('returns null rather than throwing without a config', () => {
    expect(listingFieldSearchParams(undefined, 'Galvan')).toBeNull();
    expect(listingFieldSearchParams({}, 'Galvan')).toBeNull();
  });
});

describe('isSearchableListingField', () => {
  it('covers the brand', () => {
    expect(isSearchableListingField('brand')).toBe(true);
  });

  it('leaves other fields alone', () => {
    // Most values are not worth browsing by - a size or a retail value clicking through to a
    // search would be noise.
    ['size', 'retailValue', 'color', undefined].forEach(key => {
      expect(isSearchableListingField(key)).toBe(false);
    });
  });
});
