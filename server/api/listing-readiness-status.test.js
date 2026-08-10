jest.mock('../api-util/sdk', () => ({
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../api-util/laundryAuth', () => ({
  authorizeLaundryCaller: jest.fn(),
}));

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { authorizeLaundryCaller } = require('../api-util/laundryAuth');

const listingReadinessStatus = require('./listing-readiness-status');
const { READINESS_STATUSES, READINESS_IMPLIES_ON_LAUNDRY } = listingReadinessStatus;

const LISTING_ID = { uuid: 'listing-1' };
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
  attributes: { publicData: { assignedLaundryId: LAUNDRY_ID } },
};

const setupSdk = () => {
  const show = jest.fn(() => Promise.resolve({ data: { data: listing } }));
  const update = jest.fn(() => Promise.resolve({ data: { data: listing } }));
  getIntegrationSdk.mockReturnValue({ listings: { show, update } });
  return { show, update };
};

const run = async (body, res = mockRes()) => {
  await listingReadinessStatus({ body }, res);
  await new Promise(setImmediate);
  return res;
};

describe('listing-readiness-status', () => {
  beforeEach(() => {
    // The shared jest config sets `resetMocks: true`.
    authorizeLaundryCaller.mockResolvedValue({ id: { uuid: LAUNDRY_ID } });
    handleError.mockImplementation((res, e) => {
      res.status(e.status || 500);
      res.json({ error: e.statusText || 'error' });
      res.end();
    });
  });

  describe('request validation', () => {
    it('rejects a missing listingId', async () => {
      setupSdk();
      expect((await run({ readinessStatus: 'stored' })).statusCode).toBe(400);
    });

    it('rejects an unknown readinessStatus', async () => {
      setupSdk();
      const res = await run({ listingId: LISTING_ID, readinessStatus: 'laundered-ish' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('authorization', () => {
    it('stays laundry-only: this endpoint speaks a studio-internal vocabulary', async () => {
      // Deliberately NOT widened to owners when custody became owner-writable.
      // readinessStatus and currentRack are a studio's own ops fields; the
      // owner-writable field lives on server/api/listing-custody-status.js.
      const { update } = setupSdk();
      const error = new Error('Caller is not a laundry user.');
      error.status = 403;
      error.statusText = 'Caller is not a laundry user.';
      error.data = {};
      authorizeLaundryCaller.mockRejectedValue(error);

      const res = await run({ listingId: LISTING_ID, readinessStatus: 'stored' });

      expect(res.statusCode).toBe(403);
      expect(update).not.toHaveBeenCalled();
    });

    it("authorizes against the listing's assignedLaundryId", async () => {
      setupSdk();
      await run({ listingId: LISTING_ID, readinessStatus: 'stored' });
      expect(authorizeLaundryCaller).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        LAUNDRY_ID
      );
    });
  });

  describe('readiness implies custody', () => {
    it('agrees with the exported list, which is a strict subset of the enum', () => {
      READINESS_IMPLIES_ON_LAUNDRY.forEach(status => expect(READINESS_STATUSES).toContain(status));
      expect(READINESS_IMPLIES_ON_LAUNDRY.length).toBeLessThan(READINESS_STATUSES.length);
    });

    it.each([['stored'], ['available']])(
      'stamps onLaundry when a laundry marks a garment %s',
      async status => {
        // "Al momento en que una laundry recibe una prenda" - receiving it IS
        // taking custody, and making the studio say so twice on two endpoints
        // would guarantee the two drift.
        const { update } = setupSdk();
        const res = await run({ listingId: LISTING_ID, readinessStatus: status });

        expect(update.mock.calls[0][0].metadata).toEqual({
          readinessStatus: status,
          onLaundry: true,
        });
        expect(res.body.data.onLaundry).toBe(true);
      }
    );

    it('leaves custody untouched for `incoming`', async () => {
      // `incoming` means the owner has shipped it and it has not arrived: not
      // evidence of custody in EITHER direction. Crucially it must not write
      // `false` - §8 has readiness cycling per rental, so a garment already in the
      // studio must not be released by a re-entry into `incoming`. The mapping is
      // monotone: readiness can assert custody, never revoke it.
      const { update } = setupSdk();
      const res = await run({ listingId: LISTING_ID, readinessStatus: 'incoming' });

      expect(update.mock.calls[0][0].metadata).toEqual({ readinessStatus: 'incoming' });
      expect('onLaundry' in update.mock.calls[0][0].metadata).toBe(false);
      expect(res.body.data.onLaundry).toBeUndefined();
    });

    it('never writes onLaundry: false from this endpoint at all', async () => {
      const { update } = setupSdk();
      for (const status of READINESS_STATUSES) {
        update.mockClear();
        await run({ listingId: LISTING_ID, readinessStatus: status });
        expect(update.mock.calls[0][0].metadata.onLaundry).not.toBe(false);
      }
    });
  });

  describe('the write', () => {
    it('includes currentRack only when supplied, so omitting it never clears it', async () => {
      const { update } = setupSdk();

      await run({ listingId: LISTING_ID, readinessStatus: 'stored' });
      expect(update.mock.calls[0][0].privateData).toBeUndefined();

      update.mockClear();
      await run({ listingId: LISTING_ID, readinessStatus: 'stored', currentRack: 'Rack A-04' });
      expect(update.mock.calls[0][0].privateData).toEqual({ currentRack: 'Rack A-04' });
    });
  });
});
