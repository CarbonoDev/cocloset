import {
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
