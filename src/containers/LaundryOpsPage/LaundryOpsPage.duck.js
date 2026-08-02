import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { storableError } from '../../util/errors';
import { fetchLaundryOrders, updateLaundryTransactionStatus } from '../../util/api';

// Redux state for every laundry ops screen (Dashboard / Orders / Pickups /
// Returns / Cleaning / Inventory). They all render the same payload from
// GET /api/laundry-orders and differ only in how they filter and present it,
// so there is a single duck, a single loadData, and a single fetch per page
// load rather than one endpoint per screen.

// ================ Async Thunks ================ //

export const fetchOrdersThunk = createAsyncThunk(
  'LaundryOpsPage/fetchOrders',
  (_params, { rejectWithValue }) =>
    fetchLaundryOrders()
      .then(response => response.data)
      .catch(e => rejectWithValue(storableError(e)))
);

// Advance one transaction's laundry status, optionally attaching a damage
// report (only meaningful at the 'returned' step - design doc §10).
//
// The server re-validates the move against the legal sequence and answers 409
// on an illegal jump; the UI only ever offers the single next status, so a 409
// here means the row was stale. Refetching the whole payload on success keeps
// every screen consistent and picks up any concurrent change by another
// terminal in the studio.
export const advanceStatusThunk = createAsyncThunk(
  'LaundryOpsPage/advanceStatus',
  ({ transactionId, status, damaged, damageNote }, { dispatch, rejectWithValue }) =>
    updateLaundryTransactionStatus({
      transactionId,
      status,
      ...(typeof damaged === 'boolean' ? { damaged } : {}),
      ...(damageNote ? { damageNote } : {}),
    })
      .then(response => {
        dispatch(fetchOrdersThunk());
        return response.data;
      })
      .catch(e => rejectWithValue(storableError(e)))
);

// Backward compatible wrappers, matching LaundryProfilePage.duck.js's style.
export const fetchOrders = () => dispatch => dispatch(fetchOrdersThunk());

export const advanceStatus = params => dispatch => dispatch(advanceStatusThunk(params));

// ================ Slice ================ //

const initialState = {
  orders: [],
  inventory: [],
  laundryId: null,
  // `truncated` is set by the endpoint when it hit its listing-page crawl cap,
  // i.e. the view is knowingly incomplete. Surfaced to the user rather than
  // silently showing a short list.
  truncated: false,
  fetchOrdersInProgress: false,
  fetchOrdersError: null,
  // Transaction id currently being advanced, so a single row can show a
  // spinner without disabling the whole table.
  advanceStatusTransactionId: null,
  advanceStatusError: null,
};

const laundryOpsPageSlice = createSlice({
  name: 'LaundryOpsPage',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(fetchOrdersThunk.pending, state => {
        state.fetchOrdersInProgress = true;
        state.fetchOrdersError = null;
      })
      .addCase(fetchOrdersThunk.fulfilled, (state, action) => {
        const { orders = [], inventory = [], laundryId = null, meta = {} } = action.payload || {};
        state.fetchOrdersInProgress = false;
        state.orders = orders;
        state.inventory = inventory;
        state.laundryId = laundryId;
        state.truncated = !!meta.truncated;
      })
      .addCase(fetchOrdersThunk.rejected, (state, action) => {
        state.fetchOrdersInProgress = false;
        state.fetchOrdersError = action.payload;
      })
      .addCase(advanceStatusThunk.pending, (state, action) => {
        state.advanceStatusTransactionId = action.meta.arg?.transactionId || null;
        state.advanceStatusError = null;
      })
      .addCase(advanceStatusThunk.fulfilled, state => {
        state.advanceStatusTransactionId = null;
      })
      .addCase(advanceStatusThunk.rejected, (state, action) => {
        state.advanceStatusTransactionId = null;
        state.advanceStatusError = action.payload;
      });
  },
});

// ================ Data loading ================ //

// Registered in src/containers/pageDataLoadingAPI.js so the fetch happens
// through the route's loadData (SSR-compatible) rather than a useEffect.
export const loadData = () => dispatch => dispatch(fetchOrdersThunk());

export default laundryOpsPageSlice.reducer;
