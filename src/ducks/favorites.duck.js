import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { storableError } from '../util/errors';
import { setCurrentUser } from './user.duck';
import { denormalisedResponseEntities } from '../util/data';

/**
 * Saved garments.
 *
 *   > "en la página de listing page, se puedan ver dos iconos, el primero es para marcar como
 *   >  favorito (...) debe crear una página adicional que muestre la lista de mis favoritos,
 *   >  ahi puedo quitar alguno, puede estar en listingCard, pero tambien debe verse en
 *   >  listingPage" (Jonathan, 2026-09-08)
 *
 * ── WHY THIS IS A SHARED DUCK ───────────────────────────────────────────────
 * The heart appears on the listing page, on every card in search, and on the favourites page
 * itself - three screens that can be looking at the same garment. A page-level duck would
 * give each of them its own copy of "is this saved", and the copies would disagree the moment
 * one of them wrote: unfavourite a garment on the favourites page, go back, and the search
 * card still shows it filled. So the list lives in one place, next to the user it belongs to.
 *
 * ── WHERE THE LIST IS STORED, AND WHY NOT publicData ────────────────────────
 * `currentUser.profile.privateData.favoriteListingIds`. `publicData` is readable by ANYONE
 * through the users API - a saved-garments list there is a public record of what a person
 * likes and is thinking of wearing, attached to their name. `privateData` is readable only by
 * its owner and the operator, which is what this is.
 *
 * It is a plain array of listing-id STRINGS. Not UUID instances: this is written through the
 * Marketplace API as JSON and read back as JSON, and a UUID instance would arrive as an
 * object that every reader would then have to unwrap. See util/data.js for the same argument
 * about extended data generally.
 *
 * ── WHY THE WRITE IS A WHOLE-LIST REPLACE ───────────────────────────────────
 * There is no "append to an array" in the API: `updateProfile` merges per TOP-LEVEL key, so
 * writing `privateData.favoriteListingIds` replaces the array wholesale. Every write here
 * therefore reads the current list from state and sends the full result. The consequence is
 * real and worth stating: two tabs saving different garments at the same moment will have the
 * later write win, and the earlier garment will not be saved. That is acceptable for a
 * favourites list - the user can see it did not stick and press again - and the alternative
 * is a read-modify-write against the API on every heart, which is slower and still racy.
 */

// ================ Selectors ================ //

const FAVORITES_KEY = 'favoriteListingIds';

/**
 * The ids this user has saved, oldest first.
 *
 * Reads from `state.user.currentUser` rather than from this slice: the profile IS the store,
 * and this duck only holds what is in flight. A second copy here would be a second thing that
 * can be stale - which is exactly the bug the shared duck exists to avoid.
 *
 * @param {Object} state - the Redux state
 * @returns {Array<string>} listing ids, never null
 */
export const favoriteListingIdsSelector = state => {
  const ids = state?.user?.currentUser?.attributes?.profile?.privateData?.[FAVORITES_KEY];
  // Anything that is not an array of strings is treated as no favourites at all. This is
  // user-writable data and it has been round-tripped through JSON; a malformed value must
  // degrade to an empty heart rather than throwing on a listing page.
  return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [];
};

/**
 * @param {Object} state
 * @param {string} [listingId]
 * @returns {boolean}
 */
export const isFavoriteSelector = (state, listingId) =>
  !!listingId && favoriteListingIdsSelector(state).includes(listingId);

// ================ Thunks ================ //

export const toggleFavoriteThunk = createAsyncThunk(
  'favorites/toggleFavorite',
  ({ listingId }, { dispatch, getState, rejectWithValue, extra: sdk }) => {
    if (!listingId) {
      return rejectWithValue(storableError(new Error('No listing id to favorite.')));
    }

    const current = favoriteListingIdsSelector(getState());
    const isFavorite = current.includes(listingId);
    // Appended at the END when saving, so the favourites page can read oldest-first and stay
    // in a stable order as the list grows. A set would be the natural shape for "is it in
    // there" but would throw away the only ordering the user has.
    const next = isFavorite ? current.filter(id => id !== listingId) : [...current, listingId];

    return sdk.currentUser
      .updateProfile({ privateData: { [FAVORITES_KEY]: next } }, { expand: true })
      .then(response => {
        const entities = denormalisedResponseEntities(response);
        if (entities.length !== 1) {
          throw new Error('Expected a resource in the sdk.currentUser.updateProfile response');
        }
        // The user entity is the store, so this is what makes every heart on screen agree -
        // including the ones on pages this thunk has never heard of.
        dispatch(setCurrentUser(entities[0]));
        return { listingId, isFavorite: !isFavorite };
      })
      .catch(e => rejectWithValue(storableError(e)));
  }
);

export const toggleFavorite = listingId => dispatch => dispatch(toggleFavoriteThunk({ listingId }));

// ================ Slice ================ //

const initialState = {
  // The listing currently being saved or removed, so ONE heart can show that it is working
  // without disabling every other heart on a page of forty cards.
  togglingListingId: null,
  toggleError: null,
};

const favoritesSlice = createSlice({
  name: 'favorites',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(toggleFavoriteThunk.pending, (state, action) => {
        state.togglingListingId = action.meta.arg?.listingId || null;
        state.toggleError = null;
      })
      .addCase(toggleFavoriteThunk.fulfilled, state => {
        state.togglingListingId = null;
      })
      .addCase(toggleFavoriteThunk.rejected, (state, action) => {
        state.togglingListingId = null;
        state.toggleError = action.payload;
      });
  },
});

export default favoritesSlice.reducer;
