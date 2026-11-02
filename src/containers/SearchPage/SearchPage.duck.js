import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { createImageVariantConfig } from '../../util/sdkLoader';
import { isErrorUserPendingApproval, isForbiddenError, storableError } from '../../util/errors';
import { convertUnitToSubUnit, unitDivisor } from '../../util/currency';
import {
  parseDateFromISO8601,
  getExclusiveEndDate,
  addTime,
  subtractTime,
  daysBetween,
  getStartOf,
} from '../../util/dates';
import { constructQueryParamName, isOriginInUse } from '../../util/search';
import { hasPermissionToViewData, isUserAuthorized } from '../../util/userHelpers';
import { parse } from '../../util/urlHelpers';
import { getReferralParams } from '../../util/webStorageHelpers';

import { fetchBrands, fetchLaundryOptions } from '../../util/api';
import * as log from '../../util/log';

import { addMarketplaceEntities } from '../../ducks/marketplaceData.duck';
import { RENTAL_WINDOW_DAYS } from '../../util/rentalPeriods';
import { withoutUnbookableListings, withOnlyPickupTodayListings } from '../../util/searchCleaningFloor';

// Pagination page size might need to be dynamic on responsive page layouts
// Current design has max 3 columns 12 is divisible by 2 and 3
// So, there's enough cards to fill all columns on full pagination pages
const RESULT_PAGE_SIZE = 24;

// ================ Helper Functions ================ //

const resultIds = data => {
  const listings = data.data;
  return listings
    .filter(l => !l.attributes.deleted && l.attributes.state === 'published')
    .map(l => l.id);
};

// ================ Async Thunks ================ //

/////////////////////
// Search Listings //
/////////////////////
const searchListingsPayloadCreator = ({ searchParams, config }, thunkAPI) => {
  const { dispatch, rejectWithValue, extra: sdk } = thunkAPI;
  // SearchPage can enforce listing query to only those listings with valid listingType
  // NOTE: this only works if you have set 'enum' type search schema to listing's public data fields
  //       - listingType
  //       Same setup could be expanded to 2 other extended data fields:
  //       - transactionProcessAlias
  //       - unitType
  //       ...and then turned enforceValidListingType config to true in configListing.js
  // Read More:
  // https://www.sharetribe.com/docs/how-to/manage-search-schemas-with-flex-cli/#adding-listing-search-schemas
  const searchValidListingTypes = (listingTypes, listingTypePathParam, isListingTypeVariant) => {
    return isListingTypeVariant
      ? {
          pub_listingType: listingTypePathParam,
        }
      : config.listing.enforceValidListingType
      ? {
          pub_listingType: listingTypes.map(l => l.listingType),
          // pub_transactionProcessAlias: listingTypes.map(l => l.transactionType.alias),
          // pub_unitType: listingTypes.map(l => l.transactionType.unitType),
        }
      : {};
  };

  const constructCategoryPropertiesForAPI = (queryParamPrefix, categories, level, params) => {
    const levelKey = `${queryParamPrefix}${level}`;
    const levelValue =
      typeof params?.[levelKey] !== 'undefined' ? `${params?.[levelKey]}` : undefined;
    const foundCategory = categories.find(cat => cat.id === levelValue);
    const subcategories = foundCategory?.subcategories || [];
    // Note: we might need to prepare nested categories too: categoryLevel1, categoryLevel2, categoryLevel3
    return foundCategory && subcategories.length > 0
      ? {
          [levelKey]: levelValue,
          ...constructCategoryPropertiesForAPI(queryParamPrefix, subcategories, level + 1, params),
        }
      : foundCategory
      ? { [levelKey]: levelValue }
      : {};
  };

  /**
   * Category filter params are prepared here. We omit invalid category names.
   * I.e. params that are not part of the currently configured category tree.
   *
   * @param {string} paramName - The name of the parameter to prepare.
   * @param {Object} params - The search params object.
   * @returns {Object} The prepared parameter object.
   */
  const prepareCategoryParams = (paramName, params) => {
    const categoryConfig = config.search.defaultFilters?.find(f => f.schemaType === 'category');
    const categories = config.categoryConfiguration.categories;
    const { key, scope } = categoryConfig || {};
    const categoryParamPrefix = constructQueryParamName(key, scope);
    return paramName.startsWith(categoryParamPrefix)
      ? constructCategoryPropertiesForAPI(categoryParamPrefix, categories, 1, params)
      : {};
  };

  const constructIntegerRangePropertyForAPI = (queryParamPrefix, params) => {
    const integerValue = params?.[queryParamPrefix];
    const [min, max] = integerValue ? integerValue.split(',') : [];
    // NOTE: long filter needs exclusive max value on API side
    const inclusiveMin = Number.parseInt(min, 10);
    const exclusiveMax = Number.parseInt(max, 10) + 1;

    // NOTE: currently we don't validate the range values against the integer range config,
    // but we might want to do that in the future.

    return Number.isInteger(inclusiveMin) && Number.isInteger(exclusiveMax)
      ? { [queryParamPrefix]: [inclusiveMin, exclusiveMax].join(',') }
      : {};
  };

  /**
   * Integer range filter values are converted to API params of type 'long'.
   *
   * The range end must be exclusive. E.g. 1000,2000 -> 1000,2001
   *
   * NOTE: currently we don't validate the range values against the integer range config,
   * but we might want to do that in the future.
   *
   * @param {string} paramName - The name of the parameter to prepare.
   * @param {Object} params - The search params object.
   * @returns {Object} The prepared parameter object.
   */
  const prepareIntegerRangeParam = (paramName, params) => {
    const integerRangeConfig = config.listing.listingFields?.find(f => {
      const isInteger = f.schemaType === 'long';
      const isCorrectExtendedDataKey = constructQueryParamName(f.key, f.scope) === paramName;
      return isInteger && isCorrectExtendedDataKey;
    });
    const { key, scope } = integerRangeConfig || {};
    const integerParamPrefix = constructQueryParamName(key, scope);
    return paramName.startsWith(integerParamPrefix)
      ? constructIntegerRangePropertyForAPI(integerParamPrefix, params)
      : {};
  };

  // This function goes through given params and if there's a specific handler for the parameter type,
  // it calls the handler to prepare the property for API.
  // Otherwise, it just passes the param through.
  const prepareAPIParams = (params, paramHandlers) => {
    const pickedKeys = Object.entries(params).reduce((picked, [k, v]) => {
      const preparedParams = paramHandlers.reduce((picked, fn) => {
        return { ...picked, ...fn(k, params) };
      }, {});

      // If the param is not handled by any of the handlers, we pass it through.
      const currentParam = Object.keys(preparedParams).length > 0 ? preparedParams : { [k]: v };

      return { ...picked, ...currentParam };
    }, {});

    return pickedKeys;
  };

  const priceSearchParams = priceParam => {
    const inSubunits = value => convertUnitToSubUnit(value, unitDivisor(config.currency));
    const values = priceParam ? priceParam.split(',') : [];
    return priceParam && values.length === 2
      ? {
          price: [inSubunits(values[0]), inSubunits(values[1]) + 1].join(','),
        }
      : {};
  };

  const datesSearchParams = datesParam => {
    const searchTZ = 'Etc/UTC';
    const datesFilter = config.search.defaultFilters.find(f => f.key === 'dates');
    const values = datesParam ? datesParam.split(',') : [];
    const hasValues = datesFilter && datesParam && values.length === 2;
    const { dateRangeMode, availability } = datesFilter || {};
    const isNightlyMode = dateRangeMode === 'night';
    const isEntireRangeAvailable = availability === 'time-full';

    // SearchPage need to use a single time zone but listings can have different time zones
    // We need to expand/prolong the time window (start & end) to cover other time zones too.
    //
    // NOTE: you might want to consider changing UI so that
    //   1) location is always asked first before date range
    //   2) use some 3rd party service to convert location to time zone (IANA tz name)
    //   3) Make exact dates filtering against that specific time zone
    //   This setup would be better for dates filter,
    //   but it enforces a UX where location is always asked first and therefore configurability
    const getProlongedStart = date => subtractTime(date, 14, 'hours', searchTZ);
    const getProlongedEnd = date => addTime(date, 12, 'hours', searchTZ);

    const startDate = hasValues ? parseDateFromISO8601(values[0], searchTZ) : null;
    const endRaw = hasValues ? parseDateFromISO8601(values[1], searchTZ) : null;
    const endDate =
      hasValues && isNightlyMode
        ? endRaw
        : hasValues
        ? getExclusiveEndDate(endRaw, searchTZ)
        : null;

    // THE CUTOFF HAS TO BE ANCHORED ON THE ACTUAL MOMENT, NOT ON UTC'S CALENDAR PAGE.
    //
    //   > listing `6aa26840-16da-44df-8a74-ff4ece1da4eb` still showing for a search dated
    //   >  2026-09-10, tested in the evening (Jonathan, 2026-09-10)
    //
    // `startDate` is the picked day read as UTC midnight (see parseDateFromISO8601 above), but
    // the picker itself runs in the visitor's own local calendar. For any timezone behind UTC,
    // "today" locally can already read as UTC's NEXT day by evening - e.g. at 9pm in Mexico
    // City (UTC-6) it is already past 3am UTC tomorrow. The old cutoff compared against
    // `getStartOf(now, 'day', 'Etc/UTC')` minus a 14-hour grace window, which is generous
    // against UTC's *own* clock but not against a visitor whose local day runs behind it: the
    // gap between a UTC-midnight-anchored "today" and the real instant can reach ~30 hours for
    // UTC-6 and worse further west. Once it did, `hasValidDates` went false and the whole date
    // filter silently dropped out (`{}`), returning every listing unfiltered - the picker
    // wasn't wrong, it just stopped running at all.
    //
    // So the cutoff is measured against the real "now", not a UTC day boundary, with a buffer
    // wide enough to cover any visitor's local "today" (up to UTC-12, the most negative real
    // offset). Being generous here costs nothing: this is a past/nonsense guard against a URL
    // param, not the search window itself.
    const possibleStartDate = subtractTime(new Date(), 36, 'hours', searchTZ);
    const hasValidDates =
      hasValues &&
      startDate.getTime() >= possibleStartDate.getTime() &&
      startDate.getTime() <= endDate.getTime();

    // THE DATE IS A START DATE, NOT A RANGE OF DAYS SOMEBODY WANTS FREE.
    //
    //   > "el filtro de dates (...) muestra un listing que no es propio de las fechas
    //   >  seleccionadas" (Jonathan, 2026-09-10)
    //
    // Nothing in this marketplace is rented by the day: a garment goes out for a whole period,
    // 7 days or 14. So "is this free on the 10th?" - the question this filter used to ask - is
    // not a question anybody can act on, and the listing that prompted the report answered it
    // honestly: the 10th WAS free. What was not possible was a 7-day rental starting then,
    // because a booking sat across the 13th to the 21st.
    //
    // The picker has always asked the right question (isWindowAvailableFn in
    // BookingRentalPeriodForm), so the filter now asks it too: is a whole rental period free,
    // starting on the day you picked. Anything else puts garments in front of a reader that
    // the next screen refuses.
    //
    // The END OF THE PICKED RANGE IS IGNORED on purpose. Selecting "10 to 11" cannot mean a
    // two-day rental because no such rental exists; it can only mean "I want it around the
    // 10th". The first day is the only part of that with a meaning the marketplace can honour.
    const day = 1440;
    const hour = 60;
    const windowEnd = getStartOf(startDate, 'day', searchTZ, RENTAL_WINDOW_DAYS, 'days');
    // The whole window, not one hour of it. `time-partial` with the prolonged window below is
    // what let a garment free on the 12th answer a search for the 10th.
    const minDuration = RENTAL_WINDOW_DAYS * day - hour;

    // THE API REJECTS A `start` MORE THAN A DAY OLD, EVEN WHEN THE CUTOFF ABOVE ALLOWS IT.
    //
    // The 36-hour grace period on `hasValidDates` exists so a visitor behind UTC can still pick
    // "today" late in their day (see above). But `getProlongedStart` then subtracts another 14
    // hours from that already-stale `startDate`, and Sharetribe's own search endpoint hard-
    // rejects a `start` more than 24 hours in the past with a 400 - which would have surfaced
    // as a broken search page, not a wrong result. So the prolonged start is clamped to the
    // API's own limit rather than trusted as-is; the query is still permissive (it just can't
    // reach as far back as `getProlongedStart` would like when `startDate` itself is stale).
    const earliestAllowedStart = subtractTime(new Date(), 24, 'hours', searchTZ);
    const prolongedStart = getProlongedStart(startDate);
    const start =
      prolongedStart.getTime() < earliestAllowedStart.getTime()
        ? earliestAllowedStart
        : prolongedStart;

    return hasValidDates
      ? {
          start,
          end: getProlongedEnd(windowEnd),
          // Still time-partial, because the window above is prolonged by a day's worth of
          // hours to cover other time zones - `time-full` would then demand availability
          // outside the rental itself. `minDuration` is what enforces the whole period.
          availability: 'time-partial',
          // minDuration uses minutes
          minDuration,
        }
      : {};
  };

  const stockFilters = datesMaybe => {
    const hasDatesFilterInUse = Object.keys(datesMaybe).length > 0;

    // If dates filter is not in use,
    //   1) Add minStock filter with default value (1)
    //   2) Add relaxed stockMode: "match-undefined"
    // The latter is used to filter out all the listings that explicitly are out of stock,
    // but keeps bookable and inquiry listings.
    return hasDatesFilterInUse ? {} : { minStock: 1, stockMode: 'match-undefined' };
  };

  const seatsSearchParams = (seats, datesMaybe) => {
    const seatsFilter = config.search.defaultFilters.find(f => f.key === 'seats');
    const hasDatesFilterInUse = Object.keys(datesMaybe).length > 0;

    // Seats filter cannot be applied without dates
    return hasDatesFilterInUse && seatsFilter ? { seats } : {};
  };

  const sortSearchParams = (sortParam, hasKeywords) => {
    const sortConfig = config?.search?.sortConfig || {};
    // If no sort options are set, defaultSort will be undefined
    const defaultSort = sortConfig?.options?.[0]?.key;
    const relevanceEnabled = sortConfig.options?.some(
      option => option.key === sortConfig.relevanceKey
    );

    // User-specified sort takes priority
    if (sortParam !== undefined && sortParam !== sortConfig.relevanceKey) {
      return { sort: sortParam };
    }

    // No sort parameter needed when keyword search is used or sort config is inactive
    if (relevanceEnabled && (hasKeywords || !sortConfig.active)) {
      return {};
    }

    // Fall back to default sort
    return { sort: defaultSort };
  };

  const {
    perPage,
    price,
    dates,
    pickupToday,
    seats,
    sort,
    mapSearch,
    listingTypePathParam,
    isListingTypeVariant,
    ...restOfParams
  } = searchParams;
  // The params related to default filters are prepared one-by-one
  // We could consider moving them to the prepareAPIParams function too.
  const priceMaybe = priceSearchParams(price);

  // The FIRST day the reader asked about, kept out of the query params on purpose - it is not
  // something the API is asked, it is what the cleaning floor is compared against once the API
  // has answered. Parsed the same way `datesSearchParams` parses it, and null unless the
  // dates filter produced a usable range, so a search with no dates filters nothing.
  //
  // CLAMPED FORWARD TO UTC'S OWN "TODAY" - the cleaning floor (util/cleaningFloor.js) is
  // deliberately anchored on the marketplace's day-boundary authority (UTC), not on whichever
  // browser is shopping, precisely so the floor cannot depend on a customer's clock. A visitor
  // behind UTC (e.g. Mexico City) can still pick their own local "today" late in the day - see
  // the 36h grace window above - and that picked day, read as UTC midnight, is then genuinely
  // BEHIND the marketplace's current UTC day. Comparing that stale value against a floor that
  // is correctly anchored on real UTC "today" made every listing look unbookable, including
  // ones with nothing wrong at all (onLaundry already true, cleaning long finished) - the 36h
  // widening fixed the query but broke this comparison by construction. Clamping to "no earlier
  // than UTC's actual today" keeps both halves asking about the same day.
  const today = getStartOf(new Date(), 'day', 'Etc/UTC');

  // "PICKUP TODAY" IS NOT A NEW QUESTION, JUST TODAY'S ANSWER TO THE OLD ONE.
  //
  //   > "hay que agregar un filtro en el search que nos permita filtrar por listings que
  //   >  esten disponibles para hoy" (Jonathan, 2026-09-11)
  //
  // Rather than a second copy of the date filter's own timezone handling (the 36h cutoff
  // above, the UTC-anchored clamp just below, the API's own "not more than a day in the past"
  // limit further down), this is internally just `dates=<today>,<today>`, fed through the SAME
  // datesSearchParams - it inherits every fix already made to that function instead of risking
  // a fourth, independent bug in the same family. An explicit `dates` filter still wins if the
  // reader set one; "today" and a chosen range cannot both be the question being asked.
  //
  // TRUE, NOT "true". `util/urlHelpers.js`'s `parse()` - what `loadData` actually feeds this
  // thunk from the URL - turns the query string "true"/"false" into real booleans before this
  // function ever sees them, so a URL of `?pickupToday=true` arrives here as the boolean
  // `true`. Comparing against the STRING `'true'` (as this did originally) never matches
  // anything reached through the real page-load path: the filter silently did nothing, on
  // every search, indistinguishable from an unfiltered one - which is exactly the reported
  // "the filter returns listings that don't even qualify" (Jonathan, 2026-09-19). Checked
  // against both forms since a caller could still hand this a literal string directly (as the
  // duck's own tests do, dispatching without going through parse() at all).
  const isPickupToday = pickupToday === true || pickupToday === 'true';
  const todayIso = today.toISOString().slice(0, 10);
  const effectiveDates = dates || (isPickupToday ? `${todayIso},${todayIso}` : dates);
  const datesMaybe = datesSearchParams(effectiveDates);

  // THE SAME REAL WINDOW, kept around regardless of whether THIS search is filtered by
  // pickupToday - see the verification pass below, which needs it for every search so the
  // CARD badge (not just the filter) can tell the truth. Cheap to compute; only occasionally
  // spent.
  const todayWindowParams = datesSearchParams(`${todayIso},${todayIso}`);

  const requestedStart =
    datesMaybe.start &&
    typeof effectiveDates === 'string' &&
    effectiveDates.split(',').length === 2
      ? [parseDateFromISO8601(effectiveDates.split(',')[0], 'Etc/UTC'), today].reduce((a, b) =>
          a.getTime() > b.getTime() ? a : b
        )
      : null;
  const stockMaybe = stockFilters(datesMaybe);
  const seatsMaybe = seatsSearchParams(seats, datesMaybe);
  const sortMaybe = sortSearchParams(sort, searchParams?.keywords !== undefined);

  // Filter out potential referral data parameters so that they are not included in the API query
  const { userTypes = [] } = config.user;
  const validReferralSources = getReferralParams(userTypes);
  const apiParamsRaw = Object.fromEntries(
    Object.entries(restOfParams).filter(entry => {
      const [key, value] = entry;

      return !validReferralSources.includes(key);
    })
  );

  const params = {
    // The params that are related to listing fields and categories are prepared here.
    // We add handler functions that check category and integer range configurations.
    // - With category params, we essentially just omit invalid category names.
    //   I.e. params that are not part of the currently configured category tree.
    // - With integer range params, we prepare the property for API.
    //   I.e. the range end must be exclusive. E.g. 1000,2000 -> 1000,2001
    // Note: invalid independent search params are still passed through
    ...prepareAPIParams(apiParamsRaw, [prepareCategoryParams, prepareIntegerRangeParam]),
    // If the search page variant is of type /s/:listingType, this sets the pub_listingType
    // query parameter to the value of the listing type path parameter. The ordering matters here,
    // since this value overrides any possible pub_listingType value coming from query parameters
    // i.e. the previous row.
    //
    // Only one value is currently supported in pub_listingType – if you want to support e.g.
    // /s/:listingType?pub_listingType=[otherListingType] => pub_listingType=listingType,otherListingType,
    // you'll need to customize a logic that merges the query param and path param values.
    ...searchValidListingTypes(
      config.listing.listingTypes,
      listingTypePathParam,
      isListingTypeVariant
    ),
    ...priceMaybe,
    ...datesMaybe,
    ...stockMaybe,
    ...seatsMaybe,
    ...sortMaybe,
    perPage,
  };

  // pickupToday: the API paginates BEFORE we filter, so we fetch all the
  // candidates (up to 5 pages of 100), filter them, and paginate ourselves.
  const fetchAllPickupCandidates = async () => {
    const { page: _page, ...base } = params;
    const query = p => sdk.listings.query({ ...base, perPage: 100, page: p });
    const first = await query(1);
    const totalPages = Math.min(first.data.meta?.totalPages || 1, 5);
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) => query(i + 2))
    );
    const all = [first, ...rest];
    return {
      ...first,
      data: {
        ...first.data,
        data: all.flatMap(r => r.data.data),
        included: all.flatMap(r => r.data.included || []),
      },
    };
  };

  const paginateLocally = res => {
    if (!isPickupToday) return res;
    const items = res.data.data;
    const pageSize = params.perPage;
    const page = Number(params.page) || 1;
    const from = (page - 1) * pageSize;
    return {
      ...res,
      data: {
        ...res.data,
        data: items.slice(from, from + pageSize),
        meta: {
          ...res.data.meta,
          page,
          perPage: pageSize,
          totalItems: items.length,
          totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
        },
      },
    };
  };

  return (isPickupToday ? fetchAllPickupCandidates() : sdk.listings.query(params))
    .then(response => {
      const listingFields = config?.listing?.listingFields;
      const sanitizeConfig = { listingFields };

      // Dropped BEFORE the entities are stored, so nothing downstream has to remember to
      // exclude them again: the results, the map and the count all read what is kept.
      //
      // pickupToday's post-fetch pass is the STRICTER one - the same rule the card badge
      // uses, additionally requiring onLaundry - so it runs instead of (not on top of)
      // withoutUnbookableListings' plain cleaning-floor check.
      const filtered = paginateLocally(
        isPickupToday
          ? withOnlyPickupTodayListings(response)
          : withoutUnbookableListings(response, requestedStart)
      );

      // VERIFY THE CARD'S OWN CLAIM, NOT JUST THE FILTER'S.
      //
      //   > "Puedes revisar lo necesario para que en una listing card, solo se muestre
      //   >  'Pickup today' solo si realmente puedo reservar a partir de hoy? Es muy confuso
      //   >  para el usuario si se muestra ese tag pero realmente no puedo reservar hoy"
      //   >   (Jonathan, 2026-09-19)
      //
      // isPickupTodayListing (util/searchCleaningFloor.js) is a metadata-only approximation,
      // on purpose - a real per-card availability check would mean one query per card in a
      // grid of 24. The compromise: ONE bounded follow-up query per search results PAGE,
      // scoped only to the `onLaundry` candidates already on it (typically far fewer than the
      // full page), asking Sharetribe the exact question the picker and the pickupToday
      // filter already ask - does a whole rental window fit starting today. Its answer is
      // what the card actually renders from now on; the approximation is only what decides
      // whether this query runs at all.
      //
      // Skipped entirely when isPickupToday: withOnlyPickupTodayListings already ran the real
      // query to build `filtered`, so every id in it is already verified.
      const onLaundryCandidateIds = isPickupToday
        ? []
        : (filtered?.data?.data || [])
            .filter(listing => listing?.attributes?.metadata?.onLaundry === true)
            .map(listing => listing.id);

      const verifyPickupToday =
        onLaundryCandidateIds.length === 0
          ? Promise.resolve([])
          : sdk.listings
              .query({
                ids: onLaundryCandidateIds,
                ...todayWindowParams,
                perPage: onLaundryCandidateIds.length,
              })
              .then(verifyResponse => verifyResponse.data.data.map(listing => listing.id.uuid))
              // Fails closed: nobody gets the badge rather than everybody, if the check
              // itself cannot be answered.
              .catch(() => []);

      return verifyPickupToday.then(verifiedIds => {
        dispatch(addMarketplaceEntities(filtered, sanitizeConfig));
        const pickupTodayIds = isPickupToday
          ? (filtered?.data?.data || []).map(listing => listing.id.uuid)
          : verifiedIds;
        return { ...filtered, pickupTodayIds };
      });
    })
    .catch(e => {
      const error = storableError(e);
      if (!(isErrorUserPendingApproval(error) || isForbiddenError(error))) {
        return rejectWithValue(error);
      }
      return rejectWithValue(error);
    });
};

export const searchListings = createAsyncThunk(
  'SearchPage/searchListings',
  searchListingsPayloadCreator
);

// ─────────────────────────────────────────────────────────────────────────────
// The studios a customer can filter by.
//
//   > "Manten el filtro / Arma un endpoint publico para mostrar laundries"
//
// The filter itself needs no help - `meta_assignedLaundryId` has a live search schema
// (verified against Dev: filtering by each of the three studios returns exactly its own
// garments). What it needs is the list of studios to offer, and a studio's name lives on the
// laundry USER, which the browser cannot query. Hence a server endpoint.
//
// PUBLIC, and deliberately its own endpoint rather than the authenticated directory with the
// session removed - see server/api/laundry-options.js for what that distinction protects.
//
// FAILURE IS NOT AN ERROR STATE. No rejected case and no error field: a marketplace whose
// search page will not render because a dropdown could not be populated is a far worse
// outcome than a search page with one filter missing.
// ─────────────────────────────────────────────────────────────────────────────
export const fetchLaundryOptionsThunk = createAsyncThunk('SearchPage/fetchLaundryOptions', () =>
  fetchLaundryOptions()
    .then(response => (Array.isArray(response?.data) ? response.data : []))
    .catch(e => {
      // Logged, not surfaced. A studio directory that has become unreadable is worth
      // knowing about even though the customer is never told.
      log.error(e, 'fetching-laundry-options-failed', {});
      return [];
    })
);

// ─────────────────────────────────────────────────────────────────────────────
// The brands a customer can filter by.
//
//   > "podemos usar un selector de brands que ya existen para mostrarlos en el filtro"
//
// Same shape as the studio lookup above, for the same reason. `pub_brand` has a live search
// schema - verified against Dev, where `pub_brand=Reformation` returns exactly its one garment
// while an unrecognised KEY returns the whole marketplace, which is how you tell a schema is
// really there rather than being silently ignored. What the filter needs is the list of brands
// to OFFER, and brand is deliberately not a Console field, so the values come from the listings.
//
// FAILURE IS NOT AN ERROR STATE, as above: a search page that will not render because a dropdown
// could not be filled is worse than one filter short.
// ─────────────────────────────────────────────────────────────────────────────
export const fetchBrandsThunk = createAsyncThunk('SearchPage/fetchBrands', () =>
  fetchBrands()
    .then(response => (Array.isArray(response?.data) ? response.data : []))
    .catch(e => {
      log.error(e, 'fetching-brands-failed', {});
      return [];
    })
);

// ================ Slice ================ //

const searchPageSlice = createSlice({
  name: 'SearchPage',
  initialState: {
    pagination: null,
    searchParams: null,
    searchInProgress: false,
    searchListingsError: null,
    currentPageResultIds: [],
    activeListingId: null,
    // Cocloset: the studios a customer can filter the results by, as { id, name }. Empty
    // until the public endpoint answers, and on any failure - the filter then renders
    // nothing rather than an empty dropdown, which would read as "there are no laundries".
    laundryOptions: [],
    // Cocloset: the brands a customer can filter by, as { brand, count }. Empty until the
    // public endpoint answers, and on any failure - the filter then renders nothing rather than
    // an empty dropdown, which would read as "there are no brands".
    brandOptions: [],
    // Cocloset: listing ids on the current page verified (a real availability query, not the
    // metadata-only approximation) as bookable starting today. See searchListingsPayloadCreator.
    pickupTodayIds: [],
  },
  reducers: {
    setActiveListing: (state, action) => {
      state.activeListingId = action.payload;
    },
  },
  extraReducers: builder => {
    // Search Listings
    builder
      .addCase(searchListings.pending, (state, action) => {
        state.searchParams = action.meta.arg.searchParams;
        state.searchInProgress = true;
        state.searchListingsError = null;
      })
      .addCase(searchListings.fulfilled, (state, action) => {
        state.currentPageResultIds = resultIds(action.payload.data);
        state.pagination = action.payload.data.meta;
        state.searchInProgress = false;
        // Which of this page's results are verified, for real, as bookable from today - see
        // the "VERIFY THE CARD'S OWN CLAIM" comment in searchListingsPayloadCreator. Plain
        // uuid strings, matched against listing.id.uuid wherever a card renders.
        state.pickupTodayIds = action.payload.pickupTodayIds || [];
      })
      .addCase(searchListings.rejected, (state, action) => {
        console.error(action.payload);
        state.searchInProgress = false;
        state.searchListingsError = action.payload;
      })
      // Only `fulfilled`, and the payload creator never rejects: a failed lookup resolves to
      // an empty list, which is what the initial state already says. The pickup filter is an
      // improvement on a working search, not a new dependency of it.
      .addCase(fetchLaundryOptionsThunk.fulfilled, (state, action) => {
        state.laundryOptions = action.payload;
      })
      // Same contract: only `fulfilled`, because the payload creator resolves to an empty list
      // instead of rejecting.
      .addCase(fetchBrandsThunk.fulfilled, (state, action) => {
        state.brandOptions = action.payload;
      });
  },
});

// Export the action creator
export const { setActiveListing } = searchPageSlice.actions;

export default searchPageSlice.reducer;

// ================ Load data ================ //

export const loadData = (params, search, config) => (dispatch, getState, sdk) => {
  // In private marketplace mode, this page won't fetch data if the user is unauthorized
  const { listingType: listingTypePathParam } = params || {};
  const state = getState();
  const currentUser = state.user?.currentUser;
  const isAuthorized = currentUser && isUserAuthorized(currentUser);
  const hasViewingRights = currentUser && hasPermissionToViewData(currentUser);
  const isPrivateMarketplace = config.accessControl.marketplace.private === true;
  const canFetchData =
    !isPrivateMarketplace || (isPrivateMarketplace && isAuthorized && hasViewingRights);
  if (!canFetchData) {
    return Promise.resolve();
  }

  const queryParams = parse(search, {
    latlng: ['origin'],
    latlngBounds: ['bounds'],
  });

  const { page = 1, address, origin, ...rest } = queryParams;
  const originMaybe = isOriginInUse(config) && origin ? { origin } : {};

  const listingTypeVariantMaybe = listingTypePathParam
    ? { listingTypePathParam, isListingTypeVariant: true }
    : {};

  const {
    aspectWidth = 1,
    aspectHeight = 1,
    variantPrefix = 'listing-card',
  } = config.layout.listingImage;
  const aspectRatio = aspectHeight / aspectWidth;

  const searchListingsCall = searchListings({
    searchParams: {
      ...rest,
      ...originMaybe,
      ...listingTypeVariantMaybe,
      page,
      perPage: RESULT_PAGE_SIZE,
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
        // Cocloset: what the search card actually shows. `fields.listing` is an ALLOWLIST -
        // a field not named here arrives undefined, so the brand eyebrow, the size and the
        // collection point would each render as nothing at all, on every card, with no error
        // anywhere. Adding the card's fields and adding them to this list are one change.
        'publicData.brand',
        'publicData.size',
        'publicData.assignedLaundryName',
        'publicData.pickupNeighborhood',
        // WHAT THE DATE FILTER CANNOT ASK SHARETRIBE.
        //
        //   > "tengo un listing que estará disponible hasta el día 22 de septiembre; sin
        //   >  embargo, cuando hago filtros por fecha (...) aparece el listing como resultado"
        //   >   (Jonathan, 2026-09-10)
        //
        // The initial cleaning lead time is not on the calendar - it is relative to a drop-off
        // that has not happened yet - so `listings.query` has no reason to exclude a garment
        // that cannot be collected for another fortnight. These three are what the same rule
        // the picker applies needs to run here. See util/searchCleaningFloor.js.
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
    },
    config,
  });

  const searchPromise = dispatch(searchListingsCall);

  // The pickup filter's options, AFTER the search is under way and never awaited. The results
  // do not depend on them, so a slow studio lookup must not delay the listings - and firing it
  // second keeps the search the first thing this page does, which is what it is for.
  //
  // Browser-only for the same mundane reason ListingPage's live-cleaning fetch is: src/util/
  // api.js builds its base URL from `window.location.origin`. It costs nothing here, since
  // the filter bar renders after mount either way.
  if (typeof window !== 'undefined') {
    dispatch(fetchLaundryOptionsThunk());
    dispatch(fetchBrandsThunk());
  }

  return searchPromise;
};
