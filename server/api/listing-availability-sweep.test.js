jest.mock('../api-util/sdk', () => ({ handleError: jest.fn() }));
jest.mock('../api-util/integrationSdk', () => ({ getIntegrationSdk: jest.fn() }));
jest.mock('../log', () => ({ error: jest.fn() }));

const { handleError } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const sweep = require('./listing-availability-sweep');
const { limiter } = sweep;

// WHY THIS FILE EXISTS
//
//   > "habia hecho una reservación ya para el mismo artículo y la cancelé como operator, por
//   >  lo tanto, los días reservados deberían estar disponibles, sin embargo no lo estan"
//   >   (Jonathan, 2026-09-07)
//
// This endpoint DELETES from a live calendar, and the thing it deletes is indistinguishable
// by shape from an owner's own "I am away this week" block. So the assertions that matter
// most here are the ones about what it leaves alone: an exception it did not create, one
// belonging to a rental that is still running, and one that opens days rather than closing
// them. A sweep that only ever deletes the right thing in the happy path is not safe.

const LISTING_ID = '11111111-1111-1111-1111-111111111111';

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

const tx = (id, lastTransition, bufferExceptionIds) => ({
  id: { uuid: id },
  type: 'transaction',
  attributes: {
    lastTransition,
    metadata: bufferExceptionIds ? { bufferExceptionIds } : {},
  },
});

const exception = (id, seats = 0) => ({
  id: { uuid: id },
  type: 'availabilityException',
  attributes: { seats },
});

const setup = ({ transactions = [], exceptions = [], deleteImpl } = {}) => {
  const txQuery = jest.fn(() => Promise.resolve({ data: { data: transactions } }));
  const exceptionQuery = jest.fn(() => Promise.resolve({ data: { data: exceptions } }));
  const exceptionDelete = deleteImpl || jest.fn(() => Promise.resolve({ data: { data: {} } }));
  const updateMetadata = jest.fn(() => Promise.resolve({ data: { data: {} } }));

  getIntegrationSdk.mockReturnValue({
    transactions: { query: txQuery, updateMetadata },
    availabilityExceptions: { query: exceptionQuery, delete: exceptionDelete },
  });

  return { txQuery, exceptionQuery, exceptionDelete, updateMetadata };
};

const run = async (body = { listingId: LISTING_ID }) => {
  const res = mockRes();
  await sweep({ body, ip: '10.0.0.1' }, res);
  await new Promise(resolve => setImmediate(resolve));
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  limiter.reset?.();
  handleError.mockImplementation((res, e) => {
    res.status(e.status || 500).json(e.data || {});
    return res;
  });
});

describe('listing-availability-sweep: what it gives back', () => {
  it('frees the days a cancelled booking was still blocking', async () => {
    const { exceptionDelete } = setup({
      transactions: [tx('tx-1', 'transition/cancel', ['exc-1', 'exc-2'])],
      exceptions: [exception('exc-1'), exception('exc-2')],
    });

    const res = await run();

    expect(res.statusCode).toBe(200);
    expect(res.body.data.deleted.sort()).toEqual(['exc-1', 'exc-2']);
    expect(exceptionDelete).toHaveBeenCalledTimes(2);
  });

  it('frees them for a rental that simply finished, too', async () => {
    // Nothing is owed on a delivered rental either, and its buffer has no reason to outlive
    // it. The rule is "no longer active", not "cancelled".
    const { exceptionDelete } = setup({
      transactions: [tx('tx-1', 'transition/laundry-mark-available', ['exc-1'])],
      exceptions: [exception('exc-1')],
    });

    await run();

    expect(exceptionDelete).toHaveBeenCalledTimes(1);
  });

  it('empties the record, so a second sweep has nothing to do', async () => {
    const { updateMetadata } = setup({
      transactions: [tx('tx-1', 'transition/cancel', ['exc-1'])],
      exceptions: [exception('exc-1')],
    });

    await run();

    expect(updateMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { bufferExceptionIds: null } })
    );
  });
});

describe('listing-availability-sweep: what it refuses to touch', () => {
  it('leaves a live rental blocked', async () => {
    // The whole point of the buffer. Freeing these days is a double booking.
    const { exceptionDelete } = setup({
      transactions: [tx('tx-1', 'transition/accept', ['exc-1'])],
      exceptions: [exception('exc-1')],
    });

    const res = await run();

    expect(exceptionDelete).not.toHaveBeenCalled();
    expect(res.body.data.deleted).toEqual([]);
  });

  it('leaves an exception nobody recorded, and says so', async () => {
    // An owner blocking their own garment for a week looks exactly like one of ours. It is
    // reported rather than deleted, and rather than silently ignored.
    const { exceptionDelete } = setup({
      transactions: [tx('tx-1', 'transition/cancel', ['exc-1'])],
      exceptions: [exception('exc-1'), exception('owner-block')],
    });

    const res = await run();

    expect(exceptionDelete).toHaveBeenCalledTimes(1);
    expect(exceptionDelete).toHaveBeenCalledWith({ id: 'exc-1' }, { expand: false });
    expect(res.body.data.unattributed).toEqual(['owner-block']);
  });

  it('never deletes an exception that OPENS days', async () => {
    // seats > 0 adds availability. Deleting one takes days away, which is the opposite of
    // this endpoint's job - and it would be doing it to a listing at random.
    const { exceptionDelete } = setup({
      transactions: [tx('tx-1', 'transition/cancel', ['open-1'])],
      exceptions: [exception('open-1', 3)],
    });

    const res = await run();

    expect(exceptionDelete).not.toHaveBeenCalled();
    expect(res.body.data.unattributed).toEqual([]);
  });

  it('ignores a recorded id that is no longer on the calendar', async () => {
    // Deleted by hand at some point. The record outlives the exception, so the list is
    // intersected with what is actually there rather than replayed at the API.
    const { exceptionDelete } = setup({
      transactions: [tx('tx-1', 'transition/cancel', ['gone'])],
      exceptions: [],
    });

    const res = await run();

    expect(exceptionDelete).not.toHaveBeenCalled();
    expect(res.body.data.deleted).toEqual([]);
  });
});

describe('listing-availability-sweep: failing safely', () => {
  it('keeps going when one delete fails, and keeps the record for the one that failed', async () => {
    const exceptionDelete = jest.fn(({ id }) =>
      id === 'exc-1' ? Promise.reject(new Error('boom')) : Promise.resolve({ data: { data: {} } })
    );
    const { updateMetadata } = setup({
      transactions: [tx('tx-1', 'transition/cancel', ['exc-1', 'exc-2'])],
      exceptions: [exception('exc-1'), exception('exc-2')],
      deleteImpl: exceptionDelete,
    });

    const res = await run();

    expect(res.statusCode).toBe(200);
    expect(res.body.data.deleted).toEqual(['exc-2']);
    // The record stays, so the next page load retries the block that survived.
    expect(updateMetadata).not.toHaveBeenCalled();
  });

  it('rejects a missing listing id before reading anything', async () => {
    const { txQuery } = setup({});

    const res = await run({});

    expect(res.statusCode).toBe(400);
    expect(txQuery).not.toHaveBeenCalled();
  });
});
