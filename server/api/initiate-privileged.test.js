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
    // UTC so the day() fixtures below and the rule's day arithmetic agree.
    availabilityPlan: { type: 'availability-plan/time', timezone: 'Etc/UTC' },
    publicData: {
      unitType: 'day',
      ...(minimumBookingDays === undefined ? {} : { minimumBookingDays }),
    },
    // Server-written only (Integration API). `initialCleaningDays` here is the SNAPSHOT
    // taken when the laundry was assigned; the gate prefers the studio's live turnaround
    // and falls back to this. `assignedLaundryId` is what makes the live lookup possible
    // at all - with no laundry assigned, no lookup is attempted.
    metadata: {
      ...(initialCleaningDays === undefined ? {} : { initialCleaningDays }),
      ...(onLaundry === undefined ? {} : { onLaundry }),
      ...(assignedLaundryId === undefined ? {} : { assignedLaundryId }),
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

const setup = ({
  minimumBookingDays,
  initialCleaningDays,
  onLaundry,
  assignedLaundryId,
  // The laundry's CURRENT turnaround, as it would come back from the Integration API.
  // `undefined` leaves the Integration API mock unconfigured, which makes the live lookup
  // fail - and a failed lookup must fall back to the snapshot, so that is a case worth
  // being the default rather than a special one.
  laundryTurnaroundDays,
} = {}) => {
  const show = jest.fn(() =>
    Promise.resolve({
      data: {
        data: listingEntity({
          minimumBookingDays,
          initialCleaningDays,
          onLaundry,
          assignedLaundryId,
        }),
      },
    })
  );
  getSdk.mockReturnValue({ listings: { show } });

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
  fetchCommission.mockResolvedValue({
    data: { data: [{ type: 'jsonAsset', attributes: { data: {} } }] },
  });
  buildLineItemsForListing.mockResolvedValue([]);

  const initiate = jest.fn(() => Promise.resolve({ data: { data: { id: { uuid: 'tx-1' } } } }));
  const initiateSpeculative = jest.fn(() => Promise.resolve({ data: { data: null } }));
  getTrustedSdk.mockResolvedValue({ transactions: { initiate, initiateSpeculative } });
  return { initiate, initiateSpeculative, laundryShow };
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
  // straight at this endpoint. `onLaundry` lives in `metadata`, which the Marketplace
  // API refuses to let a listing's own owner write, so the carve-out cannot be forged.
  //
  // The NUMBER of days is now resolved from the assigned laundry's live profile, with the
  // stored `metadata.initialCleaningDays` snapshot as the fallback - see the
  // "live turnaround" block at the end of this file for why, and for the guarantee that it
  // costs an Integration API call only on a garment's first rental.

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

describe('initiate-privileged: the gate resolves the laundry live turnaround', () => {
  // WHY THIS MATTERS MORE THAN IT LOOKS.
  // The booking calendar now consults the laundry's CURRENT turnaround at ListingPage load
  // (per the client: a studio that changes its turnaround must affect garments already
  // assigned to it). If this gate went on reading only the assignment-time snapshot, the
  // two could disagree - and a disagreement here means a calendar that offers a date and a
  // checkout that then refuses it, which is exactly the failure
  // src/components/OrderPanel/BookingDatesForm/initialCleaningAgreement.test.js exists to
  // stop. So both sides must resolve from the same input.

  it('refuses a day the stale snapshot would have allowed', async () => {
    // Snapshot says 1 day, so the snapshot floor is tomorrow. The studio now needs 5.
    const { initiate } = setup({
      initialCleaningDays: 1,
      assignedLaundryId: 'laundry-1',
      laundryTurnaroundDays: 5,
    });

    const res = await run({ days: 2, startsInDays: 1 });

    expect(res.statusCode).toBe(400);
    const error = handleError.mock.calls[0][1];
    expect(error.data.code).toBe('booking-before-initial-cleaning');
    // The LIVE number, reported to the customer - not the stale one.
    expect(error.data.initialCleaningDays).toBe(5);
    expect(initiate).not.toHaveBeenCalled();
  });

  it('allows a day the stale snapshot would have refused', async () => {
    // Snapshot says 7 days; the studio has got faster and now needs 2.
    const { initiate } = setup({
      initialCleaningDays: 7,
      assignedLaundryId: 'laundry-1',
      laundryTurnaroundDays: 2,
    });

    await run({ days: 2, startsInDays: 2 });

    expect(buildLineItemsForListing).toHaveBeenCalled();
    expect(initiate).toHaveBeenCalled();
  });

  // THE COST CONSTRAINT, asserted rather than promised. A previous change deliberately
  // removed the Integration API from the checkout path; this puts it back only for a
  // garment that has never reached a studio, i.e. its first rental.
  it('makes NO Integration API call once the garment is at its laundry', async () => {
    const { initiate, laundryShow } = setup({
      initialCleaningDays: 3,
      onLaundry: true,
      assignedLaundryId: 'laundry-1',
      laundryTurnaroundDays: 30,
    });

    await run({ days: 1, startsInDays: 1 });

    expect(laundryShow).not.toHaveBeenCalled();
    expect(initiate).toHaveBeenCalled();
  });

  it('makes NO Integration API call when no laundry is assigned', async () => {
    const { laundryShow } = setup({ initialCleaningDays: 3, laundryTurnaroundDays: 9 });

    await run({ days: 1, startsInDays: 5 });

    expect(laundryShow).not.toHaveBeenCalled();
  });

  it('asks the laundry exactly once, for the listing assigned laundry', async () => {
    const { laundryShow } = setup({
      assignedLaundryId: 'laundry-7',
      laundryTurnaroundDays: 2,
    });

    await run({ days: 1, startsInDays: 5 });

    expect(laundryShow).toHaveBeenCalledTimes(1);
    expect(laundryShow).toHaveBeenCalledWith({ id: 'laundry-7' });
  });

  // A READ ERROR MUST NOT OPEN THE GATE. Falling back to "no block" would let an
  // Integration API blip make a garment that is still in its owner's wardrobe bookable
  // for tomorrow - and it would do it silently, on the charge path.
  it('falls back to the snapshot when the laundry lookup fails, and still refuses', async () => {
    const { initiate } = setup({
      initialCleaningDays: 3,
      assignedLaundryId: 'laundry-1',
      // laundryTurnaroundDays omitted: the fixture's users.show rejects.
    });

    const res = await run({ days: 2, startsInDays: 1 });

    expect(res.statusCode).toBe(400);
    expect(handleError.mock.calls[0][1].data.initialCleaningDays).toBe(3);
    expect(initiate).not.toHaveBeenCalled();
  });

  it('does not turn a failed laundry lookup into a 500', async () => {
    const { initiate } = setup({
      assignedLaundryId: 'laundry-1',
      // No snapshot either, so the whole rule is a no-op - but only if the failed lookup
      // was swallowed rather than propagated.
    });

    const res = await run({ days: 2, startsInDays: 1 });

    expect(res.statusCode).not.toBe(500);
    expect(initiate).toHaveBeenCalled();
  });

  it('refuses the SPECULATIVE breakdown on the live number too', async () => {
    const { initiateSpeculative } = setup({
      initialCleaningDays: 1,
      assignedLaundryId: 'laundry-1',
      laundryTurnaroundDays: 5,
    });

    const res = await run({ days: 2, startsInDays: 1, isSpeculative: true });

    expect(res.statusCode).toBe(400);
    expect(initiateSpeculative).not.toHaveBeenCalled();
  });
});
