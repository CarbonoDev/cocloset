jest.mock('../api-util/sdk', () => ({
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../api-util/listingOwnerAuth', () => ({
  requireListingAuthorCaller: jest.fn(),
}));

jest.mock('../log', () => ({ error: jest.fn() }));

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { requireListingAuthorCaller } = require('../api-util/listingOwnerAuth');
const log = require('../log');

const listingPickupQr = require('./listing-pickup-qr');

const LISTING_ID = '6aa26840-16da-44df-8a74-ff4ece1da4eb';

const mockRes = () => {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    status: jest.fn(code => {
      res.statusCode = code;
      return res;
    }),
    set: jest.fn((key, value) => {
      res.headers[key] = value;
      return res;
    }),
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
  return `10.2.0.${ipCounter}`;
};

const listing = (metadata = {}) => ({
  id: { uuid: LISTING_ID },
  type: 'listing',
  attributes: { title: 'A silk frock', metadata },
  relationships: { author: { data: { id: { uuid: 'owner-1' }, type: 'user' } } },
});

const setupSdk = ({ metadata = { onLaundry: true }, updateImpl } = {}) => {
  const show = jest.fn(() => Promise.resolve({ data: { data: listing(metadata) } }));
  const update =
    updateImpl || jest.fn(() => Promise.resolve({ data: { data: listing(metadata) } }));
  getIntegrationSdk.mockReturnValue({ listings: { show, update } });
  return { show, update };
};

const request = (query, ip = nextIp()) => {
  const res = mockRes();
  return Promise.resolve(listingPickupQr({ ip, query }, res)).then(() => res);
};

describe('listing-pickup-qr', () => {
  beforeEach(() => {
    log.error.mockClear();
    handleError.mockImplementation((res, e) => {
      res.status(e.status || 500);
      res.json({ error: e.statusText || 'error' });
      res.end();
    });
  });

  it('rejects a missing/malformed id before touching the API', async () => {
    const { show } = setupSdk();
    const res = await request({ id: 'not-a-uuid' });
    expect(res.statusCode).toBe(400);
    expect(show).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not the listing owner', async () => {
    setupSdk();
    const error = new Error('nope');
    error.status = 403;
    error.statusText = 'nope';
    error.data = {};
    requireListingAuthorCaller.mockRejectedValue(error);

    const res = await request({ id: LISTING_ID });
    expect(res.statusCode).toBe(403);
  });

  it('refuses when the listing has nothing to pick up', async () => {
    setupSdk({ metadata: { onLaundry: false } });
    requireListingAuthorCaller.mockResolvedValue({});

    const res = await request({ id: LISTING_ID });
    expect(res.statusCode).toBe(409);
  });

  it('mints a token and renders a PNG the first time', async () => {
    const { update } = setupSdk({ metadata: { onLaundry: true } });
    requireListingAuthorCaller.mockResolvedValue({});

    const res = await request({ id: LISTING_ID });

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    const params = update.mock.calls[0][0];
    expect(params.id).toBe(LISTING_ID);
    expect(params.metadata.pickupToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is idempotent: a second call reuses the existing token instead of rotating it', async () => {
    const existingToken = 'a'.repeat(32);
    const { update } = setupSdk({ metadata: { onLaundry: true, pickupToken: existingToken } });
    requireListingAuthorCaller.mockResolvedValue({});

    const res = await request({ id: LISTING_ID });

    expect(res.statusCode).toBe(200);
    expect(update).not.toHaveBeenCalled();
  });

  it('is rate limited', async () => {
    // The limiter is checked before the id is validated, so a malformed id consumes the
    // budget without rendering a single PNG - same trick transaction-qr.test.js uses.
    const { MAX_PER_IP_PER_WINDOW } = listingPickupQr;
    const ip = nextIp();

    for (let i = 0; i < MAX_PER_IP_PER_WINDOW; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request({ id: 'not-a-uuid' }, ip);
      expect(res.statusCode).toBe(400);
    }

    const overBudget = await request({ id: LISTING_ID }, ip);
    expect(overBudget.statusCode).toBe(429);
    expect(overBudget.headers['Retry-After']).toEqual(expect.any(String));
  });
});
