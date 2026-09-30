jest.mock('../api-util/sdk', () => ({
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../api-util/laundryAuth', () => ({
  authorizeLaundryCaller: jest.fn(),
}));

jest.mock('../api-util/laundryMailer', () => ({
  notifyGarmentHandedBack: jest.fn(),
}));

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { authorizeLaundryCaller } = require('../api-util/laundryAuth');
const { notifyGarmentHandedBack } = require('../api-util/laundryMailer');

const listingPickupConfirm = require('./listing-pickup-confirm');

const LISTING_ID = { uuid: 'listing-1' };
const OWNER_ID = 'owner-1';
const LAUNDRY_ID = 'laundry-1';
const VALID_TOKEN = 'a'.repeat(32);

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

const listing = (metadata = {}) => ({
  id: LISTING_ID,
  type: 'listing',
  attributes: {
    title: 'Draped jersey gown, crimson',
    metadata: { assignedLaundryId: LAUNDRY_ID, ...metadata },
  },
  relationships: { author: { data: { id: { uuid: OWNER_ID }, type: 'user' } } },
});

const setupSdk = ({
  metadata = { onLaundry: true, pickupToken: VALID_TOKEN },
  activeTransactions = [],
  updateImpl,
  queryImpl,
} = {}) => {
  const show = jest.fn(() =>
    Promise.resolve({
      data: {
        data: listing(metadata),
        included: [
          {
            id: { uuid: OWNER_ID },
            type: 'user',
            attributes: { email: 'owner@example.com', profile: { displayName: 'Ana Rivera' } },
          },
        ],
      },
    })
  );
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
  const update = updateImpl || jest.fn(() => Promise.resolve({ data: { data: listing(metadata) } }));

  getIntegrationSdk.mockReturnValue({ listings: { show, update }, transactions: { query } });
  return { show, query, update };
};

const run = async (body, res = mockRes()) => {
  await listingPickupConfirm({ body }, res);
  await new Promise(setImmediate);
  return res;
};

describe('listing-pickup-confirm', () => {
  beforeEach(() => {
    authorizeLaundryCaller.mockResolvedValue({});
    handleError.mockImplementation((res, e) => {
      res.status(e.status || 500);
      res.json({ error: e.statusText || 'error' });
      res.end();
    });
  });

  describe('request validation', () => {
    it('rejects a missing listingId', async () => {
      setupSdk();
      const res = await run({ token: VALID_TOKEN });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a missing token', async () => {
      setupSdk();
      const res = await run({ listingId: LISTING_ID });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('authorization', () => {
    it('refuses a caller who is not the assigned laundry, and writes nothing', async () => {
      const { update } = setupSdk();
      const error = new Error('nope');
      error.status = 403;
      error.statusText = 'nope';
      error.data = {};
      authorizeLaundryCaller.mockRejectedValue(error);

      const res = await run({ listingId: LISTING_ID, token: VALID_TOKEN });

      expect(res.statusCode).toBe(403);
      expect(update).not.toHaveBeenCalled();
    });

    it("authorizes against the FETCHED listing's assigned laundry", async () => {
      setupSdk();
      await run({ listingId: LISTING_ID, token: VALID_TOKEN });
      expect(authorizeLaundryCaller).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        LAUNDRY_ID
      );
    });
  });

  describe('the token check', () => {
    it('refuses with 409 and writes nothing when the token does not match', async () => {
      const { update } = setupSdk({ metadata: { onLaundry: true, pickupToken: VALID_TOKEN } });
      const res = await run({ listingId: LISTING_ID, token: 'b'.repeat(32) });

      expect(res.statusCode).toBe(409);
      expect(update).not.toHaveBeenCalled();
    });

    it('refuses with 409 when the garment is not onLaundry at all', async () => {
      const { update } = setupSdk({ metadata: { onLaundry: false, pickupToken: VALID_TOKEN } });
      const res = await run({ listingId: LISTING_ID, token: VALID_TOKEN });

      expect(res.statusCode).toBe(409);
      expect(update).not.toHaveBeenCalled();
    });

    it('checks the token AFTER authorization, so an unauthorized caller never learns whether one exists', async () => {
      const { query } = setupSdk({ metadata: { onLaundry: true, pickupToken: VALID_TOKEN } });
      const error = new Error('nope');
      error.status = 403;
      error.statusText = 'nope';
      error.data = {};
      authorizeLaundryCaller.mockRejectedValue(error);

      const res = await run({ listingId: LISTING_ID, token: 'anything' });

      expect(res.statusCode).toBe(403);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('the active-transaction gate', () => {
    it('hands the garment back when the token matches and the listing is free', async () => {
      const { update } = setupSdk({
        metadata: { onLaundry: true, pickupToken: VALID_TOKEN },
        activeTransactions: [],
      });
      const res = await run({ listingId: LISTING_ID, token: VALID_TOKEN });

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual({ onLaundry: false, role: 'laundry' });
      const params = update.mock.calls[0][0];
      expect(params.metadata.onLaundry).toBe(false);
      // The write is the SAME writeCustodyMetadata every hand-back path uses, so the token
      // is cleared here too - see api-util/listingCustody.js.
      expect(params.metadata.pickupToken).toBe(null);
    });

    it('refuses with 409 while a booking is live, and writes nothing', async () => {
      const { update } = setupSdk({
        metadata: { onLaundry: true, pickupToken: VALID_TOKEN },
        activeTransactions: ['transition/laundry-confirm-pickup'],
      });
      const res = await run({ listingId: LISTING_ID, token: VALID_TOKEN });

      expect(res.statusCode).toBe(409);
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('telling the owner', () => {
    it('mails the owner on a successful confirm', async () => {
      setupSdk();
      await run({ listingId: LISTING_ID, token: VALID_TOKEN });

      expect(notifyGarmentHandedBack).toHaveBeenCalledTimes(1);
      expect(notifyGarmentHandedBack).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'owner@example.com' })
      );
    });

    it('still answers 200 when the mail throws', async () => {
      setupSdk();
      notifyGarmentHandedBack.mockImplementation(() => {
        throw new Error('mailgun down');
      });

      const res = await run({ listingId: LISTING_ID, token: VALID_TOKEN });
      expect(res.statusCode).toBe(200);
    });
  });
});
