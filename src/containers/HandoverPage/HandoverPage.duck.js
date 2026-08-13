import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { storableError } from '../../util/errors';
import { fetchHandoverStatus, updateLaundryTransactionStatus } from '../../util/api';

// Redux state for the page a scanned handover QR opens.
//
// One transaction, one question: what is due at the counter, and may this caller confirm it?
// Both answers come from GET /api/handover-status, because the assigned laundry - the only
// role that can act - is not a party to the transaction and therefore cannot read it through
// the SDK at all. See server/api/handover-status.js.

// `request()` in util/api.js returns the PARSED BODY, so the endpoint's `{ data: {...} }`
// arrives here whole and `response.data` is already the handover object. Reading `.data` a
// second time in the reducer is what produced a completely blank page in production: the
// thunk fulfilled, the reducer stored `undefined`, and a component that renders nothing for
// "no handover" had nothing to render and no error to explain it.
//
// `Promise.resolve().then(...)` so a SYNCHRONOUS throw inside `fetchHandoverStatus` lands in
// the same `.catch` as a rejected request. Without it such a throw escapes the payload
// creator, createAsyncThunk rejects with `action.error` instead of `action.payload`, and the
// slice stores `undefined` as its error - blank page again, by a different route.
export const fetchHandoverThunk = createAsyncThunk(
  'HandoverPage/fetchHandover',
  ({ transactionId }, { rejectWithValue }) =>
    Promise.resolve()
      .then(() => fetchHandoverStatus(transactionId))
      .then(response => response?.data || null)
      .catch(e => rejectWithValue(storableError(e)))
);

// Confirm the step and advance the transaction.
//
// Fires the SAME endpoint the ops dashboard's row action fires, with the same `status`
// vocabulary, so a handover confirmed at the counter and one confirmed from the worklist are
// the same write with the same authorization. A second path to the custody chain would be a
// second place for the authorization to be wrong.
//
// Refetches on success rather than patching the slice from the response: the next step is a
// function of the new process state, and re-deriving it from the server is what stops this
// page ever showing a step the transaction has already left.
export const confirmHandoverThunk = createAsyncThunk(
  'HandoverPage/confirmHandover',
  ({ transactionId, status }, { dispatch, rejectWithValue }) =>
    updateLaundryTransactionStatus({ transactionId, status })
      .then(response => {
        dispatch(fetchHandoverThunk({ transactionId }));
        return response.data;
      })
      .catch(e => rejectWithValue(storableError(e)))
);

export const confirmHandover = params => dispatch => dispatch(confirmHandoverThunk(params));

// ================ Slice ================ //

const initialState = {
  handover: null,
  fetchInProgress: false,
  fetchError: null,
  confirmInProgress: false,
  confirmError: null,
};

const handoverPageSlice = createSlice({
  name: 'HandoverPage',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(fetchHandoverThunk.pending, state => {
        state.fetchInProgress = true;
        state.fetchError = null;
      })
      .addCase(fetchHandoverThunk.fulfilled, (state, action) => {
        state.fetchInProgress = false;
        // The payload IS the handover object - see the note on the thunk.
        state.handover = action.payload || null;
        // A successful refetch clears a previous confirm failure: the state on screen is now
        // the server's, so a stale error next to it would describe a world that no longer
        // exists.
        state.confirmError = null;
      })
      .addCase(fetchHandoverThunk.rejected, (state, action) => {
        state.fetchInProgress = false;
        state.fetchError = action.payload;
        // The old handover is dropped too. Showing the previous transaction's step under a
        // "could not load" error is how a laundry confirms the wrong garment.
        state.handover = null;
      })
      .addCase(confirmHandoverThunk.pending, state => {
        state.confirmInProgress = true;
        state.confirmError = null;
      })
      .addCase(confirmHandoverThunk.fulfilled, state => {
        state.confirmInProgress = false;
      })
      .addCase(confirmHandoverThunk.rejected, (state, action) => {
        state.confirmInProgress = false;
        state.confirmError = action.payload;
      });
  },
});

export default handoverPageSlice.reducer;

// ================ Load data ================ //

export const loadData = params => dispatch => {
  const transactionId = params?.id;
  if (!transactionId) {
    return Promise.resolve();
  }
  return dispatch(fetchHandoverThunk({ transactionId }));
};
