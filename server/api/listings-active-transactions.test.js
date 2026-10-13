jest.mock('../api-util/sdk', () => ({
  getSdk: jest.fn(),
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

const { getSdk, handleError } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const listingsActiveTransactions = require('./listings-active-transactions');

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

// Mirrors listing-pause-eligibility.test.js: `transactions.query({ lastTransitions })`
// filters server-side in the real API, so this mock filters too rather than trusting
// findActiveTransactions to re-check states itself.
const setupSdks = ({ ownedIds = [], transactionsByListingId = {}, rejectIds = [] } = {}) => {
  const ownListingsShow = jest.fn(({ id }) => {
    if (rejectIds.includes(id)) {
      const error = new Error('Integration API unavailable');
      return Promise.reject(error);
    }
    return ownedIds.includes(id)
      ? Promise.resolve({ data: { data: { id, type: 'listing' } } })
      : Promise.reject(Object.assign(new Error('Not found'), { status: 404 }));
  });
  getSdk.mockReturnValue({ ownListings: { show: ownListingsShow } });

  const query = jest.fn(({ listingId, lastTransitions } = {}) =>
    Promise.resolve({
      data: {
        data: (transactionsByListingId[listingId] || []).filter(tx =>
          lastTransitions?.includes(tx.attributes.lastTransition)
        ),
      },
    })
  );
  getIntegrationSdk.mockReturnValue({ transactions: { query } });

  return { ownListingsShow, query };
};

const activeTransaction = (lastTransition = 'transition/accept') => ({
  id: { uuid: 'tx-1' },
  type: 'transaction',
  attributes: { lastTransition },
});

const run = async (query, res = mockRes()) => {
  await listingsActiveTransactions({ query }, res);
  await new Promise(setImmediate);
  return res;
};

describe('listings-active-transactions', () => {
  beforeEach(() => {
    handleError.mockImplementation((res, e) => {
      res.status(e.status || 500);
      res.json({ error: e.message || 'error' });
      res.end();
    });
  });

  it('returns an empty map for no ids, without calling either SDK', async () => {
    setupSdks();
    const res = await run({});
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ data: { active: {} } });
    expect(getSdk).not.toHaveBeenCalled();
  });

  it('rejects more than MAX_IDS ids with 400', async () => {
    setupSdks();
    const manyIds = Array.from({ length: 101 }, (_, i) => `id-${i}`).join(',');
    const res = await run({ ids: manyIds });
    expect(res.statusCode).toBe(400);
  });

  it('reports false for a listing with no active transaction', async () => {
    setupSdks({ ownedIds: ['listing-1'], transactionsByListingId: { 'listing-1': [] } });
    const res = await run({ ids: 'listing-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ data: { active: { 'listing-1': false } } });
  });

  it('reports true for a listing with a genuinely active transaction', async () => {
    setupSdks({
      ownedIds: ['listing-1'],
      transactionsByListingId: { 'listing-1': [activeTransaction('transition/accept')] },
    });
    const res = await run({ ids: 'listing-1' });
    expect(res.body).toEqual({ data: { active: { 'listing-1': true } } });
  });

  it('checks each requested listing independently', async () => {
    setupSdks({
      ownedIds: ['listing-active', 'listing-idle'],
      transactionsByListingId: {
        'listing-active': [activeTransaction('transition/accept')],
        'listing-idle': [],
      },
    });
    const res = await run({ ids: 'listing-active,listing-idle' });
    expect(res.body).toEqual({
      data: { active: { 'listing-active': true, 'listing-idle': false } },
    });
  });

  it('omits an id that is not the caller\'s own, without failing the whole request', async () => {
    setupSdks({
      ownedIds: ['listing-mine'],
      transactionsByListingId: { 'listing-mine': [] },
    });
    const res = await run({ ids: 'listing-mine,listing-not-mine' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ data: { active: { 'listing-mine': false } } });
  });

  it('omits an id whose active-transaction check could not be verified, rather than failing closed loudly', async () => {
    // Note: unlike the single-listing eligibility endpoint, this bulk UI-only read
    // omits an unverifiable id rather than reporting it - the authoritative fail-closed
    // check still happens at listing-pause-eligibility.js when the provider actually clicks.
    setupSdks({
      ownedIds: ['listing-1', 'listing-2'],
      rejectIds: ['listing-2'],
      transactionsByListingId: { 'listing-1': [] },
    });
    const res = await run({ ids: 'listing-1,listing-2' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ data: { active: { 'listing-1': false } } });
  });

  it('de-duplicates and trims whitespace in the ids param', async () => {
    const { ownListingsShow } = setupSdks({
      ownedIds: ['listing-1'],
      transactionsByListingId: { 'listing-1': [] },
    });
    await run({ ids: ' listing-1 , listing-1,' });
    expect(ownListingsShow).toHaveBeenCalledTimes(1);
  });
});
