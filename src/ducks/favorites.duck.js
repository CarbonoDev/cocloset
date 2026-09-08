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
 * ── WHY THE WRITE IS A WHOLE-LIST REPLACE, AND WHAT THAT COSTS ──────────────
 * There is no "append to an array" in the API: `updateProfile` merges per TOP-LEVEL key, so
 * writing `privateData.favoriteListingIds` replaces the array wholesale. Whatever is sent
 * becomes the list.
 *
 *   > "puedes cambiar el comportamiento por si un usuario abre varias pestañas no debería
 *   >  perder sus favoritos guardados" (Jonathan, 2026-09-08)
 *
 * So the list is READ FROM THE API immediately before every write, not from this tab's Redux
 * state. A second tab opened an hour ago holds the list as it was an hour ago; saving one
 * garment there would otherwise send that stale list back and silently delete everything
 * saved since. That is not an edge case - leaving tabs open is how people browse a
 * marketplace - and the loss is invisible until they next look at the page.
 *
 * The extra round trip buys exactly that. What it does NOT buy is safety against two writes
 * in the same instant: the API has no compare-and-set, so two tabs saving within the same
 * few hundred milliseconds still resolve to whichever request the server handles last. That
 * window is now the length of one request rather than the lifetime of a tab, and closing it
 * completely is not something this API can express.
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
export const favoriteListingIdsSelector = state =>
  favoriteListingIdsFromUser(state?.user?.currentUser);

/**
 * The same read, off a user entity rather than off the store.
 *
 * Shared so the selector and the pre-write API read cannot disagree about the shape - which
 * would be a very quiet bug: one of them would see a list the other did not, and the write
 * would then persist the wrong one.
 *
 * @param {Object} [user] - a currentUser entity
 * @returns {Array<string>} listing ids, never null
 */
export const favoriteListingIdsFromUser = user => {
  const ids = user?.attributes?.profile?.privateData?.[FAVORITES_KEY];
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

    // The SERVER's list, fetched now - see the note above. What this tab happens to hold is
    // only good enough for drawing a heart; it is not good enough to write back as the whole
    // truth. On a failure the local copy is used rather than refusing: a user who cannot save
    // anything is worse off than one whose stale tab loses a race it was going to lose anyway.
    return sdk.currentUser
      .show()
      .then(response => favoriteListingIdsFromUser(response?.data?.data))
      .catch(() => favoriteListingIdsSelector(getState()))
      .then(current => {
        const isFavorite = current.includes(listingId);
        // Appended at the END when saving, so the favourites page can read oldest-first and
        // stay in a stable order as the list grows. A set would be the natural shape for "is
        // it in there" but would throw away the only ordering the user has.
        const next = isFavorite ? current.filter(id => id !== listingId) : [...current, listingId];

        return sdk.currentUser
          .updateProfile({ privateData: { [FAVORITES_KEY]: next } }, { expand: true })
          .then(updateResponse => ({ updateResponse, isFavorite }));
      })
      .then(({ updateResponse: response, isFavorite }) => {
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
