import React from 'react';
import '@testing-library/jest-dom';
import Decimal from 'decimal.js';

import { types as sdkTypes } from '../../../util/sdkLoader';
import { getStartOf, monthIdString, timeOfDayFromTimeZoneToLocal } from '../../../util/dates';
import { LINE_ITEM_DAY } from '../../../util/types';
import { renderWithProviders as render, testingLibrary } from '../../../util/testHelpers';

import EstimatedCustomerBreakdownMaybe from '../EstimatedCustomerBreakdownMaybe';
import {
  resolveInitialCleaningDays,
  earliestBookableDate,
  isOutsideRangeFn,
} from './BookingDatesForm';

const { Money } = sdkTypes;
const { screen, within } = testingLibrary;

const lineItems = [
  {
    code: 'line-item/night',
    unitPrice: new Money(1099, 'USD'),
    quantity: new Decimal(2),
    includeFor: ['customer', 'provider'],
    lineTotal: new Money(2198, 'USD'),
    reversal: false,
  },
];

describe('EstimatedCustomerBreakdownMaybe', () => {
  it('renders nothing if nightly is missing start and end date', () => {
    const tree = render(
      <EstimatedCustomerBreakdownMaybe
        lineItems={lineItems}
        currency="USD"
        marketplaceName="MarketplaceX"
        processName="default-booking"
      />
    );
    expect(tree.asFragment().firstChild).toBeFalsy();
  });

  it('renders nothing if nightly is missing end date', () => {
    const data = {
      startDate: new Date(),
    };
    const tree = render(
      <EstimatedCustomerBreakdownMaybe
        breakdownData={data}
        lineItems={lineItems}
        currency="USD"
        marketplaceName="MarketplaceX"
        processName="default-booking"
      />
    );
    expect(tree.asFragment().firstChild).toBeFalsy();
  });

  it('renders breakdown with correct transaction data', () => {
    const startDate = new Date(Date.UTC(2017, 3, 14, 0, 0, 0));
    const endDate = new Date(Date.UTC(2017, 3, 16, 0, 0, 0));
    const props = {
      breakdownData: {
        startDate,
        endDate,
      },
      lineItems,
      currency: 'USD',
      timeZone: 'Etc/UTC',
      marketplaceName: 'MarketplaceX',
      processName: 'default-booking',
    };

    render(<EstimatedCustomerBreakdownMaybe {...props} />);

    const bookingStart = screen.getByText('OrderBreakdown.bookingStart');
    expect(bookingStart).toBeInTheDocument();
    const bookingStartInfo = within(bookingStart.parentNode.parentNode);
    expect(bookingStartInfo.getByText('Friday')).toBeInTheDocument();
    expect(bookingStartInfo.getByText('Apr 14')).toBeInTheDocument();

    const bookingEnd = screen.getByText('OrderBreakdown.bookingEnd');
    expect(bookingEnd).toBeInTheDocument();
    const bookingEndInfo = within(bookingEnd.parentNode.parentNode);
    expect(bookingEndInfo.getByText('Sunday')).toBeInTheDocument();
    expect(bookingEndInfo.getByText('Apr 16')).toBeInTheDocument();

    const baseUnitNight = screen.getByText('OrderBreakdown.baseUnitNight');
    expect(baseUnitNight).toBeInTheDocument();
    const baseUnitNightInfo = within(baseUnitNight.parentNode.parentNode);
    expect(baseUnitNightInfo.getByText('$21.98')).toBeInTheDocument();

    const total = screen.getByText('OrderBreakdown.total');
    expect(total).toBeInTheDocument();
    const totalPayIn = within(total.parentNode.parentNode);
    expect(totalPayIn.getByText('$21.98')).toBeInTheDocument();
  });
});

describe("the calendar's lower bound honours the garment's initial cleaning time", () => {
  //   > "Al hacer booking, el calendario muestra el siguiente día como disponible,
  //   >  pero no esta considerando los tiempos de lavado inicial, esto debe aplicar
  //   >  solo para la primera vez en esa prenda, si la prenda aun no esta en el
  //   >  laundry, si la prenda ya esta en laundry entonces si debe aparecer
  //   >  disponible al siguiente día"
  //
  // The floor is asserted in both directions on purpose. Too low and a customer
  // books a garment that is still in its owner's wardrobe; too high and an owner
  // silently loses a day of availability on every new garment, which arrives as
  // "the calendar is broken" rather than as a rule.
  //
  // `now` is pinned: a rule about "today" that reads the clock is a test that
  // passes until it is run just before midnight.
  const NOW = new Date('2026-08-10T09:30:00.000Z');
  const TZ = 'Etc/UTC';

  describe('resolveInitialCleaningDays', () => {
    it('applies while the garment has not reached its laundry', () => {
      expect(resolveInitialCleaningDays(3, false)).toBe(3);
      expect(resolveInitialCleaningDays(3, undefined)).toBe(3);
    });

    // The client's carve-out, and the whole reason this is first-time-only.
    it('stops applying the moment the garment IS at the laundry', () => {
      expect(resolveInitialCleaningDays(3, true)).toBeNull();
      expect(resolveInitialCleaningDays(30, true)).toBeNull();
    });

    // `if (onLaundry)` would switch the rule off for any truthy junk. Only a real
    // boolean is custody - the same rule EditListingLaundryPanel applies.
    it.each([['the string "true"', 'true'], ['1', 1], ['an object', {}], ['null', null]])(
      'does not treat %s as "at the laundry"',
      (_label, onLaundry) => {
        expect(resolveInitialCleaningDays(3, onLaundry)).toBe(3);
      }
    );

    // No migration exists and none is needed - per the client, "en producción
    // iniciaremos limpio". Absence is a deliberate no-block, not an oversight.
    it('treats an absent value as no block', () => {
      expect(resolveInitialCleaningDays(undefined, false)).toBeNull();
      // null is what the Marketplace API stores for a deleted extended-data key.
      expect(resolveInitialCleaningDays(null, false)).toBeNull();
    });

    it.each([[0], [-2], [2.5], ['3'], [true], [{}]])(
      'treats the malformed value %p as no block rather than guessing',
      initialCleaningDays => {
        expect(resolveInitialCleaningDays(initialCleaningDays, false)).toBeNull();
      }
    );

    // The LIVE turnaround, fetched at ListingPage load because the number lives in the
    // laundry USER's privateData and the browser cannot read it.
    //
    //   > "si la laundry necesita por ejemplo 2 días para su lavado, la disponibilidad
    //   >  debe estar 2 días despues de hoy"
    //
    // The stored value is only what the laundry's turnaround WAS when it was assigned.
    // initialCleaningAgreement.test.js proves this precedence matches the server gate's
    // over the whole cross product of inputs; these state it locally.
    describe('the live turnaround', () => {
      it('wins over the stored snapshot, in both directions', () => {
        expect(resolveInitialCleaningDays(2, false, 5)).toBe(5);
        expect(resolveInitialCleaningDays(7, false, 2)).toBe(2);
      });

      it('applies to a listing with no snapshot at all', () => {
        // Every garment assigned before the field existed. The live lookup is what gives
        // those a correct floor for the first time.
        expect(resolveInitialCleaningDays(undefined, false, 3)).toBe(3);
      });

      // null is BOTH the initial state and the result of every failure the lookup can
      // have. Falling back to "no block" would let a flaky network offer a garment that
      // has never left its owner's wardrobe.
      it.each([
        ['null', null],
        ['undefined', undefined],
        ['0', 0],
        ['a fraction', 1.5],
        ['a string', '2'],
      ])(
        'falls back to the snapshot, not to "no block", when the live value is %s',
        (_label, live) => {
          expect(resolveInitialCleaningDays(4, false, live)).toBe(4);
        }
      );

      it('is still no block when neither value is usable', () => {
        expect(resolveInitialCleaningDays(undefined, false, null)).toBeNull();
        expect(resolveInitialCleaningDays(0, false, 0)).toBeNull();
      });

      // `onLaundry` is checked first, so the carve-out cannot be undone by a slow studio.
      it('cannot resurrect the rule once the garment is at its laundry', () => {
        expect(resolveInitialCleaningDays(undefined, true, 9)).toBeNull();
        expect(resolveInitialCleaningDays(3, true, 9)).toBeNull();
      });

      it('is clamped, so a fat-fingered profile cannot take a listing off the market', () => {
        expect(resolveInitialCleaningDays(undefined, false, 4000)).toBe(365);
        expect(resolveInitialCleaningDays(4000, false, undefined)).toBe(365);
      });
    });
  });

  describe('earliestBookableDate', () => {
    // NOW is the 10th. Cleaning cannot start today - the garment still has to get to the
    // studio - so it runs 11..13 for a 3-day turnaround and the floor is the 14th.
    //
    // The +1 is the whole point of the one-day case: without it a 1-day turnaround puts the
    // floor on the 11th, which is where it already was (today is unbookable anyway, because
    // the availability slot for the current day starts at the moment of the query). A rule
    // with no observable effect is the bug the client reported.
    it('pushes the floor past the cleaning days, which start tomorrow', () => {
      expect(earliestBookableDate(3, TZ, NOW).toISOString()).toBe('2026-08-14T00:00:00.000Z');
      expect(earliestBookableDate(1, TZ, NOW).toISOString()).toBe('2026-08-12T00:00:00.000Z');
    });

    // The floor is a DAY, not `now` plus n * 24h: 09:30 must not leak into it, or
    // the picker's bound would move with the hour the customer is shopping and could
    // disagree with the server's gate by a whole day.
    it('is a start-of-day, not an offset instant', () => {
      expect(earliestBookableDate(2, TZ, NOW).getUTCHours()).toBe(0);
      expect(earliestBookableDate(2, TZ, new Date('2026-08-10T23:59:00.000Z')).toISOString()).toBe(
        '2026-08-13T00:00:00.000Z'
      );
    });

    it('counts the days in the LISTING time zone', () => {
      // 09:30 UTC on the 10th is 03:30 on the 10th in Mexico City, so two cleaning days
      // starting tomorrow put the floor at midnight on the 13th there - 06:00 UTC.
      expect(earliestBookableDate(2, 'America/Mexico_City', NOW).toISOString()).toBe(
        '2026-08-13T06:00:00.000Z'
      );
    });

    // With no block the picker must take the exact path it took before this feature:
    // the stock floor, start of today.
    it('is the start of today when there is no block at all', () => {
      expect(earliestBookableDate(null, TZ, NOW).toISOString()).toBe('2026-08-10T00:00:00.000Z');
      expect(
        earliestBookableDate(resolveInitialCleaningDays(30, true), TZ, NOW).toISOString()
      ).toBe('2026-08-10T00:00:00.000Z');
      expect(
        earliestBookableDate(resolveInitialCleaningDays(undefined, false), TZ, NOW).toISOString()
      ).toBe('2026-08-10T00:00:00.000Z');
    });

    it('composes with the resolver the way the picker uses them', () => {
      // The pair as the form actually calls them, so the two halves cannot drift.
      const floorFor = (days, onLaundry) =>
        earliestBookableDate(resolveInitialCleaningDays(days, onLaundry), TZ, NOW).toISOString();

      expect(floorFor(5, false)).toBe('2026-08-16T00:00:00.000Z');
      expect(floorFor(5, true)).toBe('2026-08-10T00:00:00.000Z');
      expect(floorFor(2.5, false)).toBe('2026-08-10T00:00:00.000Z');
    });
  });

  describe('isOutsideRangeFn actually applies the floor', () => {
    // `earliestBookableDate` returning the right day is NOT the same claim as the
    // picker refusing the days before it. isOutsideRangeFn holds the module-level
    // TODAY, so these probes are anchored on the real clock rather than on NOW.
    const dayInTz = offset => getStartOf(new Date(), 'day', TZ, offset, 'days');
    // The picker hands its predicate LOCAL dates and the component converts them
    // back; this is that conversion, so the test exercises the same path the
    // calendar does rather than a shortcut past it.
    const probe = (blockDays, offset, readyAt) => {
      const isOutside = isOutsideRangeFn(
        [],
        { [monthIdString(new Date(), TZ)]: { timeSlots: [] } },
        null,
        null,
        LINE_ITEM_DAY,
        90,
        TZ,
        blockDays,
        readyAt
      );
      return isOutside(timeOfDayFromTimeZoneToLocal(dayInTz(offset), TZ));
    };

    it('refuses today and the three cleaning days, and allows the day after them', () => {
      // Cleaning runs on days +1, +2 and +3; the garment is bookable from +4.
      expect(probe(3, 0)).toBe(true);
      expect(probe(3, 1)).toBe(true);
      expect(probe(3, 2)).toBe(true);
      expect(probe(3, 3)).toBe(true);
      expect(probe(3, 4)).toBe(false);
      expect(probe(3, 10)).toBe(false);
    });

    it('leaves tomorrow bookable when there is no block, exactly as upstream', () => {
      // null is what resolveInitialCleaningDays returns for `onLaundry === true` and
      // for a listing with no stored turnaround, so this is the unchanged path.
      expect(probe(null, 0)).toBe(false);
      expect(probe(null, 1)).toBe(false);
      expect(probe(null, -1)).toBe(true);
    });

    it('refuses every day before the wash the garment is in now finishes', () => {
      //   > "esto debe apartar dias para que la prenda vuelva a estar disponible (...) la
      //   >  prenda debe estar disponible el 18, 4 días despues, no antes"
      //
      // `readyAt` reaches the picker with `initialCleaningDays` already null, because a
      // garment can only have one after a studio has taken delivery - and that retires the
      // first-cleaning rule for good. So this is the floor on its own, not on top of one.
      const readyAt = dayInTz(5).toISOString();

      expect(probe(null, 1, readyAt)).toBe(true);
      expect(probe(null, 4, readyAt)).toBe(true);
      expect(probe(null, 5, readyAt)).toBe(false);
      expect(probe(null, 6, readyAt)).toBe(false);
    });

    it('takes whichever of the two cleaning floors is later', () => {
      // They are independent facts and either alone is a reason the garment cannot be handed
      // over, so the picker has to satisfy both rather than the most recently added one.
      const soon = dayInTz(2).toISOString();
      const late = dayInTz(9).toISOString();

      // Initial cleaning binds (floor +4), readiness has already passed it.
      expect(probe(3, 3, soon)).toBe(true);
      expect(probe(3, 4, soon)).toBe(false);

      // Readiness binds (floor +9), well past the initial-cleaning floor.
      expect(probe(3, 4, late)).toBe(true);
      expect(probe(3, 9, late)).toBe(false);
    });

    it('is unmoved by a readiness date that has already passed', () => {
      // `readyAt` is never cleared, so almost every listing that has ever been rented
      // carries a stale one. It must change nothing.
      expect(probe(null, 1, dayInTz(-4).toISOString())).toBe(false);
      expect(probe(null, 0, dayInTz(-4).toISOString())).toBe(false);
    });
  });
});
