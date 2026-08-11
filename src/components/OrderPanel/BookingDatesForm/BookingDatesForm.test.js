import React from 'react';
import '@testing-library/jest-dom';
import Decimal from 'decimal.js';

import { types as sdkTypes } from '../../../util/sdkLoader';
import { renderWithProviders as render, testingLibrary } from '../../../util/testHelpers';

import EstimatedCustomerBreakdownMaybe from '../EstimatedCustomerBreakdownMaybe';
import { resolveMinimumDays, minimumNightsForMinimumDays } from './BookingDatesForm';

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
