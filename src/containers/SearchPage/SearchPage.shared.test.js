import {
  withNeighborhoodFilter,
  omitLimitedListingFieldParams,
  validURLParamForExtendedData,
  validFilterParams,
  validUrlQueryParamsFromProps,
  initialValues,
  cleanSearchFromConflictingParams,
  pickSearchParamsOnly,
  searchParamsPicker,
  groupListingFieldConfigs,
  getDerivedRenderData,
  withBrandFilter,
  withLaundryPickupFilter,
  onResetAll,
} from './SearchPage.shared.js';

const urlParams = {
  pub_generalParam: 'one',
  pub_generalMultienum: 'towels,bathroom',
};

const listingFieldsConfig = [
  {
    key: 'generalParam',
    scope: 'public',
    schemaType: 'enum',
    enumOptions: [
      { option: 'one', label: 'One' },
      { option: 'two', label: 'Two' },
      { option: 'three', label: 'Three' },
    ],
    filterConfig: {
      showFilter: true,
      label: 'General information',
      group: 'primary',
    },
  },
  {
    key: 'rider',
    scope: 'public',
    listingTypeConfig: {
      limitToListingTypeIds: true,
      listingTypeIds: ['sell-bicycles'],
    },
    schemaType: 'enum',
    enumOptions: [
      { option: 'men', label: 'Men' },
      { option: 'women', label: 'Women' },
      { option: 'kids', label: 'Kids' },
    ],
    filterConfig: {
      showFilter: true,
      label: 'Bicycle rider',
      group: 'primary',
    },
  },
  {
    key: 'param1',
    scope: 'public',
    listingTypeConfig: {
      limitToListingTypeIds: true,
      listingTypeIds: ['sell-bicycles'],
    },
    schemaType: 'enum',
    enumOptions: [{ option: 'smoke', label: 'Smoke' }, { option: 'wood', label: 'Wood' }],
    filterConfig: {
      showFilter: true,
      label: 'Test',
      group: 'secondary',
    },
  },
  {
    key: 'amenities',
    scope: 'public',
    listingTypeConfig: {
      limitToListingTypeIds: true,
      listingTypeIds: ['rent-bicycles-daily', 'rent-bicycles-nightly', 'rent-bicycles-hourly'],
    },
    schemaType: 'multi-enum',
    enumOptions: [{ option: 'towels', label: 'Towels' }, { option: 'bathroom', label: 'Bathroom' }],
    filterConfig: {
      showFilter: true,
      label: 'Amenities',
      //searchMode: 'has_all',
      group: 'secondary',
    },
  },
  {
    key: 'generalMultienum',
    scope: 'public',
    schemaType: 'multi-enum',
    enumOptions: [{ option: 'towels', label: 'Towels' }, { option: 'bathroom', label: 'Bathroom' }],
    filterConfig: {
      showFilter: true,
      label: 'Generic multi-enum',
      //searchMode: 'has_all',
      group: 'secondary',
    },
  },
  {
    key: 'cat',
    scope: 'public',
    listingTypeConfig: {
      limitToListingTypeIds: true,
      listingTypeIds: ['sell-bicycles'],
    },
    categoryConfig: {
      limitToCategoryIds: true,
      categoryIds: ['a'],
    },
    schemaType: 'enum',
    enumOptions: [
      { option: 'cat1', label: 'C1' },
      { option: 'cat2', label: 'C2' },
      { option: 'cat3', label: 'C3' },
    ],
    filterConfig: {
      showFilter: true,
      label: 'Cat',
      group: 'primary',
    },
  },
];

const activeListingTypes = [
  'sell-bicycles',
  'rent-bicycles-daily',
  'rent-bicycles-nightly',
  'rent-bicycles-hourly',
];

const listingTypesConfig = activeListingTypes.map(lt => ({
  id: lt,
  label: lt,
}));

const defaultFiltersConfig = [
  {
    key: 'categoryLevel',
    schemaType: 'category',
    scope: 'public',
    isNestedEnum: false,
    nestedParams: ['categoryLevel'],
  },
  {
    key: 'price',
    schemaType: 'price',
    label: 'Price',
    // Note: unlike most prices this is not handled in subunits
    min: 0,
    max: 1000,
    step: 5,
  },
  {
    key: 'keywords',
    schemaType: 'text',
    label: 'Keyword',
  },
  {
    key: 'listingType',
    schemaType: 'listingType',
    label: 'Listing type',
  },
];

const listingCategories = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
  { id: 'd', name: 'D' },
  { id: 'e', name: 'E' },
  { id: 'f', name: 'F' },
];

const filterConfigs = {
  listingFieldsConfig,
  defaultFiltersConfig,
  listingCategories,
  activeListingTypes,
};

const sortConfig = {
  active: true,
  queryParamName: 'sort',
  relevanceKey: 'relevance',
  conflictingFilters: ['keywords'],
  options: [
    { key: 'createdAt', label: 'Newest' },
    { key: '-createdAt', label: 'Oldest' },
    { key: '-price', label: 'Lowest price' },
    { key: 'price', label: 'Highest price' },
    { key: 'relevance', label: 'Relevance', longLabel: 'Relevance (Keyword search)' },
  ],
};

describe('SearchPage.helpers', () => {
  describe('omitLimitedListingFieldParams', () => {
    it('returns everything if no category limit is set', () => {
      const params = { pub_generalParam: 'one', other_param: 'somevalue' };
      const validParam = omitLimitedListingFieldParams(params, filterConfigs);
      expect(validParam).toEqual({ pub_generalParam: 'one', other_param: 'somevalue' });
    });
    it('returns filtered parameters if listing type limit affects', () => {
      const params = { pub_rider: 'women', other_param: 'somevalue' };
      const validParam = omitLimitedListingFieldParams(params, filterConfigs);
      expect(validParam).toEqual({ other_param: 'somevalue' });
    });
    it('returns filtered parameters if category limit affects', () => {
      const params = { pub_cat: 'cat1', other_param: 'somevalue' };
      const validParam = omitLimitedListingFieldParams(params, filterConfigs);
      expect(validParam).toEqual({ other_param: 'somevalue' });
    });
    it('returns everything if correct category and listing type is set', () => {
      const params = {
        pub_categoryLevel1: 'a',
        pub_cat: 'cat1',
        other_param: 'somevalue',
        pub_listingType: 'sell-bicycles',
      };
      const validParam = omitLimitedListingFieldParams(params, filterConfigs);
      expect(validParam).toEqual({
        pub_categoryLevel1: 'a',
        pub_cat: 'cat1',
        other_param: 'somevalue',
        pub_listingType: 'sell-bicycles',
      });
    });
  });

  describe('validURLParamForExtendedData', () => {
    it('returns a valid parameter', () => {
      const validParam = validURLParamForExtendedData(
        'pub_rider',
        'women',
        listingFieldsConfig,
        []
      );
      expect(validParam).toEqual({ pub_rider: 'women' });
    });

    it('returns a valid parameter for price filter', () => {
      const validParam = validURLParamForExtendedData(
        'price',
        '5,200',
        listingFieldsConfig,
        defaultFiltersConfig
      );
      expect(validParam).toEqual({ price: '5,200' });
    });

    it('returns a valid parameter for price filter, when params exceed config', () => {
      const validParam = validURLParamForExtendedData(
        'price',
        '-5,2000',
        listingFieldsConfig,
        defaultFiltersConfig
      );
      expect(validParam).toEqual({ price: '0,1000' });
    });

    it('takes empty params', () => {
      const validParam = validURLParamForExtendedData('pub_rider', '', listingFieldsConfig, []);
      expect(validParam).toEqual({});
    });

    it('drops an invalid param value', () => {
      const validParam = validURLParamForExtendedData(
        'pub_rider',
        'invalid',
        listingFieldsConfig,
        []
      );
      expect(validParam).toEqual({});
    });

    it('drops a param with invalid name', () => {
      const validParam = validURLParamForExtendedData(
        'pub_invalid',
        'towels',
        listingFieldsConfig,
        []
      );
      expect(validParam).toEqual({});
    });
  });

  describe('validFilterParams', () => {
    it('returns valid parameters', () => {
      const validParams = validFilterParams(urlParams, filterConfigs);
      expect(validParams).toEqual(urlParams);
    });

    it('takes empty params', () => {
      const validParams = validFilterParams({}, filterConfigs);
      expect(validParams).toEqual({});
    });

    it('drops an invalid filter param value', () => {
      const params = { pub_generalParam: 'one', pub_generalMultienum: 'invalid1,invalid2' };
      const validParams = validFilterParams(params, filterConfigs);
      expect(validParams).toEqual({ pub_generalParam: 'one' });
    });

    it('drops non-filter params', () => {
      const params = { pub_generalParam: 'one', other_param: 'somevalue' };
      const validParams = validFilterParams(params, filterConfigs);
      expect(validParams).toEqual({ pub_generalParam: 'one' });
    });

    it('returns valid parameters, when "dropNonFilterParams" is false', () => {
      const validParams = validFilterParams(urlParams, filterConfigs, false);
      expect(validParams).toEqual(urlParams);
    });

    it('takes empty params, when "dropNonFilterParams" is false', () => {
      const validParams = validFilterParams({}, filterConfigs, false);
      expect(validParams).toEqual({});
    });

    it('drops an invalid filter param value, when "dropNonFilterParams" is false', () => {
      const params = { pub_generalParam: 'one', pub_generalMultienum: 'invalid1,invalid2' };
      const validParams = validFilterParams(params, filterConfigs, false);
      expect(validParams).toEqual({ pub_generalParam: 'one' });
    });

    it('returns non-filter params, when "dropNonFilterParams" is false', () => {
      const params = { pub_generalParam: 'one', other_param: 'somevalue' };
      const validParams = validFilterParams(params, filterConfigs, false);
      expect(validParams).toEqual(params);
    });
  });

  describe('validUrlQueryParamsFromProps', () => {
    it('returns a valid parameter', () => {
      const location = { search: '?pub_generalParam=one&pub_generalMultienum=towels,bathroom' };
      const pickedParams = validUrlQueryParamsFromProps({
        location,
        config: {
          listing: {
            listingFields: listingFieldsConfig,
            listingTypes: listingTypesConfig,
          },
          search: {
            defaultFilters: defaultFiltersConfig,
          },
          categoryConfiguration: { categories: listingCategories },
        },
      });

      expect(pickedParams).toEqual(urlParams);
    });

    it('returns valid values for parameters when also invalid is given', () => {
      // asdf is invalid value
      const location = {
        search: '?pub_generalParam=one&pub_generalMultienum=towels,bathroom,asdf',
      };
      const pickedParams = validUrlQueryParamsFromProps({
        location,
        config: {
          listing: {
            listingFields: listingFieldsConfig,
            listingTypes: listingTypesConfig,
          },
          search: {
            defaultFilters: defaultFiltersConfig,
          },
          categoryConfiguration: { categories: listingCategories },
        },
      });
      expect(pickedParams).toEqual(urlParams);
    });
  });

  describe('initialValues', () => {
    const location = { search: '?pub_generalParam=one&pub_generalMultienum=towels,bathroom' };
    const props = {
      location,
      config: {
        listing: {
          listingFields: listingFieldsConfig,
          listingTypes: listingTypesConfig,
        },
        search: {
          defaultFilters: defaultFiltersConfig,
        },
        categoryConfiguration: { categories: listingCategories },
      },
    };
    const currentQueryParams = {};

    it('returns a valid parameter for a selected queryParamName', () => {
      const queryParamNames = ['pub_generalMultienum'];
      const isLiveEdit = true;

      const iv = initialValues(props, currentQueryParams)(queryParamNames, isLiveEdit);
      expect(iv).toEqual({ pub_generalMultienum: urlParams.pub_generalMultienum });
    });

    it('returns a valid parameter for a selected queryParamNames', () => {
      const queryParamNames = ['pub_generalParam', 'pub_generalMultienum'];
      const isLiveEdit = true;

      const iv = initialValues(props, currentQueryParams)(queryParamNames, isLiveEdit);
      expect(iv).toEqual(urlParams);
    });

    it('returns a valid parameter for a undefined queryParamName', () => {
      const queryParamNames = ['pub_asdf'];
      const isLiveEdit = true;

      const iv = initialValues(props, currentQueryParams)(queryParamNames, isLiveEdit);
      expect(iv).toEqual({ pub_asdf: undefined });
    });

    it('returns a valid parameter for a selected queryParamNames if currentQueryParams is overwritten', () => {
      const queryParamNames = ['pub_generalParam', 'pub_generalMultienum'];
      const isLiveEdit = true;

      const iv = initialValues(props, { pub_generalParam: 'two' })(queryParamNames, isLiveEdit);
      expect(iv).toEqual(urlParams);
    });

    it('returns a valid parameters lisLiveEdit=false (uses currentQueryParams)', () => {
      const multiEnumOnly = { search: '?pub_generalMultienum=towels,bathroom' };
      const props2 = { ...props, location: multiEnumOnly };
      const queryParamNames = ['pub_generalParam', 'pub_generalMultienum'];
      const isLiveEdit = false;

      const iv = initialValues(props2, { pub_generalParam: 'one' })(queryParamNames, isLiveEdit);
      expect(iv).toEqual(urlParams);
    });

    it("returns a valid parameters lisLiveEdit=true (doesn't use currentQueryParams)", () => {
      const multiEnumOnly = { search: '?pub_generalMultienum=towels,bathroom' };
      const props2 = { ...props, location: multiEnumOnly };
      const queryParamNames = ['pub_generalParam', 'pub_generalMultienum'];
      const isLiveEdit = true;

      const iv = initialValues(props2, { pub_generalParam: 'one' })(queryParamNames, isLiveEdit);
      expect(iv).toEqual({ ...urlParams, pub_generalParam: undefined });
    });
  });

  describe('cleanSearchFromConflictingParams', () => {
    it('returns sort as null if conflicting filter is active', () => {
      const searchParams = {
        address: 'address value',
        bounds: 'bounds value',
        keywords: 'asdf',
        sort: 'createdAt',
      };
      const validParams = cleanSearchFromConflictingParams(searchParams, filterConfigs, sortConfig);

      expect(validParams).toEqual({ ...searchParams, sort: null });
    });

    it('returns sort as null if one of conflicting filter is active', () => {
      const searchParams = {
        address: 'address value',
        bounds: 'bounds value',
        keywords: 'asdf',
        sort: 'createdAt',
      };
      const validParams = cleanSearchFromConflictingParams(searchParams, filterConfigs, {
        ...sortConfig,
        conflictingFilters: ['origin', 'keywords'],
      });

      expect(validParams).toEqual({ ...searchParams, sort: null });
    });

    it('returns sort if conflicting filter is not active parameters', () => {
      const searchParams = {
        address: 'address value',
        bounds: 'bounds value',
        sort: 'createdAt',
      };
      const validParams = cleanSearchFromConflictingParams(searchParams, filterConfigs, sortConfig);

      expect(validParams).toEqual(searchParams);
    });
  });

  describe('pickSearchParamsOnly', () => {
    const isOriginInUse = false;
    it('returns search parameters', () => {
      const params = {
        address: 'address value',
        origin: 'origin value',
        bounds: 'bounds value',
      };
      const validParams = pickSearchParamsOnly(params, filterConfigs, sortConfig, isOriginInUse);
      expect(validParams).toEqual({ bounds: 'bounds value' });
    });

    it('returns filter parameters', () => {
      const validParams = pickSearchParamsOnly(urlParams, filterConfigs, sortConfig, isOriginInUse);
      expect(validParams).toEqual(urlParams);
    });

    it('drops an invalid filter param value', () => {
      const params = { pub_generalParam: 'one', pub_generalMultienum: 'invalid1,invalid2' };
      const validParams = pickSearchParamsOnly(params, filterConfigs, sortConfig, isOriginInUse);
      expect(validParams).toEqual({ pub_generalParam: 'one' });
    });

    it('drops non-search params', () => {
      const params = { pub_generalParam: 'one', other_param: 'somevalue' };
      const validParams = pickSearchParamsOnly(params, filterConfigs, sortConfig, isOriginInUse);
      expect(validParams).toEqual({ pub_generalParam: 'one' });
    });

    it('returns sort param', () => {
      const params = { sort: '-price', other_param: 'somevalue' };
      const validParams = pickSearchParamsOnly(params, filterConfigs, sortConfig, isOriginInUse);
      expect(validParams).toEqual({ sort: '-price' });
    });
  });

  describe('searchParamsPicker', () => {
    const isOriginInUse = false;
    it("returns searchParamsAreInSync: false if searchParamsInProps and location.search don't match", () => {
      const location = { search: '?pub_generalParam=one&pub_generalMultienum=towels,bathroom' };
      const searchParamsInProps = {
        address: 'address value',
        origin: 'origin value',
        bounds: 'bounds value',
      };

      const paramsInfo = searchParamsPicker(
        location.search,
        searchParamsInProps,
        filterConfigs,
        sortConfig,
        isOriginInUse
      );

      expect(paramsInfo).toEqual({
        searchParamsAreInSync: false,
        searchParamsInURL: { pub_generalMultienum: 'towels,bathroom', pub_generalParam: 'one' },
        urlQueryParams: { pub_generalMultienum: 'towels,bathroom', pub_generalParam: 'one' },
      });
    });

    it('returns searchParamsAreInSync: true if searchParamsInProps and location.search match', () => {
      const location = { search: '?pub_generalParam=one&pub_generalMultienum=towels,bathroom' };
      const searchParamsInProps = {
        pub_generalMultienum: 'towels,bathroom',
        pub_generalParam: 'one',
      };

      const paramsInfo = searchParamsPicker(
        location.search,
        searchParamsInProps,
        filterConfigs,
        sortConfig,
        isOriginInUse
      );

      expect(paramsInfo).toEqual({
        searchParamsAreInSync: true,
        searchParamsInURL: { pub_generalMultienum: 'towels,bathroom', pub_generalParam: 'one' },
        urlQueryParams: { pub_generalMultienum: 'towels,bathroom', pub_generalParam: 'one' },
      });
    });

    it('returns correct info even if location.search contains page and mapSearch params', () => {
      const location = {
        search: '?pub_generalParam=one&pub_generalMultienum=towels,bathroom&page=2&mapSearch=true',
      };
      const searchParamsInProps = {
        pub_generalMultienum: 'towels,bathroom',
        pub_generalParam: 'one',
      };

      const paramsInfo = searchParamsPicker(
        location.search,
        searchParamsInProps,
        filterConfigs,
        sortConfig,
        isOriginInUse
      );

      expect(paramsInfo).toEqual({
        searchParamsAreInSync: true,
        searchParamsInURL: { pub_generalMultienum: 'towels,bathroom', pub_generalParam: 'one' },
        urlQueryParams: { pub_generalMultienum: 'towels,bathroom', pub_generalParam: 'one' },
      });
    });

    it('returns correct urlQueryParams even if location.search contains unknown search params', () => {
      const location = {
        search: '?pub_generalParam=one&pub_generalMultienum=towels,bathroom&pub_asdf=true',
      };
      const searchParamsInProps = {
        pub_generalMultienum: 'towels,bathroom',
        pub_generalParam: 'one',
      };

      const paramsInfo = searchParamsPicker(
        location.search,
        searchParamsInProps,
        filterConfigs,
        sortConfig,
        isOriginInUse
      );

      expect(paramsInfo).toEqual({
        searchParamsAreInSync: true,
        searchParamsInURL: {
          pub_generalMultienum: 'towels,bathroom',
          pub_generalParam: 'one',
          pub_asdf: true,
        },
        urlQueryParams: { pub_generalMultienum: 'towels,bathroom', pub_generalParam: 'one' },
      });
    });
  });

  describe('groupListingFieldConfigs', () => {
    it('returns grouped configs for the extended data of the listinga', () => {
      const [primary, secondary] = groupListingFieldConfigs(
        listingFieldsConfig,
        activeListingTypes
      );

      expect(primary).toEqual([
        listingFieldsConfig[0],
        listingFieldsConfig[1],
        listingFieldsConfig[5],
      ]);
      expect(secondary).toEqual([
        listingFieldsConfig[2],
        listingFieldsConfig[3],
        listingFieldsConfig[4],
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
//   > "El filtro de keywords debe estar en more filters"
//
// Keywords only reaches the filter row at all when the main search is by LOCATION - which is
// what Console says this marketplace is (`mainSearch.searchType: "location"`, read off the
// hosted listing-search asset). When it is `keywords`, the box lives in the topbar and the
// filter is dropped earlier, so there is nothing to move.
// ---------------------------------------------------------------------------
describe('keywords belongs in "more filters"', () => {
  const keysOf = filters => filters.map(f => f.key);

  const derive = ({ searchType = 'location', search = '' } = {}) =>
    getDerivedRenderData({
      intl: { formatMessage: ({ id }) => id, formatNumber: n => `${n}` },
      location: { search },
      routeConfiguration: [],
      config: {
        currency: 'USD',
        listing: {
          listingTypes: [{ listingType: 'rent-garment' }],
          listingFields: [],
        },
        categoryConfiguration: { key: 'categoryLevel', categories: [] },
        search: {
          mainSearch: { searchType },
          sortConfig: {
            active: false,
            queryParamName: 'sort',
            options: [],
            conflictingFilters: [],
          },
          defaultFilters: [
            { key: 'listingType', schemaType: 'listingType' },
            { key: 'categoryLevel', schemaType: 'category' },
            { key: 'price', schemaType: 'price', min: 0, max: 1000 },
            { key: 'keywords', schemaType: 'keywords' },
          ],
        },
        maps: {},
        user: { userTypes: [] },
      },
      searchParams: {},
      listings: [],
      searchInProgress: false,
    });

  it('keeps keywords out of the primary filter row', () => {
    const { availablePrimaryFilters } = derive();

    expect(keysOf(availablePrimaryFilters)).not.toContain('keywords');
  });

  // Moved, not deleted. It has to still be rendered somewhere.
  it('still offers keywords among all the filters', () => {
    const { availableFilters } = derive();

    expect(keysOf(availableFilters)).toContain('keywords');
  });

  // There are no custom secondary filters in this fixture, so before the change the panel
  // holding keywords would never have opened.
  it('opens the "more filters" panel even with no custom secondary filters', () => {
    const { hasSecondaryFilters } = derive();

    expect(hasSecondaryFilters).toBe(true);
  });

  // A built-in filter is counted by its raw key - only custom listing fields are namespaced.
  // Counting keywords as `pub_keywords` would leave the button showing no count while a
  // keyword was active.
  it('counts an active keyword on the "more filters" button', () => {
    expect(derive().selectedSecondaryFiltersCount).toBe(0);
    expect(derive({ search: '?keywords=silk' }).selectedSecondaryFiltersCount).toBe(1);
  });

  // When the topbar IS the keyword box, the filter never existed here to begin with.
  it('does nothing when the main search is by keywords', () => {
    const { availableFilters, availablePrimaryFilters } = derive({ searchType: 'keywords' });

    expect(keysOf(availableFilters)).not.toContain('keywords');
    expect(keysOf(availablePrimaryFilters)).not.toContain('keywords');
  });

  // The rest of the row is untouched: price is built-in too and must stay primary.
  it('leaves the other built-in filters where they were', () => {
    expect(keysOf(derive().availablePrimaryFilters)).toContain('price');
  });
});

// ---------------------------------------------------------------------------
//   > "En search page, puedes agregar brand como primary filter? Es un texto a ingresar,
//   >  entonces hay que manejarlo bien para que funcione"
//
// "Manejarlo bien" is the whole problem: Sharetribe cannot filter "text contains" on extended
// data, so `pub_brand` carries an ENUM schema pushed by CLI and the options are the brands that
// already exist. Brand is deliberately not a Console field - it had to be removed for the CLI to
// own the schema - which is why this config is injected in code.
// ---------------------------------------------------------------------------
describe('withBrandFilter', () => {
  const brandOptions = [{ brand: 'Club Monaco', count: 1 }, { brand: 'Reformation', count: 3 }];
  const intl = { formatMessage: ({ id }) => id };

  const brandField = (fields = [], options = brandOptions) =>
    withBrandFilter(fields, options, intl).find(f => f.key === 'brand');

  it('offers exactly the brands that exist, as stored', () => {
    expect(brandField().enumOptions).toEqual([
      { option: 'Club Monaco', label: 'Club Monaco' },
      { option: 'Reformation', label: 'Reformation' },
    ]);
  });

  // The stored spelling IS the query value, so the filter is an exact match on what is really
  // on the listings. A prettified label would search for something no listing carries.
  it('queries by the stored spelling, not a tidied one', () => {
    const field = brandField([], [{ brand: "Lulu's", count: 1 }]);

    expect(field.enumOptions[0].option).toBe("Lulu's");
  });

  it('is a primary filter, as asked', () => {
    expect(brandField().filterConfig.group).toBe('primary');
    expect(brandField().filterConfig.showFilter).toBe(true);
    expect(brandField().filterConfig.indexForSearch).toBe(true);
  });

  // enum, NOT multi-enum: multi-select still works on a plain enum via a comma-separated OR
  // (`pub_brand=Zara,Nike`) - the `has_any:` prefix is only for multi-enum's array-valued
  // fields, so switching schemaType was never needed to switch filterType (2026-09-21).
  it('is a multi-select enum, matching the schema that was pushed', () => {
    expect(brandField().schemaType).toBe('enum');
    expect(brandField().filterConfig.filterType).toBe('SelectMultipleFilter');
  });

  // Rendering an empty dropdown reads as "there are no brands", which is a different and
  // wronger statement than not showing the filter at all.
  it('adds nothing when there are no brands to offer', () => {
    const existing = [{ key: 'size' }];

    expect(withBrandFilter(existing, [], intl)).toBe(existing);
    expect(withBrandFilter(existing, null, intl)).toBe(existing);
    expect(withBrandFilter(existing, undefined, intl)).toBe(existing);
  });

  it('leaves the fields it was given alone', () => {
    const existing = [{ key: 'size' }, { key: 'color' }];
    const result = withBrandFilter(existing, brandOptions, intl);

    expect(result).toHaveLength(3);
    expect(result.slice(0, 2)).toEqual(existing);
  });
});

// ---------------------------------------------------------------------------
//   > "filtremos por laundry pero usando el nombre del vecindario que tenga en su
//   >  dirección, solo es cambiar el label en las opciones de búsqueda"
//   >  (Jonathan, 2026-09-03)
//
// The option's VALUE is still the studio id - that is what the search schema filters on, and
// changing it would silently return the whole marketplace. Only the label moved.
// ---------------------------------------------------------------------------
describe('withLaundryPickupFilter labels', () => {
  const optionsFor = laundryOptions => {
    const [filter] = withLaundryPickupFilter([], laundryOptions, { formatMessage: () => 'Pickup' });
    return filter.enumOptions;
  };

  it('labels a studio by its neighborhood', () => {
    expect(optionsFor([{ id: 'l1', name: 'Maison du Marais', neighborhood: 'Le Marais' }])).toEqual(
      [{ option: 'l1', label: 'Le Marais' }]
    );
  });

  it('falls back to the studio name when there is no neighborhood', () => {
    // A studio that has not filled it in would otherwise be a blank row in the dropdown,
    // which is worse than a name the reader has to look up.
    expect(optionsFor([{ id: 'l1', name: 'Maison du Marais', neighborhood: null }])).toEqual([
      { option: 'l1', label: 'Maison du Marais' },
    ]);
  });

  it('keeps filtering by the studio id, whatever the label says', () => {
    const [option] = optionsFor([
      { id: 'l1', name: 'Maison du Marais', neighborhood: 'Le Marais' },
    ]);
    expect(option.option).toBe('l1');
  });

  it('adds no filter at all when there are no studios', () => {
    // An empty dropdown reads as "this marketplace has no stores", which is worse than none.
    expect(withLaundryPickupFilter([], [], { formatMessage: () => 'Pickup' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
//   > "el vecindario tambien debe guardarse en el listing y debemos poder filtrar por
//   >  vecindario, el cual me dará el mismo resultado que filtrar por laundry"
//   >   (Jonathan, 2026-09-09)
//
// It returns the same listings as the pickup filter - one studio per garment, one part of
// town per studio - and asks a different question: each neighborhood once, rather than one
// row per studio. What is worth pinning is the deduplication, since that IS the difference.
// ---------------------------------------------------------------------------
describe('withNeighborhoodFilter', () => {
  const fieldFrom = laundryOptions => {
    const fields = withNeighborhoodFilter([], laundryOptions, null);
    return fields.find(f => f.key === 'pickupNeighborhood') || null;
  };

  it('offers each part of town once, however many studios are in it', () => {
    const field = fieldFrom([
      { id: 'l1', name: 'Maison du Marais', neighborhood: 'Le Marais' },
      { id: 'l2', name: 'Pressing Bastille', neighborhood: 'Le Marais' },
      { id: 'l3', name: 'Studio Pigalle', neighborhood: 'Pigalle' },
    ]);

    expect(field.enumOptions).toEqual([
      { option: 'Le Marais', label: 'Le Marais' },
      { option: 'Pigalle', label: 'Pigalle' },
    ]);
  });

  it('queries the listing, not the studio', () => {
    // The value has to be on the garment for a listing search to filter on it - which is why
    // the assignment now stamps it and the propagation keeps it current.
    const field = fieldFrom([{ id: 'l1', name: 'A', neighborhood: 'Le Marais' }]);

    expect(field.key).toBe('pickupNeighborhood');
    expect(field.scope).toBe('public');
  });

  it('skips studios with no neighborhood rather than offering a blank row', () => {
    const field = fieldFrom([
      { id: 'l1', name: 'A', neighborhood: null },
      { id: 'l2', name: 'B', neighborhood: '   ' },
      { id: 'l3', name: 'C', neighborhood: 'Sant Antoni' },
    ]);

    expect(field.enumOptions).toEqual([{ option: 'Sant Antoni', label: 'Sant Antoni' }]);
  });

  it('renders no filter at all when nothing has a neighborhood', () => {
    // A dropdown offering nothing reads as "this marketplace has no neighborhoods", which is
    // worse than no dropdown.
    expect(fieldFrom([{ id: 'l1', name: 'A', neighborhood: null }])).toBeNull();
    expect(fieldFrom([])).toBeNull();
  });

  it('leaves the fields it was given alone', () => {
    const existing = [{ key: 'brand' }];
    expect(withNeighborhoodFilter(existing, [], null)).toBe(existing);
  });
});

// ---------------------------------------------------------------------------
//   > "si doy click en Reset All no se limpia, se limpia hasta que doy click manualmente a
//   >  ese filtro" (Jonathan, 2026-09-09)
//
// Three of the filters on this page are not in Console - pickup, neighborhood and brand are
// synthesised from the studios and brands that exist. "Reset all" strips the params it knows
// about, and it only knew about the Console ones, so it cleared some filters and left others.
// A reset that resets most things is worse than one that resets nothing: it reads as done.
// ---------------------------------------------------------------------------
describe('onResetAll', () => {
  const LAUNDRY_OPTIONS = [{ id: 'l1', name: 'Maison du Marais', neighborhood: 'Le Marais' }];
  const BRAND_OPTIONS = ['Reformation'];

  const resetFrom = urlQueryParams => {
    const history = { push: jest.fn() };
    onResetAll({
      history,
      routeConfiguration: [{ name: 'SearchPage', path: '/s', auth: false }],
      config: {
        listing: {
          listingFields: [
            {
              key: 'size',
              scope: 'public',
              schemaType: 'enum',
              filterConfig: { indexForSearch: true, showFilter: true },
            },
          ],
        },
        search: { defaultFilters: [{ key: 'price', schemaType: 'price' }] },
      },
      location: { pathname: '/s', search: '' },
      urlQueryParams,
      setState: () => null,
      laundryOptions: LAUNDRY_OPTIONS,
      brandOptions: BRAND_OPTIONS,
    });
    const pushedTo = history.push.mock.calls[0]?.[0] || '';
    return pushedTo;
  };

  it('clears the pickup, neighborhood and brand filters as well as the Console ones', () => {
    const url = resetFrom({
      pub_size: 'M',
      price: '0,100',
      meta_assignedLaundryId: 'l1',
      pub_pickupNeighborhood: 'Le Marais',
      pub_brand: 'Reformation',
    });

    expect(url).not.toContain('pub_size');
    expect(url).not.toContain('price');
    expect(url).not.toContain('meta_assignedLaundryId');
    expect(url).not.toContain('pub_pickupNeighborhood');
    expect(url).not.toContain('pub_brand');
  });

  it('leaves params that are not filters alone', () => {
    // Sorting and paging are not filters, and a reset that dropped them would move the reader
    // somewhere they did not ask to go.
    const url = resetFrom({ pub_size: 'M', sort: '-createdAt' });

    expect(url).toContain('sort=-createdAt');
    expect(url).not.toContain('pub_size');
  });

  it('still clears the Console filters when there are no studios or brands', () => {
    const history = { push: jest.fn() };
    onResetAll({
      history,
      routeConfiguration: [{ name: 'SearchPage', path: '/s', auth: false }],
      config: {
        listing: {
          listingFields: [
            {
              key: 'size',
              scope: 'public',
              schemaType: 'enum',
              filterConfig: { indexForSearch: true, showFilter: true },
            },
          ],
        },
        search: { defaultFilters: [] },
      },
      location: { pathname: '/s', search: '' },
      urlQueryParams: { pub_size: 'M' },
      setState: () => null,
    });

    expect(history.push.mock.calls[0][0]).not.toContain('pub_size');
  });
});

// ---------------------------------------------------------------------------
//   > "El filtro de brand no está en la primer posición, esto debe funcionar tanto en mobile
//   >  como en desktop"
//   > "No se muestra el filtro de vecindario" (Jonathan, 2026-09-10)
//
// The two synthesised filters were asserted in isolation, which proved the builders were
// right and nothing about the list the page actually renders. Both screens map over
// `availableFilters`, so that is what these drive - through getDerivedRenderData, with the
// options the page really passes.
// ---------------------------------------------------------------------------
describe('the filter row the page renders', () => {
  const keysOf = filters => filters.map(f => f.key);

  const deriveWith = ({
    laundryOptions = [],
    brandOptions = [],
    listingFields = [],
    categories = [],
  } = {}) =>
    getDerivedRenderData({
      intl: { formatMessage: ({ id }) => id, formatNumber: n => `${n}` },
      location: { search: '' },
      routeConfiguration: [],
      config: {
        currency: 'USD',
        listing: { listingTypes: [{ listingType: 'rent-garment' }], listingFields },
        categoryConfiguration: { key: 'categoryLevel', categories },
        search: {
          mainSearch: { searchType: 'location' },
          sortConfig: {
            active: false,
            queryParamName: 'sort',
            options: [],
            conflictingFilters: [],
          },
          defaultFilters: [
            { key: 'listingType', schemaType: 'listingType' },
            { key: 'categoryLevel', schemaType: 'category' },
            { key: 'price', schemaType: 'price', min: 0, max: 1000 },
            { key: 'keywords', schemaType: 'keywords' },
          ],
        },
        maps: {},
        user: { userTypes: [] },
      },
      searchParams: {},
      listings: [],
      searchInProgress: false,
      laundryOptions,
      brandOptions,
    });

  const consoleField = key => ({
    key,
    scope: 'public',
    schemaType: 'enum',
    enumOptions: [{ option: 'a', label: 'A' }],
    filterConfig: { indexForSearch: true, showFilter: true, group: 'primary', label: key },
  });

  it('puts brand first, ahead of the built-ins and of the Console fields', () => {
    const { availableFilters, availablePrimaryFilters } = deriveWith({
      brandOptions: ['Reformation'],
      listingFields: [consoleField('size')],
      // A REAL category tree. With none, the category filter drops out of the list entirely
      // and the ordering question never arises - which is exactly how a green test can sit
      // beside a filter row that reads Category, Size, ... on the actual page.
      categories: [{ id: 'dresses', name: 'Dresses' }],
    });

    // Both lists: the desktop row reads the primary one, the mobile panel reads the other.
    expect(keysOf(availableFilters)[0]).toBe('brand');
    expect(keysOf(availablePrimaryFilters)[0]).toBe('brand');
  });

  it('puts a CONSOLE brand field first too, not just the synthesised one', () => {
    // The synthesised brand filter only exists when the marketplace has brands to offer. If
    // Console also defines a `brand` listing field, that is what a reader sees - and it has to
    // land in the same place, or "brand is first" would depend on how many brands exist.
    const { availableFilters } = deriveWith({
      listingFields: [consoleField('size'), consoleField('brand')],
    });

    expect(keysOf(availableFilters)[0]).toBe('brand');
  });

  it('hoists a brand field whatever Console called it', () => {
    // The last way the hoist could miss: the key on a Console-authored field is Console's to
    // choose, and a filter sliding back down the row because somebody typed "Brands" is not a
    // failure anybody would attribute to this code.
    const { availableFilters } = deriveWith({
      listingFields: [consoleField('size'), consoleField('Brands')],
    });

    expect(keysOf(availableFilters)[0]).toBe('Brands');
  });

  it('offers the neighborhood filter once a studio has one', () => {
    const { availableFilters } = deriveWith({
      laundryOptions: [{ id: 'l1', name: 'Maison du Marais', neighborhood: 'Le Marais' }],
    });

    expect(keysOf(availableFilters)).toContain('pickupNeighborhood');
  });

  it('offers no neighborhood filter while no studio has set one', () => {
    // The honest empty case: this is what a marketplace looks like before any studio has
    // saved a neighborhood, and it is why the filter can be "missing" without being broken.
    const { availableFilters } = deriveWith({
      laundryOptions: [{ id: 'l1', name: 'Maison du Marais', neighborhood: null }],
    });

    expect(keysOf(availableFilters)).not.toContain('pickupNeighborhood');
  });
});
