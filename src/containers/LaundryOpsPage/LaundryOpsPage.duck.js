import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { storableError } from '../../util/errors';
import {
  fetchLaundryOrders,
  receiveGarmentAtLaundry,
  updateLaundryTransactionStatus,
  updateListingCustodyStatus,
} from '../../util/api';

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

// Advance one transaction's laundry status, optionally attaching a damage report
// and/or the number of days cleaning will take (both only meaningful at the
// 'returned' step - design doc §10 and the client's turnaround rule).
//
// `cleaningDays` is forwarded only when the caller supplied a number. Omitting it
// is meaningful: the server then applies the turnaround this laundry configured
// for the garment's category, and sizes listing.metadata.readyAt and the
// availability block from that.
//
// `laundryCode` is the studio's own name for the garment, read only at the reception
// step. THE WHITELIST BELOW IS LOAD-BEARING AND WAS WHY THE OPS TABLE COULD NOT SEND
// ONE: every field is spread in explicitly, so a key the caller passes and this list
// does not name is dropped here, silently, before the request is built. Anything added
// to the row's payload has to be added here too.
//
// The server re-validates the move against the legal sequence and answers 409
// on an illegal jump; the UI only ever offers the single next status, so a 409
// here means the row was stale. Refetching the whole payload on success keeps
// every screen consistent and picks up any concurrent change by another
// terminal in the studio.
// RECEPTION GOES THROUGH ITS OWN ENDPOINT, so it is not the same POST.
//
//   > "cuando el provider va a entregar una prenda a la laundry, la laundry debe ingresar un
//   >  ticket y luego iniciar el proceso de lavado" (Jonathan, 2026-09-08)
//
// Both screens advance the studio through one vocabulary of statuses, and this one step is
// answered by a different endpoint: it records that the garment is now on the studio's rack
// (a listing write) AND - since 2026-09-21 - fires transition/laundry-receive-from-provider,
// moving the transaction from `accepted` to its own `initial-cleaning` state for the length of
// the first wash (see the EDN and server/api/laundry-receive-garment.js). Branching HERE rather
// than in the components keeps that a fact about the endpoint rather than something every
// button has to know.
const RECEPTION_STATUS = 'garment-received';

const postStatus = ({ transactionId, status, damaged, damageNote, cleaningDays, laundryCode }) =>
  status === RECEPTION_STATUS
    ? receiveGarmentAtLaundry({
        transactionId,
        ...(laundryCode ? { laundryCode } : {}),
      })
    : updateLaundryTransactionStatus({
        transactionId,
        status,
        ...(typeof damaged === 'boolean' ? { damaged } : {}),
        ...(damageNote ? { damageNote } : {}),
        ...(typeof cleaningDays === 'number' ? { cleaningDays } : {}),
        ...(laundryCode ? { laundryCode } : {}),
      });

export const advanceStatusThunk = createAsyncThunk(
  'LaundryOpsPage/advanceStatus',
  (params, { dispatch, rejectWithValue }) =>
    postStatus(params)
      .then(response => {
        dispatch(fetchOrdersThunk());
        return response.data;
      })
      .catch(e => rejectWithValue(storableError(e)))
);

// HANDING A GARMENT BACK TO ITS OWNER.
//
//   > "no hay ninguna manera en que un provider pueda recoger la prenda y se pueda cambiar
//   >  ese status" (Jonathan, 2026-09-07)
//
// The endpoint and its authorization have existed since the custody work; nothing called
// them, which looks exactly like a missing feature and is why the client reported one.
//
// It is a LISTING write, not a transaction one - the garment's whereabouts outlive any
// booking - so it re-fetches the orders afterwards rather than assuming: the row's readiness
// and custody both come from that query, and a screen that keeps showing a garment the studio
// just handed over is the bug this would otherwise introduce.
//
// The server refuses with 409 while the listing has an active transaction, which is what
// enforces "una vez que finalice la limpieza": `cleaning` counts as active and `delivered`
// does not, so the button becomes usable exactly when the wash is finished.
export const handBackToOwnerThunk = createAsyncThunk(
  'LaundryOpsPage/handBackToOwner',
  ({ listingId }, { dispatch, rejectWithValue }) =>
    updateListingCustodyStatus({ listingId, onLaundry: false })
      .then(response => {
        dispatch(fetchOrdersThunk());
        return response.data;
      })
      .catch(e => rejectWithValue(storableError(e)))
);

// Backward compatible wrappers, matching LaundryProfilePage.duck.js's style.
export const fetchOrders = () => dispatch => dispatch(fetchOrdersThunk());

export const advanceStatus = params => dispatch => dispatch(advanceStatusThunk(params));

export const handBackToOwner = params => dispatch => dispatch(handBackToOwnerThunk(params));

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
  handBackListingId: null,
  handBackError: null,
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
      .addCase(handBackToOwnerThunk.pending, (state, action) => {
        state.handBackListingId = action.meta.arg?.listingId || null;
        state.handBackError = null;
      })
      .addCase(handBackToOwnerThunk.fulfilled, state => {
        state.handBackListingId = null;
      })
      .addCase(handBackToOwnerThunk.rejected, (state, action) => {
        state.handBackListingId = null;
        state.handBackError = action.payload;
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
