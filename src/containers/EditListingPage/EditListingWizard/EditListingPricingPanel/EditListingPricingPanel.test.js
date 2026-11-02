import React from 'react';
import '@testing-library/jest-dom';

import { types as sdkTypes } from '../../../../util/sdkLoader';
import { createOwnListing, fakeIntl } from '../../../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';

import EditListingPricingPanel from './EditListingPricingPanel';
import { rentalPeriodFieldName } from './RentalPeriodPrices';

const { Money } = sdkTypes;
const { screen, fireEvent } = testingLibrary;

const SAVE_ACTION_MSG = 'Save price';

// Cocloset's garment rentals are booked for fixed periods of whole days, so the pricing
// panel takes the rental-period branch of onSubmit rather than either stock branch.
const GARMENT_RENTAL_TYPE = {
  listingType: 'garment-rental',
  transactionType: {
    process: 'cocloset-booking',
    alias: 'cocloset-booking/release-1',
    unitType: 'day',
  },
};

const UpdatePageTitle = () => null;

const renderPanel = (publicData, onSubmit, price = new Money(5500, 'USD')) => {
  const listing = createOwnListing('listing-1', {
    price,
    publicData: { listingType: 'garment-rental', unitType: 'day', ...publicData },
  });

  return render(
    <EditListingPricingPanel
      intl={fakeIntl}
      listing={listing}
      listingTypes={[GARMENT_RENTAL_TYPE]}
      marketplaceCurrency="USD"
      listingMinimumPriceSubUnits={0}
      disabled={false}
      ready={false}
      onSubmit={onSubmit}
      submitButtonText={SAVE_ACTION_MSG}
      panelUpdated={false}
      updateInProgress={false}
      errors={{}}
      updatePageTitle={UpdatePageTitle}
    />
  );
};

// Located by id rather than by accessible name: both fields carry the SAME rendered label
// under fakeIntl (which returns the message id, not the interpolated string), so a
// name-based query cannot tell the 7-day field from the 14-day one.
const priceField = days =>
  document.getElementById(`EditListingPricingForm_${rentalPeriodFieldName(days)}`);

const setPrice = (days, value) => {
  const field = priceField(days);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
};

const save = () => fireEvent.click(screen.getByRole('button', { name: SAVE_ACTION_MSG }));

describe('EditListingPricingPanel', () => {
  describe('fixed rental periods', () => {
    it('renders one price field per offered period and no single price field', () => {
      renderPanel({}, jest.fn());

      expect(priceField(7)).toBeInTheDocument();
      expect(priceField(14)).toBeInTheDocument();
      // The stock single-price input would have carried this id.
      expect(document.getElementById('EditListingPricingFormprice')).toBeNull();
    });

    it('saves both periods as priceVariants, with listing.price set to the cheapest', () => {
      const onSubmit = jest.fn();
      renderPanel({}, onSubmit);

      setPrice(7, '100');
      setPrice(14, '180');
      save();

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({
        // The cheapest of the two, which is what search cards render as "From ...".
        price: new Money(10000, 'USD'),
        publicData: {
          priceVariationsEnabled: true,
          priceVariants: [
            { name: '7-days', bookingLengthInDays: 7, priceInSubunits: 10000 },
            { name: '14-days', bookingLengthInDays: 14, priceInSubunits: 18000 },
          ],
        },
      });
    });

    it('does not submit while a period has no price', () => {
      // "los precios nuevos son obligatorios" - a listing priced for one period only would
      // render a chip the customer cannot use.
      const onSubmit = jest.fn();
      renderPanel({}, onSubmit);

      setPrice(7, '100');
      save();

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('seeds stored periods into the form and keeps them after saving', () => {
      // getInitialValues re-seeds the form from an optimistic listing after each submit, so
      // a value missing from getInitialValues would be wiped from the form here.
      const onSubmit = jest.fn();
      renderPanel(
        {
          priceVariationsEnabled: true,
          priceVariants: [
            { name: '7-days', bookingLengthInDays: 7, priceInSubunits: 12000 },
            { name: '14-days', bookingLengthInDays: 14, priceInSubunits: 20000 },
          ],
        },
        onSubmit,
        new Money(12000, 'USD')
      );

      expect(priceField(7)).toHaveValue('$120.00');
      expect(priceField(14)).toHaveValue('$200.00');

      save();

      expect(onSubmit).toHaveBeenCalledWith({
        price: new Money(12000, 'USD'),
        publicData: {
          priceVariationsEnabled: true,
          priceVariants: [
            { name: '7-days', bookingLengthInDays: 7, priceInSubunits: 12000 },
            { name: '14-days', bookingLengthInDays: 14, priceInSubunits: 20000 },
          ],
        },
      });
      expect(priceField(7)).toHaveValue('$120.00');
    });

    it('offers no minimum rental length field', () => {
      // The minimum is now the period itself; the old field would store a number nothing
      // reads. Asserted rather than assumed, because the field's absence is the feature.
      renderPanel({}, jest.fn());

      expect(screen.queryByRole('spinbutton')).toBeNull();
    });
  });
});
