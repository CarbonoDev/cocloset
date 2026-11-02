const {
  MAX_RENTAL_PERIOD_DAYS,
  assertRentalPeriodBooking,
  getRentalPeriods,
  rentalPeriodBookingEnd,
  resolveRentalPeriodDays,
  usesFixedRentalPeriods,
} = require('./rentalPeriods');

const period = (days, priceInSubunits = 10000) => ({
  name: `${days}-days`,
  bookingLengthInDays: days,
  priceInSubunits,
});

const listing = (publicData = {}, timezone = 'Etc/UTC') => ({
  attributes: {
    availabilityPlan: { type: 'availability-plan/time', timezone },
    publicData: {
      transactionProcessAlias: 'cocloset-booking/release-1',
      unitType: 'day',
      priceVariants: [period(7), period(14, 18000)],
      ...publicData,
    },
  },
});

describe('usesFixedRentalPeriods', () => {
  it('is true for a day-based listing on the cocloset-booking process', () => {
    expect(
      usesFixedRentalPeriods({
        transactionProcessAlias: 'cocloset-booking/release-1',
        unitType: 'day',
      })
    ).toBe(true);
  });

  it('is false for a listing created on another process', () => {
    // The alias is baked onto a listing at creation, so this is per-listing rather than
    // per-listing-type: a garment created before this feature keeps the old alias.
    expect(
      usesFixedRentalPeriods({
        transactionProcessAlias: 'default-booking/release-1',
        unitType: 'day',
      })
    ).toBe(false);
  });

  it('is false rather than throwing on missing or malformed publicData', () => {
    expect(usesFixedRentalPeriods(undefined)).toBe(false);
    expect(usesFixedRentalPeriods({})).toBe(false);
    expect(usesFixedRentalPeriods({ transactionProcessAlias: 42, unitType: 'day' })).toBe(false);
  });
});

describe('getRentalPeriods / resolveRentalPeriodDays', () => {
  it('sorts shortest first and resolves a named period', () => {
    const publicData = listing().attributes.publicData;
    expect(getRentalPeriods(publicData).map(p => p.bookingLengthInDays)).toEqual([7, 14]);
    expect(resolveRentalPeriodDays(publicData, '14-days')).toEqual(14);
  });

  it('drops variants with no usable day count', () => {
    expect(
      getRentalPeriods({ priceVariants: [{ name: 'weekend', priceInSubunits: 5000 }] })
    ).toEqual([]);
  });

  it('drops a day count past the bound rather than honouring it', () => {
    expect(
      getRentalPeriods({
        priceVariants: [{ ...period(7), bookingLengthInDays: MAX_RENTAL_PERIOD_DAYS + 1 }],
      })
    ).toEqual([]);
  });
});

describe('rentalPeriodBookingEnd', () => {
  it('adds whole days in the listing time zone', () => {
    const end = rentalPeriodBookingEnd({
      bookingStart: new Date('2026-09-01T00:00:00.000Z'),
      periodDays: 7,
      timeZone: 'Etc/UTC',
    });
    expect(end.toISOString()).toEqual('2026-09-08T00:00:00.000Z');
  });
});

describe('assertRentalPeriodBooking', () => {
  const start = new Date('2026-09-01T00:00:00.000Z');

  it('accepts dates that match the named period exactly', () => {
    expect(() =>
      assertRentalPeriodBooking({
        listing: listing(),
        priceVariantName: '7-days',
        bookingStart: start,
        bookingEnd: new Date('2026-09-08T00:00:00.000Z'),
      })
    ).not.toThrow();
  });

  it('rejects a longer range sold at the shorter period price', () => {
    // The attack this module exists for: the line-item builder prices from the named period
    // and never looks at the dates, so without this a 90-day rental costs the 7-day price.
    let thrown = null;
    try {
      assertRentalPeriodBooking({
        listing: listing(),
        priceVariantName: '7-days',
        bookingStart: start,
        bookingEnd: new Date('2026-11-30T00:00:00.000Z'),
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).not.toBeNull();
    expect(thrown.status).toEqual(400);
    expect(thrown.data.code).toEqual('rental-period-length-mismatch');
    expect(thrown.data.periodDays).toEqual(7);
  });

  it('rejects a shorter range too', () => {
    expect(() =>
      assertRentalPeriodBooking({
        listing: listing(),
        priceVariantName: '14-days',
        bookingStart: start,
        bookingEnd: new Date('2026-09-08T00:00:00.000Z'),
      })
    ).toThrow();
  });

  it('rejects a period the listing does not offer', () => {
    let thrown = null;
    try {
      assertRentalPeriodBooking({
        listing: listing(),
        priceVariantName: '30-days',
        bookingStart: start,
        bookingEnd: new Date('2026-10-01T00:00:00.000Z'),
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.data?.code).toEqual('rental-period-unknown');
    expect(thrown?.data?.availablePeriods).toEqual([7, 14]);
  });

  it('rejects a request that names no period at all', () => {
    expect(() =>
      assertRentalPeriodBooking({
        listing: listing(),
        bookingStart: start,
        bookingEnd: new Date('2026-09-08T00:00:00.000Z'),
      })
    ).toThrow();
  });

  it('is a no-op on a listing that does not use fixed periods', () => {
    expect(() =>
      assertRentalPeriodBooking({
        listing: listing({ transactionProcessAlias: 'default-booking/release-1' }),
        priceVariantName: undefined,
        bookingStart: start,
        bookingEnd: new Date('2026-11-30T00:00:00.000Z'),
      })
    ).not.toThrow();
  });

  it('is a no-op when the owner has priced nothing yet', () => {
    // Pricing fails on its own with a message about the missing price. Relabelling that as a
    // period fault would point the owner at the wrong thing.
    expect(() =>
      assertRentalPeriodBooking({
        listing: listing({ priceVariants: [] }),
        priceVariantName: '7-days',
        bookingStart: start,
        bookingEnd: new Date('2026-09-08T00:00:00.000Z'),
      })
    ).not.toThrow();
  });

  it('does not complain about missing dates - that is the line-item builder s fault to report', () => {
    expect(() =>
      assertRentalPeriodBooking({ listing: listing(), priceVariantName: '7-days' })
    ).not.toThrow();
  });

  it('counts days, not hours, across a DST boundary', () => {
    // Europe/Helsinki springs forward on 2026-03-29, so 7 calendar days from the 26th is
    // 167 hours. An instant-based check would reject a booking the calendar offered.
    const dstListing = listing({}, 'Europe/Helsinki');
    const dstStart = new Date('2026-03-25T22:00:00.000Z'); // 2026-03-26 00:00 local
    const dstEnd = new Date('2026-04-01T21:00:00.000Z'); // 2026-04-02 00:00 local

    expect(() =>
      assertRentalPeriodBooking({
        listing: dstListing,
        priceVariantName: '7-days',
        bookingStart: dstStart,
        bookingEnd: dstEnd,
      })
    ).not.toThrow();
  });
});
