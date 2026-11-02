import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { storableError } from '../../../../util/errors';
import { submitEmailSignup } from '../../../../util/api';

/**
 * Redux slice for the email-list signup form embedded in the main landing page's `invite`
 * section (SectionCoclosetLandingInvite). Structurally the same shape as
 * `SectionCoclosetPartnerForm.duck.js` (submit-in-progress / submit-error / submitted, via a
 * single async thunk) - kept as its own slice rather than reusing that one, since this is a
 * different form with a different destination (`/api/email-signup`, not
 * `/api/laundry-partner-application`) and a different consumer downstream.
 */

// ================ Async Thunks ================ //

export const submitSignup = createAsyncThunk(
  'landingInviteForm/submitSignup',
  (values, { rejectWithValue }) => {
    return submitEmailSignup(values).catch(e => rejectWithValue(storableError(e)));
  }
);

// ================ Slice ================ //

const landingInviteFormSlice = createSlice({
  name: 'landingInviteForm',
  initialState: {
    submitInProgress: false,
    submitError: null,
    signupSubmitted: false,
  },
  reducers: {
    clearSubmitError: state => {
      state.submitError = null;
    },
    resetSignup: state => {
      state.submitInProgress = false;
      state.submitError = null;
      state.signupSubmitted = false;
    },
  },
  extraReducers: builder => {
    builder
      .addCase(submitSignup.pending, state => {
        state.submitInProgress = true;
        state.submitError = null;
      })
      .addCase(submitSignup.fulfilled, state => {
        state.submitInProgress = false;
        state.signupSubmitted = true;
      })
      .addCase(submitSignup.rejected, (state, action) => {
        state.submitInProgress = false;
        state.submitError = action.payload;
      });
  },
});

export const { clearSubmitError, resetSignup } = landingInviteFormSlice.actions;

export default landingInviteFormSlice.reducer;
