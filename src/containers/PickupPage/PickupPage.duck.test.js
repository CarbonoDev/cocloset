import { configureStore } from '@reduxjs/toolkit';

jest.mock('../../util/api', () => ({
  fetchListingPickupStatus: jest.fn(),
  confirmListingPickup: jest.fn(),
}));

import { fetchListingPickupStatus, confirmListingPickup } from '../../util/api';
import reducer, { fetchPickupStatusThunk, confirmPickupThunk, loadData } from './PickupPage.duck';

const LISTING_ID = '6aa26840-16da-44df-8a74-ff4ece1da4eb';
const TOKEN = 'a'.repeat(32);

const RESPONSE_BODY = {
  data: {
    listingId: LISTING_ID,
    listingTitle: 'A silk frock',
    ownerName: 'Ana Rivera',
    onLaundry: true,
    viewerRole: 'laundry',
    tokenValid: true,
    canConfirm: true,
  },
};

const makeStore = () => configureStore({ reducer: { PickupPage: reducer } });
const stateOf = store => store.getState().PickupPage;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetchPickupStatusThunk', () => {
  it('stores the status the endpoint sends, and the request args alongside it', async () => {
    fetchListingPickupStatus.mockResolvedValue(RESPONSE_BODY);
    const store = makeStore();

    await store.dispatch(fetchPickupStatusThunk({ listingId: LISTING_ID, token: TOKEN }));

    expect(stateOf(store).pickupStatus).toEqual(RESPONSE_BODY.data);
    expect(stateOf(store).listingId).toBe(LISTING_ID);
    expect(stateOf(store).token).toBe(TOKEN);
    expect(stateOf(store).fetchError).toBeNull();
    expect(stateOf(store).fetchInProgress).toBe(false);
  });

  it('reports a refusal as an error the page can distinguish', async () => {
    const forbidden = Object.assign(new Error(), { status: 403, statusText: 'Forbidden' });
    fetchListingPickupStatus.mockRejectedValue(forbidden);
    const store = makeStore();

    await store.dispatch(fetchPickupStatusThunk({ listingId: LISTING_ID, token: TOKEN }));

    expect(stateOf(store).fetchError.status).toBe(403);
    expect(stateOf(store).pickupStatus).toBeNull();
  });

  it('reports a SYNCHRONOUS throw as an error rather than silently', async () => {
    // Same class of bug src/containers/HandoverPage/HandoverPage.duck.test.js guards against:
    // a throw that escapes the payload creator rejects with action.error, not action.payload.
    fetchListingPickupStatus.mockImplementation(() => {
      throw new ReferenceError('window is not defined');
    });
    const store = makeStore();

    await store.dispatch(fetchPickupStatusThunk({ listingId: LISTING_ID, token: TOKEN }));

    expect(stateOf(store).fetchError).toBeTruthy();
    expect(stateOf(store).fetchInProgress).toBe(false);
  });

  it('drops the previous status when a refetch fails', async () => {
    fetchListingPickupStatus.mockResolvedValueOnce(RESPONSE_BODY);
    const store = makeStore();
    await store.dispatch(fetchPickupStatusThunk({ listingId: LISTING_ID, token: TOKEN }));

    fetchListingPickupStatus.mockRejectedValueOnce(Object.assign(new Error(), { status: 500 }));
    await store.dispatch(fetchPickupStatusThunk({ listingId: LISTING_ID, token: TOKEN }));

    expect(stateOf(store).pickupStatus).toBeNull();
  });

  it('resets justConfirmed when a genuinely different listing/token loads', async () => {
    confirmListingPickup.mockResolvedValue({ data: {} });
    fetchListingPickupStatus.mockResolvedValue(RESPONSE_BODY);
    const store = makeStore();
    await store.dispatch(fetchPickupStatusThunk({ listingId: LISTING_ID, token: TOKEN }));
    await store.dispatch(confirmPickupThunk({ listingId: LISTING_ID, token: TOKEN }));
    expect(stateOf(store).justConfirmed).toBe(true);

    await store.dispatch(fetchPickupStatusThunk({ listingId: 'other-listing', token: 'b'.repeat(32) }));
    expect(stateOf(store).justConfirmed).toBe(false);
  });
});

describe('confirmPickupThunk', () => {
  it('posts listingId and token, and refetches the status afterwards', async () => {
    confirmListingPickup.mockResolvedValue({ data: { onLaundry: false, role: 'laundry' } });
    fetchListingPickupStatus.mockResolvedValue(RESPONSE_BODY);
    const store = makeStore();

    await store.dispatch(confirmPickupThunk({ listingId: LISTING_ID, token: TOKEN }));

    expect(confirmListingPickup).toHaveBeenCalledWith({ listingId: LISTING_ID, token: TOKEN });
    // Refetched, not patched locally - canConfirm becoming false is the server's answer once
    // custody has actually flipped, same reasoning as confirmHandoverThunk.
    expect(fetchListingPickupStatus).toHaveBeenCalledWith({ listingId: LISTING_ID, token: TOKEN });
    expect(stateOf(store).justConfirmed).toBe(true);
  });

  it('surfaces a rejected confirm (stale/invalid token) without crashing the refetch', async () => {
    confirmListingPickup.mockRejectedValue(Object.assign(new Error(), { status: 409 }));
    const store = makeStore();

    await store.dispatch(confirmPickupThunk({ listingId: LISTING_ID, token: TOKEN }));

    expect(stateOf(store).confirmError.status).toBe(409);
    expect(stateOf(store).confirmInProgress).toBe(false);
    expect(stateOf(store).justConfirmed).toBe(false);
    expect(fetchListingPickupStatus).not.toHaveBeenCalled();
  });
});

describe('loadData', () => {
  it('reads listingId from route params and token from the query string', async () => {
    fetchListingPickupStatus.mockResolvedValue(RESPONSE_BODY);
    const dispatch = jest.fn(action => (typeof action === 'function' ? action(dispatch) : action));
    const store = makeStore();

    await store.dispatch(loadData({ listingId: LISTING_ID }, `?token=${TOKEN}`));

    expect(fetchListingPickupStatus).toHaveBeenCalledWith({ listingId: LISTING_ID, token: TOKEN });
  });

  it('does nothing when the token is missing from the URL', async () => {
    const store = makeStore();
    await store.dispatch(loadData({ listingId: LISTING_ID }, ''));
    expect(fetchListingPickupStatus).not.toHaveBeenCalled();
  });

  it('does nothing when listingId is missing from the route params', async () => {
    const store = makeStore();
    await store.dispatch(loadData({}, `?token=${TOKEN}`));
    expect(fetchListingPickupStatus).not.toHaveBeenCalled();
  });
});
