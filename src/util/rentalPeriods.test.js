import {
  MAX_RENTAL_PERIOD_DAYS,
  RENTAL_PERIOD_DAYS,
  getRentalPeriods,
  rentalPeriodVariantName,
  resolveCleaningWindowDays,
  resolveRentalPeriodDays,
  usesFixedRentalPeriods,
} from './rentalPeriods';

const period = (days, priceInSubunits = 10000) => ({
  name: rentalPeriodVariantName(days),
  bookingLengthInDays: days,
  priceInSubunits,
});

const coclosetType = (unitType = 'day') => ({
  listingType: 'garment-rental',
  transactionType: { process: 'cocloset-booking', alias: 'cocloset-booking/release-1', unitType },
});

describe('RENTAL_PERIOD_DAYS', () => {
  it('offers exactly the two periods the client asked for', () => {
    expect(RENTAL_PERIOD_DAYS).toEqual([7, 14]);
  });
});

describe('rentalPeriodVariantName', () => {
  it('is a URL-safe slug, because it becomes a ?priceVariant= deep link', () => {
    RENTAL_PERIOD_DAYS.forEach(days => {
      expect(rentalPeriodVariantName(days)).toMatch(/^[a-z0-9-]+$/);
    });
  });

  it('is distinct per period', () => {
    expect(rentalPeriodVariantName(7)).not.toEqual(rentalPeriodVariantName(14));
  });
});

describe('usesFixedRentalPeriods', () => {
  it('is true for a day-based cocloset-booking listing type', () => {
    expect(usesFixedRentalPeriods(coclosetType())).toBe(true);
  });

  it('is false for every other process', () => {
    expect(
      usesFixedRentalPeriods({
        transactionType: { process: 'default-booking', unitType: 'day' },
      })
    ).toBe(false);
  });

  it('is false for a cocloset listing type that is not day-based', () => {
    // Every day count in this feature - the period, the cleaning window, the availability
    // check - would silently mean something else on an hourly type.
    expect(usesFixedRentalPeriods(coclosetType('hour'))).toBe(false);
  });

  it('is false rather than throwing for missing config', () => {
    expect(usesFixedRentalPeriods(undefined)).toBe(false);
    expect(usesFixedRentalPeriods({})).toBe(false);
  });
});

describe('getRentalPeriods', () => {
  it('returns the stored periods, shortest first', () => {
    const publicData = { priceVariants: [period(14, 18000), period(7, 10000)] };
    expect(getRentalPeriods(publicData).map(p => p.bookingLengthInDays)).toEqual([7, 14]);
  });

  it('returns an empty array when nothing is stored', () => {
    expect(getRentalPeriods(undefined)).toEqual([]);
    expect(getRentalPeriods({})).toEqual([]);
    expect(getRentalPeriods({ priceVariants: 'not an array' })).toEqual([]);
  });

  it('drops a stock price variant that has no booking length', () => {
    // A listing that went through the stock price-variations editor stores variants with no
    // day count. Rendering one as a chip would produce a booking whose length the server
    // cannot check.
    const publicData = {
      priceVariants: [{ name: 'weekend', priceInSubunits: 5000 }, period(7)],
    };
    expect(getRentalPeriods(publicData)).toHaveLength(1);
    expect(getRentalPeriods(publicData)[0].bookingLengthInDays).toEqual(7);
  });

  it.each([
    ['a fractional length', { ...period(7), bookingLengthInDays: 2.5 }],
    ['a zero length', { ...period(7), bookingLengthInDays: 0 }],
    ['a negative length', { ...period(7), bookingLengthInDays: -7 }],
    ['a length past the bound', { ...period(7), bookingLengthInDays: MAX_RENTAL_PERIOD_DAYS + 1 }],
    ['a missing price', { name: '7-days', bookingLengthInDays: 7 }],
    ['a fractional price', { ...period(7), priceInSubunits: 100.5 }],
    ['a blank name', { ...period(7), name: '' }],
  ])('drops %s', (_label, variant) => {
    expect(getRentalPeriods({ priceVariants: [variant] })).toEqual([]);
  });

  it('accepts a numeric string, in case the value was set by hand in Console', () => {
    const publicData = {
      priceVariants: [{ name: '7-days', bookingLengthInDays: '7', priceInSubunits: '10000' }],
    };
    const [resolved] = getRentalPeriods(publicData);
    expect(resolved.bookingLengthInDays).toEqual(7);
    expect(resolved.priceInSubunits).toEqual(10000);
  });
});

describe('resolveRentalPeriodDays', () => {
  const publicData = { priceVariants: [period(7), period(14)] };

  it('resolves the length of a named period', () => {
    expect(resolveRentalPeriodDays(publicData, '14-days')).toEqual(14);
  });

  it('is null for a name the listing does not offer', () => {
    // Not parsed out of the name: a period the owner has since removed must not be bookable
    // by replaying its name.
    expect(resolveRentalPeriodDays(publicData, '30-days')).toBeNull();
  });

  it('is null with no name at all', () => {
    expect(resolveRentalPeriodDays(publicData, undefined)).toBeNull();
  });
});

describe('resolveCleaningWindowDays', () => {
  it('prefers the laundry live turnaround over the snapshot', () => {
    expect(resolveCleaningWindowDays(3, 2)).toEqual(3);
  });

  it('falls back to the snapshot when there is no live answer', () => {
    // A null live value is what every failure returns - a deleted laundry, an outage. The
    // stale snapshot is a better answer than none.
    expect(resolveCleaningWindowDays(null, 2)).toEqual(2);
    expect(resolveCleaningWindowDays(undefined, 2)).toEqual(2);
  });

  it('is 0 when neither is available', () => {
    // 0 only ever makes the availability requirement LOOSER, which is the right direction
    // for a failed read: guessing high would refuse dates the marketplace can honour.
    expect(resolveCleaningWindowDays(null, null)).toEqual(0);
    expect(resolveCleaningWindowDays(undefined, undefined)).toEqual(0);
  });

  it.each([['a fraction', 2.5], ['a string of garbage', 'soon'], ['a negative', -3], ['zero', 0]])(
    'ignores %s and uses the snapshot instead',
    (_label, live) => {
      expect(resolveCleaningWindowDays(live, 2)).toEqual(2);
    }
  );

  it('clamps an absurd value rather than taking the listing off the market', () => {
    expect(resolveCleaningWindowDays(4000, null)).toEqual(MAX_RENTAL_PERIOD_DAYS);
  });
});
