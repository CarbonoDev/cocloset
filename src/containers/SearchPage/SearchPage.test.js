import React from 'react';
import '@testing-library/jest-dom';

import { createImageVariantConfig } from '../../util/sdkLoader';
import { createCurrentUser, createListing } from '../../util/testData';
import {
  renderWithProviders as render,
  testingLibrary,
  getRouteConfiguration,
  getHostedConfiguration,
  createFakeDispatch,
  dispatchedActions,
} from '../../util/testHelpers';

import { loadData, searchListings } from './SearchPage.duck';
import { addMarketplaceEntities } from '../../ducks/marketplaceData.duck';
import SearchPageWithGrid from './SearchPageWithGrid';
import SearchPageWithMap from './SearchPageWithMap';

// `routeConfiguration` exposes SearchPage through `@loadable/component`, which can render an empty
// tree until the dynamic import resolves. This test is not about routeConfiguration and
// loadable components. We'll select the SearchPage variant directly here.
const getConnectedSearchPageForTests = layout =>
  layout?.searchPage?.variantType === 'map' ? SearchPageWithMap : SearchPageWithGrid;

const { screen, userEvent, waitFor } = testingLibrary;

const noop = () => null;

const listingTypes = [
  {
    id: 'rent-bicycles-daily',
    transactionProcess: {
      name: 'default-booking',
      alias: 'default-booking/release-1',
    },
    unitType: 'day',
  },
  {
    id: 'rent-bicycles-nightly',
    transactionProcess: {
      name: 'default-booking',
      alias: 'default-booking/release-1',
    },
    unitType: 'night',
  },
  {
    id: 'rent-bicycles-hourly',
    transactionProcess: {
      name: 'default-booking',
      alias: 'default-booking/release-1',
    },
    unitType: 'hour',
  },
  {
    id: 'sell-bicycles',
    transactionProcess: {
      name: 'default-purchase',
      alias: 'default-purchase/release-1',
    },
    unitType: 'item',
  },
];

const capitalizeFirstLetter = str => str.charAt(0).toUpperCase() + str.slice(1);
const addSpaces = str => str.split('-').join(' ');
const labelize = str => addSpaces(capitalizeFirstLetter(str));

const generateCategories = optionStrings => {
  return optionStrings.reduce((converted, entry) => {
    const isArray = Array.isArray(entry);
    const option = isArray
      ? { id: entry[0], name: labelize(entry[0]), subcategories: generateCategories(entry[1]) }
      : { id: entry, name: labelize(entry) };
    return [...converted, option];
  }, []);
};
const categories = generateCategories([
  ['dogs', ['labradors', 'poodles']],
  ['cats', ['burmese', 'egyptian-mau']],
  ['fish', [['freshwater', ['grayling', 'arctic-char', 'pike']], 'saltwater']],
  ['birds', ['parrot', 'macaw']],
]);

const listingFields = [
  {
    // Formerly used for category, but now there's dedicated category setup
    key: 'cat',
    scope: 'public',
    categoryConfig: {
      limitToCategoryIds: true,
      categoryIds: ['cats'],
    },
    schemaType: 'enum',
    enumOptions: [{ option: 'cat_1', label: 'Cat 1' }, { option: 'cat_2', label: 'Cat 2' }],
    filterConfig: {
      showFilter: true,
      label: 'Cat',
      group: 'primary',
    },
    showConfig: {
      label: 'Cat',
    },
    saveConfig: {
      label: 'Cat',
    },
  },
  {
    key: 'boat ',
    scope: 'public',
    listingTypeConfig: {
      limitToListingTypeIds: true,
      listingTypeIds: ['sell-bicycles'],
    },
    schemaType: 'enum',
    enumOptions: [{ option: 'boat_1', label: 'Boat 1' }, { option: 'boat_2', label: 'Boat 2' }],
    filterConfig: {
      showFilter: true,
      label: 'Boat',
      group: 'primary',
    },
    showConfig: {
      label: 'Boat',
    },
    saveConfig: {
      label: 'Boat',
    },
  },
  {
    // Named for what this field's OWN config still says, not for how it renders any more:
    // `validFilterType` (configHelpers.js) now forces every enum/multi-enum field to
    // SelectMultipleFilter regardless of what filterType is configured here (Jonathan,
    // 2026-09-21: "no solo es para brand o size, debe ser para todos los fields"). This fixture
    // exists specifically to prove that override reaches even a field explicitly configured
    // for single-select, the same as `enumOptions`-driven fields would be on the live app.
    key: 'singleSelectTest',
    scope: 'public',
    schemaType: 'enum',
    enumOptions: [{ option: 'enum1', label: 'Enum 1' }, { option: 'enum2', label: 'Enum 2' }],
    filterConfig: {
      showFilter: true,
      filterType: 'SelectSingleFilter',
      label: 'Single Select Test',
      group: 'primary',
    },
    showConfig: {
      label: 'Single Select Test',
    },
    saveConfig: {
      label: 'Single Select Test',
    },
  },
  {
    key: 'amenities',
    scope: 'public',
    schemaType: 'multi-enum',
    enumOptions: [{ option: 'dog_1', label: 'Dog 1' }, { option: 'dog_2', label: 'Dog 2' }],
    filterConfig: {
      showFilter: true,
      label: 'Amenities',
      //searchMode: 'has_all',
      group: 'secondary',
    },
    showConfig: {
      label: 'Amenities',
    },
    saveConfig: {
      label: 'Amenities',
    },
  },
];

const listingTypeOptions = listingTypes.map(lt => ({ option: lt.id, label: labelize(lt.id) }));

const defaultFiltersConfig = [
  {
    key: 'categoryLevel',
    schemaType: 'category',
    scope: 'public',
    isNestedEnum: true,
    nestedParams: ['categoryLevel1', 'categoryLevel2', 'categoryLevel3'],
  },
  {
    key: 'listingType',
    schemaType: 'listingType',
    scope: 'public',
    options: listingTypeOptions,
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
];

const sortConfig = {
  active: true,
  queryParamName: 'sort',
  relevanceKey: 'relevance',
  conflictingFilters: [],
  options: [
    { key: 'createdAt', label: 'Newest' },
    { key: '-createdAt', label: 'Oldest' },
    { key: '-price', label: 'Lowest price' },
    { key: 'price', label: 'Highest price' },
    { key: 'relevance', label: 'Relevance', longLabel: 'Relevance (Keyword search)' },
  ],
};

const getConfig = (variantType, customListingFields) => {
  const hostedConfig = getHostedConfiguration();
  return {
    ...hostedConfig,
    listingFields: {
      listingFields: customListingFields || listingFields,
    },
    listingTypes: {
      listingTypes,
    },
    categories: { categories },
    search: {
      ...hostedConfig.search,
      mainSearch: {
        searchType: 'location',
      },
      defaultFilters: defaultFiltersConfig,
      sortConfig: sortConfig,
    },
    layout: {
      ...hostedConfig.layout,
      searchPage: { variantType },
    },
    topbar: {
      searchBar: {
        display: 'always',
      },
    },
  };
};

const l1 = createListing('l1');
const l2 = createListing('l2');

// We'll initialize the store with relevant listing data
const initialState = {
  SearchPage: {
    currentPageResultIds: [l1.id, l2.id],
    pagination: {
      page: 1,
      perPage: 1,
      totalItems: 2,
      totalPages: 2,
    },
    searchInProgress: false,
    searchListingsError: null,
    searchParams: null,
    activeListingId: null,
  },
  marketplaceData: {
    entities: {
      listing: {
        l1,
        l2,
      },
    },
  },
};

const getSearchParams = config => {
  const {
    aspectWidth = 1,
    aspectHeight = 1,
    variantPrefix = 'listing-card',
  } = config.layout.listingImage;
  const aspectRatio = aspectHeight / aspectWidth;
  return {
    page: 1,
    perPage: 24,
    include: ['author', 'images'],
    'fields.listing': [
      'title',
      'geolocation',
      'price',
      'deleted',
      'state',
      'publicData.listingType',
      'publicData.transactionProcessAlias',
      'publicData.unitType',
      'publicData.cardStyle',
      // These help rendering of 'purchase' listings,
      // when transitioning from search page to listing page
      'publicData.pickupEnabled',
      'publicData.shippingEnabled',
      'publicData.priceVariationsEnabled',
      'publicData.priceVariants',
      // Cocloset: the search card's own fields. `fields.listing` is an allowlist, so a field
      // missing here arrives undefined and the brand, size and collection point each render as
      // nothing at all, on every card, with no error anywhere.
      'publicData.brand',
      'publicData.size',
      'publicData.assignedLaundryName',
      // Read by the card and by getPickupLocation (util/listingLocation.js); written by the
      // laundry assignment, which is what this branch added.
      'publicData.pickupNeighborhood',
      // The cleaning floor the date filter cannot ask Sharetribe about - see
      // util/searchCleaningFloor.js. Without these three the filter has nothing to apply and
      // a garment that cannot be collected for a fortnight comes back as available today.
      'metadata.initialCleaningDays',
      'metadata.onLaundry',
      'metadata.readyAt',
    ],
    'fields.user': ['profile.displayName', 'profile.abbreviatedName'],
    'fields.image': [
      'variants.scaled-small',
      'variants.scaled-medium',
      `variants.${variantPrefix}`,
      `variants.${variantPrefix}-2x`,
    ],
    ...createImageVariantConfig(`${variantPrefix}`, 400, aspectRatio),
    ...createImageVariantConfig(`${variantPrefix}-2x`, 800, aspectRatio),
    'limit.images': 1,
  };
};

describe('SearchPage', () => {
  const commonProps = {
    scrollingDisabled: false,
    onActivateListing: noop,
    onManageDisableScrolling: noop,
  };

  it('Check that filterColumn and filters exist in grid variant', async () => {
    // Select correct SearchPage variant according to route configuration
    const user = userEvent.setup();
    const config = getConfig('grid');
    const routeConfiguration = getRouteConfiguration(config.layout);
    const props = { ...commonProps };
    const SearchPage = getConnectedSearchPageForTests(config.layout);

    const { getByPlaceholderText, getByText, getAllByText, queryByText, getByRole } = render(
      <SearchPage {...props} />,
      {
        initialState,
        config,
        routeConfiguration,
        messages: { 'FieldSelectTree.screenreader.option': 'Choose {optionName}.' },
      }
    );

    await waitFor(() => {
      // Has main search in Topbar and it's a location search.
      expect(getByPlaceholderText('TopbarSearchForm.placeholder')).toBeInTheDocument();
      expect(screen.getByTestId('location-search')).toBeInTheDocument();

      // Has filter column
      expect(screen.getByTestId('filterColumnAside')).toBeInTheDocument();
      // Does not have search map container
      expect(screen.queryByTestId('searchMapContainer')).not.toBeInTheDocument();

      // Has SortBy component
      expect(getByText('MainPanelHeader.sortBy')).toBeInTheDocument();
      expect(getAllByText('Newest')).toHaveLength(4); // desktop and mobile dropdowns & selected
      expect(getAllByText('Oldest')).toHaveLength(2); // desktop and mobile dropdowns

      // Has no Cat filter (primary filter tied to 'Cats' category)
      expect(queryByText('Cat')).not.toBeInTheDocument();
      // Has no Boat filter (primary filter tied to 'sell-bicycles' listing type)
      expect(queryByText('Boat')).not.toBeInTheDocument();
      // Has(!) Amenities filter (secondary filter) (it contains also legend for screen readers)
      expect(getAllByText('Amenities')).toHaveLength(2);
      // Has Single Select Test filter - now rendered as multi-select regardless of its own
      // `filterType: 'SelectSingleFilter'` config (2026-09-21), so it duplicates its label the
      // same way the multi-enum 'Amenities' filter above does (fieldset legend for screen
      // readers, same as an inline SelectMultipleFilter always has).
      expect(getAllByText('Single Select Test')).toHaveLength(2);
      expect(getByText('Enum 1')).toBeInTheDocument();
      expect(getByText('Enum 2')).toBeInTheDocument();

      // Has Category filter
      expect(getByText('FilterComponent.categoryLabel')).toBeInTheDocument();
      expect(getByText('Dogs')).toBeInTheDocument();
      expect(queryByText('Poodle')).not.toBeInTheDocument();
      expect(getByText('Cats')).toBeInTheDocument();
      expect(queryByText('Burmese')).not.toBeInTheDocument();
      expect(getByText('Fish')).toBeInTheDocument();
      expect(queryByText('Freshwater')).not.toBeInTheDocument();

      // NO Listing type filter.
      //
      //   > "Hay que remover el filtro 'Listing type' de search"
      //
      // This marketplace has one listing type, so the control could narrow nothing and rule
      // nothing out.
      expect(queryByText('FilterComponent.listingTypeLabel')).not.toBeInTheDocument();
      // The options too: dropping the label while still rendering four unlabelled radio
      // buttons would be the obvious way to half-do this.
      expect(queryByText('Rent bicycles daily')).not.toBeInTheDocument();
      expect(queryByText('Rent bicycles nightly')).not.toBeInTheDocument();
      expect(queryByText('Rent bicycles hourly')).not.toBeInTheDocument();
      expect(queryByText('Sell bicycles')).not.toBeInTheDocument();

      // Has Price filter
      expect(getByText('FilterComponent.priceLabel')).toBeInTheDocument();

      // Shows listings
      // Has listing with title
      expect(getByText('l1 title')).toBeInTheDocument();
      // Has listing with title
      expect(getByText('l2 title')).toBeInTheDocument();
      // 2 listings with the same price
      expect(getAllByText('ListingCard.price')).toHaveLength(2);
    });

    // Test category intercation: click "Fish"
    await user.click(getByRole('button', { name: 'Choose Fish.' }));

    expect(getByText('Dogs')).toBeInTheDocument();
    expect(queryByText('Poodle')).not.toBeInTheDocument();
    expect(getByText('Cats')).toBeInTheDocument();
    expect(queryByText('Burmese')).not.toBeInTheDocument();
    // Subcategories of Fish should be visible
    expect(getByText('Fish')).toBeInTheDocument();
    expect(getByText('Freshwater')).toBeInTheDocument();
    expect(getByText('Saltwater')).toBeInTheDocument();
  });

  it('Check that map and filters exist in map variant', async () => {
    // Select correct SearchPage variant according to route configuration
    const user = userEvent.setup();
    const config = getConfig('map');
    const routeConfiguration = getRouteConfiguration(config.layout);
    const props = { ...commonProps };
    const SearchPage = getConnectedSearchPageForTests(config.layout);

    const {
      getByPlaceholderText,
      getByText,
      getByLabelText,
      getAllByText,
      queryByText,
      getByRole,
    } = render(<SearchPage {...props} />, {
      initialState,
      config,
      routeConfiguration,
      messages: {
        'SearchPage.screenreader.openFilterButton': 'Filter: {label}',
        'FieldSelectTree.screenreader.option': 'Choose {optionName}.',
      },
    });

    await waitFor(() => {
      // Has main search in Topbar and it's a location search.
      expect(getByPlaceholderText('TopbarSearchForm.placeholder')).toBeInTheDocument();
      expect(screen.getByTestId('location-search')).toBeInTheDocument();

      // Does not have filter column
      expect(screen.queryByTestId('filterColumnAside')).not.toBeInTheDocument();
      // Has search map container
      expect(screen.getByTestId('searchMapContainer')).toBeInTheDocument();

      // Has SortBy component
      expect(getByText('MainPanelHeader.sortBy')).toBeInTheDocument();
      expect(getAllByText('Newest')).toHaveLength(4); // desktop and mobile dropdowns & selected
      expect(getAllByText('Oldest')).toHaveLength(2); // desktop and mobile dropdowns

      // Has no Cat filter (primary filter tied to 'Cats' category)
      expect(queryByText('Cat')).not.toBeInTheDocument();
      // Does not have Amenities filter (secondary)
      expect(queryByText('Amenities')).not.toBeInTheDocument();
      // Has Single Select Test filter
      expect(getByText('Single Select Test')).toBeInTheDocument();
      expect(queryByText('Enum 1')).not.toBeInTheDocument();
      expect(queryByText('Enum 2')).not.toBeInTheDocument();

      // Has Category filter
      expect(getByLabelText('Filter: FilterComponent.categoryLabel')).toBeInTheDocument();
      expect(queryByText('Dogs')).not.toBeInTheDocument();
      expect(queryByText('Cats')).not.toBeInTheDocument();
      expect(queryByText('Fish')).not.toBeInTheDocument();

      // NO Listing type filter.
      //
      //   > "Hay que remover el filtro 'Listing type' de search"
      //
      // This marketplace has one listing type, so the control could narrow nothing and rule
      // nothing out.
      expect(queryByText('FilterComponent.listingTypeLabel')).not.toBeInTheDocument();
      expect(queryByText('Rent bicycles daily')).not.toBeInTheDocument();
      expect(queryByText('Rent bicycles nightly')).not.toBeInTheDocument();
      expect(queryByText('Rent bicycles hourly')).not.toBeInTheDocument();
      expect(queryByText('Sell bicycles')).not.toBeInTheDocument();

      // Has "more filters" button for secondary filters
      expect(getByText('SearchFiltersPrimary.moreFiltersButton')).toBeInTheDocument();

      // Has Price filter
      expect(getByText('FilterComponent.priceLabel')).toBeInTheDocument();

      // Shows listings
      // Has listing with title
      expect(getByText('l1 title')).toBeInTheDocument();
      // Has listing with title
      expect(getByText('l2 title')).toBeInTheDocument();
      // 2 listings with the same price
      expect(getAllByText('ListingCard.price')).toHaveLength(2);
    });

    // Test category intercation
    await user.click(getByRole('button', { name: 'Filter: FilterComponent.categoryLabel' }));

    expect(getByText('Dogs')).toBeInTheDocument();
    expect(queryByText('Poodle')).not.toBeInTheDocument();
    expect(getByText('Cats')).toBeInTheDocument();
    expect(queryByText('Burmese')).not.toBeInTheDocument();
    expect(getByText('Fish')).toBeInTheDocument();
    expect(queryByText('Freshwater')).not.toBeInTheDocument();

    // Test category intercation: click "Fish"
    await user.click(getByRole('button', { name: 'Choose Fish.' }));

    expect(getByText('Dogs')).toBeInTheDocument();
    expect(queryByText('Poodle')).not.toBeInTheDocument();
    expect(getByText('Cats')).toBeInTheDocument();
    expect(queryByText('Burmese')).not.toBeInTheDocument();
    // Subcategories of Fish should be visible
    expect(getByText('Fish')).toBeInTheDocument();
    expect(getByText('Freshwater')).toBeInTheDocument();
    expect(getByText('Saltwater')).toBeInTheDocument();
  });

  it('Check that Cat filters is revealed in grid variant', async () => {
    // Select correct SearchPage variant according to route configuration
    const user = userEvent.setup();
    const config = getConfig('grid');
    const routeConfiguration = getRouteConfiguration(config.layout);
    const props = { ...commonProps };
    const SearchPage = getConnectedSearchPageForTests(config.layout);

    const { getByPlaceholderText, getByText, getAllByText, queryByText, getByRole } = render(
      <SearchPage {...props} />,
      {
        initialState,
        config,
        routeConfiguration,
        messages: {
          'FieldSelectTree.screenreader.option': 'Choose {optionName}.',
        },
      }
    );

    await waitFor(() => {
      // Has no Cat filter (primary)
      expect(queryByText('Cat')).not.toBeInTheDocument();

      // Has Category filter
      expect(getByText('FilterComponent.categoryLabel')).toBeInTheDocument();
      expect(getByText('Dogs')).toBeInTheDocument();
      expect(queryByText('Poodle')).not.toBeInTheDocument();
      expect(getByText('Cats')).toBeInTheDocument();
      expect(queryByText('Burmese')).not.toBeInTheDocument();
      expect(getByText('Fish')).toBeInTheDocument();
      expect(queryByText('Freshwater')).not.toBeInTheDocument();
    });

    // Test category intercation: click "Cats"
    await user.click(getByRole('button', { name: 'Choose Cats.' }));

    // Has Cat filter (enum) using SelectMultipleFilter component (it contains also legend for screen readers)
    expect(getAllByText('Cat')).toHaveLength(2);

    expect(getByText('Dogs')).toBeInTheDocument();
    expect(queryByText('Poodle')).not.toBeInTheDocument();
    expect(getByText('Cats')).toBeInTheDocument();
    // Subcategories of Cats should be visible
    expect(queryByText('Burmese')).toBeInTheDocument();
    expect(queryByText('Egyptian mau')).toBeInTheDocument();
    expect(getByText('Fish')).toBeInTheDocument();
    expect(queryByText('Freshwater')).not.toBeInTheDocument();
    expect(queryByText('Saltwater')).not.toBeInTheDocument();
  });

  it('Check that Boat filters is revealed in grid variant', async () => {
    const user = userEvent.setup();
    // Select correct SearchPage variant according to route configuration
    const config = getConfig('grid');
    const routeConfiguration = getRouteConfiguration(config.layout);
    const props = { ...commonProps };
    const SearchPage = getConnectedSearchPageForTests(config.layout);

    const { getByPlaceholderText, getByText, getAllByText, queryByText, getByRole } = render(
      <SearchPage {...props} />,
      {
        initialState,
        config,
        routeConfiguration,
        messages: {
          'FieldSelectTree.screenreader.option': 'Choose {optionName}.',
        },
      }
    );

    await waitFor(() => {
      // Has no Boat filter (primary)
      expect(queryByText('Boat')).not.toBeInTheDocument();

      // NO Listing type filter.
      //
      //   > "Hay que remover el filtro 'Listing type' de search"
      //
      // This marketplace has one listing type, so the control could narrow nothing and rule
      // nothing out.
      expect(queryByText('FilterComponent.listingTypeLabel')).not.toBeInTheDocument();
      // The options too: dropping the label while still rendering four unlabelled radio
      // buttons would be the obvious way to half-do this.
      expect(queryByText('Rent bicycles daily')).not.toBeInTheDocument();
      expect(queryByText('Rent bicycles nightly')).not.toBeInTheDocument();
      expect(queryByText('Rent bicycles hourly')).not.toBeInTheDocument();
      expect(queryByText('Sell bicycles')).not.toBeInTheDocument();
    });

    // The listing type now arrives through the PATH PARAM rather than through a control the
    // reader clicks - see the note on HIDDEN_BUILT_IN_FILTER_KEYS. What is being proved is
    // unchanged: a listing field limited to a listing type shows up once that type is chosen.
    const scoped = render(
      <SearchPage {...commonProps} params={{ listingType: 'sell-bicycles' }} />,
      { initialState, config, routeConfiguration }
    );

    await waitFor(() => {
      // Has Boat filter (enum) using SelectMultipleFilter component (it contains also legend
      // for screen readers)
      expect(scoped.getAllByText('Boat')).toHaveLength(2);
    });
  });

  it('Check that Listing type filter is not revealed when using a listing type path param', async () => {
    // Select correct SearchPage variant according to route configuration
    const config = getConfig('grid');
    const routeConfiguration = getRouteConfiguration(config.layout);
    const props = { ...commonProps, params: { listingType: 'sell-bicycles' } };
    const SearchPage = getConnectedSearchPageForTests(config.layout);

    const { getByPlaceholderText, getByText, getAllByText, queryByText, getByRole } = render(
      <SearchPage {...props} />,
      {
        initialState,
        config,
        routeConfiguration,
      }
    );

    await waitFor(() => {
      // Does not have Listing type filter
      expect(queryByText('FilterComponent.listingTypeLabel')).not.toBeInTheDocument();
      expect(queryByText('Rent bicycles daily')).not.toBeInTheDocument();
      expect(queryByText('Rent bicycles nightly')).not.toBeInTheDocument();
      expect(queryByText('Rent bicycles hourly')).not.toBeInTheDocument();
      expect(queryByText('Sell bicycles')).not.toBeInTheDocument();
    });
  });
});

describe('Duck', () => {
  const defaultConfig = getConfig('map');

  const config = {
    ...defaultConfig,
    categoryConfiguration: {
      categories: [...defaultConfig.categories.categories],
      categoryLevelKeys: ['categoryLevel1', 'categoryLevel2', 'categoryLevel3'],
      key: 'categoryLevel',
      scope: 'public',
    },
    listing: {
      ...defaultConfig.listingFields,
      ...defaultConfig.listingTypes,
    },
    accessControl: { marketplace: { private: true } },
    user: {
      userTypes: defaultConfig.userTypes.userTypes,
    },
  };
  // Shared parameters for viewing rights loadData tests
  const fakeResponse = resource => ({ data: { data: resource, include: [] } });
  const sdkFn = response => jest.fn(() => Promise.resolve(response));
  const currentUser = createCurrentUser('userId');

  // -------------------------------------------------------------------------
  //   > "el filtro de dates (...) muestra un listing que no es propio de las fechas
  //   >  seleccionadas" (Jonathan, 2026-09-10)
  //
  // Nothing here is rented by the day, so "is it free on the 10th?" is not a question anybody
  // can act on. The listing that prompted the report answered it honestly - the 10th WAS free
  // - and a 7-day rental starting then still collided with a booking three days later. The
  // filter has to ask what the picker asks: is a whole period free from this day.
  // -------------------------------------------------------------------------
  it('asks for a whole rental period from the chosen day, not for the days picked', () => {
    const getState = () => ({
      ...initialState,
      user: { currentUser },
      auth: { isAuthenticated: true },
    });
    const query = sdkFn(fakeResponse([]));
    const sdk = {
      currentUser: { show: sdkFn(fakeResponse(currentUser)) },
      listings: { query },
      authInfo: sdkFn({}),
    };
    const dispatch = createFakeDispatch(getState, sdk);

    // The dates filter has to be configured for the params to be built at all - the shared
    // `config` above is the map variant's.
    const withDatesFilter = {
      ...config,
      search: {
        ...config.search,
        defaultFilters: [
          ...(config.search?.defaultFilters || []).filter(f => f.key !== 'dates'),
          { key: 'dates', schemaType: 'dates', availability: 'time-full', dateRangeMode: 'day' },
        ],
      },
    };

    // Dispatched directly rather than through loadData: what is under test is how a picked
    // date becomes an availability query, not how the page reads its URL.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const iso = d => d.toISOString().slice(0, 10);
    const dates = `${iso(tomorrow)},${iso(new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000))}`;

    return dispatch(
      searchListings({ searchParams: { dates, perPage: 24 }, config: withDatesFilter })
    ).then(() => {
      const params = query.mock.calls[0][0];

      // Seven days from the chosen day, not the two the reader happened to touch. The bounds
      // are prolonged either side to cover other time zones - the stock template's doing, and
      // why this asserts a span rather than exact instants.
      const spanMs = params.end.getTime() - params.start.getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(spanMs).toBeGreaterThan(sevenDaysMs);
      expect(spanMs).toBeLessThan(sevenDaysMs + 36 * 60 * 60 * 1000);

      // And the whole of it has to be free. An hour of availability inside a prolonged window
      // is what let a garment free on the 12th answer a search for the 10th.
      expect(params.minDuration).toBe(7 * 1440 - 60);
    });
  });

  // -------------------------------------------------------------------------
  //   > listing `6aa26840-16da-44df-8a74-ff4ece1da4eb` still showing for a search dated
  //   >  2026-09-10, tested in the evening (Jonathan, 2026-09-10)
  //
  // Widening the "is this date valid" cutoff above (36h) let a visitor behind UTC pick their
  // own local "today" late in the day - but that picked day, read as UTC midnight, can then be
  // genuinely behind the marketplace's actual UTC "today". The cleaning-floor post-filter
  // (util/searchCleaningFloor.js) is deliberately anchored on UTC as the day-boundary
  // authority, so comparing a stale `requestedStart` against it made every listing look
  // unbookable - including ones with nothing wrong (already on laundry, cleaning long done).
  // -------------------------------------------------------------------------
  it('does not let a stale picked day hide an already-bookable listing behind the cleaning floor', () => {
    const getState = () => ({
      ...initialState,
      user: { currentUser },
      auth: { isAuthenticated: true },
    });

    // The picked day itself: yesterday, by real UTC clock - the exact shape of a visitor behind
    // UTC picking their own local "today" late enough that it reads as UTC's prior day.
    const pickedDay = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const iso = d => d.toISOString().slice(0, 10);
    const dates = `${iso(pickedDay)},${iso(pickedDay)}`;

    // Already on its laundry, cleaning finished long ago - nothing should block this listing
    // from a search for "today or later".
    const bookableListing = createListing('bookable', {
      metadata: { onLaundry: true, initialCleaningDays: 2, readyAt: '2020-01-01T00:00:00.000Z' },
    });

    const query = sdkFn(fakeResponse([bookableListing]));
    const sdk = {
      currentUser: { show: sdkFn(fakeResponse(currentUser)) },
      listings: { query },
      authInfo: sdkFn({}),
    };
    const dispatch = createFakeDispatch(getState, sdk);

    const withDatesFilter = {
      ...config,
      search: {
        ...config.search,
        defaultFilters: [
          ...(config.search?.defaultFilters || []).filter(f => f.key !== 'dates'),
          { key: 'dates', schemaType: 'dates', availability: 'time-full', dateRangeMode: 'day' },
        ],
      },
    };

    return dispatch(
      searchListings({ searchParams: { dates, perPage: 24 }, config: withDatesFilter })
    ).then(result => {
      expect(result.payload.data.data.map(l => l.id.uuid)).toEqual(['bookable']);
    });
  });

  // -------------------------------------------------------------------------
  //   > "hay que agregar un filtro en el search que nos permita filtrar por listings que
  //   >  esten disponibles para hoy" (Jonathan, 2026-09-11)
  //
  // pickupToday is internally just dates=<today>,<today> fed through the same
  // datesSearchParams the picked-date filter uses, plus a stricter (onLaundry-requiring)
  // post-filter. These pin the wiring, not the date/cleaning-floor math itself, which the
  // tests above and searchCleaningFloor.test.js already cover.
  // -------------------------------------------------------------------------
  describe('the "Pickup Today" filter (pickupToday)', () => {
    const withDatesFilter = {
      ...config,
      search: {
        ...config.search,
        defaultFilters: [
          ...(config.search?.defaultFilters || []).filter(f => f.key !== 'dates'),
          { key: 'dates', schemaType: 'dates', availability: 'time-full', dateRangeMode: 'day' },
        ],
      },
    };

    const dispatchSearch = (searchParams, listings) => {
      const getState = () => ({
        ...initialState,
        user: { currentUser },
        auth: { isAuthenticated: true },
      });
      const query = sdkFn(fakeResponse(listings));
      const sdk = {
        currentUser: { show: sdkFn(fakeResponse(currentUser)) },
        listings: { query },
        authInfo: sdkFn({}),
      };
      const dispatch = createFakeDispatch(getState, sdk);

      return dispatch(
        searchListings({ searchParams, config: withDatesFilter })
      ).then(result => ({ result, query }));
    };

    it('asks the API for a window starting today, with no dates param in the URL', () => {
      return dispatchSearch({ pickupToday: 'true', perPage: 24 }, []).then(({ query }) => {
        const params = query.mock.calls[0][0];

        // Same shape the picked-date filter produces: a real window, not the empty `{}` a
        // request with nothing to filter on would send.
        expect(params.availability).toBe('time-partial');
        expect(params.minDuration).toBeGreaterThan(0);
        // `start` is prolonged 14h before "today" to cover other time zones (same as the
        // picked-date filter) - anchored on right now rather than an exact calendar day,
        // since the prolongation can push it into yesterday depending on the hour this test
        // happens to run.
        const hoursFromNow = (Date.now() - new Date(params.start).getTime()) / (60 * 60 * 1000);
        expect(hoursFromNow).toBeGreaterThan(-1);
        expect(hoursFromNow).toBeLessThan(40);
      });
    });

    it('keeps only listings already on laundry and free today', () => {
      const onLaundryToday = createListing('on-laundry', { metadata: { onLaundry: true } });
      const notOnLaundry = createListing('not-on-laundry', { metadata: { onLaundry: false } });

      return dispatchSearch({ pickupToday: 'true', perPage: 24 }, [
        onLaundryToday,
        notOnLaundry,
      ]).then(({ result }) => {
        expect(result.payload.data.data.map(l => l.id.uuid)).toEqual(['on-laundry']);
      });
    });

    it('defers to an explicit dates filter rather than overriding it with today', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const iso = d => d.toISOString().slice(0, 10);
      const dates = `${iso(tomorrow)},${iso(tomorrow)}`;

      // If pickupToday were overriding the explicit dates param, this query would differ from
      // the same search made without pickupToday at all.
      const withPickupToday = await dispatchSearch({ pickupToday: 'true', dates, perPage: 24 }, []);
      const withoutPickupToday = await dispatchSearch({ dates, perPage: 24 }, []);

      expect(withPickupToday.query.mock.calls[0][0]).toEqual(
        withoutPickupToday.query.mock.calls[0][0]
      );
    });

    it('is a no-op when not requested', () => {
      const listing = createListing('l', { metadata: { onLaundry: false } });

      return dispatchSearch({ perPage: 24 }, [listing]).then(({ result }) => {
        expect(result.payload.data.data.map(l => l.id.uuid)).toEqual(['l']);
      });
    });
  });

  // -------------------------------------------------------------------------
  //   > "Puedes revisar lo necesario para que en una listing card, solo se muestre 'Pickup
  //   >  today' solo si realmente puedo reservar a partir de hoy? Es muy confuso para el
  //   >  usuario si se muestra ese tag pero realmente no puedo reservar hoy" (Jonathan,
  //   >  2026-09-19)
  //
  // An ordinary (non-pickupToday) search still has to tell the CARD which of its results are
  // genuinely bookable today, so the badge (util/searchCleaningFloor.js's isPickupTodayListing,
  // metadata-only) can be corrected the same way the listing page's badge already is. Unlike
  // that page, a search results grid has no per-listing real calendar already in hand - so
  // this is a bounded, ids-scoped follow-up query instead.
  // -------------------------------------------------------------------------
  describe("the card's pickup-today verification (non-filtered search)", () => {
    const withDatesFilter = {
      ...config,
      search: {
        ...config.search,
        defaultFilters: [
          ...(config.search?.defaultFilters || []).filter(f => f.key !== 'dates'),
          { key: 'dates', schemaType: 'dates', availability: 'time-full', dateRangeMode: 'day' },
        ],
      },
    };

    it('asks a second, ids-scoped query only for the onLaundry candidates, and trusts its answer', () => {
      const onLaundryFree = createListing('on-laundry-free', { metadata: { onLaundry: true } });
      const onLaundryBusy = createListing('on-laundry-busy', { metadata: { onLaundry: true } });
      const notOnLaundry = createListing('not-on-laundry', { metadata: { onLaundry: false } });

      const query = jest
        .fn()
        // The main search.
        .mockImplementationOnce(() =>
          Promise.resolve(fakeResponse([onLaundryFree, onLaundryBusy, notOnLaundry]))
        )
        // The verification pass - only one of the two onLaundry listings actually has a real
        // window free today.
        .mockImplementationOnce(() => Promise.resolve(fakeResponse([onLaundryFree])));

      const getState = () => ({
        ...initialState,
        user: { currentUser },
        auth: { isAuthenticated: true },
      });
      const sdk = {
        currentUser: { show: sdkFn(fakeResponse(currentUser)) },
        listings: { query },
        authInfo: sdkFn({}),
      };
      const dispatch = createFakeDispatch(getState, sdk);

      return dispatch(
        searchListings({ searchParams: { perPage: 24 }, config: withDatesFilter })
      ).then(result => {
        expect(query).toHaveBeenCalledTimes(2);
        const verifyCallParams = query.mock.calls[1][0];
        // Scoped to the candidates, not the whole page.
        expect(verifyCallParams.ids.map(id => id.uuid).sort()).toEqual(
          ['on-laundry-busy', 'on-laundry-free'].sort()
        );
        expect(verifyCallParams.availability).toBe('time-partial');

        // The search's own results are untouched (this is a badge signal, not a filter) - all
        // three listings still come back.
        expect(result.payload.data.data.map(l => l.id.uuid).sort()).toEqual(
          ['not-on-laundry', 'on-laundry-busy', 'on-laundry-free'].sort()
        );
        // Only the one the verification query actually confirmed.
        expect(result.payload.pickupTodayIds).toEqual(['on-laundry-free']);
      });
    });

    it('skips the second query entirely when nothing on the page is onLaundry', () => {
      const query = jest.fn(() =>
        Promise.resolve(fakeResponse([createListing('l', { metadata: { onLaundry: false } })]))
      );
      const getState = () => ({
        ...initialState,
        user: { currentUser },
        auth: { isAuthenticated: true },
      });
      const sdk = {
        currentUser: { show: sdkFn(fakeResponse(currentUser)) },
        listings: { query },
        authInfo: sdkFn({}),
      };
      const dispatch = createFakeDispatch(getState, sdk);

      return dispatch(
        searchListings({ searchParams: { perPage: 24 }, config: withDatesFilter })
      ).then(result => {
        expect(query).toHaveBeenCalledTimes(1);
        expect(result.payload.pickupTodayIds).toEqual([]);
      });
    });

    it('fails closed: nobody gets the badge if the verification query itself fails', () => {
      const onLaundry = createListing('on-laundry', { metadata: { onLaundry: true } });
      const query = jest
        .fn()
        .mockImplementationOnce(() => Promise.resolve(fakeResponse([onLaundry])))
        .mockImplementationOnce(() => Promise.reject(new Error('boom')));

      const getState = () => ({
        ...initialState,
        user: { currentUser },
        auth: { isAuthenticated: true },
      });
      const sdk = {
        currentUser: { show: sdkFn(fakeResponse(currentUser)) },
        listings: { query },
        authInfo: sdkFn({}),
      };
      const dispatch = createFakeDispatch(getState, sdk);

      return dispatch(
        searchListings({ searchParams: { perPage: 24 }, config: withDatesFilter })
      ).then(result => {
        // The search itself still succeeds - a broken verification must not break the page.
        expect(result.payload.data.data.map(l => l.id.uuid)).toEqual(['on-laundry']);
        expect(result.payload.pickupTodayIds).toEqual([]);
      });
    });
  });

  it('loadData() for full viewing rights user loads listings', () => {
    const getState = () => ({
      ...initialState,
      user: { currentUser },
      auth: { isAuthenticated: true },
    });

    const sdk = {
      currentUser: { show: sdkFn(fakeResponse(currentUser)) },
      listings: { query: sdkFn(fakeResponse([l1, l2])) },
      authInfo: sdkFn({}),
    };

    const dispatch = createFakeDispatch(getState, sdk);

    const searchParams = getSearchParams(config);
    const listingFields = config?.listing?.listingFields;
    const sanitizeConfig = { listingFields };

    // Tests the actions that get dispatched to the Redux store when SearchPage.duck.js
    // loadData() function is called. If you make customizations to the loadData() logic,
    // update this test accordingly!
    return loadData(null, null, config)(dispatch, getState, sdk).then(data => {
      const allActions = dispatchedActions(dispatch);

      // FIVE now, not three: the page also fetches the studios its pickup filter offers and
      // the brands its brand filter offers. Both are asserted by PRESENCE rather than by
      // position - they are fired without being awaited, so where they interleave with the
      // search's own resolution is a scheduling detail rather than a contract. The search's
      // three actions are then checked in order, with these filtered out, so this test keeps
      // saying what it was written to say.
      const sideLookups = ['SearchPage/fetchLaundryOptions', 'SearchPage/fetchBrands'];

      expect(allActions).toHaveLength(5);
      sideLookups.forEach(prefix => {
        expect(allActions.map(a => a.type)).toContain(`${prefix}/pending`);
      });

      const actions = allActions.filter(a => !sideLookups.some(p => a.type.startsWith(p)));
      expect(actions).toHaveLength(3);

      // First action should be searchListings.pending
      expect(actions[0].type).toBe('SearchPage/searchListings/pending');
      expect(actions[0].meta.arg.searchParams).toEqual(searchParams);

      // Second action should be addMarketplaceEntities
      expect(actions[1]).toEqual(addMarketplaceEntities(fakeResponse([l1, l2]), sanitizeConfig));

      // Third action should be searchListings.fulfilled
      expect(actions[2].type).toBe('SearchPage/searchListings/fulfilled');
      // Neither l1 nor l2 is onLaundry, so the pickup-today verification pass has nothing to
      // check and resolves to an empty list without an extra query - see its own describe
      // block below for that behaviour.
      expect(actions[2].payload).toEqual({ ...fakeResponse([l1, l2]), pickupTodayIds: [] });
    });
  });

  // -------------------------------------------------------------------------
  //   > "filtrando por pickupToday=true en search me devuelve artículos que no muestran ese
  //   >  tag" (Jonathan, 2026-09-19)
  //
  // The unit tests above dispatch `searchListings` directly with a hand-built searchParams
  // object, always spelling `pickupToday: 'true'` as a string - which never exercises the
  // real page-load path. `loadData` parses the URL through `util/urlHelpers.js`'s `parse()`,
  // which turns the query string "true" into the actual BOOLEAN `true` before this thunk ever
  // sees it - so `pickupToday === 'true'` (a string comparison) silently never matched
  // anything a real visitor could trigger, and the filter did nothing on every real request.
  // This test goes through `loadData` with a real query string, the way production actually
  // calls it, specifically so a regression here fails a test again instead of only showing up
  // as "the filter does nothing" in production.
  // -------------------------------------------------------------------------
  it('loadData() with a real ?pickupToday=true URL actually applies the filter', () => {
    const getState = () => ({
      ...initialState,
      user: { currentUser },
      auth: { isAuthenticated: true },
    });

    const query = sdkFn(fakeResponse([]));
    const sdk = {
      currentUser: { show: sdkFn(fakeResponse(currentUser)) },
      listings: { query },
      authInfo: sdkFn({}),
    };

    const dispatch = createFakeDispatch(getState, sdk);

    // Needs a config with the `dates` filter registered - datesSearchParams (which this
    // reuses internally) returns `{}` outright without one, same as a config with no dates
    // filter configured at all.
    const withDatesFilter = {
      ...config,
      search: {
        ...config.search,
        defaultFilters: [
          ...(config.search?.defaultFilters || []).filter(f => f.key !== 'dates'),
          { key: 'dates', schemaType: 'dates', availability: 'time-full', dateRangeMode: 'day' },
        ],
      },
    };

    return loadData(null, '?pickupToday=true', withDatesFilter)(dispatch, getState, sdk).then(() => {
      const allActions = dispatchedActions(dispatch);
      const pendingAction = allActions.find(a => a.type === 'SearchPage/searchListings/pending');

      // parse() really does hand this thunk a boolean, not the string - pinning that here
      // means a future change to parse() itself would also be caught.
      expect(pendingAction.meta.arg.searchParams.pickupToday).toBe(true);

      const params = query.mock.calls[0][0];
      // If the filter is not applying, this call carries no date/availability params at all
      // (an unfiltered search) - the same failure mode reported live.
      expect(params.availability).toBe('time-partial');
      expect(params.minDuration).toBeGreaterThan(0);
    });
  });

  it('loadData() for restricted viewing rights user does not load listings', () => {
    currentUser.effectivePermissionSet.attributes.read = 'permissions/deny';

    const getState = () => ({
      ...initialState,
      user: { currentUser },
      auth: { isAuthenticated: true },
    });

    const sdk = {};

    const dispatch = createFakeDispatch(getState, sdk);

    // Tests the actions that get dispatched to the Redux store when SearchPage.duck.js
    // loadData() function is called. If you make customizations to the loadData() logic,
    // update this test accordingly!
    return loadData(null, null, config)(dispatch, getState, sdk).then(data => {
      expect(dispatchedActions(dispatch)).toEqual([]);
    });
  });
});
