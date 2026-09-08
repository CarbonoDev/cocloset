import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { storableError } from '../../util/errors';
import {
  fetchHandoverStatus,
  receiveGarmentAtLaundry,
  updateLaundryTransactionStatus,
  updateListingCustodyStatus,
} from '../../util/api';

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
// RECEPTION IS NOT A TRANSITION, so it is not the same POST.
//
//   > "cuando el provider va a entregar una prenda a la laundry, la laundry debe ingresar un
//   >  ticket y luego iniciar el proceso de lavado" (Jonathan, 2026-09-08)
//
// Both screens advance the studio through one vocabulary of statuses, and this one step is
// answered by a different endpoint: it records that the garment is now on the studio's rack
// (a listing write) and fires nothing on the transaction, which stays `accepted` for the
// length of the wash. Branching HERE rather than in the components keeps that a fact about
// the endpoint rather than something every button has to know.
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

export const confirmHandoverThunk = createAsyncThunk(
  'HandoverPage/confirmHandover',
  (
    { transactionId, status, cleaningDays, damaged, damageNote, laundryCode },
    { dispatch, rejectWithValue }
  ) =>
    // `cleaningDays` is forwarded only when the caller supplied a number. Omitting it is
    // MEANINGFUL: the server then applies the turnaround this studio configured for the
    // garment's category. Sending 0 would mean "ready today" and block nothing at all, so a
    // blank box must not become a zero on the way here.
    //
    // `laundryCode` WAS MISSING FROM THIS LIST, and that is a bug this page had all along
    // rather than one introduced with it. The component built the field, the endpoint accepted
    // it, and this destructure silently dropped it in between - so a studio typing its shelf
    // code on the counter phone watched the step succeed and the code never existed. Nothing
    // could catch it: the component test asserts what it handed to `onConfirm`, the endpoint
    // test asserts what it does with a body it was given, and this is the seam between them.
    //
    // EVERY FIELD IS SPREAD IN BY NAME on purpose - it is what stops a caller posting
    // arbitrary keys at a privileged endpoint - so anything added to the form has to be added
    // here too, or it goes nowhere and says nothing.
    postStatus({ transactionId, status, cleaningDays, damaged, damageNote, laundryCode })
      .then(response => {
        dispatch(fetchHandoverThunk({ transactionId }));
        return response.data;
      })
      .catch(e => rejectWithValue(storableError(e)))
);

// Hand the garment back to its owner, from the counter phone.
//
//   > "el botón para devolver la prenda en el lado de laundry debe aparecer en order,
//   >  handover o inventory" (Jonathan, 2026-09-07)
//
// The SAME endpoint the ops dashboard's inventory card fires, for the same reason the confirm
// above shares one with the worklist: a second path to a privileged write is a second place
// for the authorization to be wrong.
//
// Refetches on success, so `canHandBack` comes back false and the button leaves - the page
// re-derives everything from the server rather than patching what it believes changed.
export const handBackToOwnerThunk = createAsyncThunk(
  'HandoverPage/handBackToOwner',
  ({ transactionId, listingId }, { dispatch, rejectWithValue }) =>
    updateListingCustodyStatus({ listingId, onLaundry: false })
      .then(response => {
        dispatch(fetchHandoverThunk({ transactionId }));
        return response.data;
      })
      .catch(e => rejectWithValue(storableError(e)))
);

export const confirmHandover = params => dispatch => dispatch(confirmHandoverThunk(params));

export const handBackToOwner = params => dispatch => dispatch(handBackToOwnerThunk(params));

// ================ Slice ================ //

const initialState = {
  handover: null,
  fetchInProgress: false,
  fetchError: null,
  confirmInProgress: false,
  confirmError: null,
  handBackInProgress: false,
  handBackError: null,
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
        state.handBackError = null;
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
      })
      .addCase(handBackToOwnerThunk.pending, state => {
        state.handBackInProgress = true;
        state.handBackError = null;
      })
      .addCase(handBackToOwnerThunk.fulfilled, state => {
        state.handBackInProgress = false;
      })
      .addCase(handBackToOwnerThunk.rejected, (state, action) => {
        state.handBackInProgress = false;
        state.handBackError = action.payload;
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
