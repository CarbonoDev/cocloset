import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { storableError } from '../../util/errors';
import {
  refreshLaundryListings,
  updateLaundryAddress as updateLaundryAddressApi,
} from '../../util/api';
import { fetchCurrentUser, setCurrentUser } from '../../ducks/user.duck';
import { denormalisedResponseEntities } from '../../util/data';

// ================ Async Thunks ================ //

//////////////////
// Upload Image //
//////////////////

// The Logo field (2026-09-11) reuses the exact same upload mechanism as the ordinary
// ProfileSettingsPage avatar - `profileImage` is a base Sharetribe user attribute
// shared by every user type, not a laundry-specific one, so "Logo" is a label change
// only. See ProfileSettingsPage.duck.js's uploadImageThunk, which this mirrors.
export const uploadImageThunk = createAsyncThunk(
  'LaundryProfilePage/uploadImage',
  ({ id, file }, { rejectWithValue, extra: sdk }) => {
    const bodyParams = {
      image: file,
    };
    const queryParams = {
      expand: true,
      'fields.image': ['variants.square-small', 'variants.square-small2x'],
    };

    return sdk.images
      .upload(bodyParams, queryParams)
      .then(resp => {
        const uploadedImage = resp.data.data;
        return { id, uploadedImage };
      })
      .catch(e => {
        return rejectWithValue({ id, error: storableError(e) });
      });
  }
);

export const uploadImage = actionPayload => dispatch => dispatch(uploadImageThunk(actionPayload));

////////////////////
// Update Profile //
////////////////////

export const updateProfileThunk = createAsyncThunk(
  'LaundryProfilePage/updateProfile',
  (actionPayload, { dispatch, rejectWithValue, extra: sdk }) => {
    const queryParams = {
      expand: true,
      include: ['profileImage'],
      'fields.image': ['variants.square-small', 'variants.square-small2x'],
    };

    return sdk.currentUser
      .updateProfile(actionPayload, queryParams)
      .then(response => {
        const entities = denormalisedResponseEntities(response);
        if (entities.length !== 1) {
          throw new Error('Expected a resource in the sdk.currentUser.updateProfile response');
        }
        const currentUser = entities[0];

        // Update current user in state.user.currentUser through user.duck.js
        dispatch(setCurrentUser(currentUser));
        return response;
      })
      .catch(e => {
        return rejectWithValue(storableError(e));
      });
  }
);

/////////////////////
// Update Address  //
/////////////////////

/**
 * Save the studio's address through our own server, not the Marketplace API.
 *
 * A SECOND CALL, BY DESIGN:
 *   > "Igual podemos hacer una llamada secundaria que solo guarde la dirección, el
 *   >  resto se sigue guardando igual, pero la dirección (aun en publicData) se
 *   >  guarda a través de integration API"
 *
 * Everything else on this page still goes through `sdk.currentUser.updateProfile`
 * above. The address goes to /api/laundry-address because two things there need the
 * Integration API: the permission check (`metadata.addressChangeAllowed`, which a
 * user cannot write for themselves) and the propagation of the new address onto
 * every listing assigned to this studio.
 *
 * ON SUCCESS THE CURRENT USER IS RE-FETCHED, and that is not housekeeping: the
 * server has just spent the one-off grant (the flag is now `false`) and stored the
 * new address. Without the re-fetch the form would keep rendering the old
 * `currentUser`, i.e. an unlocked address field for a grant that no longer exists.
 *
 * The failure is kept in its OWN state key rather than folded into
 * `updateProfileError`: the two calls fail for different reasons and the form shows
 * a different message for each ("contact support" versus "save failed").
 */
export const updateLaundryAddressThunk = createAsyncThunk(
  'LaundryProfilePage/updateLaundryAddress',
  ({ address, origin }, { dispatch, rejectWithValue }) =>
    updateLaundryAddressApi({ address, origin: { lat: origin?.lat, lng: origin?.lng } })
      .then(response =>
        // Awaited: the form's lock and alert are both derived from currentUser, so
        // resolving before the refresh lands would leave the studio looking at a
        // stale profile immediately after a successful save.
        dispatch(fetchCurrentUser()).then(() => response)
      )
      .catch(e =>
        // `code` is carried alongside the storable error on purpose: `storableError`
        // keeps only `data.errors` and would throw the endpoint's `data.code` away,
        // and that code is the whole point of the 403 — it is what lets the form show
        // the translated "ask support" message instead of a generic failure. Same
        // pattern as EditListingLaundryPanel reading `e.data.reason` off the raw
        // error, kept in state here because this failure is rendered by a different
        // component than the one that catches it.
        rejectWithValue({ ...storableError(e), code: e?.data?.code || null })
      )
);

/**
 * Save the profile, then the address — in that order, and only if the first
 * succeeded.
 *
 * THE ORDER IS LOAD-BEARING. Both writes touch `publicData.laundryProfile`, which is
 * ONE top-level extended-data key holding a nested object, so each write replaces
 * the whole object rather than merging into it. The profile write carries the
 * STORED address (see LaundryProfilePage's handleSubmit) and the address endpoint
 * read-modify-writes on top of whatever it finds. Profile-then-address therefore
 * converges on "new studio name + new address". The reverse order would have the
 * profile write stamp the old address back over the new one.
 *
 * If the profile write fails, the address write is skipped: `updateProfileError` is
 * already on screen, and a partial save that moved the address anyway would be
 * worse than no save at all.
 *
 * @param {Object} actionPayload - the publicData/privateData for currentUser.updateProfile
 * @param {Object} [addressChange] - `{ address, origin }`, or null when the address
 *   did not change (or the studio may not change it)
 */
export const updateProfile = (actionPayload, addressChange) => dispatch =>
  dispatch(updateProfileThunk(actionPayload)).then(action => {
    const profileSaved = updateProfileThunk.fulfilled.match(action);

    if (addressChange && profileSaved) {
      // The address endpoint propagates to the listings itself, so there is nothing more to
      // do here - and asking twice would write the same fields twice.
      return dispatch(updateLaundryAddressThunk(addressChange));
    }

    if (profileSaved) {
      // RE-STAMP THE GARMENTS.
      //
      //   > "si laundry cambia su nombre, la dirección o el vecindario los listings no se
      //   >  actualizan" (Jonathan, 2026-09-09)
      //
      // Assigning a laundry copies its name and address onto the listing, because cards,
      // search results and emails print them and none of those can fetch a user. A studio
      // that renamed itself therefore kept its old name on every garment it holds - the
      // address path has propagated since it was built, an ordinary profile save never did.
      //
      // Not awaited and failures are swallowed: the profile HAS saved by this point, and
      // reporting a propagation failure as a save failure would tell the studio its rename
      // did not stick when it did. The endpoint is idempotent, so the next save converges.
      Promise.resolve()
        .then(() => refreshLaundryListings())
        .catch(() => null);
    }

    return action;
  });

// ================ Slice ================ //

const laundryProfilePageSlice = createSlice({
  name: 'LaundryProfilePage',
  initialState: {
    image: null,
    uploadImageError: null,
    uploadInProgress: false,
    updateProfileInProgress: false,
    updateProfileError: null,
    updateAddressInProgress: false,
    updateAddressError: null,
  },
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(uploadImageThunk.pending, (state, action) => {
        const { id, file } = action.meta.arg;
        state.image = { id, file };
        state.uploadInProgress = true;
        state.uploadImageError = null;
      })
      .addCase(uploadImageThunk.fulfilled, (state, action) => {
        const { id, uploadedImage } = action.payload;
        const { file } = state.image || {};
        state.image = { id, imageId: uploadedImage.id, file, uploadedImage };
        state.uploadInProgress = false;
      })
      .addCase(uploadImageThunk.rejected, (state, action) => {
        state.image = null;
        state.uploadInProgress = false;
        state.uploadImageError = action.payload.error;
      })
      .addCase(updateProfileThunk.pending, state => {
        state.updateProfileInProgress = true;
        state.updateProfileError = null;
        // Cleared here too: the two calls are one user action ("Save changes"), so a
        // stale "contact support" message must not survive alongside a fresh attempt.
        state.updateAddressError = null;
      })
      .addCase(updateProfileThunk.fulfilled, state => {
        state.image = null;
        state.updateProfileInProgress = false;
      })
      .addCase(updateProfileThunk.rejected, (state, action) => {
        state.updateProfileInProgress = false;
        state.updateProfileError = action.payload;
      })
      .addCase(updateLaundryAddressThunk.pending, state => {
        state.updateAddressInProgress = true;
        state.updateAddressError = null;
      })
      .addCase(updateLaundryAddressThunk.fulfilled, state => {
        state.updateAddressInProgress = false;
      })
      .addCase(updateLaundryAddressThunk.rejected, (state, action) => {
        state.updateAddressInProgress = false;
        state.updateAddressError = action.payload;
      });
  },
});

export default laundryProfilePageSlice.reducer;
