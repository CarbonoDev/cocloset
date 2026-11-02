import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import * as log from '../util/log';
import { storableError } from '../util/errors';
import { clearCurrentUser, fetchCurrentUser } from './user.duck';
import { createUserWithIdp, initUserRole } from '../util/api';
import { clearStoredReferralData } from '../util/webStorageHelpers';

const authenticated = authInfo => authInfo?.isAnonymous === false;
const loggedInAs = authInfo => authInfo?.isLoggedInAs === true;

// ================ Initial State ================ //

const initialState = {
  isAuthenticated: false,

  // is marketplace operator logged in as a marketplace user
  isLoggedInAs: false,

  // scopes associated with current token
  authScopes: [],

  // auth info
  authInfoLoaded: false,

  // login
  loginError: null,
  loginInProgress: false,

  // logout
  logoutError: null,
  logoutInProgress: false,

  // signup
  signupError: null,
  signupInProgress: false,

  // confirm (create use with idp)
  confirmError: null,
  confirmInProgress: false,
};

// ================ Async Thunks ================ //

const authInfoThunk = createAsyncThunk('auth/authInfo', (_, thunkAPI) => {
  const { extra: sdk } = thunkAPI;
  return sdk.authInfo().catch(e => {
    // Requesting auth info just reads the token from the token
    // store (i.e. cookies), and should not fail in normal
    // circumstances. If it fails, it's due to a programming
    // error. In that case we mark the operation done and dispatch
    // `null` success action that marks the user as unauthenticated.
    log.error(e, 'auth-info-failed');
    return null;
  });
});

const loginThunk = createAsyncThunk(
  'auth/login',
  ({ username, password }, thunkAPI) => {
    const { rejectWithValue, extra: sdk, dispatch } = thunkAPI;

    return sdk
      .login({ username, password })
      .then(() => {
        return dispatch(fetchCurrentUser({ afterLogin: true }));
      })
      .then(() => ({ username, password }))
      .catch(e => rejectWithValue(storableError(e)));
  },
  {
    condition: (_, { getState }) => {
      const state = getState();
      if (authenticationInProgress(state, 'loginInProgress')) {
        return false;
      }
    },
  }
);

const logoutThunk = createAsyncThunk(
  'auth/logout',
  (_, thunkAPI) => {
    const { rejectWithValue, extra: sdk, dispatch } = thunkAPI;

    return sdk
      .logout()
      .then(() => {
        dispatch(clearCurrentUser());
        log.clearUserId();
        return true;
      })
      .catch(e => rejectWithValue(storableError(e)));
  },
  {
    condition: (_, { getState }) => {
      const state = getState();
      if (authenticationInProgress(state, 'logoutInProgress')) {
        return false;
      }
    },
  }
);

// Stamp the explicit `metadata.isLaundry = false` default onto the user that
// just signed up (client requirement: every user is created with the flag set
// to false, and an admin promotes them from Console). A user cannot write
// their own metadata - `currentUser.updateProfile({ metadata })` is rejected
// with `400 validation-disallowed-key` - so this has to be an Integration API
// write on our own server: see server/api/init-user-role.js.
//
// FIRE-AND-CONTINUE, like createAvailabilityBuffer in TransactionPage.duck.js:
// the promise is deliberately not returned, so nothing here can delay, block
// or fail the signup that has already succeeded. Failures are logged only,
// never surfaced. That is safe because the missing key is not a functional
// difference - every consumer tests `isLaundry === true` (see
// src/util/userHelpers.js), so a user without it behaves exactly as a
// non-laundry. It only means an operator sees no key in Console until
// scripts/backfill-laundry-role.js is run.
//
// Must run AFTER the login below: the endpoint identifies the user from their
// own session, so an unauthenticated call would 401.
//
// KNOWN RESIDUAL GAP: because this is fired from the browser it is skipped if
// the tab is closed mid-request, and it does not cover users an operator
// creates directly in Console. Closing that properly needs a server-side
// worker on Sharetribe's user events; until then the backfill script is the
// reconciliation path.
const initUserRoleFireAndContinue = () => {
  try {
    initUserRole().catch(e => {
      log.error(e, 'init-user-role-failed');
    });
  } catch (e) {
    // `window.fetch` may not exist at all in some environments; a signup must
    // not blow up on a best-effort call.
    log.error(e, 'init-user-role-failed');
  }
};

const signupThunk = createAsyncThunk(
  'auth/signup',
  (params, thunkAPI) => {
    const { rejectWithValue, extra: sdk, dispatch } = thunkAPI;

    return sdk.currentUser
      .create(params)
      .then(() =>
        dispatch(loginThunk({ username: params.email, password: params.password })).unwrap()
      )
      .then(() => {
        initUserRoleFireAndContinue();

        // Clear potential referral data from session storage
        clearStoredReferralData();
        return params;
      })
      .catch(e => {
        log.error(e, 'signup-failed', {
          email: params.email,
          firstName: params.firstName,
          lastName: params.lastName,
        });
        return rejectWithValue(storableError(e));
      });
  },
  {
    condition: (_, { getState }) => {
      const state = getState();
      if (authenticationInProgress(state, 'signupInProgress')) {
        return false;
      }
    },
  }
);

const signupWithIdpThunk = createAsyncThunk(
  'auth/signupWithIdp',
  (params, thunkAPI) => {
    const { rejectWithValue, dispatch } = thunkAPI;
    return createUserWithIdp(params)
      .then(() => dispatch(fetchCurrentUser({ afterLogin: true })))
      .then(() => {
        // Clear potential referral data from session storage
        clearStoredReferralData();
        return params;
      })
      .catch(e => {
        log.error(e, 'create-user-with-idp-failed');
        return rejectWithValue(storableError(e));
      });
  },
  {
    condition: (_, { getState }) => {
      const state = getState();
      if (authenticationInProgress(state, 'confirmInProgress')) {
        return false;
      }
    },
  }
);

// ================ Slice ================ //

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {},
  extraReducers: builder => {
    // Auth Info
    builder.addCase(authInfoThunk.fulfilled, (state, action) => {
      const payload = action.payload;
      state.authInfoLoaded = true;
      state.isAuthenticated = authenticated(payload);
      state.isLoggedInAs = loggedInAs(payload);
      state.authScopes = payload?.scopes || [];
    });

    // Login
    builder
      .addCase(loginThunk.pending, state => {
        state.loginInProgress = true;
        state.loginError = null;
        state.logoutError = null;
        state.signupError = null;
      })
      .addCase(loginThunk.fulfilled, state => {
        state.loginInProgress = false;
        state.isAuthenticated = true;
      })
      .addCase(loginThunk.rejected, (state, action) => {
        state.loginInProgress = false;
        state.loginError = action.payload;
      });

    // Logout
    builder
      .addCase(logoutThunk.pending, state => {
        state.logoutInProgress = true;
        state.loginError = null;
        state.logoutError = null;
      })
      .addCase(logoutThunk.fulfilled, state => {
        state.logoutInProgress = false;
        state.isAuthenticated = false;
        state.isLoggedInAs = false;
        state.authScopes = [];
      })
      .addCase(logoutThunk.rejected, (state, action) => {
        state.logoutInProgress = false;
        state.logoutError = action.payload;
      });

    // Signup
    builder
      .addCase(signupThunk.pending, state => {
        state.signupInProgress = true;
        state.loginError = null;
        state.signupError = null;
      })
      .addCase(signupThunk.fulfilled, state => {
        state.signupInProgress = false;
      })
      .addCase(signupThunk.rejected, (state, action) => {
        state.signupInProgress = false;
        state.signupError = action.payload;
      });

    // Signup with IDP (Confirm)
    builder
      .addCase(signupWithIdpThunk.pending, state => {
        state.confirmInProgress = true;
        state.loginError = null;
        state.confirmError = null;
      })
      .addCase(signupWithIdpThunk.fulfilled, state => {
        state.confirmInProgress = false;
        state.isAuthenticated = true;
      })
      .addCase(signupWithIdpThunk.rejected, (state, action) => {
        state.confirmInProgress = false;
        state.confirmError = action.payload;
      });
  },
});

export { logoutThunk };
export default authSlice.reducer;

// ================ Selectors ================ //

export const authenticationInProgress = (state, nextInProgress = 'any') => {
  const { loginInProgress, logoutInProgress, signupInProgress, confirmInProgress } = state.auth;
  const anyInProgress =
    loginInProgress || logoutInProgress || signupInProgress || confirmInProgress;
  return nextInProgress === 'loginInProgress'
    ? loginInProgress || logoutInProgress || confirmInProgress
    : anyInProgress;
};

// ================ Thunk Wrappers ================ //
// These maintain the same API as the original thunks

export const login = (username, password) => dispatch => {
  return dispatch(loginThunk({ username, password })).unwrap();
};

export const logout = () => dispatch => {
  return dispatch(logoutThunk()).unwrap();
};

export const signup = params => dispatch => {
  return dispatch(signupThunk(params)).unwrap();
};

export const signupWithIdp = params => dispatch => {
  return dispatch(signupWithIdpThunk(params)).unwrap();
};

export const authInfo = () => dispatch => {
  return dispatch(authInfoThunk()).unwrap();
};
