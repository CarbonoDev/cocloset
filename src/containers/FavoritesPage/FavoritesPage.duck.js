import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { types as sdkTypes, createImageVariantConfig } from '../../util/sdkLoader';
import { storableError } from '../../util/errors';
import { addMarketplaceEntities } from '../../ducks/marketplaceData.duck';
import { fetchCurrentUser } from '../../ducks/user.duck';
import { favoriteListingIdsSelector } from '../../ducks/favorites.duck';

const { UUID } = sdkTypes;

/**
 * The saved-garments page.
 *
 * WHAT THIS DUCK DOES NOT HOLD: the list of ids. That lives on the user
 * (ducks/favorites.duck.js), because the hearts on every other screen read it too. This one
 * holds only which of those listings have been FETCHED, so the page can render cards.
 *
 * ── WHY THE IDS ARE READ AFTER fetchCurrentUser AND NOT FROM THE URL ────────
 * A favourites page has no parameters: the answer depends entirely on who is asking. So the
 * loader has to have the current user in hand before it knows what to fetch, and on a cold
 * load - someone opening a bookmark - it does not. Hence the explicit `fetchCurrentUser`
 * first, awaited. Skipping it worked in development, where the user was always already in
 * state from the previous page, and rendered an empty list on a fresh tab.
 */

export const fetchFavoritesThunk = createAsyncThunk(
  'FavoritesPage/fetchFavorites',
  ({ config }, { dispatch, getState, rejectWithValue, extra: sdk }) =>
    dispatch(fetchCurrentUser())
      .then(() => {
        const ids = favoriteListingIdsSelector(getState());
        if (ids.length === 0) {
          // No request at all. `listings.query({ ids: [] })` is not a query for nothing - it
          // is a query with no filter, which returns the whole marketplace.
          return { listingIds: [] };
        }

        const { aspectWidth = 1, aspectHeight = 1, variantPrefix = 'listing-card' } =
          config?.layout?.listingImage || {};
        const aspectRatio = aspectHeight / aspectWidth;

        return sdk.listings
          .query({
            ids: ids.map(id => new UUID(id)),
            include: ['author', 'images'],
            'fields.image': [
              `variants.${variantPrefix}`,
              `variants.${variantPrefix}-2x`,
              'variants.square-small',
              'variants.square-small2x',
            ],
            ...createImageVariantConfig(`${variantPrefix}`, 400, aspectRatio),
            ...createImageVariantConfig(`${variantPrefix}-2x`, 800, aspectRatio),
          })
          .then(response => {
            dispatch(addMarketplaceEntities(response));
            // The ORDER the query returned is not the order they were saved in, and it is not
            // stable either. The ids are re-read from the user so the page can present them
            // the way the person built the list, newest last.
            const returned = response.data.data.map(l => l.id.uuid);
            return { listingIds: ids.filter(id => returned.includes(id)) };
          });
      })
      .catch(e => rejectWithValue(storableError(e)))
);

export const loadData = (params, search, config) => dispatch =>
  dispatch(fetchFavoritesThunk({ config }));

// ================ Slice ================ //

const initialState = {
  // Ids of listings that were fetched successfully. A saved listing that has since been
  // closed or deleted simply does not come back from the query, and is therefore not here -
  // which is what stops the page rendering a card for a garment that no longer exists.
  listingIds: [],
  fetchInProgress: false,
  fetchError: null,
};

const favoritesPageSlice = createSlice({
  name: 'FavoritesPage',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(fetchFavoritesThunk.pending, state => {
        state.fetchInProgress = true;
        state.fetchError = null;
      })
      .addCase(fetchFavoritesThunk.fulfilled, (state, action) => {
        state.fetchInProgress = false;
        state.listingIds = action.payload?.listingIds || [];
      })
      .addCase(fetchFavoritesThunk.rejected, (state, action) => {
        state.fetchInProgress = false;
        state.fetchError = action.payload;
      });
  },
});

export default favoritesPageSlice.reducer;
