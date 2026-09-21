jest.mock('../api-util/sdk', () => ({ handleError: jest.fn() }));
jest.mock('../api-util/integrationSdk', () => ({ getIntegrationSdk: jest.fn() }));
jest.mock('../api-util/laundryAuth', () => ({ authorizeLaundryCaller: jest.fn() }));

const { handleError } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { authorizeLaundryCaller } = require('../api-util/laundryAuth');

const receiveGarment = require('./laundry-receive-garment');

// WHY THIS FILE EXISTS
//
//   > "cuando el provider va a entregar una prenda a la laundry, la laundry debe ingresar un
//   >  ticket y luego iniciar el proceso de lavado" (Jonathan, 2026-09-08)
//
// This endpoint is what stops a coat being announced as collectable before it has been
// washed, and it is also a custody write that is deliberately NOT behind the
// active-transaction gate that guards every other one. So the two things worth pinning are
// that it records the arrival, and that it refuses every situation that is not an arrival.

const TX_ID = '6a74b530-a104-42b6-a586-b35efb5dee79';
const LISTING_ID = '11111111-1111-1111-1111-111111111111';
const LAUNDRY_ID = '22222222-2222-2222-2222-222222222222';

const mockRes = () => ({
  statusCode: null,
  body: null,
  status: jest.fn(function(code) {
    this.statusCode = code;
    return this;
  }),
  set: jest.fn().mockReturnThis(),
  send: jest.fn(function(body) {
    this.body = body;
    return this;
  }),
  json: jest.fn(function(body) {
    this.body = body;
    return this;
  }),
  end: jest.fn().mockReturnThis(),
});

const setup = ({
  lastTransition = 'transition/accept',
  onLaundry = false,
  updateImpl,
  transitionImpl,
  authorizeFails = null,
} = {}) => {
  const listingsUpdate = updateImpl || jest.fn(() => Promise.resolve({ data: { data: {} } }));
  const updateMetadata = jest.fn(() => Promise.resolve({ data: { data: {} } }));
  const transition = transitionImpl || jest.fn(() => Promise.resolve({ data: { data: {} } }));
  const show = jest.fn(() =>
    Promise.resolve({
      data: {
        data: { id: { uuid: TX_ID }, attributes: { lastTransition } },
        included: [
          {
            id: { uuid: LISTING_ID },
            type: 'listing',
            attributes: {
              metadata: {
                assignedLaundryId: LAUNDRY_ID,
                ...(onLaundry ? { onLaundry: true } : {}),
              },
            },
          },
        ],
      },
    })
  );

  getIntegrationSdk.mockReturnValue({
    transactions: { show, updateMetadata, transition },
    listings: { update: listingsUpdate },
  });
  authorizeLaundryCaller.mockImplementation(() =>
    authorizeFails ? Promise.reject(authorizeFails) : Promise.resolve({ id: { uuid: LAUNDRY_ID } })
  );

  return { listingsUpdate, updateMetadata, transition, show };
};

const run = async (body = { transactionId: TX_ID }) => {
  const res = mockRes();
  await receiveGarment({ body }, res);
  await new Promise(resolve => setImmediate(resolve));
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  handleError.mockImplementation((res, e) => {
    res.status(e.status || 500).json(e.data || {});
    return res;
  });
});

describe('laundry-receive-garment', () => {
  it('records that the garment is now on the studio rack', async () => {
    const { listingsUpdate } = setup();
    const res = await run();

    expect(res.statusCode).toBe(200);
    expect(res.body.data.onLaundry).toBe(true);
    // The custody flag is what the ops screens read to decide the next step - with it false
    // they keep offering reception, so this write is the load-bearing one.
    const custodyCall = listingsUpdate.mock.calls[0][0];
    expect(custodyCall.metadata.onLaundry).toBe(true);
    // And the departure stamp is cleared: a garment that came back is not one that went home.
    expect(custodyCall.metadata.handedBackAt).toBeNull();
  });

  it('fires transition/laundry-receive-from-provider, moving the rental into initial-cleaning (2026-09-21)', async () => {
    // This used to fire no transition at all, to avoid the cost of a flex-cli process push for
    // a first pass - see the comment at the top of laundry-receive-garment.js for why that
    // trade-off no longer applies.
    const { show, transition } = setup();
    await run();

    expect(show).toHaveBeenCalled();
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        id: TX_ID,
        transition: 'transition/laundry-receive-from-provider',
      }),
      expect.anything()
    );
  });

  it('reports a 409, not a 500, when Sharetribe refuses the transition as illegal', async () => {
    const invalidTransitionError = new Error('invalid transition');
    invalidTransitionError.data = { errors: [{ code: 'transaction-invalid-transition' }] };
    const { listingsUpdate } = setup({
      transitionImpl: jest.fn(() => Promise.reject(invalidTransitionError)),
    });

    const res = await run();

    expect(res.statusCode).toBe(409);
    // The transition was refused, so nothing downstream of it should have run.
    expect(listingsUpdate).not.toHaveBeenCalled();
  });

  it('writes the studio code to the rental and to the garment', async () => {
    const { listingsUpdate, updateMetadata } = setup();
    await run({ transactionId: TX_ID, laundryCode: 'A-04' });

    expect(updateMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ id: TX_ID, metadata: { laundryCode: 'A-04' } })
    );
    // The garment's copy is stamped with the studio that issued it - see
    // api-util/laundryCode.js for why a bare string would be unreadable later.
    const codeCall = listingsUpdate.mock.calls[1][0];
    expect(codeCall.metadata.laundryCode.code).toBe('A-04');
    expect(codeCall.metadata.laundryCode.laundryId).toBe(LAUNDRY_ID);
  });

  it('still records the arrival when no code was typed', async () => {
    // A studio that has not named the garment yet must still be able to take it in.
    const { listingsUpdate, updateMetadata } = setup();
    const res = await run();

    expect(res.statusCode).toBe(200);
    expect(updateMetadata).not.toHaveBeenCalled();
    expect(listingsUpdate).toHaveBeenCalledTimes(1);
  });

  it('refuses a garment the studio already has', async () => {
    // This is the rental that skips straight to the renter collecting. A no-op 200 would
    // leave the operator pressing a button that does nothing.
    const { listingsUpdate } = setup({ onLaundry: true });
    const res = await run();

    expect(res.statusCode).toBe(409);
    expect(listingsUpdate).not.toHaveBeenCalled();
  });

  it('refuses at any state other than accepted', async () => {
    // A stale screen must not claim custody of a garment that is out with a customer.
    const { listingsUpdate } = setup({ lastTransition: 'transition/laundry-confirm-pickup' });
    const res = await run();

    expect(res.statusCode).toBe(409);
    expect(listingsUpdate).not.toHaveBeenCalled();
  });

  it('refuses a caller that is not the assigned studio, and writes nothing', async () => {
    const forbidden = new Error('Forbidden');
    forbidden.status = 403;
    forbidden.data = {};
    const { listingsUpdate } = setup({ authorizeFails: forbidden });
    const res = await run();

    expect(res.statusCode).toBe(403);
    expect(listingsUpdate).not.toHaveBeenCalled();
  });

  it('rejects a missing transaction id before reading anything', async () => {
    const { show } = setup();
    const res = await run({});

    expect(res.statusCode).toBe(400);
    expect(show).not.toHaveBeenCalled();
  });

  it('rejects a code the store would refuse anyway', async () => {
    const { show } = setup();
    const res = await run({ transactionId: TX_ID, laundryCode: 'x'.repeat(100) });

    expect(res.statusCode).toBe(400);
    expect(show).not.toHaveBeenCalled();
  });
});
