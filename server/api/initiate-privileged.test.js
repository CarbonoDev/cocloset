jest.mock('../api-util/sdk', () => ({
  getSdk: jest.fn(),
  getTrustedSdk: jest.fn(),
  fetchCommission: jest.fn(),
  handleError: jest.fn(),
  serialize: jest.fn(v => v),
}));

jest.mock('../api-util/lineItems', () => ({
  buildLineItemsForListing: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../api-util/handoverQr', () => ({
  ensureHandoverQr: jest.fn(),
}));

const { getSdk, getTrustedSdk, fetchCommission, handleError } = require('../api-util/sdk');
const { buildLineItemsForListing } = require('../api-util/lineItems');

const initiatePrivileged = require('./initiate-privileged');

// WHY THIS FILE EXISTS
// `server/api-util/bookingRules.js` is unit-tested on its own, but a rule that is
// never reached is indistinguishable from a rule that always passes - and this
// project has shipped exactly that twice (a QR that "nunca se genera", a category
// check that could never fire). These tests assert the GATE, not the arithmetic:
// that a too-short booking is refused BEFORE anything is priced, and that a legal
// one still gets through.

const LISTING_ID = { uuid: 'listing-1' };

const listingEntity = ({ minimumBookingDays } = {}) => ({
  id: LISTING_ID,
  type: 'listing',
  attributes: {
    price: { amount: 5000, currency: 'EUR' },
    publicData: {
      unitType: 'day',
      ...(minimumBookingDays === undefined ? {} : { minimumBookingDays }),
    },
  },
});

const day = n => new Date(Date.UTC(2026, 7, n));

const mockRes = () => ({
  statusCode: null,
  status: jest.fn(function(code) {
    this.statusCode = code;
    return this;
  }),
  set: jest.fn().mockReturnThis(),
  send: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
  end: jest.fn().mockReturnThis(),
});

// A booking of `days` days. The end date is EXCLUSIVE, as it is on the wire.
const req = ({ days }) => ({
  body: {
    isSpeculative: false,
    orderData: { currency: 'EUR' },
    bodyParams: {
      transition: 'transition/request-payment',
      params: {
        listingId: LISTING_ID,
        bookingStart: day(10),
        bookingEnd: day(10 + days),
      },
    },
    queryParams: {},
  },
});

const setup = ({ minimumBookingDays }) => {
  const show = jest.fn(() =>
    Promise.resolve({ data: { data: listingEntity({ minimumBookingDays }) } })
  );
  getSdk.mockReturnValue({ listings: { show } });
  fetchCommission.mockResolvedValue({
    data: { data: [{ type: 'jsonAsset', attributes: { data: {} } }] },
  });
  buildLineItemsForListing.mockResolvedValue([]);

  const initiate = jest.fn(() => Promise.resolve({ data: { data: { id: { uuid: 'tx-1' } } } }));
  getTrustedSdk.mockResolvedValue({ transactions: { initiate } });
  return { initiate };
};

const run = async params => {
  const res = mockRes();
  await initiatePrivileged(req(params), res);
  // The handler resolves its promise chain across several microtasks.
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

describe('initiate-privileged: the minimum booking length gate', () => {
  it('refuses a booking shorter than the listing minimum', async () => {
    const { initiate } = setup({ minimumBookingDays: 3 });

    const res = await run({ days: 2 });

    expect(res.statusCode).toBe(400);
    expect(handleError).toHaveBeenCalled();
    const error = handleError.mock.calls[0][1];
    expect(error.data.code).toBe('booking-below-minimum-days');
    // The refusal must come BEFORE pricing and BEFORE the charge. A 400 that
    // arrives after the transaction was initiated is not a refusal.
    expect(buildLineItemsForListing).not.toHaveBeenCalled();
    expect(initiate).not.toHaveBeenCalled();
  });

  it('lets a booking of exactly the minimum through to pricing', async () => {
    const { initiate } = setup({ minimumBookingDays: 3 });

    await run({ days: 3 });

    expect(buildLineItemsForListing).toHaveBeenCalled();
    expect(initiate).toHaveBeenCalled();
  });

  it('leaves a listing with no minimum completely unaffected', async () => {
    const { initiate } = setup({});

    await run({ days: 1 });

    expect(buildLineItemsForListing).toHaveBeenCalled();
    expect(initiate).toHaveBeenCalled();
  });
});
