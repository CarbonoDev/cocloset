jest.mock('../api-util/sdk', () => ({
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../api-util/listingOwnerAuth', () => ({
  requireListingAuthorCaller: jest.fn(),
}));

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { requireListingAuthorCaller } = require('../api-util/listingOwnerAuth');

const listingPauseEligibility = require('./listing-pause-eligibility');

const LISTING_ID = { uuid: 'listing-1' };
const OWNER_ID = 'owner-1';

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

// `onLaundry: true` on EVERY fixture here, deliberately: it is the idle-storage case the
// 2026-09-29 guard used to (wrongly) block outright. This endpoint must not care about it
// at all - only about whether a transaction is genuinely active. See the header comment.
const listingEntity = () => ({
  id: LISTING_ID,
  type: 'listing',
  attributes: {
    metadata: { onLaundry: true },
  },
  relationships: { author: { data: { id: { uuid: OWNER_ID }, type: 'user' } } },
});

// findActiveTransactions is deliberately NOT mocked, so these tests exercise its real
// query and its real fail-closed behaviour, exactly like listing-laundry-assignment.test.js
// does for the same helper. The real `transactions.query({ lastTransitions })` filters
// SERVER-SIDE, so this mock filters too - findActiveTransactions trusts the query to have
// already excluded anything not in the requested set, it does not re-check states itself.
const setupSdk = (listing, { transactions = [], transactionsReject } = {}) => {
  const show = jest.fn(() => Promise.resolve({ data: { data: listing, included: [] } }));
  const query = jest.fn(({ lastTransitions } = {}) =>
    transactionsReject
      ? Promise.reject(new Error('Integration API unavailable'))
      : Promise.resolve({
          data: {
            data: transactions.filter(tx => lastTransitions?.includes(tx.attributes.lastTransition)),
          },
        })
  );

  getIntegrationSdk.mockReturnValue({
    listings: { show },
    transactions: { query },
  });
  return { show, query };
};

const activeTransaction = (lastTransition = 'transition/accept') => ({
  id: { uuid: 'tx-1' },
  type: 'transaction',
  attributes: { lastTransition },
});

const run = async (body, res = mockRes()) => {
  await listingPauseEligibility({ body }, res);
  await new Promise(setImmediate);
  return res;
};

describe('listing-pause-eligibility', () => {
  beforeEach(() => {
    // The shared jest config sets `resetMocks: true`.
    requireListingAuthorCaller.mockResolvedValue({ id: { uuid: OWNER_ID } });
    handleError.mockImplementation((res, e) => {
      res.status(e.status || 500);
      res.json({ error: e.statusText || 'error', data: e.data });
      res.end();
    });
  });

  describe('request validation', () => {
    it('rejects a missing listingId', async () => {
      setupSdk(listingEntity());
      const res = await run({});
      expect(res.statusCode).toBe(400);
    });
  });

  describe('authorization', () => {
    it('answers 403 for a caller who is not the listing owner', async () => {
      setupSdk(listingEntity());
      const error = new Error('Caller is not the owner of this listing.');
      error.status = 403;
      error.statusText = error.message;
      error.data = {};
      requireListingAuthorCaller.mockRejectedValue(error);

      const res = await run({ listingId: LISTING_ID });
      expect(res.statusCode).toBe(403);
    });

    it('fetches the listing WITH its author relationship, so a real owner is not rejected', async () => {
      const { show } = setupSdk(listingEntity());
      await run({ listingId: LISTING_ID });
      expect(show).toHaveBeenCalledWith({ id: LISTING_ID, include: ['author'] });
    });
  });

  describe('the guard', () => {
    it('allows pausing an idle, onLaundry listing with no active transaction', async () => {
      setupSdk(listingEntity(), { transactions: [] });
      const res = await run({ listingId: LISTING_ID });
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ data: { allowed: true } });
    });

    it('allows pausing a listing whose only transactions are finished (delivered/reviewed)', async () => {
      setupSdk(listingEntity(), {
        transactions: [
          activeTransaction('transition/laundry-mark-available'),
          activeTransaction('transition/review-1-by-customer'),
        ],
      });
      const res = await run({ listingId: LISTING_ID });
      expect(res.statusCode).toBe(200);
    });

    it('refuses with 409 while a transaction is genuinely active', async () => {
      setupSdk(listingEntity(), { transactions: [activeTransaction('transition/accept')] });
      const res = await run({ listingId: LISTING_ID });
      expect(res.statusCode).toBe(409);
    });

    it('fails closed (409) when the active-transaction check cannot be verified', async () => {
      setupSdk(listingEntity(), { transactionsReject: true });
      const res = await run({ listingId: LISTING_ID });
      expect(res.statusCode).toBe(409);
    });
  });
});
