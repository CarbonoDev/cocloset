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
//   * the fixed rental period: the dates must match the period being charged for
//     (data.code 'rental-period-length-mismatch' / 'rental-period-unknown')
//   * the garment's initial cleaning turnaround, for a garment that has never
//     reached its laundry (data.code 'booking-before-initial-cleaning')

const LISTING_ID = { uuid: 'listing-1' };

// The two fixed periods a Cocloset garment is offered for. Opted into per-test rather than
// defaulted, so the initial-cleaning tests below can go on booking arbitrary lengths without
// the period gate refusing them first — each describe exercises ONE rule.
const PERIODS = [
  { name: '7-days', bookingLengthInDays: 7, priceInSubunits: 10000 },
  { name: '14-days', bookingLengthInDays: 14, priceInSubunits: 18000 },
];

const listingEntity = ({
  priceVariants = [],
  initialCleaningDays,
  onLaundry,
  assignedLaundryId,
  readyAt,
} = {}) => ({
  id: LISTING_ID,
  type: 'listing',
  attributes: {
    price: { amount: 5000, currency: 'EUR' },
    // UTC so the day() fixtures below and the rule's day arithmetic agree.
    availabilityPlan: { type: 'availability-plan/time', timezone: 'Etc/UTC' },
    publicData: {
      unitType: 'day',
      // The alias is what api-util/rentalPeriods.js keys on: it is baked onto a listing at
      // creation, so the rule is per-listing rather than per-listing-type.
      transactionProcessAlias: 'cocloset-booking/release-1',
      priceVariants,
    },
    // Server-written only (Integration API). `initialCleaningDays` here is the SNAPSHOT
    // taken when the laundry was assigned; the gate prefers the studio's live turnaround
    // and falls back to this. `assignedLaundryId` is what makes the live lookup possible
    // at all - with no laundry assigned, no lookup is attempted.
    metadata: {
      ...(initialCleaningDays === undefined ? {} : { initialCleaningDays }),
      ...(onLaundry === undefined ? {} : { onLaundry }),
      ...(assignedLaundryId === undefined ? {} : { assignedLaundryId }),
      // When the wash this garment is in RIGHT NOW finishes. Written at the return counter
      // by api-util/listingCustody.js; unrelated to initialCleaningDays, which is about a
      // garment that has never been to a laundry at all.
      ...(readyAt === undefined ? {} : { readyAt }),
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
// WHERE `priceVariantName` LIVES ON THE WIRE, and why this fixture has two shapes.
//
// CheckoutPage.duck.js sends it in DIFFERENT places on its two paths:
//   * `speculateTransaction` destructures it into `orderData`;
//   * `initiateOrder` — the real "Request to book" — does not, so it stays in
//     `otherOrderParams` and arrives inside `bodyParams.params`, with `orderData` empty.
//
// The endpoint has to accept both, and the second is the one that matters: a fixture that
// only ever used `orderData` is exactly how the period gate shipped refusing every real
// booking with `rental period "undefined"` while its tests passed. Default to the real
// shape here; `variantIn: 'orderData'` covers the speculative one.
const req = ({
  days,
  startsInDays = 0,
  isSpeculative = false,
  priceVariantName = '7-days',
  variantIn = 'params',
}) => ({
  body: {
    isSpeculative,
    orderData: {
      currency: 'EUR',
      ...(variantIn === 'orderData' ? { priceVariantName } : {}),
    },
    bodyParams: {
      transition: 'transition/request-payment',
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

const setup = ({
  priceVariants,
  initialCleaningDays,
  onLaundry,
  assignedLaundryId,
  readyAt,
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
          priceVariants,
          initialCleaningDays,
          onLaundry,
          assignedLaundryId,
          readyAt,
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

describe('initiate-privileged: the rental period gate', () => {
  it('refuses dates that do not match the period being charged for', async () => {
    // The attack: name the cheap period, book a long range. The line-item builder prices
    // from the named period and never looks at the dates.
    const { initiate } = setup({ priceVariants: PERIODS });

    const res = await run({ days: 60, priceVariantName: '7-days' });

    expect(res.statusCode).toBe(400);
    expect(handleError).toHaveBeenCalled();
    const error = handleError.mock.calls[0][1];
    expect(error.data.code).toBe('rental-period-length-mismatch');
    // The refusal must come BEFORE pricing and BEFORE the charge. A 400 that arrives after
    // the transaction was initiated is not a refusal.
    expect(buildLineItemsForListing).not.toHaveBeenCalled();
    expect(initiate).not.toHaveBeenCalled();
  });

  it('refuses a period the listing does not offer', async () => {
    const { initiate } = setup({ priceVariants: PERIODS });

    const res = await run({ days: 30, priceVariantName: '30-days' });

    expect(res.statusCode).toBe(400);
    expect(handleError.mock.calls[0][1].data.code).toBe('rental-period-unknown');
    expect(initiate).not.toHaveBeenCalled();
  });

  it('lets a booking of exactly the named period through to pricing', async () => {
    const { initiate } = setup({ priceVariants: PERIODS });

    await run({ days: 7, priceVariantName: '7-days' });

    expect(buildLineItemsForListing).toHaveBeenCalled();
    expect(initiate).toHaveBeenCalled();
  });

  it('lets the longer period through as well', async () => {
    const { initiate } = setup({ priceVariants: PERIODS });

    await run({ days: 14, priceVariantName: '14-days' });

    expect(buildLineItemsForListing).toHaveBeenCalled();
    expect(initiate).toHaveBeenCalled();
  });

  it('accepts the period from bodyParams.params, which is where the real booking path puts it', async () => {
    // THE REGRESSION. Reported from Dev as `This garment is not offered for the rental
    // period "undefined"` on a payload whose `orderData` was `{}` and whose
    // `bodyParams.params.priceVariantName` was '7-days'. Every real booking was refused.
    const { initiate } = setup({ priceVariants: PERIODS });

    const res = await run({ days: 7, priceVariantName: '7-days', variantIn: 'params' });

    expect(res.statusCode).not.toBe(400);
    expect(initiate).toHaveBeenCalled();
  });

  it('accepts the period from orderData, which is where the speculative path puts it', async () => {
    const { initiateSpeculative } = setup({ priceVariants: PERIODS });

    const res = await run({
      days: 7,
      priceVariantName: '7-days',
      variantIn: 'orderData',
      isSpeculative: true,
    });

    expect(res.statusCode).not.toBe(400);
    expect(initiateSpeculative).toHaveBeenCalled();
  });

  it('leaves a listing with no priced periods completely unaffected', async () => {
    // Pricing fails on its own with a message about the missing price; relabelling that as
    // a period fault would point the owner at the wrong thing.
    const { initiate } = setup({ priceVariants: [] });

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
    // Cleaning runs on days +1..+3, so +4 is the first day the garment is READY.
    // Refusing it would cost the owner a day on every new garment.
    const { initiate } = setup({ initialCleaningDays: 3 });

    await run({ days: 2, startsInDays: 4 });

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
    // Same request, two different faults. The browser has to be able to say "wait a few
    // days" and "those dates are not a 7-day rental" - not the same instruction.
    setup({ priceVariants: PERIODS, initialCleaningDays: 3 });
    await run({ days: 7, startsInDays: 1 });
    expect(handleError.mock.calls[0][1].data.code).toBe('booking-before-initial-cleaning');

    jest.clearAllMocks();
    handleError.mockImplementation((res, e) => {
      res.status(e.status || 500).json(e.data || {});
      return res;
    });

    setup({ priceVariants: PERIODS, initialCleaningDays: 3 });
    await run({ days: 1, startsInDays: 10 });
    expect(handleError.mock.calls[0][1].data.code).toBe('rental-period-length-mismatch');
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
    // Snapshot says 7 days; the studio has got faster and now needs 2, so the floor moves
    // from +8 to +3.
    const { initiate } = setup({
      initialCleaningDays: 7,
      assignedLaundryId: 'laundry-1',
      laundryTurnaroundDays: 2,
    });

    await run({ days: 2, startsInDays: 3 });

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

describe('initiate-privileged: the post-rental cleaning gate', () => {
  //   > "al momento en que un laundry recibe la prenda, puede ingresar cuantos dias necesita
  //   >  para la lavada, esto debe apartar dias para que la prenda vuelva a estar disponible
  //   >  (...) la prenda debe estar disponible el 18, 4 días despues, no antes"
  //
  // WHY THIS GATE IS HERE AND NOT ONLY ON THE CALENDAR.
  // The cleaning window used to be held by exactly one thing: an availability exception
  // written at the return. That write runs after a transition that has ALREADY succeeded, so
  // it swallows its own failures by design - failing the request would make the ops UI retry
  // a step Sharetribe answers 409 for. Every way it can come up short (a rejected exception
  // query, an owner-blocked week overlapping with seats > 0, a garment returned before the
  // feature shipped) ended with the listing bookable the day the rental ended, silently.
  //
  // `metadata.readyAt` is written BEFORE the calendar and read fresh here on every booking,
  // and it is Integration-API-only so an owner cannot clear it to get back on the market
  // early. Two independent mechanisms, and the authoritative one is the one that cannot
  // quietly write nothing.

  it('refuses a booking that starts while the garment is still in the wash', async () => {
    const { initiate } = setup({ readyAt: daysFromToday(5).toISOString(), onLaundry: true });

    const res = await run({ days: 2, startsInDays: 3 });

    expect(res.statusCode).toBe(400);
    const error = handleError.mock.calls[0][1];
    expect(error.data.code).toBe('booking-before-cleaning-ready');
    // A 400 that arrives after the transaction was initiated is not a refusal.
    expect(buildLineItemsForListing).not.toHaveBeenCalled();
    expect(initiate).not.toHaveBeenCalled();
  });

  it('lets the readiness day itself through to pricing', async () => {
    // Off by one here costs the owner a day of availability after every single rental.
    const { initiate } = setup({ readyAt: daysFromToday(5).toISOString(), onLaundry: true });

    await run({ days: 2, startsInDays: 5 });

    expect(buildLineItemsForListing).toHaveBeenCalled();
    expect(initiate).toHaveBeenCalled();
  });

  it('leaves a garment that is not in a wash entirely alone', async () => {
    // Which is almost every listing, almost all of the time.
    const { initiate } = setup({ onLaundry: true });

    await run({ days: 2, startsInDays: 1 });

    expect(initiate).toHaveBeenCalled();
  });

  it('ignores a readiness date that has already passed', async () => {
    // `readyAt` is never cleared - it just stops mattering. A stale one must not refuse
    // bookings for the rest of the listing's life.
    const { initiate } = setup({ readyAt: daysFromToday(-3).toISOString(), onLaundry: true });

    await run({ days: 2, startsInDays: 1 });

    expect(initiate).toHaveBeenCalled();
  });

  it('refuses on the speculative path too, so the preview cannot quote a refused date', async () => {
    // A preview that quotes a booking the charge path will reject is how a customer gets to
    // the last step before finding out.
    const { initiateSpeculative } = setup({
      readyAt: daysFromToday(5).toISOString(),
      onLaundry: true,
    });

    const res = await run({ days: 2, startsInDays: 3, isSpeculative: true });

    expect(res.statusCode).toBe(400);
    expect(initiateSpeculative).not.toHaveBeenCalled();
  });

  it('does not treat a malformed readyAt as a block', async () => {
    // A bad write must not be able to take a listing off the market - nothing would ever
    // say why. Same direction the initial-cleaning rule errs in.
    const { initiate } = setup({ readyAt: 'sometime next week', onLaundry: true });

    await run({ days: 2, startsInDays: 1 });

    expect(initiate).toHaveBeenCalled();
  });
});
