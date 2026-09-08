import reducer, {
  favoriteListingIdsSelector,
  isFavoriteSelector,
  toggleFavoriteThunk,
} from './favorites.duck';

/**
 * WHY THIS FILE EXISTS
 *
 * The list lives on the user's `privateData`, and the API has no "append to an array":
 * `updateProfile` replaces a top-level key wholesale. So every toggle reads the current list
 * and sends the whole result, and the failure mode of getting that wrong is a user's saved
 * garments quietly disappearing one at a time.
 */

const A = 'aaaaaaaa-0000-0000-0000-000000000000';
const B = 'bbbbbbbb-0000-0000-0000-000000000000';

const stateWith = favoriteListingIds => ({
  user: {
    currentUser: {
      attributes: { profile: { privateData: favoriteListingIds ? { favoriteListingIds } : {} } },
    },
  },
});

describe('the saved list, read', () => {
  it('is empty for a user who has saved nothing', () => {
    expect(favoriteListingIdsSelector(stateWith(undefined))).toEqual([]);
  });

  it('is empty for a signed-out visitor', () => {
    // The heart still renders for them - it just cannot be filled.
    expect(favoriteListingIdsSelector({})).toEqual([]);
    expect(isFavoriteSelector({}, A)).toBe(false);
  });

  it('ignores anything that is not a list of ids', () => {
    // privateData is user-writable and has been through JSON. A malformed value has to
    // degrade to an empty heart rather than throw on a listing page.
    expect(favoriteListingIdsSelector(stateWith('not-a-list'))).toEqual([]);
    expect(favoriteListingIdsSelector(stateWith([A, 42, null, B]))).toEqual([A, B]);
  });

  it('answers whether one garment is saved', () => {
    expect(isFavoriteSelector(stateWith([A]), A)).toBe(true);
    expect(isFavoriteSelector(stateWith([A]), B)).toBe(false);
    expect(isFavoriteSelector(stateWith([A]), undefined)).toBe(false);
  });
});

describe('the saved list, written', () => {
  const run = ({ current, listingId }) => {
    const updateProfile = jest.fn(() =>
      Promise.resolve({
        data: { data: { id: { uuid: 'user-1' }, type: 'currentUser', attributes: {} } },
      })
    );
    const dispatch = jest.fn(action =>
      typeof action === 'function' ? action(dispatch, () => stateWith(current)) : action
    );
    const thunk = toggleFavoriteThunk({ listingId });

    return thunk(dispatch, () => stateWith(current), { currentUser: { updateProfile } }).then(
      () => updateProfile
    );
  };

  it('adds a garment at the end, keeping the ones already there', async () => {
    // The whole array is sent, so "keeping the ones already there" is this code's job and
    // nothing else's.
    const updateProfile = await run({ current: [A], listingId: B });

    expect(updateProfile.mock.calls[0][0]).toEqual({
      privateData: { favoriteListingIds: [A, B] },
    });
  });

  it('removes a garment and leaves the rest', async () => {
    const updateProfile = await run({ current: [A, B], listingId: A });

    expect(updateProfile.mock.calls[0][0].privateData.favoriteListingIds).toEqual([B]);
  });

  it('starts a list for the first save', async () => {
    const updateProfile = await run({ current: undefined, listingId: A });

    expect(updateProfile.mock.calls[0][0].privateData.favoriteListingIds).toEqual([A]);
  });

  it('does not save the same garment twice', async () => {
    // Two fast clicks, or two hearts for one listing on the same screen.
    const updateProfile = await run({ current: [A], listingId: A });

    expect(updateProfile.mock.calls[0][0].privateData.favoriteListingIds).toEqual([]);
  });
});

describe('the in-flight state', () => {
  it('names the one listing being toggled, not all of them', () => {
    // A page of forty cards must not grey out thirty-nine hearts because one is saving.
    const state = reducer(undefined, {
      type: toggleFavoriteThunk.pending.type,
      meta: { arg: { listingId: A } },
    });

    expect(state.togglingListingId).toBe(A);
  });

  it('clears when the write lands', () => {
    const pending = reducer(undefined, {
      type: toggleFavoriteThunk.pending.type,
      meta: { arg: { listingId: A } },
    });
    const done = reducer(pending, { type: toggleFavoriteThunk.fulfilled.type });

    expect(done.togglingListingId).toBeNull();
  });

  it('keeps the error and stops spinning when it fails', () => {
    const state = reducer(undefined, {
      type: toggleFavoriteThunk.rejected.type,
      payload: { status: 500 },
    });

    expect(state.togglingListingId).toBeNull();
    expect(state.toggleError).toEqual({ status: 500 });
  });
});
