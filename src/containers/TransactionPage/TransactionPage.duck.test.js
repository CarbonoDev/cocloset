import { configureStore } from '@reduxjs/toolkit';

jest.mock('../../util/api', () => ({
  customerPartialRefundCancel: jest.fn(),
  transactionLineItems: jest.fn(),
  transitionPrivileged: jest.fn(),
}));

import { customerPartialRefundCancel } from '../../util/api';
import reducer, { partialRefundCancelThunk, partialRefundCancel } from './TransactionPage.duck';

/**
 * partialRefundCancelThunk is NOT the generic makeTransitionThunk - it calls a custom,
 * multi-step server endpoint (server/api/customer-partial-refund-cancel.js) instead of
 * dispatching a transition name through the SDK. These tests are about the Redux state
 * machine around that call: loading/error/success, tracked in its OWN state keys
 * (partialRefundCancelInProgress/-Error/-Result) rather than the generic
 * transitionInProgress/transitionError the rest of this duck uses for real transitions.
 */

const TX_ID = { uuid: '6a74b530-a104-42b6-a586-b35efb5dee79' };

const makeStore = (sdkOverrides = {}) => {
  const sdk = {
    transactions: {
      show: jest.fn().mockResolvedValue({ data: { data: { id: TX_ID } } }),
      ...sdkOverrides,
    },
  };
  return {
    store: configureStore({
      reducer: { TransactionPage: reducer },
      middleware: getDefaultMiddleware => getDefaultMiddleware({ thunk: { extraArgument: sdk } }),
    }),
    sdk,
  };
};

const stateOf = store => store.getState().TransactionPage;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('partialRefundCancelThunk', () => {
  it('tracks inProgress true while in flight, then false on success', async () => {
    let resolveApi;
    customerPartialRefundCancel.mockReturnValue(
      new Promise(resolve => {
        resolveApi = resolve;
      })
    );
    const { store } = makeStore();

    const dispatchPromise = store.dispatch(partialRefundCancelThunk({ txId: TX_ID }));
    expect(stateOf(store).partialRefundCancelInProgress).toBe(true);
    expect(stateOf(store).partialRefundCancelError).toBeNull();

    resolveApi({
      data: { refunded: true, cancelled: true, requiresManualFollowUp: false, refundAmount: 8000 },
    });
    await dispatchPromise;

    expect(stateOf(store).partialRefundCancelInProgress).toBe(false);
    expect(stateOf(store).partialRefundCancelResult).toEqual({
      refunded: true,
      cancelled: true,
      requiresManualFollowUp: false,
      refundAmount: 8000,
    });
  });

  it('refreshes the transaction entity on success - the ENTITY, not a locally patched guess', async () => {
    customerPartialRefundCancel.mockResolvedValue({
      data: { refunded: true, cancelled: true, requiresManualFollowUp: false },
    });
    const { store, sdk } = makeStore();

    await store.dispatch(partialRefundCancelThunk({ txId: TX_ID }));

    expect(sdk.transactions.show).toHaveBeenCalledWith({ id: TX_ID }, { expand: true });
  });

  it('still reports the real result even when the post-success refresh itself fails', async () => {
    customerPartialRefundCancel.mockResolvedValue({
      data: { refunded: true, cancelled: true, requiresManualFollowUp: false },
    });
    const { store } = makeStore({ show: jest.fn().mockRejectedValue(new Error('refresh down')) });

    await store.dispatch(partialRefundCancelThunk({ txId: TX_ID }));

    expect(stateOf(store).partialRefundCancelResult).toEqual({
      refunded: true,
      cancelled: true,
      requiresManualFollowUp: false,
    });
    expect(stateOf(store).partialRefundCancelError).toBeNull();
  });

  it('reports the manual-follow-up half-success distinctly, not as a plain error', async () => {
    customerPartialRefundCancel.mockResolvedValue({
      data: { refunded: true, cancelled: false, requiresManualFollowUp: true, refundAmount: 8000 },
    });
    const { store } = makeStore();

    await store.dispatch(partialRefundCancelThunk({ txId: TX_ID }));

    expect(stateOf(store).partialRefundCancelError).toBeNull();
    expect(stateOf(store).partialRefundCancelResult.requiresManualFollowUp).toBe(true);
    expect(stateOf(store).partialRefundCancelResult.cancelled).toBe(false);
  });

  it('stores a storable error, with the server error/reason intact, on a rejected call', async () => {
    const serverError = Object.assign(new Error('nope'), {
      status: 409,
      error: 'not-eligible',
      reason: 'wrong-state',
    });
    customerPartialRefundCancel.mockRejectedValue(serverError);
    const { store } = makeStore();

    await store.dispatch(partialRefundCancelThunk({ txId: TX_ID }));

    expect(stateOf(store).partialRefundCancelInProgress).toBe(false);
    expect(stateOf(store).partialRefundCancelError).toEqual(
      expect.objectContaining({ status: 409, error: 'not-eligible', reason: 'wrong-state' })
    );
    expect(stateOf(store).partialRefundCancelResult).toBeNull();
  });

  it('refuses to start a second call while one is already in flight', async () => {
    let resolveApi;
    customerPartialRefundCancel.mockReturnValue(
      new Promise(resolve => {
        resolveApi = resolve;
      })
    );
    const { store } = makeStore();

    const first = store.dispatch(partialRefundCancelThunk({ txId: TX_ID }));
    store.dispatch(partialRefundCancelThunk({ txId: TX_ID }));

    // Only the first call actually reached the API - the second was refused by `condition`.
    expect(customerPartialRefundCancel).toHaveBeenCalledTimes(1);

    resolveApi({ data: { refunded: true, cancelled: true } });
    await first;
  });

  it('clears a previous error when a fresh attempt starts', async () => {
    customerPartialRefundCancel.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { status: 409, error: 'not-eligible' })
    );
    const { store } = makeStore();

    await store.dispatch(partialRefundCancelThunk({ txId: TX_ID }));
    expect(stateOf(store).partialRefundCancelError).not.toBeNull();

    let resolveApi;
    customerPartialRefundCancel.mockReturnValue(
      new Promise(resolve => {
        resolveApi = resolve;
      })
    );
    const dispatchPromise = store.dispatch(partialRefundCancelThunk({ txId: TX_ID }));
    expect(stateOf(store).partialRefundCancelError).toBeNull();

    resolveApi({ data: { refunded: true, cancelled: true } });
    await dispatchPromise;
  });
});

describe('partialRefundCancel (container convenience wrapper)', () => {
  it('dispatches the thunk with the given transaction id', async () => {
    customerPartialRefundCancel.mockResolvedValue({ data: { refunded: true, cancelled: true } });
    const { store } = makeStore();

    await store.dispatch(partialRefundCancel(TX_ID));

    expect(customerPartialRefundCancel).toHaveBeenCalledWith({ transactionId: TX_ID });
    expect(stateOf(store).partialRefundCancelResult).toEqual({ refunded: true, cancelled: true });
  });
});
