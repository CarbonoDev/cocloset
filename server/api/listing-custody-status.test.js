jest.mock('../api-util/sdk', () => ({
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../api-util/listingOwnerAuth', () => ({
  authorizeLaundryOrOwnerCaller: jest.fn(),
}));

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { authorizeLaundryOrOwnerCaller } = require('../api-util/listingOwnerAuth');

const listingCustodyStatus = require('./listing-custody-status');

const LISTING_ID = { uuid: 'listing-1' };
const OWNER_ID = 'owner-1';
const LAUNDRY_ID = 'laundry-1';

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

const listing = {
  id: LISTING_ID,
  type: 'listing',
  attributes: {
    title: 'Draped jersey gown, crimson',
    metadata: { assignedLaundryId: LAUNDRY_ID, onLaundry: true },
  },
  relationships: { author: { data: { id: { uuid: OWNER_ID }, type: 'user' } } },
};

// activeTransactions: array of lastTransition strings to pretend the listing has.
const setupSdk = ({ activeTransactions = [], updateImpl, queryImpl } = {}) => {
  const show = jest.fn(() => Promise.resolve({ data: { data: listing } }));
  const query =
    queryImpl ||
    jest.fn(() =>
      Promise.resolve({
        data: {
          data: activeTransactions.map(lastTransition => ({
            id: { uuid: `tx-${lastTransition}` },
            attributes: { lastTransition },
          })),
        },
      })
    );
  const update = updateImpl || jest.fn(() => Promise.resolve({ data: { data: listing } }));

  getIntegrationSdk.mockReturnValue({
    listings: { show, update },
    transactions: { query },
  });
  return { show, query, update };
};

const run = async (body, res = mockRes()) => {
  await listingCustodyStatus({ body }, res);
  await new Promise(setImmediate);
  return res;
};

describe('listing-custody-status', () => {
  beforeEach(() => {
    // The shared jest config sets `resetMocks: true`.
    authorizeLaundryOrOwnerCaller.mockResolvedValue({ currentUser: {}, role: 'owner' });
    handleError.mockImplementation((res, e) => {
      res.status(e.status || 500);
      res.json({ error: e.statusText || 'error' });
      res.end();
    });
  });

  describe('request validation', () => {
    it('rejects a missing listingId', async () => {
      setupSdk();
      const res = await run({ onLaundry: false });
      expect(res.statusCode).toBe(400);
    });

    // The whole point of the field is to be unambiguous about where a physical
    // object is. `"false"` is truthy, and coercing it would claim custody of a
    // garment sitting in someone's wardrobe.
    it.each([
      ['a missing value', undefined],
      ['a string "false"', 'false'],
      ['a string "true"', 'true'],
      ['0', 0],
      ['1', 1],
      ['null', null],
    ])('rejects %s for onLaundry', async (_label, onLaundry) => {
      const { update } = setupSdk();
      const res = await run({ listingId: LISTING_ID, onLaundry });
      expect(res.statusCode).toBe(400);
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('authorization', () => {
    it('writes nothing when the caller is neither the laundry nor the owner', async () => {
      const { update } = setupSdk();
      const error = new Error('nope');
      error.status = 403;
      error.statusText = 'nope';
      error.data = {};
      authorizeLaundryOrOwnerCaller.mockRejectedValue(error);

      const res = await run({ listingId: LISTING_ID, onLaundry: false });

      expect(res.statusCode).toBe(403);
      expect(update).not.toHaveBeenCalled();
    });

    it('authorizes against the fetched listing, not against the request body', async () => {
      setupSdk();
      await run({ listingId: LISTING_ID, onLaundry: false });
      expect(authorizeLaundryOrOwnerCaller).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        listing
      );
    });

    it('reports which principal was recognised', async () => {
      setupSdk();
      authorizeLaundryOrOwnerCaller.mockResolvedValue({ currentUser: {}, role: 'laundry' });
      const res = await run({ listingId: LISTING_ID, onLaundry: false });
      expect(res.body.data).toEqual({ onLaundry: false, role: 'laundry' });
    });

    it('checks authorization BEFORE looking for active transactions', async () => {
      // Not cosmetic: the transaction query is an Integration API read on someone
      // else's listing. An unauthorized caller must not be able to trigger it.
      const { query } = setupSdk();
      const error = new Error('nope');
      error.status = 403;
      error.statusText = 'nope';
      error.data = {};
      authorizeLaundryOrOwnerCaller.mockRejectedValue(error);

      await run({ listingId: LISTING_ID, onLaundry: false });

      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('the active-transaction gate', () => {
    it('hands the garment back when the listing is free', async () => {
      const { update } = setupSdk({ activeTransactions: [] });
      const res = await run({ listingId: LISTING_ID, onLaundry: false });

      expect(res.statusCode).toBe(200);
      expect(update).toHaveBeenCalledWith(
        { id: LISTING_ID, metadata: { onLaundry: false } },
        { expand: true }
      );
    });

    it('refuses with 409 while a booking is live, and writes nothing', async () => {
      const { update } = setupSdk({
        activeTransactions: ['transition/laundry-confirm-pickup'],
      });
      const res = await run({ listingId: LISTING_ID, onLaundry: false });

      expect(res.statusCode).toBe(409);
      expect(update).not.toHaveBeenCalled();
    });

    it('applies the gate in the true direction too', async () => {
      // An explicit custody claim mid-rental has no legitimate meaning; the
      // implicit writers (a real return, a laundry receiving a garment in) are
      // separate code paths and are deliberately not gated.
      const { update } = setupSdk({ activeTransactions: ['transition/accept'] });
      const res = await run({ listingId: LISTING_ID, onLaundry: true });

      expect(res.statusCode).toBe(409);
      expect(update).not.toHaveBeenCalled();
    });

    it('FAILS CLOSED when the transaction query breaks', async () => {
      // The dangerous direction: an API hiccup must not read as "no bookings".
      const { update } = setupSdk({
        queryImpl: jest.fn(() => Promise.reject(new Error('502 Bad Gateway'))),
      });
      const res = await run({ listingId: LISTING_ID, onLaundry: false });

      expect(res.statusCode).toBe(409);
      expect(update).not.toHaveBeenCalled();
    });

    it('ignores a pre-accept inquiry', async () => {
      // Every transaction in Dev sits at `inquire`. Treating a stranger's question
      // as an active booking would freeze every listing in the marketplace.
      const { update } = setupSdk({ activeTransactions: [] });
      const res = await run({ listingId: LISTING_ID, onLaundry: false });
      expect(res.statusCode).toBe(200);
      expect(update).toHaveBeenCalled();
    });
  });

  describe('the write', () => {
    it('touches metadata only, leaving readiness and rack alone', async () => {
      const { update } = setupSdk();
      await run({ listingId: LISTING_ID, onLaundry: false });

      const params = update.mock.calls[0][0];
      expect(Object.keys(params).sort()).toEqual(['id', 'metadata']);
      expect(params.metadata).toEqual({ onLaundry: false });
    });

    it('surfaces a failed write as an error rather than a false 200', async () => {
      const error = new Error('Forbidden');
      error.status = 403;
      error.statusText = 'Forbidden';
      error.data = {};
      setupSdk({ updateImpl: jest.fn(() => Promise.reject(error)) });

      const res = await run({ listingId: LISTING_ID, onLaundry: false });

      // Unlike the post-transition side effects in laundry-transaction-status.js,
      // this write IS the request. Reporting success would tell an owner their
      // garment is home when the marketplace still says otherwise.
      expect(res.statusCode).toBe(403);
    });
  });
});
