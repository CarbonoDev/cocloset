import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { storableError } from '../../util/errors';
import { fetchListingPickupStatus, confirmListingPickup } from '../../util/api';

// Redux state for the page a scanned pickup QR opens.
//
// One listing, one question: is a garment waiting to be collected here, and may THIS caller
// confirm it? Both answers come from GET /api/listing-pickup-status - a pickup has no
// transaction to lean on (it may have none at all, the §8 pure-inventory case), so the token
// carried in the QR's own URL is part of what the server checks. See
// server/api/listing-pickup-status.js.
//
// `Promise.resolve().then(...)`, same reason as HandoverPage.duck.js: a synchronous throw
// inside fetchListingPickupStatus must land in the same .catch as a rejected request, or it
// escapes as action.error instead of action.payload and the slice stores undefined - a blank
// page with no explanation.
export const fetchPickupStatusThunk = createAsyncThunk(
  'PickupPage/fetchPickupStatus',
  ({ listingId, token }, { rejectWithValue }) =>
    Promise.resolve()
      .then(() => fetchListingPickupStatus({ listingId, token }))
      .then(response => response?.data || null)
      .catch(e => rejectWithValue(storableError(e)))
);

// Confirm the hand-back. Fires the SAME underlying write
// server/api/listing-custody-status.js performs (see listing-pickup-confirm.js's own header
// for why it is a second door rather than a different write), gated additionally on the
// token this page's own URL carries.
//
// Refetches on success rather than patching the slice locally: `canConfirm` becoming false is
// the server's answer once the garment has actually gone home, and re-deriving it is what
// stops this page ever offering a second confirm for a pickup that already happened.
export const confirmPickupThunk = createAsyncThunk(
  'PickupPage/confirmPickup',
  ({ listingId, token }, { dispatch, rejectWithValue }) =>
    confirmListingPickup({ listingId, token })
      .then(response => {
        dispatch(fetchPickupStatusThunk({ listingId, token }));
        return response.data;
      })
      .catch(e => rejectWithValue(storableError(e)))
);

export const confirmPickup = params => dispatch => dispatch(confirmPickupThunk(params));

// ================ Slice ================ //

const initialState = {
  // The request's own arguments, not just its answer. The component fires the confirm action
  // with these - never with anything parsed fresh from the URL - so there is exactly one
  // place (this thunk's arg) that ever reads the page's own address bar.
  listingId: null,
  token: null,
  pickupStatus: null,
  fetchInProgress: false,
  fetchError: null,
  confirmInProgress: false,
  confirmError: null,
  // Sticky across the refetch a successful confirm triggers, so the page can say "you just
  // did this" rather than silently falling back to whatever canConfirm now reads (false,
  // indistinguishable from "someone else already confirmed it" without this flag).
  justConfirmed: false,
};

const pickupPageSlice = createSlice({
  name: 'PickupPage',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(fetchPickupStatusThunk.pending, (state, action) => {
        state.fetchInProgress = true;
        state.fetchError = null;
        // Reset only when this is a genuinely NEW request (a different listing/token than
        // the one already loaded) - not the refetch a successful confirm itself triggers,
        // which must keep `justConfirmed` true through to its own fulfilled handler.
        if (
          state.listingId !== action.meta.arg.listingId ||
          state.token !== action.meta.arg.token
        ) {
          state.justConfirmed = false;
        }
        state.listingId = action.meta.arg.listingId;
        state.token = action.meta.arg.token;
      })
      .addCase(fetchPickupStatusThunk.fulfilled, (state, action) => {
        state.fetchInProgress = false;
        state.pickupStatus = action.payload || null;
        state.confirmError = null;
      })
      .addCase(fetchPickupStatusThunk.rejected, (state, action) => {
        state.fetchInProgress = false;
        state.fetchError = action.payload;
        // Dropped for the same reason HandoverPage.duck.js drops `handover` on a failed
        // refetch: showing a stale "you may confirm" next to a load error is how the wrong
        // garment gets handed over.
        state.pickupStatus = null;
      })
      .addCase(confirmPickupThunk.pending, state => {
        state.confirmInProgress = true;
        state.confirmError = null;
      })
      .addCase(confirmPickupThunk.fulfilled, state => {
        state.confirmInProgress = false;
        state.justConfirmed = true;
      })
      .addCase(confirmPickupThunk.rejected, (state, action) => {
        state.confirmInProgress = false;
        state.confirmError = action.payload;
      });
  },
});

export default pickupPageSlice.reducer;

// ================ Load data ================ //

export const loadData = (params, search) => dispatch => {
  const listingId = params?.listingId;
  const searchParams = new URLSearchParams(search);
  const token = searchParams.get('token');

  if (!listingId || !token) {
    return Promise.resolve();
  }
  return dispatch(fetchPickupStatusThunk({ listingId, token }));
};
