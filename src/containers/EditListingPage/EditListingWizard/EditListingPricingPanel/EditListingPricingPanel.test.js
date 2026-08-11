import React from 'react';
import '@testing-library/jest-dom';

import { types as sdkTypes } from '../../../../util/sdkLoader';
import { createOwnListing, fakeIntl } from '../../../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';

import EditListingPricingPanel from './EditListingPricingPanel';

const { Money } = sdkTypes;
const { screen, fireEvent } = testingLibrary;

const SAVE_ACTION_MSG = 'Save price';

// Cocloset's garment rentals are booked in whole days, so the pricing panel takes the
// non-price-variant branch of onSubmit. That branch used to write publicData in one shot.
const GARMENT_RENTAL_TYPE = {
  listingType: 'garment-rental',
  transactionType: {
    process: 'cocloset-booking',
    alias: 'cocloset-booking/release-1',
    unitType: 'day',
  },
};

const UpdatePageTitle = () => null;

const renderPanel = (publicData, onSubmit) => {
  const listing = createOwnListing('listing-1', {
    price: new Money(5500, 'USD'),
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

const minimumBookingDaysField = () =>
  screen.getByRole('spinbutton', { name: 'MinimumBookingDays.label' });

const setMinimumBookingDays = value => {
  const field = minimumBookingDaysField();
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
};

const save = () => fireEvent.click(screen.getByRole('button', { name: SAVE_ACTION_MSG }));

describe('EditListingPricingPanel', () => {
  describe('day-unit listing', () => {
    it('saves minimumBookingDays as a number alongside priceVariationsEnabled', () => {
      const onSubmit = jest.fn();
      renderPanel({}, onSubmit);

      setMinimumBookingDays('3');
      save();

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const updateValues = onSubmit.mock.calls[0][0];
      expect(updateValues.publicData).toEqual({
        priceVariationsEnabled: false,
        minimumBookingDays: 3,
      });
      expect(typeof updateValues.publicData.minimumBookingDays).toEqual('number');
      expect(updateValues.price).toEqual(new Money(5500, 'USD'));
    });

    it('writes no minimumBookingDays key when the field is left blank', () => {
      // An existing listing without the key has to stay untouched: no key, not a 1.
      const onSubmit = jest.fn();
      renderPanel({}, onSubmit);

      save();

      expect(onSubmit).toHaveBeenCalledWith({
        price: new Money(5500, 'USD'),
        publicData: { priceVariationsEnabled: false },
      });
    });

    it('does not save a value the validator rejects', () => {
      const onSubmit = jest.fn();
      renderPanel({}, onSubmit);

      setMinimumBookingDays('0');
      save();

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('shows a stored minimum in the form and keeps it after saving', () => {
      // getInitialValues re-seeds the form from an optimistic listing after each submit,
      // so a field missing from getInitialValues would be wiped from the form here.
      const onSubmit = jest.fn();
      renderPanel({ minimumBookingDays: 4 }, onSubmit);

      expect(minimumBookingDaysField()).toHaveValue(4);

      save();

      expect(onSubmit).toHaveBeenCalledWith({
        price: new Money(5500, 'USD'),
        publicData: { priceVariationsEnabled: false, minimumBookingDays: 4 },
      });
      expect(minimumBookingDaysField()).toHaveValue(4);
    });

    it('clears a stored minimum with null when the field is emptied', () => {
      const onSubmit = jest.fn();
      renderPanel({ minimumBookingDays: 4 }, onSubmit);

      setMinimumBookingDays('');
      save();

      expect(onSubmit).toHaveBeenCalledWith({
        price: new Money(5500, 'USD'),
        publicData: { priceVariationsEnabled: false, minimumBookingDays: null },
      });
    });
  });
});
