import React from 'react';
import '@testing-library/jest-dom';
import Decimal from 'decimal.js';

import { types as sdkTypes } from '../../../util/sdkLoader';
import { getStartOf, monthIdString, timeOfDayFromTimeZoneToLocal } from '../../../util/dates';
import { LINE_ITEM_DAY } from '../../../util/types';
import { renderWithProviders as render, testingLibrary } from '../../../util/testHelpers';

import EstimatedCustomerBreakdownMaybe from '../EstimatedCustomerBreakdownMaybe';
import {
  resolveMinimumDays,
  minimumNightsForMinimumDays,
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

describe('the minimum rental length, in days, becomes the picker floor, in nights', () => {
  // The picker holds an INCLUSIVE end date for daily bookings, so these two
  // numbers are deliberately different. Asserting the mapping directly is the
  // point: an off-by-one here blocks the shortest booking the owner allows, and
  // presents as a broken calendar rather than as a rule.
  it('maps an n-day minimum onto an (n-1)-night floor', () => {
    expect(minimumNightsForMinimumDays(resolveMinimumDays(3, true))).toBe(2);
    expect(minimumNightsForMinimumDays(resolveMinimumDays(2, true))).toBe(1);
    expect(minimumNightsForMinimumDays(resolveMinimumDays(30, true))).toBe(29);
  });

  it('leaves the picker default alone when the listing sets no real minimum', () => {
    // undefined means "do not override", so a 1-day minimum keeps the stock
    // behaviour of allowing single-day bookings.
    expect(minimumNightsForMinimumDays(resolveMinimumDays(1, true))).toBeUndefined();
    expect(minimumNightsForMinimumDays(resolveMinimumDays(0, true))).toBeUndefined();
    expect(minimumNightsForMinimumDays(resolveMinimumDays(undefined, true))).toBeUndefined();
    // null is what the wizard writes when an owner clears the field.
    expect(minimumNightsForMinimumDays(resolveMinimumDays(null, true))).toBeUndefined();
    expect(minimumNightsForMinimumDays(resolveMinimumDays(2.5, true))).toBeUndefined();
    expect(minimumNightsForMinimumDays(resolveMinimumDays('3', true))).toBeUndefined();
  });

  it('ignores the minimum entirely for a non-daily booking', () => {
    expect(resolveMinimumDays(3, false)).toBeNull();
    expect(minimumNightsForMinimumDays(resolveMinimumDays(3, false))).toBeUndefined();
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
  });

  describe('earliestBookableDate', () => {
    it('pushes the floor forward by whole days when the block applies', () => {
      expect(earliestBookableDate(3, TZ, NOW).toISOString()).toBe('2026-08-13T00:00:00.000Z');
      expect(earliestBookableDate(1, TZ, NOW).toISOString()).toBe('2026-08-11T00:00:00.000Z');
    });

    // The floor is a DAY, not `now` plus n * 24h: 09:30 must not leak into it, or
    // the picker's bound would move with the hour the customer is shopping and could
    // disagree with the server's gate by a whole day.
    it('is a start-of-day, not an offset instant', () => {
      expect(earliestBookableDate(2, TZ, NOW).getUTCHours()).toBe(0);
      expect(earliestBookableDate(2, TZ, new Date('2026-08-10T23:59:00.000Z')).toISOString()).toBe(
        '2026-08-12T00:00:00.000Z'
      );
    });

    it('counts the days in the LISTING time zone', () => {
      // 09:30 UTC on the 10th is 03:30 on the 10th in Mexico City, so +2 days is
      // midnight on the 12th there - 06:00 UTC.
      expect(earliestBookableDate(2, 'America/Mexico_City', NOW).toISOString()).toBe(
        '2026-08-12T06:00:00.000Z'
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

      expect(floorFor(5, false)).toBe('2026-08-15T00:00:00.000Z');
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
    const probe = (blockDays, offset) => {
      const isOutside = isOutsideRangeFn(
        [],
        { [monthIdString(new Date(), TZ)]: { timeSlots: [] } },
        null,
        null,
        LINE_ITEM_DAY,
        90,
        TZ,
        blockDays
      );
      return isOutside(timeOfDayFromTimeZoneToLocal(dayInTz(offset), TZ));
    };

    it('refuses today and tomorrow, and allows the boundary day, for a 3-day block', () => {
      expect(probe(3, 0)).toBe(true);
      expect(probe(3, 1)).toBe(true);
      expect(probe(3, 2)).toBe(true);
      expect(probe(3, 3)).toBe(false);
      expect(probe(3, 10)).toBe(false);
    });

    it('leaves tomorrow bookable when there is no block, exactly as upstream', () => {
      // null is what resolveInitialCleaningDays returns for `onLaundry === true` and
      // for a listing with no stored turnaround, so this is the unchanged path.
      expect(probe(null, 0)).toBe(false);
      expect(probe(null, 1)).toBe(false);
      expect(probe(null, -1)).toBe(true);
    });
  });
});
