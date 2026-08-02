import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { storableError } from '../../util/errors';
import { submitLaundryPartnerApplication } from '../../util/api';
import { fetchPageAssets } from '../../ducks/hostedAssets.duck';

// Asset path of the Console-managed page that supplies the marketing copy for this
// route: `content/pages/laundry-partners.json` in the Asset Delivery API.
//
// The page is OPTIONAL. If the operator has not created it yet, PartnerLandingPage
// renders the built-in copy from DefaultContent.js instead. See the container for the
// full rationale.
export const ASSET_NAME = 'laundry-partners';

// ================ Async Thunks ================ //

export const submitApplication = createAsyncThunk(
  'partnerLandingPage/submitApplication',
  (values, { rejectWithValue }) => {
    return submitLaundryPartnerApplication(values).catch(e => rejectWithValue(storableError(e)));
  }
);

// ================ Slice ================ //

const partnerLandingPageSlice = createSlice({
  name: 'partnerLandingPage',
  initialState: {
    submitInProgress: false,
    submitError: null,
    applicationSubmitted: false,
  },
  reducers: {
    clearSubmitError: state => {
      state.submitError = null;
    },
    resetApplication: state => {
      state.submitInProgress = false;
      state.submitError = null;
      state.applicationSubmitted = false;
    },
  },
  extraReducers: builder => {
    builder
      .addCase(submitApplication.pending, state => {
        state.submitInProgress = true;
        state.submitError = null;
      })
      .addCase(submitApplication.fulfilled, state => {
        state.submitInProgress = false;
        state.applicationSubmitted = true;
      })
      .addCase(submitApplication.rejected, (state, action) => {
        state.submitInProgress = false;
        state.submitError = action.payload;
      });
  },
});

export const { clearSubmitError, resetApplication } = partnerLandingPageSlice.actions;

export default partnerLandingPageSlice.reducer;

// ================ Data loading ================ //

/**
 * Fetch the optional hosted page asset that carries the marketing copy.
 *
 * The rejection is swallowed on purpose: a missing `laundry-partners` page is an
 * expected state (the operator may not have created it yet), not a page error. The
 * rejected thunk still records the failure in `state.hostedAssets.error`, which the
 * container uses to decide whether to render hosted sections or the built-in fallback.
 */
export const loadData = (params, search) => dispatch => {
  const pageAsset = { [ASSET_NAME]: `content/pages/${ASSET_NAME}.json` };
  const hasFallbackContent = false;
  return dispatch(fetchPageAssets(pageAsset, hasFallbackContent)).catch(() => null);
};
