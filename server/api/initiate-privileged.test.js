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
// check that could never fire). These tests assert the GATES, not the arithmetic:
// that a booking the rules refuse is stopped BEFORE anything is priced and BEFORE
// any transaction is created, and that a legal one still gets through.
//
// Two rules live on this path now, and they must stay distinguishable:
//   * the owner's minimum rental length (data.code 'booking-below-minimum-days')
//   * the garment's initial cleaning turnaround, for a garment that has never
//     reached its laundry (data.code 'booking-before-initial-cleaning')

const LISTING_ID = { uuid: 'listing-1' };

const listingEntity = ({ minimumBookingDays, initialCleaningDays, onLaundry } = {}) => ({
  id: LISTING_ID,
  type: 'listing',
  attributes: {
    price: { amount: 5000, currency: 'EUR' },
    // UTC so the day() fixtures below and the rule's day arithmetic agree.
    availabilityPlan: { type: 'availability-plan/time', timezone: 'Etc/UTC' },
    publicData: {
      unitType: 'day',
      ...(minimumBookingDays === undefined ? {} : { minimumBookingDays }),
    },
    // Server-written only (Integration API). The initial-cleaning gate reads these
    // two and nothing else, which is what lets it run with no API call of its own.
    metadata: {
      ...(initialCleaningDays === undefined ? {} : { initialCleaningDays }),
      ...(onLaundry === undefined ? {} : { onLaundry }),
    },
  },
});

// Whole-day UTC arithmetic anchored on the REAL clock. The initial-cleaning gate
// compares the requested start against "today" using `new Date()` inside the
// endpoint - production passes it no clock - so a hardcoded calendar date here would
// be a test that passes this week and fails next week.
const startOfTodayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};
const daysFromToday = n => {
  const date = startOfTodayUtc();
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

// A booking of `days` days, starting `startsInDays` days from today. The end date is
// EXCLUSIVE, as it is on the wire.
const req = ({ days, startsInDays = 0, isSpeculative = false }) => ({
  body: {
    isSpeculative,
    orderData: { currency: 'EUR' },
    bodyParams: {
      transition: 'transition/request-payment',
      params: {
        listingId: LISTING_ID,
        bookingStart: daysFromToday(startsInDays),
        bookingEnd: daysFromToday(startsInDays + days),
      },
    },
    queryParams: {},
  },
});

const setup = ({ minimumBookingDays, initialCleaningDays, onLaundry }) => {
  const show = jest.fn(() =>
    Promise.resolve({
      data: { data: listingEntity({ minimumBookingDays, initialCleaningDays, onLaundry }) },
    })
  );
  getSdk.mockReturnValue({ listings: { show } });
  fetchCommission.mockResolvedValue({
    data: { data: [{ type: 'jsonAsset', attributes: { data: {} } }] },
  });
  buildLineItemsForListing.mockResolvedValue([]);

  const initiate = jest.fn(() => Promise.resolve({ data: { data: { id: { uuid: 'tx-1' } } } }));
  const initiateSpeculative = jest.fn(() => Promise.resolve({ data: { data: null } }));
  getTrustedSdk.mockResolvedValue({ transactions: { initiate, initiateSpeculative } });
  return { initiate, initiateSpeculative };
};

const run = async (params = {}) => {
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

describe('initiate-privileged: the initial cleaning gate', () => {
  // A garment that has not yet physically reached its laundry needs its first wash
  // before it can be rented:
  //
  //   > "el calendario muestra el siguiente día como disponible, pero no esta
  //   >  considerando los tiempos de lavado inicial ... si la prenda ya esta en
  //   >  laundry entonces si debe aparecer disponible al siguiente día"
  //
  // The calendar half of this is in BookingDatesForm. That is UX: `bookingStart` is
  // an ordinary request parameter, so without the assertion below an owner's brand
  // new garment can be booked - and charged - for tomorrow by anyone posting
  // straight at this endpoint. Both inputs live in `metadata`, which the Marketplace
  // API refuses to let a listing's own owner write, so the check needs no Integration
  // API call and this path deliberately makes none.

  it('refuses a booking that starts before the initial cleaning is done', async () => {
    const { initiate } = setup({ initialCleaningDays: 3 });

    // Tomorrow: the exact date the calendar used to offer.
    const res = await run({ days: 2, startsInDays: 1 });

    expect(res.statusCode).toBe(400);
    const error = handleError.mock.calls[0][1];
    expect(error.data.code).toBe('booking-before-initial-cleaning');
    expect(error.data.initialCleaningDays).toBe(3);
    // A 400 that arrives after the transaction was initiated is not a refusal.
    expect(buildLineItemsForListing).not.toHaveBeenCalled();
    expect(initiate).not.toHaveBeenCalled();
  });

  it('lets a booking starting exactly on the boundary day through to pricing', async () => {
    // day + n is the first day the garment is READY. Refusing it would cost the
    // owner a day on every new garment.
    const { initiate } = setup({ initialCleaningDays: 3 });

    await run({ days: 2, startsInDays: 3 });

    expect(buildLineItemsForListing).toHaveBeenCalled();
    expect(initiate).toHaveBeenCalled();
  });

  it('lets a booking well after the window through', async () => {
    const { initiate } = setup({ initialCleaningDays: 3 });

    await run({ days: 2, startsInDays: 20 });

    expect(buildLineItemsForListing).toHaveBeenCalled();
    expect(initiate).toHaveBeenCalled();
  });

  // The client's carve-out. Once the garment is at a studio, tomorrow is correct and
  // this endpoint must behave exactly as it did before the feature existed.
  it('changes NOTHING once the garment is at the laundry', async () => {
    const { initiate } = setup({ initialCleaningDays: 30, onLaundry: true });

    const res = await run({ days: 1, startsInDays: 1 });

    expect(res.statusCode).not.toBe(400);
    expect(buildLineItemsForListing).toHaveBeenCalled();
    expect(initiate).toHaveBeenCalled();
  });

  it('leaves a listing with no stored turnaround unaffected - no migration needed', async () => {
    // Every listing assigned before this field existed. Per the client, "en
    // producción iniciaremos limpio", so absence is a deliberate no-block.
    const { initiate } = setup({});

    await run({ days: 1, startsInDays: 1 });

    expect(buildLineItemsForListing).toHaveBeenCalled();
    expect(initiate).toHaveBeenCalled();
  });

  it('leaves a listing with a malformed stored turnaround unaffected', async () => {
    // A bad write must not be able to take a garment off the market silently.
    const { initiate } = setup({ initialCleaningDays: 'soon' });

    await run({ days: 1, startsInDays: 1 });

    expect(buildLineItemsForListing).toHaveBeenCalled();
    expect(initiate).toHaveBeenCalled();
  });

  it('refuses the SPECULATIVE breakdown too, so checkout cannot quote a refused date', async () => {
    const { initiateSpeculative } = setup({ initialCleaningDays: 3 });

    const res = await run({ days: 2, startsInDays: 1, isSpeculative: true });

    expect(res.statusCode).toBe(400);
    expect(buildLineItemsForListing).not.toHaveBeenCalled();
    expect(initiateSpeculative).not.toHaveBeenCalled();
  });

  it('keeps the two refusals distinguishable', async () => {
    // Same request, two different faults. The browser has to be able to say "wait a
    // few days" and "book more days" - they are not the same instruction.
    setup({ minimumBookingDays: 3, initialCleaningDays: 3 });
    await run({ days: 5, startsInDays: 1 });
    expect(handleError.mock.calls[0][1].data.code).toBe('booking-before-initial-cleaning');

    jest.clearAllMocks();
    handleError.mockImplementation((res, e) => {
      res.status(e.status || 500).json(e.data || {});
      return res;
    });

    setup({ minimumBookingDays: 3, initialCleaningDays: 3 });
    await run({ days: 1, startsInDays: 10 });
    expect(handleError.mock.calls[0][1].data.code).toBe('booking-below-minimum-days');
  });
});
