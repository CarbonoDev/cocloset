import { configureStore } from '@reduxjs/toolkit';

jest.mock('../../util/api', () => ({
  fetchLaundryOrders: jest.fn(),
  updateLaundryTransactionStatus: jest.fn(),
}));

import { updateLaundryTransactionStatus, fetchLaundryOrders } from '../../util/api';
import reducer, { advanceStatusThunk } from './LaundryOpsPage.duck';

/**
 * WHY THIS FILE EXISTS
 *
 * `advanceStatusThunk` builds its request body by spreading named fields in one at a time.
 * That is deliberate - it is what stops a caller posting arbitrary keys at a privileged
 * endpoint - but it means a field the row sends and this list does not name is dropped HERE,
 * silently, before the request is built. No error, no warning, and the endpoint answers 200
 * because the move itself was legal.
 *
 * That is exactly how the ops table came to lose the studio's internal code: the box was the
 * missing half of it, but even with a box, the value would have stopped at this whitelist.
 * Both component tests and endpoint tests sail past it - the component asserts what it handed
 * to `onAdvanceStatus`, the endpoint asserts what it does with a body it was given, and this
 * is the seam between them.
 */

const TX_ID = '6a74b530-a104-42b6-a586-b35efb5dee79';

const makeStore = () =>
  configureStore({
    reducer: { LaundryOpsPage: reducer },
    middleware: getDefault => getDefault({ serializableCheck: false }),
  });

const bodySentFor = params => {
  updateLaundryTransactionStatus.mockResolvedValue({ data: { ok: true } });
  fetchLaundryOrders.mockResolvedValue({ data: { orders: [], inventory: [], meta: {} } });

  return makeStore()
    .dispatch(advanceStatusThunk(params))
    .then(() => updateLaundryTransactionStatus.mock.calls[0][0]);
};

describe('advanceStatusThunk request body', () => {
  it('forwards the studio internal code to the endpoint', async () => {
    const body = await bodySentFor({
      transactionId: TX_ID,
      status: 'ready-for-pickup',
      laundryCode: 'A-04 / BIN 7',
    });

    expect(body).toEqual({
      transactionId: TX_ID,
      status: 'ready-for-pickup',
      laundryCode: 'A-04 / BIN 7',
    });
  });

  it('omits the code entirely when the caller sent none', async () => {
    const body = await bodySentFor({ transactionId: TX_ID, status: 'ready-for-pickup' });

    expect(body).not.toHaveProperty('laundryCode');
  });

  // The fields that were already forwarded, pinned here so a future addition to the whitelist
  // cannot quietly displace one of them.
  it('still forwards the damage report and the cleaning days', async () => {
    const body = await bodySentFor({
      transactionId: TX_ID,
      status: 'returned',
      damaged: true,
      damageNote: 'Hem torn',
      cleaningDays: 4,
    });

    expect(body).toEqual({
      transactionId: TX_ID,
      status: 'returned',
      damaged: true,
      damageNote: 'Hem torn',
      cleaningDays: 4,
    });
  });
});
