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

const listingEntity = ({
  minimumBookingDays,
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
      ...(minimumBookingDays === undefined ? {} : { minimumBookingDays }),
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

const req = ({ days, startsInDays = 0 }) => ({
  body: {
    isSpeculative: false,
    orderData: { currency: 'EUR' },
    bodyParams: {
      id: TX_ID,
      transition: 'transition/request-payment-after-inquiry',
      params: {
        listingId: LISTING_ID,
        bookingStart: daysFromToday(startsInDays),
        bookingEnd: daysFromToday(startsInDays + days),
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
  getIntegrationSdk.mockReturnValue({ users: { show: laundryShow } });

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
  return { transition, laundryShow };
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

  it('refuses a booking shorter than the listing minimum', async () => {
    const { transition } = setup({ minimumBookingDays: 3 });

    const res = await run({ days: 2, startsInDays: 5 });

    expect(res.statusCode).toBe(400);
    expect(handleError.mock.calls[0][1].data.code).toBe('booking-below-minimum-days');
    expect(buildLineItemsForListing).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it('lets a legal booking through to pricing and the transition', async () => {
    const { transition } = setup({ minimumBookingDays: 3, initialCleaningDays: 3 });

    await run({ days: 3, startsInDays: 3 });

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
      const { transition } = setup({
        initialCleaningDays: 7,
        assignedLaundryId: 'laundry-1',
        laundryTurnaroundDays: 2,
      });

      await run({ days: 2, startsInDays: 2 });

      expect(transition).toHaveBeenCalled();
    });

    // Most transitions through this endpoint act on a booking that already exists, on a
    // garment long since delivered. None of those may pay for an Integration API round trip.
    it('makes no Integration API call once the garment is at its laundry', async () => {
      const { laundryShow } = setup({
        initialCleaningDays: 3,
        onLaundry: true,
        assignedLaundryId: 'laundry-1',
        laundryTurnaroundDays: 30,
      });

      await run({ days: 1, startsInDays: 1 });

      expect(laundryShow).not.toHaveBeenCalled();
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
