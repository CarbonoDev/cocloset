import { configureStore } from '@reduxjs/toolkit';

jest.mock('../../util/api', () => ({
  fetchHandoverStatus: jest.fn(),
  updateLaundryTransactionStatus: jest.fn(),
}));

import { fetchHandoverStatus, updateLaundryTransactionStatus } from '../../util/api';
import reducer, { fetchHandoverThunk, confirmHandoverThunk } from './HandoverPage.duck';

/**
 * WHY THIS FILE EXISTS
 *
 * The page shipped completely blank: a heading over empty space, no data and no error. The
 * cause was here, not in the component — `request()` in util/api.js returns the PARSED BODY,
 * so the endpoint's `{ data: {...} }` arrives whole and `response.data` is already the
 * handover. The reducer read `.data` a second time, stored `undefined`, and a component that
 * rendered nothing for "no handover" had nothing to say.
 *
 * Nothing caught it. The endpoint tests asserted the response body, the component tests
 * passed the handover in as a prop, and the two never met. So these tests are specifically
 * about the SHAPE crossing that boundary, driven through the real reducer.
 */

const TX_ID = '6a74b530-a104-42b6-a586-b35efb5dee79';

// Exactly what GET /api/handover-status sends, and exactly what `request()` hands back for
// it: the parsed body, one `data` deep.
const RESPONSE_BODY = {
  data: {
    transactionId: TX_ID,
    processState: 'ready-for-pickup',
    viewerRole: 'customer',
    canConfirm: false,
    step: {
      state: 'ready-for-pickup',
      status: 'picked-up',
      counterparty: 'customer',
      direction: 'out',
      isLate: false,
    },
    listingTitle: 'A silk frock',
    bookingStart: '2026-09-01T00:00:00.000Z',
    bookingEnd: '2026-09-08T00:00:00.000Z',
    ticketCode: 'PIG-A3F91C',
  },
};

const makeStore = () => configureStore({ reducer: { HandoverPage: reducer } });
const stateOf = store => store.getState().HandoverPage;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetchHandoverThunk', () => {
  it('stores the handover the endpoint actually sends', async () => {
    // THE REGRESSION. One `.data` too many here rendered the whole page blank in production.
    fetchHandoverStatus.mockResolvedValue(RESPONSE_BODY);
    const store = makeStore();

    await store.dispatch(fetchHandoverThunk({ transactionId: TX_ID }));

    expect(stateOf(store).handover).toEqual(RESPONSE_BODY.data);
    expect(stateOf(store).handover.processState).toBe('ready-for-pickup');
    expect(stateOf(store).fetchError).toBeNull();
    expect(stateOf(store).fetchInProgress).toBe(false);
  });

  it('reports a refusal as an error the page can distinguish', async () => {
    // `request()` throws an Error carrying the JSON body, and our endpoint's body includes
    // `status`. The page branches on it to tell "not yours" apart from "try again", so losing
    // it would collapse three different messages into one.
    const forbidden = Object.assign(new Error(), { status: 403, statusText: 'Forbidden' });
    fetchHandoverStatus.mockRejectedValue(forbidden);
    const store = makeStore();

    await store.dispatch(fetchHandoverThunk({ transactionId: TX_ID }));

    expect(stateOf(store).fetchError).toBeTruthy();
    expect(stateOf(store).fetchError.status).toBe(403);
    expect(stateOf(store).handover).toBeNull();
  });

  it('reports a SYNCHRONOUS throw as an error rather than silently', async () => {
    // A throw that escapes the payload creator rejects with `action.error`, not
    // `action.payload` - so the slice would store `undefined` and the page would be blank
    // again, by a different route. `Promise.resolve().then(...)` in the thunk is what stops
    // that; this is the test that keeps it there.
    fetchHandoverStatus.mockImplementation(() => {
      throw new ReferenceError('window is not defined');
    });
    const store = makeStore();

    await store.dispatch(fetchHandoverThunk({ transactionId: TX_ID }));

    expect(stateOf(store).fetchError).toBeTruthy();
    expect(stateOf(store).fetchInProgress).toBe(false);
  });

  it('drops the previous handover when a refetch fails', async () => {
    // Showing the last transaction's step under a "could not load" error is how a laundry
    // confirms the wrong garment.
    fetchHandoverStatus.mockResolvedValueOnce(RESPONSE_BODY);
    const store = makeStore();
    await store.dispatch(fetchHandoverThunk({ transactionId: TX_ID }));

    fetchHandoverStatus.mockRejectedValueOnce(Object.assign(new Error(), { status: 500 }));
    await store.dispatch(fetchHandoverThunk({ transactionId: TX_ID }));

    expect(stateOf(store).handover).toBeNull();
  });
});

describe('confirmHandoverThunk', () => {
  it('posts the step status and refetches the handover afterwards', async () => {
    updateLaundryTransactionStatus.mockResolvedValue({ data: {} });
    fetchHandoverStatus.mockResolvedValue(RESPONSE_BODY);
    const store = makeStore();

    await store.dispatch(confirmHandoverThunk({ transactionId: TX_ID, status: 'picked-up' }));

    expect(updateLaundryTransactionStatus).toHaveBeenCalledWith({
      transactionId: TX_ID,
      status: 'picked-up',
    });
    // Refetched rather than patched: the next step is a function of the NEW process state,
    // and re-deriving it server-side is what stops the page showing a step already left.
    expect(fetchHandoverStatus).toHaveBeenCalledWith(TX_ID);
  });

  // THE FIELD THAT WENT NOWHERE. Every key is spread in by name here - which is what stops a
  // caller posting arbitrary keys at a privileged endpoint - and `laundryCode` was simply not
  // among them. The component built it and the endpoint accepted it, so a studio typing its
  // shelf code on the counter phone saw the step succeed while the code was dropped in
  // between, silently. Nothing else could have caught it: the component test asserts what it
  // handed to `onConfirm`, the endpoint test asserts what it does with a body it was given.
  it('forwards the studio internal code, and omits it when there is none', async () => {
    updateLaundryTransactionStatus.mockResolvedValue({ data: {} });
    fetchHandoverStatus.mockResolvedValue(RESPONSE_BODY);
    const store = makeStore();

    await store.dispatch(
      confirmHandoverThunk({
        transactionId: TX_ID,
        status: 'ready-for-pickup',
        laundryCode: 'A-04 / BIN 7',
      })
    );

    expect(updateLaundryTransactionStatus).toHaveBeenCalledWith({
      transactionId: TX_ID,
      status: 'ready-for-pickup',
      laundryCode: 'A-04 / BIN 7',
    });

    // A blank box is "not decided yet", never a delete - the server reads an absent value as
    // "leave whatever is stored alone".
    await store.dispatch(
      confirmHandoverThunk({ transactionId: TX_ID, status: 'ready-for-pickup' })
    );

    expect(updateLaundryTransactionStatus).toHaveBeenLastCalledWith({
      transactionId: TX_ID,
      status: 'ready-for-pickup',
    });
  });

  it('surfaces a rejected confirm without wiping the handover on screen', async () => {
    // The operator has physically handed the garment over by now; the screen has to keep
    // showing what they were doing.
    fetchHandoverStatus.mockResolvedValue(RESPONSE_BODY);
    const store = makeStore();
    await store.dispatch(fetchHandoverThunk({ transactionId: TX_ID }));

    updateLaundryTransactionStatus.mockRejectedValue(Object.assign(new Error(), { status: 409 }));
    await store.dispatch(confirmHandoverThunk({ transactionId: TX_ID, status: 'picked-up' }));

    expect(stateOf(store).confirmError).toBeTruthy();
    expect(stateOf(store).confirmError.status).toBe(409);
    expect(stateOf(store).handover).toEqual(RESPONSE_BODY.data);
    expect(stateOf(store).confirmInProgress).toBe(false);
  });
});
