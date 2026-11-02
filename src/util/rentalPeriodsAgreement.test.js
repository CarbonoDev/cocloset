import {
  MAX_RENTAL_PERIOD_DAYS as CLIENT_MAX,
  getRentalPeriods as clientGetRentalPeriods,
  resolveRentalPeriodDays as clientResolveRentalPeriodDays,
} from './rentalPeriods';

const {
  MAX_RENTAL_PERIOD_DAYS: SERVER_MAX,
  getRentalPeriods: serverGetRentalPeriods,
  resolveRentalPeriodDays: serverResolveRentalPeriodDays,
} = require('../../server/api-util/rentalPeriods');

/**
 * WHY THIS FILE EXISTS
 *
 * The fixed-period rule is implemented twice: once in the browser, where it decides which
 * start dates the calendar offers and what the chips say, and once on the server, where it
 * decides whether a booking is accepted and at what price. `src/` and `server/` cannot
 * import each other - one is transpiled ESM, the other plain CommonJS - so the two are
 * separate code.
 *
 * A disagreement between them does not look like a bug. It looks like "the site let me pick
 * that and then refused my card". This project has already shipped that failure once, which
 * is why initialCleaningAgreement.test.js exists; this is the same guard for the same
 * reason, over the period rules.
 *
 * These assertions deliberately go through the PUBLIC functions on both sides, on identical
 * input, rather than comparing constants. A shared constant that both sides then use
 * differently would pass a constants-only check.
 */

const variants = [
  { name: '14-days', bookingLengthInDays: 14, priceInSubunits: 18000 },
  { name: '7-days', bookingLengthInDays: 7, priceInSubunits: 10000 },
];

describe('the client and server rental-period rules agree', () => {
  it('bound a stored period at the same number of days', () => {
    expect(CLIENT_MAX).toEqual(SERVER_MAX);
  });

  it('select and order the same periods from the same listing', () => {
    const publicData = { priceVariants: variants };

    expect(clientGetRentalPeriods(publicData).map(p => p.bookingLengthInDays)).toEqual(
      serverGetRentalPeriods(publicData).map(p => p.bookingLengthInDays)
    );
  });

  it.each([
    ['a stock variant with no day count', [{ name: 'weekend', priceInSubunits: 5000 }]],
    ['a fractional day count', [{ name: '7-days', bookingLengthInDays: 2.5, priceInSubunits: 1 }]],
    ['a zero day count', [{ name: '7-days', bookingLengthInDays: 0, priceInSubunits: 1 }]],
    [
      'a day count past the bound',
      [{ name: '7-days', bookingLengthInDays: CLIENT_MAX + 1, priceInSubunits: 1 }],
    ],
    ['a missing price', [{ name: '7-days', bookingLengthInDays: 7 }]],
    ['a blank name', [{ name: '', bookingLengthInDays: 7, priceInSubunits: 1 }]],
    ['a numeric string', [{ name: '7-days', bookingLengthInDays: '7', priceInSubunits: '1' }]],
  ])('treat %s identically', (_label, priceVariants) => {
    const publicData = { priceVariants };

    expect(clientGetRentalPeriods(publicData).map(p => p.bookingLengthInDays)).toEqual(
      serverGetRentalPeriods(publicData).map(p => p.bookingLengthInDays)
    );
  });

  it.each([['7-days'], ['14-days'], ['30-days'], [''], [undefined]])(
    'resolve the period name %s to the same length',
    priceVariantName => {
      const publicData = { priceVariants: variants };

      expect(clientResolveRentalPeriodDays(publicData, priceVariantName)).toEqual(
        serverResolveRentalPeriodDays(publicData, priceVariantName)
      );
    }
  );

  it('agree there are no periods on a listing that has none', () => {
    [undefined, {}, { priceVariants: [] }, { priceVariants: 'nope' }].forEach(publicData => {
      expect(clientGetRentalPeriods(publicData)).toEqual([]);
      expect(serverGetRentalPeriods(publicData)).toEqual([]);
    });
  });
});
