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
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const transitionPrivileged = require('./transition-privileged');

// WHY THIS FILE EXISTS
// `transition/request-payment-after-inquiry` is the SECOND door into a reservation:
// a customer who started with an inquiry books through here instead of through
// initiate-privileged.js. Both booking rules are wired into both endpoints, and a
// rule wired into only one of them is a rule with a documented bypass - the sort of
// half-applied guard this project has already shipped more than once.
//
// initiate-privileged.test.js asserts the same two gates on the other door. This
// file asserts they are reached HERE too: that a refused booking is stopped before
// anything is priced and before any transition is made.

const LISTING_ID = { uuid: 'listing-1' };
const TX_ID = { uuid: 'tx-1' };

// The two fixed periods a Cocloset garment is offered for. Opted into per-test, so the
// initial-cleaning tests can book arbitrary lengths without the period gate refusing them
// first — each test exercises ONE rule.
const PERIODS = [
  { name: '7-days', bookingLengthInDays: 7, priceInSubunits: 10000 },
  { name: '14-days', bookingLengthInDays: 14, priceInSubunits: 18000 },
];

const listingEntity = ({
  priceVariants = [],
  initialCleaningDays,
  onLaundry,
  assignedLaundryId,
} = {}) => ({
  id: LISTING_ID,
  type: 'listing',
  attributes: {
    price: { amount: 5000, currency: 'EUR' },
    availabilityPlan: { type: 'availability-plan/time', timezone: 'Etc/UTC' },
    publicData: {
      unitType: 'day',
      // What api-util/rentalPeriods.js keys on: the alias is baked onto a listing at
      // creation, so the rule is per-listing rather than per-listing-type.
      transactionProcessAlias: 'cocloset-booking/release-1',
      priceVariants,
    },
    // `include: ['listing']` returns the full listing resource - no `fields.listing`
    // restriction is sent - so `metadata` is present here for the same reason
    // `publicData` is, which the line-item builder already depends on.
    metadata: {
      ...(initialCleaningDays === undefined ? {} : { initialCleaningDays }),
      ...(onLaundry === undefined ? {} : { onLaundry }),
      ...(assignedLaundryId === undefined ? {} : { assignedLaundryId }),
    },
  },
});

// Anchored on the real clock: the initial-cleaning gate asks `new Date()` inside the
// endpoint, so a fixed calendar date would be a test with an expiry date.
const daysFromToday = n => {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + n);
  return date;
};

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

// See the note in initiate-privileged.test.js: the real client path puts
// `priceVariantName` in `bodyParams.params`, not in `orderData`. Default to that shape.
const req = ({ days, startsInDays = 0, priceVariantName = '7-days', variantIn = 'params' }) => ({
  body: {
    isSpeculative: false,
    orderData: {
      currency: 'EUR',
      ...(variantIn === 'orderData' ? { priceVariantName } : {}),
    },
    bodyParams: {
      id: TX_ID,
      transition: 'transition/request-payment-after-inquiry',
      params: {
        listingId: LISTING_ID,
        bookingStart: daysFromToday(startsInDays),
        bookingEnd: daysFromToday(startsInDays + days),
        ...(variantIn === 'params' ? { priceVariantName } : {}),
      },
    },
    queryParams: {},
  },
});

const setup = ({ laundryTurnaroundDays, ...listingParams } = {}) => {
  const listing = listingEntity(listingParams);

  // The laundry's CURRENT turnaround, as the Integration API would return it. Left
  // rejecting when the fixture does not supply one, so "the live lookup failed" is the
  // default and the snapshot fallback is exercised by every pre-existing test here.
  const laundryShow = jest.fn(() =>
    laundryTurnaroundDays === undefined
      ? Promise.reject(new Error('no laundry configured in this fixture'))
      : Promise.resolve({
          data: {
            data: {
              attributes: { profile: { privateData: { turnaroundDays: laundryTurnaroundDays } } },
            },
          },
        })
  );
  // The listing's OTHER bookings, for the cleaning-gap gate. Empty by default: every test in
  // this file is about a different rule, and a fixture that silently added a rental would
  // make them fail for the wrong reason.
  const transactionsQuery = jest.fn(() => Promise.resolve({ data: { data: [], included: [] } }));
  getIntegrationSdk.mockReturnValue({
    users: { show: laundryShow },
    transactions: { query: transactionsQuery },
  });

  const show = jest.fn(() =>
    Promise.resolve({
      data: {
        data: {
          id: TX_ID,
          type: 'transaction',
          attributes: { metadata: {}, transitions: [], payinTotal: null },
          relationships: { listing: { data: { id: LISTING_ID, type: 'listing' } } },
        },
        included: [listing],
      },
    })
  );
  getSdk.mockReturnValue({ transactions: { show } });
  fetchCommission.mockResolvedValue({
    data: { data: [{ type: 'jsonAsset', attributes: { data: {} } }] },
  });
  buildLineItemsForListing.mockResolvedValue([]);

  const transition = jest.fn(() => Promise.resolve({ data: { data: { id: TX_ID } } }));
  getTrustedSdk.mockResolvedValue({ transactions: { transition } });
  return { transition, laundryShow, transactionsQuery };
};

const run = async params => {
  const res = mockRes();
  await transitionPrivileged(req(params), res);
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

describe('transition-privileged: the booking gates are reached on this door too', () => {
  it('refuses a booking that starts before the initial cleaning is done', async () => {
    const { transition } = setup({ initialCleaningDays: 3 });

    const res = await run({ days: 2, startsInDays: 1 });

    expect(res.statusCode).toBe(400);
    const error = handleError.mock.calls[0][1];
    expect(error.data.code).toBe('booking-before-initial-cleaning');
    expect(buildLineItemsForListing).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it('refuses dates that do not match the period being charged for', async () => {
    // `request-payment-after-inquiry` is the second door into the same booking, so the
    // period rule has to be here too - otherwise the cheap-period-long-range request just
    // moves to this endpoint.
    const { transition } = setup({ priceVariants: PERIODS });

    const res = await run({ days: 60, startsInDays: 5, priceVariantName: '7-days' });

    expect(res.statusCode).toBe(400);
    expect(handleError.mock.calls[0][1].data.code).toBe('rental-period-length-mismatch');
    expect(buildLineItemsForListing).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it('lets a legal booking through to pricing and the transition', async () => {
    const { transition } = setup({ priceVariants: PERIODS, initialCleaningDays: 3 });

    await run({ days: 7, startsInDays: 4, priceVariantName: '7-days' });

    expect(buildLineItemsForListing).toHaveBeenCalled();
    expect(transition).toHaveBeenCalled();
  });

  it('changes NOTHING once the garment is at the laundry', async () => {
    const { transition } = setup({ initialCleaningDays: 30, onLaundry: true });

    const res = await run({ days: 1, startsInDays: 1 });

    expect(res.statusCode).not.toBe(400);
    expect(transition).toHaveBeenCalled();
  });

  it('leaves a listing with no stored rules completely unaffected', async () => {
    const { transition } = setup();

    await run({ days: 1, startsInDays: 1 });

    expect(buildLineItemsForListing).toHaveBeenCalled();
    expect(transition).toHaveBeenCalled();
  });

  // The live turnaround has to be resolved on THIS door as well. A gate that reads the
  // laundry's current number on one entrance and the stale snapshot on the other is the
  // same bypass this whole file exists to rule out - and the customer-visible symptom is
  // the one the calendar/gate agreement test guards: an offered date that checkout refuses.
  describe('the live laundry turnaround', () => {
    it('refuses a day the stale snapshot would have allowed', async () => {
      const { transition } = setup({
        initialCleaningDays: 1,
        assignedLaundryId: 'laundry-1',
        laundryTurnaroundDays: 5,
      });

      const res = await run({ days: 2, startsInDays: 1 });

      expect(res.statusCode).toBe(400);
      expect(handleError.mock.calls[0][1].data.initialCleaningDays).toBe(5);
      expect(transition).not.toHaveBeenCalled();
    });

    it('allows a day the stale snapshot would have refused', async () => {
      // Snapshot 7 days puts the floor at +8; the studio now needs 2, so it is +3.
      const { transition } = setup({
        initialCleaningDays: 7,
        assignedLaundryId: 'laundry-1',
        laundryTurnaroundDays: 2,
      });

      await run({ days: 2, startsInDays: 3 });

      expect(transition).toHaveBeenCalled();
    });

    // THIS ASSERTION CHANGED, DELIBERATELY. It used to be "no Integration API call once the
    // garment is at its laundry", on the reasoning that the lead time is spent by then. The
    // cleaning-gap gate needs the same studio's turnaround for EVERY rental, so the call is
    // now made on this path too. What is still worth holding is that it happens ONCE - two
    // fetches of one number would be two chances for the two gates to disagree - and that
    // the lead time itself stays retired.
    it('asks the laundry once, and still lets a garment at its studio book tomorrow', async () => {
      const { laundryShow, transition } = setup({
        initialCleaningDays: 3,
        onLaundry: true,
        assignedLaundryId: 'laundry-1',
        laundryTurnaroundDays: 30,
      });

      await run({ days: 1, startsInDays: 1 });

      expect(laundryShow).toHaveBeenCalledTimes(1);
      expect(transition).toHaveBeenCalled();
    });

    it('falls back to the snapshot when the lookup fails, and still refuses', async () => {
      const { transition } = setup({
        initialCleaningDays: 3,
        assignedLaundryId: 'laundry-1',
      });

      const res = await run({ days: 2, startsInDays: 1 });

      expect(res.statusCode).toBe(400);
      expect(handleError.mock.calls[0][1].data.initialCleaningDays).toBe(3);
      expect(transition).not.toHaveBeenCalled();
    });
  });
});
