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

const listingPickupStatus = require('./listing-pickup-status');

const LISTING_ID = '6aa26840-16da-44df-8a74-ff4ece1da4eb';
const VALID_TOKEN = 'a'.repeat(32);

const mockRes = () => {
  const res = {
    statusCode: null,
    body: null,
    status: jest.fn(code => {
      res.statusCode = code;
      return res;
    }),
    set: jest.fn(() => res),
    send: jest.fn(body => {
      res.body = body;
      return res;
    }),
    json: jest.fn(body => {
      res.body = body;
      return res;
    }),
    end: jest.fn(() => res),
  };
  return res;
};

let ipCounter = 0;
const nextIp = () => {
  ipCounter += 1;
  return `10.3.0.${ipCounter}`;
};

const listing = (metadata = {}) => ({
  id: { uuid: LISTING_ID },
  type: 'listing',
  attributes: { title: 'A silk frock', metadata },
  relationships: { author: { data: { id: { uuid: 'owner-1' }, type: 'user' } } },
});

const setupSdk = ({ metadata = { onLaundry: true, pickupToken: VALID_TOKEN } } = {}) => {
  const show = jest.fn(() =>
    Promise.resolve({
      data: {
        data: listing(metadata),
        included: [
          {
            id: { uuid: 'owner-1' },
            type: 'user',
            attributes: { profile: { displayName: 'Ana Rivera' } },
          },
        ],
      },
    })
  );
  getIntegrationSdk.mockReturnValue({ listings: { show } });
  return { show };
};

const request = (query, ip = nextIp()) => {
  const res = mockRes();
  return Promise.resolve(listingPickupStatus({ ip, query }, res)).then(() => res);
};

describe('listing-pickup-status', () => {
  beforeEach(() => {
    handleError.mockImplementation((res, e) => {
      res.status(e.status || 500);
      res.json({ error: e.statusText || 'error' });
      res.end();
    });
  });

  it('rejects a missing/malformed id', async () => {
    const res = await request({ token: VALID_TOKEN });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing token', async () => {
    const res = await request({ id: LISTING_ID });
    expect(res.statusCode).toBe(400);
  });

  it('403s a caller who is neither the owner nor the assigned laundry', async () => {
    setupSdk();
    const error = new Error('nope');
    error.status = 403;
    error.statusText = 'nope';
    error.data = {};
    authorizeLaundryOrOwnerCaller.mockRejectedValue(error);

    const res = await request({ id: LISTING_ID, token: VALID_TOKEN });
    expect(res.statusCode).toBe(403);
  });

  it('never lets the owner confirm, even with a valid token', async () => {
    setupSdk();
    authorizeLaundryOrOwnerCaller.mockResolvedValue({ role: 'owner' });

    const res = await request({ id: LISTING_ID, token: VALID_TOKEN });
    expect(res.body.data.viewerRole).toBe('owner');
    expect(res.body.data.canConfirm).toBe(false);
  });

  it('lets the laundry confirm when the token matches and the garment is still there', async () => {
    setupSdk();
    authorizeLaundryOrOwnerCaller.mockResolvedValue({ role: 'laundry' });

    const res = await request({ id: LISTING_ID, token: VALID_TOKEN });
    expect(res.body.data.tokenValid).toBe(true);
    expect(res.body.data.canConfirm).toBe(true);
    expect(res.body.data.ownerName).toBe('Ana Rivera');
  });

  it('refuses the laundry a mismatched token', async () => {
    setupSdk();
    authorizeLaundryOrOwnerCaller.mockResolvedValue({ role: 'laundry' });

    const res = await request({ id: LISTING_ID, token: 'b'.repeat(32) });
    expect(res.body.data.tokenValid).toBe(false);
    expect(res.body.data.canConfirm).toBe(false);
  });

  it('refuses the laundry a valid-looking token once the garment already went home', async () => {
    // pickupToken is cleared on hand-back (writeCustodyMetadata), so a stale/reused QR
    // must read as invalid, not as "already confirmed" with a stale answer.
    setupSdk({ metadata: { onLaundry: false, pickupToken: null } });
    authorizeLaundryOrOwnerCaller.mockResolvedValue({ role: 'laundry' });

    const res = await request({ id: LISTING_ID, token: VALID_TOKEN });
    expect(res.body.data.tokenValid).toBe(false);
    expect(res.body.data.canConfirm).toBe(false);
  });
});
