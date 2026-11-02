jest.mock('./liveInitialCleaning', () => ({
  resolveLiveTurnaroundDays: jest.fn(),
}));

const { resolveLiveTurnaroundDays } = require('./liveInitialCleaning');
const { assertCleaningReadiness, startOfDayInTimeZone } = require('./bookingRules');
const { currentCleaningGap, resolveCleaningGapsForListing } = require('./listingCleaningGaps');

// A garment's own zone, deliberately not UTC and deliberately behind it: every bug this rule
// has had was a whole-day slip that only appears when the two disagree.
const TIME_ZONE = 'America/Mexico_City';
const LISTING_ID = 'listing-1';

const listingWith = (metadata = {}) => ({
  id: { uuid: LISTING_ID },
  attributes: {
    metadata: { assignedLaundryId: 'laundry-1', ...metadata },
    availabilityPlan: { timezone: TIME_ZONE },
  },
});

// `readyAt` as listingCustody writes it: a midnight in the listing's zone, `days` from today.
const readyAtInDays = days => startOfDayInTimeZone(new Date(), TIME_ZONE, days).toISOString();

const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

describe('currentCleaningGap', () => {
  it('blocks the days between today and readyAt while a wash is running', () => {
    const gap = currentCleaningGap(listingWith({ readyAt: readyAtInDays(3) }));

    expect(gap).not.toBeNull();
    expect(gap.start).toEqual(startOfDayInTimeZone(new Date(), TIME_ZONE));
    expect(gap.end).toEqual(startOfDayInTimeZone(new Date(), TIME_ZONE, 3));
  });

  // `readyAt` is never cleared - it is a fact about the last return, not a flag - so almost
  // every listing in the marketplace reaches here with one in the past and MUST come out
  // unblocked. Getting this wrong would block every garment that has ever been rented.
  it('is nothing once the wash has finished', () => {
    expect(currentCleaningGap(listingWith({ readyAt: readyAtInDays(-2) }))).toBeNull();
  });

  it('is nothing on the day the garment becomes ready', () => {
    expect(currentCleaningGap(listingWith({ readyAt: readyAtInDays(0) }))).toBeNull();
  });

  it('is nothing for a garment that has never been returned', () => {
    expect(currentCleaningGap(listingWith())).toBeNull();
    expect(currentCleaningGap(listingWith({ readyAt: 'not-a-date' }))).toBeNull();
    expect(currentCleaningGap(undefined)).toBeNull();
  });

  // THE AGREEMENT THAT MATTERS. The picker refuses what this gap covers; checkout refuses what
  // `assertCleaningReadiness` says. If they disagree by a day the customer meets it as "the
  // calendar let me pick this date and then my card was refused" - the exact failure this
  // repository has already paid for twice. Asserted against the gate itself rather than against
  // a second copy of the arithmetic.
  it('ends exactly where the checkout gate stops refusing', () => {
    const listing = listingWith({ readyAt: readyAtInDays(4) });
    const gap = currentCleaningGap(listing);

    // The first day the picker offers is the first day checkout accepts.
    expect(() => assertCleaningReadiness({ listing, bookingStart: gap.end })).not.toThrow();

    // And the last day the picker blocks is still refused.
    expect(() => assertCleaningReadiness({ listing, bookingStart: addDays(gap.end, -1) })).toThrow(
      /being cleaned/
    );
  });
});

describe('resolveCleaningGapsForListing', () => {
  // Built per test, not once: the shared jest config sets `resetMocks: true`, which strips the
  // implementation off any `jest.fn` created at module scope and leaves it returning undefined.
  let emptySdk;

  beforeEach(() => {
    resolveLiveTurnaroundDays.mockResolvedValue(2);
    emptySdk = {
      transactions: {
        query: jest.fn(() => Promise.resolve({ data: { data: [], included: [] } })),
      },
    };
  });

  it('adds the running wash to the gaps the bookings produce', async () => {
    const result = await resolveCleaningGapsForListing({
      listing: listingWith({ readyAt: readyAtInDays(3) }),
      integrationSdk: emptySdk,
    });

    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].end).toEqual(startOfDayInTimeZone(new Date(), TIME_ZONE, 3));
  });

  it('reports no gaps for a garment with nothing booked and nothing in a wash', async () => {
    const result = await resolveCleaningGapsForListing({
      listing: listingWith(),
      integrationSdk: emptySdk,
    });

    expect(result.gaps).toEqual([]);
  });

  // `null` means "the bookings read failed", which is NOT the same as "there are none" - the
  // picker treats an empty array as a clear calendar. Answering with just the wash would turn a
  // failed query into a confident, wrong answer.
  it('keeps unknown gaps unknown, even when a wash is running', async () => {
    const failingSdk = {
      transactions: { query: jest.fn(() => Promise.reject(new Error('boom'))) },
    };

    const result = await resolveCleaningGapsForListing({
      listing: listingWith({ readyAt: readyAtInDays(3) }),
      integrationSdk: failingSdk,
      log: { error: jest.fn() },
    });

    expect(result.gaps).toBeNull();
  });
});
