import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { storableError } from '../../../../util/errors';
import { submitLaundryPartnerApplication } from '../../../../util/api';

/**
 * Redux slice for the partner-application form embedded in the become-a-partner page's
 * `form` section (SectionCoclosetPartnerForm).
 *
 * Relocated from the old `PartnerLandingPage.duck.js` when that whole container was retired
 * in favour of the generic `/p/become-a-partner` CMS route - only the submit
 * thunk/slice moved, unchanged. The old duck's `ASSET_NAME`/`loadData` are NOT carried over:
 * they existed to fetch a (wrongly-named, never-matching) fallback Console asset the old
 * container used for its own copy path, which no longer applies now that the CMS page owns
 * all the copy for this route.
 */

// ================ Async Thunks ================ //

export const submitApplication = createAsyncThunk(
  'partnerApplicationForm/submitApplication',
  (values, { rejectWithValue }) => {
    return submitLaundryPartnerApplication(values).catch(e => rejectWithValue(storableError(e)));
  }
);

// ================ Slice ================ //

const partnerApplicationFormSlice = createSlice({
  name: 'partnerApplicationForm',
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

export const { clearSubmitError, resetApplication } = partnerApplicationFormSlice.actions;

export default partnerApplicationFormSlice.reducer;
