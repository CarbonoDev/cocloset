jest.mock('../api-util/sdk', () => ({
  getSdk: jest.fn(),
  handleError: jest.fn(),
}));

jest.mock('../api-util/liveInitialCleaning', () => ({
  resolveLiveInitialCleaningDays: jest.fn(),
}));

const { getSdk, handleError } = require('../api-util/sdk');
const { resolveLiveInitialCleaningDays } = require('../api-util/liveInitialCleaning');

const listingInitialCleaning = require('./listing-initial-cleaning');
const { limiter } = listingInitialCleaning;

const LISTING_ID = '9a1b2c3d-0000-0000-0000-000000000001';

const mockRes = () => ({
  statusCode: null,
  body: null,
  headers: {},
  status: jest.fn(function(code) {
    this.statusCode = code;
    return this;
  }),
  set: jest.fn(function(key, value) {
    if (typeof key === 'string') {
      this.headers[key] = value;
    }
    return this;
  }),
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
  id: { uuid: LISTING_ID },
  type: 'listing',
  attributes: { metadata: { assignedLaundryId: 'laundry-1' }, publicData: {} },
};

const setupSdk = (response = { data: { data: listing } }) => {
  const show = jest.fn(() => Promise.resolve(response));
  getSdk.mockReturnValue({ listings: { show } });
  return { show };
};

const run = async (query, res = mockRes()) => {
  await listingInitialCleaning({ query, ip: '203.0.113.7' }, res);
  await new Promise(setImmediate);
  return res;
};

describe('listing-initial-cleaning', () => {
  beforeEach(() => {
    // The shared jest config sets `resetMocks: true`.
    limiter.reset();
    resolveLiveInitialCleaningDays.mockResolvedValue(null);
    handleError.mockImplementation((res, e) => {
      res.status(e.status || 500);
      res.json({ error: e.statusText || 'error' });
      res.end();
    });
  });

  describe('request validation', () => {
    it('rejects a missing listingId', async () => {
      setupSdk();
      const res = await run({});
      expect(res.statusCode).toBe(400);
    });

    it.each([['an array', ['a', 'b']], ['an object', { uuid: LISTING_ID }], ['empty', '']])(
      'rejects a listingId that is %s',
      async (_label, listingId) => {
        const { show } = setupSdk();
        expect((await run({ listingId })).statusCode).toBe(400);
        expect(show).not.toHaveBeenCalled();
      }
    );
  });

  describe('access', () => {
    // DELIBERATELY PUBLIC, unlike api/laundries.js. ListingPage is public and the customer
    // who needs the calendar floor has no session yet, so requiring auth here would mean
    // the calendar was only correct for logged-in users. The exposure is one derived
    // integer that the calendar already reveals by refusing those days.
    it('serves an anonymous caller', async () => {
      setupSdk();
      resolveLiveInitialCleaningDays.mockResolvedValue(3);
      const res = await run({ listingId: LISTING_ID });
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ data: { initialCleaningDays: 3 } });
    });

    // The listing itself is read with the caller's own MARKETPLACE session, not with
    // admin credentials: this endpoint must not become a way to read a listing the caller
    // could not already fetch. Only the laundry's privateData needs the Integration API,
    // and that read is inside api-util/liveInitialCleaning.js.
    it('reads the listing through the caller-scoped Marketplace SDK', async () => {
      const { show } = setupSdk();
      await run({ listingId: LISTING_ID });
      expect(getSdk).toHaveBeenCalled();
      expect(show).toHaveBeenCalledWith({ id: LISTING_ID });
    });

    it('forwards a listing fetch failure through handleError', async () => {
      const show = jest.fn(() =>
        Promise.reject(Object.assign(new Error('nope'), { status: 404, statusText: 'Not found' }))
      );
      getSdk.mockReturnValue({ listings: { show } });
      const res = await run({ listingId: LISTING_ID });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('the response shape', () => {
    // THE SECURITY CONTRACT, asserted rather than described. Per-category cleaning FEES
    // live in the same laundry privateData blob the turnaround is read from, so the
    // response is checked to be exactly one key and nothing else - a future change that
    // starts spreading the resolver's input fails here.
    it('returns nothing but initialCleaningDays', async () => {
      setupSdk();
      resolveLiveInitialCleaningDays.mockResolvedValue(2);
      const res = await run({ listingId: LISTING_ID });
      expect(Object.keys(res.body)).toEqual(['data']);
      expect(Object.keys(res.body.data)).toEqual(['initialCleaningDays']);
    });

    // No key at all, not `initialCleaningDays: null`: "there is no block" and "the block
    // is n days" must be structurally different answers so a client cannot read null as 0.
    it('omits the key entirely when there is no block', async () => {
      setupSdk();
      resolveLiveInitialCleaningDays.mockResolvedValue(null);
      const res = await run({ listingId: LISTING_ID });
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ data: {} });
      expect('initialCleaningDays' in res.body.data).toBe(false);
    });

    // A garment already at its laundry, a garment with no laundry, and a laundry whose
    // profile could not be read all come back as the same empty answer - so the response
    // cannot be used to probe a listing's assignment state.
    it('says nothing about WHICH laundry, or whether one is assigned', async () => {
      setupSdk({
        data: {
          data: {
            id: { uuid: LISTING_ID },
            attributes: { metadata: { onLaundry: true, assignedLaundryId: 'laundry-9' } },
          },
        },
      });
      const res = await run({ listingId: LISTING_ID });
      expect(JSON.stringify(res.body)).not.toContain('laundry-9');
      expect(res.body).toEqual({ data: {} });
    });
  });

  describe('onLaundry', () => {
    // The endpoint does not re-implement the rule; it hands the listing to the one
    // resolver that owns it, which is what keeps this and the checkout gate in agreement.
    it('passes the fetched listing to the resolver verbatim', async () => {
      setupSdk();
      await run({ listingId: LISTING_ID });
      expect(resolveLiveInitialCleaningDays).toHaveBeenCalledWith({ listing });
    });

    it('returns no block for a garment already at its laundry', async () => {
      const atLaundry = {
        id: { uuid: LISTING_ID },
        attributes: { metadata: { onLaundry: true, assignedLaundryId: 'laundry-1' } },
      };
      setupSdk({ data: { data: atLaundry } });
      // Real resolver behaviour for onLaundry === true, restated here because this suite
      // mocks it: see liveInitialCleaning.test.js for the unmocked proof.
      resolveLiveInitialCleaningDays.mockResolvedValue(null);
      const res = await run({ listingId: LISTING_ID });
      expect(res.body).toEqual({ data: {} });
    });
  });

  describe('rate limiting', () => {
    // Public AND backed by an Integration API call - the combination api/laundries.js
    // avoided by requiring a session. Without a limit, a script walking listing ids turns
    // into unbounded Integration API quota burn.
    it('429s once one caller exceeds its budget, with a Retry-After', async () => {
      setupSdk();
      let res = null;
      for (let i = 0; i < 121; i += 1) {
        res = await run({ listingId: LISTING_ID });
      }
      expect(res.statusCode).toBe(429);
      expect(Number.parseInt(res.headers['Retry-After'], 10)).toBeGreaterThan(0);
    });

    it('does not spend the budget on a malformed request', async () => {
      const { show } = setupSdk();
      for (let i = 0; i < 200; i += 1) {
        await run({});
      }
      const res = await run({ listingId: LISTING_ID });
      expect(res.statusCode).toBe(200);
      expect(show).toHaveBeenCalledTimes(1);
    });

    it('does not touch the SDK for a rejected request', async () => {
      const { show } = setupSdk();
      for (let i = 0; i < 120; i += 1) {
        await run({ listingId: LISTING_ID });
      }
      show.mockClear();
      expect((await run({ listingId: LISTING_ID })).statusCode).toBe(429);
      expect(show).not.toHaveBeenCalled();
    });
  });
});
