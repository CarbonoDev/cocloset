import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { storableError } from '../../util/errors';
import { parse, getValidInboxSort } from '../../util/urlHelpers';
import { getSupportedProcessesInfo } from '../../transactions/transaction';
import { createImageVariantConfig } from '../../util/sdkLoader';
import { addMarketplaceEntities } from '../../ducks/marketplaceData.duck';
import { sumProviderEarnings } from '../../util/providerEarnings';

const INBOX_PAGE_SIZE = 10;

// THE EARNINGS WALK.
//
// The inbox shows ten rentals at a time. A total computed from what is on screen would change
// as the reader pages, which is worse than no total at all - so this walks the whole list.
//
// A SEPARATE, LEANER QUERY rather than reusing the page above: this needs two fields per
// transaction and none of the images, the listing or the two users, so asking for the inbox's
// full payload would fetch a wardrobe's worth of pictures to add up some numbers.
//
// PER PAGE is the API's maximum, and MAX_PAGES bounds what one page view can spend - the same
// contract the server-side walks use. When the cap is hit the total is marked partial rather
// than presented as complete; an owner with more sales than this deserves a caveat, not a
// quietly wrong number.
const EARNINGS_PER_PAGE = 100;
const EARNINGS_MAX_PAGES = 10;

// ================ Helper functions ================ //

const entityRefs = entities =>
  entities.map(entity => ({
    id: entity.id,
    type: entity.type,
  }));

// ================ Slice ================ //

const inboxPageSlice = createSlice({
  name: 'InboxPage',
  initialState: {
    fetchInProgress: false,
    fetchOrdersOrSalesError: null,
    pagination: null,
    transactionRefs: [],
    // Cocloset: what the owner has been paid, across every sale rather than the page on
    // screen. Null until the walk answers, and on any failure - the inbox is not worth
    // breaking over a summary line. See fetchProviderEarningsThunk.
    providerEarnings: null,
  },
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(loadDataThunk.pending, state => {
        state.fetchInProgress = true;
        state.fetchOrdersOrSalesError = null;
      })
      .addCase(loadDataThunk.fulfilled, (state, action) => {
        const transactions = action.payload.data.data;
        state.fetchInProgress = false;
        state.transactionRefs = entityRefs(transactions);
        state.pagination = action.payload.data.meta;
      })
      .addCase(loadDataThunk.rejected, (state, action) => {
        console.error(action.payload || action.error);
        state.fetchInProgress = false;
        state.fetchOrdersOrSalesError = action.payload;
      })
      // Only `fulfilled`: the payload creator resolves to null instead of rejecting, so a
      // failed walk leaves the initial state alone and the summary simply does not render.
      .addCase(fetchProviderEarningsThunk.fulfilled, (state, action) => {
        state.providerEarnings = action.payload;
      });
  },
});

export default inboxPageSlice.reducer;

// ================ Load data ================ //

const loadDataPayloadCreator = ({ params, search }, { dispatch, rejectWithValue, extra: sdk }) => {
  const { tab } = params;

  const onlyFilterValues = {
    orders: 'order',
    sales: 'sale',
  };

  const onlyFilter = onlyFilterValues[tab];
  if (!onlyFilter) {
    return Promise.reject(new Error(`Invalid tab for InboxPage: ${tab}`));
  }

  const { page = 1, sort } = parse(search);
  const processNames = getSupportedProcessesInfo().map(p => p.name);

  const apiQueryParams = {
    only: onlyFilter,
    processNames,
    include: [
      'listing',
      // Cocloset: the garment's photo, for the list and for the detail header. The inbox is a
      // wardrobe now, not a message list - a row without the garment on it is unreadable at a
      // glance, which is the whole reason the design puts a thumbnail on every one.
      'listing.images',
      'provider',
      'provider.profileImage',
      'customer',
      'customer.profileImage',
      'booking',
    ],
    'fields.transaction': [
      'processName',
      'lastTransition',
      'lastTransitionedAt',
      'transitions',
      'payinTotal',
      'payoutTotal',
      'lineItems',
      // Cocloset: the ticket the counter goes by, and the studio's own code for the garment.
      // `fields.transaction` is an ALLOWLIST - without this the detail panel would render
      // those two rows blank on every rental, with nothing anywhere saying why.
      'metadata',
    ],
    'fields.listing': [
      'title',
      'availabilityPlan',
      'publicData.listingType',
      'publicData.transactionProcessAlias',
      'publicData.unitType',
      // Cocloset: what the detail panel actually shows - the brand above the title, and where
      // the garment is collected. Same allowlist trap as above.
      'publicData.brand',
      'publicData.assignedLaundryName',
      'publicData.pickupAddress',
      // WHERE THE GARMENT PHYSICALLY IS, which decides whether the OWNER is shown the QR
      // (see InboxTransactionPanel and transactions/transactionProcessCoclosetBooking.js).
      //
      //   > "el QR tiene inconsistencias, en la ventana de inbox y en transaction page, a
      //   >  veces no aparece en inbox, luego al ingresar a tx page y luego regreso, aparece"
      //   >   (Jonathan, 2026-09-09)
      //
      // That is this allowlist. Without the field, `metadata` is absent here and the rule
      // read `onLaundry` as false for every rental - so the inbox always answered with the
      // DROP-OFF rule. Opening the transaction page loads the listing in full into the same
      // entity store, so coming back the inbox suddenly had the flag and changed its mind.
      // Two screens, one rule, two answers, depending on where you had been.
      'metadata.onLaundry',
    ],
    'fields.user': ['profile.displayName', 'profile.abbreviatedName', 'deleted', 'banned'],
    'fields.image': [
      'variants.square-small',
      'variants.square-small2x',
      // The garment thumbnails. The two square variants above are avatar-sized and are what
      // the stock inbox used for the counterparty's photo; a garment needs a real one.
      'variants.listing-card',
      'variants.listing-card-2x',
    ],
    // AND THE VARIANT HAS TO BE ASKED FOR, not just named above. `fields.image` says which
    // variants to RETURN; `imageVariant.<name>` is what makes the API generate one. Naming a
    // variant that was never requested returns an image with no such variant, and
    // ResponsiveImage then renders a broken <img> - which is exactly what shipped, on every
    // row, because this page was never opened with data in it.
    ...createImageVariantConfig('listing-card', 400, 1),
    ...createImageVariantConfig('listing-card-2x', 800, 1),
    page,
    perPage: INBOX_PAGE_SIZE,
    ...getValidInboxSort(sort),
  };

  return sdk.transactions
    .query(apiQueryParams)
    .then(response => {
      dispatch(addMarketplaceEntities(response));
      return response;
    })
    .catch(e => {
      return rejectWithValue(storableError(e));
    });
};

export const loadDataThunk = createAsyncThunk('InboxPage/loadData', loadDataPayloadCreator);

// ─────────────────────────────────────────────────────────────────────────────
// What the owner has earned.
//
//   > "Puedes agregar el total de earnings visible solo para el provider por sus transacciones
//   >  completadas"
//
// SALES ONLY (`only: 'sale'`), which is what makes this the OWNER's number: the API scopes the
// query to the caller, so there is no way for this to answer about somebody else. That is also
// why there is no new endpoint - the browser can ask this question about itself and no other.
//
// FAILURE IS NOT AN ERROR STATE. Resolves to null rather than rejecting: a summary line that
// could not be computed should disappear, not take the inbox down with it.
// ─────────────────────────────────────────────────────────────────────────────
const fetchSalesPage = (sdk, page, collected) =>
  sdk.transactions
    .query({
      only: 'sale',
      processNames: getSupportedProcessesInfo().map(pr => pr.name),
      'fields.transaction': ['payoutTotal', 'transitions'],
      page,
      perPage: EARNINGS_PER_PAGE,
    })
    .then(response => {
      const { data = [], meta = {} } = response.data || {};
      const sales = collected.concat(data);
      const totalPages = Number.isFinite(meta.totalPages) ? meta.totalPages : page;

      if (page < totalPages && page < EARNINGS_MAX_PAGES) {
        return fetchSalesPage(sdk, page + 1, sales);
      }
      return { sales, truncated: page < totalPages };
    });

const fetchProviderEarningsPayloadCreator = (_arg, { extra: sdk }) =>
  fetchSalesPage(sdk, 1, [])
    .then(({ sales, truncated }) => ({ ...sumProviderEarnings(sales), truncated }))
    .catch(() => null);

export const fetchProviderEarningsThunk = createAsyncThunk(
  'InboxPage/fetchProviderEarnings',
  fetchProviderEarningsPayloadCreator
);

// Backward compatible wrapper for the thunk
export const loadData = (params, search) => (dispatch, getState, sdk) => {
  const promise = dispatch(loadDataThunk({ params, search }));

  // Only on the sales tab, and only in the browser. Fired without being awaited: the rentals
  // are what the reader came for, and a summary line must not hold them up. Same shape as the
  // search page's two side lookups.
  if (params?.tab === 'sales' && typeof window !== 'undefined') {
    dispatch(fetchProviderEarningsThunk());
  }

  return promise;
};
