import React from 'react';
import '@testing-library/jest-dom';

import { createOwnListing, fakeIntl } from '../../../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';

import EditListingPricingForm from './EditListingPricingForm';
import {
  DEFAULT_MAX_MINIMUM_BOOKING_DAYS,
  MIN_MINIMUM_BOOKING_DAYS,
  getInitialValuesForMinimumBookingDays,
  getMaxMinimumBookingDays,
  handleSubmitValuesForMinimumBookingDays,
} from './MinimumBookingDays';

const { screen, fireEvent } = testingLibrary;

const noop = () => null;

const ENV_VAR = 'REACT_APP_MAX_MINIMUM_BOOKING_DAYS';

const withMaxDays = (value, fn) => {
  const original = process.env[ENV_VAR];
  if (value === undefined) {
    delete process.env[ENV_VAR];
  } else {
    process.env[ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (original === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = original;
    }
  }
};

describe('getMaxMinimumBookingDays()', () => {
  it('defaults to 30 days when the env var is unset', () => {
    expect(DEFAULT_MAX_MINIMUM_BOOKING_DAYS).toEqual(30);
    withMaxDays(undefined, () => {
      expect(getMaxMinimumBookingDays()).toEqual(30);
    });
  });
  it('reads a whole number from the env var', () => {
    withMaxDays('14', () => {
      expect(getMaxMinimumBookingDays()).toEqual(14);
    });
    withMaxDays(' 45 ', () => {
      expect(getMaxMinimumBookingDays()).toEqual(45);
    });
  });
  it('falls back to the default when the env var does not parse', () => {
    // A truncating parse would turn these into 2, 7 and 30 respectively.
    ['', 'many', '2.5', '7 days', '0', '-3'].forEach(value => {
      withMaxDays(value, () => {
        expect(getMaxMinimumBookingDays()).toEqual(DEFAULT_MAX_MINIMUM_BOOKING_DAYS);
      });
    });
  });
});

describe('getInitialValuesForMinimumBookingDays()', () => {
  const listingWith = publicData =>
    createOwnListing('listing-1', { publicData: { unitType: 'day', ...publicData } });

  it('gives no value when the key is absent', () => {
    // Absent means "no minimum". Seeding a 1 here would write a minimum the owner never
    // asked for on the next save of the pricing tab.
    expect(getInitialValuesForMinimumBookingDays({ listing: listingWith({}) })).toEqual({});
  });
  it('gives no value for a listing with no publicData at all', () => {
    expect(getInitialValuesForMinimumBookingDays({})).toEqual({});
    expect(getInitialValuesForMinimumBookingDays({ listing: {} })).toEqual({});
  });
  it('reads a stored number', () => {
    expect(
      getInitialValuesForMinimumBookingDays({ listing: listingWith({ minimumBookingDays: 5 }) })
    ).toEqual({ minimumBookingDays: 5 });
    expect(
      getInitialValuesForMinimumBookingDays({
        listing: listingWith({ minimumBookingDays: MIN_MINIMUM_BOOKING_DAYS }),
      })
    ).toEqual({ minimumBookingDays: 1 });
  });
  it('tolerates a numeric string set outside the wizard, as a number', () => {
    expect(
      getInitialValuesForMinimumBookingDays({ listing: listingWith({ minimumBookingDays: '5' }) })
    ).toEqual({ minimumBookingDays: 5 });
  });
  it('ignores stored values that are not a usable minimum', () => {
    [null, 0, -2, 2.5, 'three', true].forEach(minimumBookingDays => {
      expect(
        getInitialValuesForMinimumBookingDays({ listing: listingWith({ minimumBookingDays }) })
      ).toEqual({});
    });
  });
  it('round-trips a submitted value back into the form', () => {
    // getInitialValues re-seeds the form from the optimistic listing after each submit,
    // so what the submit handler writes has to be readable back.
    const { publicData } = handleSubmitValuesForMinimumBookingDays({ minimumBookingDays: '4' }, {});
    expect(getInitialValuesForMinimumBookingDays({ listing: listingWith(publicData) })).toEqual({
      minimumBookingDays: 4,
    });
  });
});

describe('handleSubmitValuesForMinimumBookingDays()', () => {
  it('stores the value as a number, not a string', () => {
    const result = handleSubmitValuesForMinimumBookingDays({ minimumBookingDays: '3' }, {});
    expect(result).toEqual({ publicData: { minimumBookingDays: 3 } });
    expect(typeof result.publicData.minimumBookingDays).toEqual('number');
  });
  it('keeps the publicData updates it is handed', () => {
    expect(
      handleSubmitValuesForMinimumBookingDays(
        { minimumBookingDays: 3 },
        {
          priceVariationsEnabled: false,
        }
      )
    ).toEqual({ publicData: { priceVariationsEnabled: false, minimumBookingDays: 3 } });
  });
  it('writes nothing for a blank field on a listing that has no minimum', () => {
    ['', '   ', null, undefined].forEach(minimumBookingDays => {
      expect(
        handleSubmitValuesForMinimumBookingDays({ minimumBookingDays }, {}, { unitType: 'day' })
      ).toEqual({ publicData: {} });
    });
    expect(handleSubmitValuesForMinimumBookingDays({}, {}, {})).toEqual({ publicData: {} });
  });
  it('clears a stored minimum with null when the field is emptied', () => {
    // null is how the Marketplace API removes an extended data key.
    expect(
      handleSubmitValuesForMinimumBookingDays(
        { minimumBookingDays: '' },
        {},
        { minimumBookingDays: 5 }
      )
    ).toEqual({ publicData: { minimumBookingDays: null } });
  });
  it('drops out-of-range and non-integer values rather than clamping or rounding them', () => {
    withMaxDays('30', () => {
      ['0', '-1', '31', '2.5', 'three'].forEach(minimumBookingDays => {
        expect(handleSubmitValuesForMinimumBookingDays({ minimumBookingDays }, {})).toEqual({
          publicData: {},
        });
      });
    });
  });
  it('respects the env-configured bound', () => {
    withMaxDays('7', () => {
      expect(handleSubmitValuesForMinimumBookingDays({ minimumBookingDays: '7' }, {})).toEqual({
        publicData: { minimumBookingDays: 7 },
      });
      expect(handleSubmitValuesForMinimumBookingDays({ minimumBookingDays: '8' }, {})).toEqual({
        publicData: {},
      });
    });
  });
});

describe('MinimumBookingDays field in the pricing form', () => {
  const renderForm = (props = {}) =>
    render(
      <EditListingPricingForm
        intl={fakeIntl}
        dispatch={noop}
        onSubmit={v => v}
        marketplaceCurrency="USD"
        unitType="day"
        listingTypeConfig={{ transactionType: { process: 'cocloset-booking' } }}
        listingMinimumPriceSubUnits={0}
        saveActionMsg="Save price"
        updated={false}
        updateInProgress={false}
        disabled={false}
        ready={false}
        {...props}
      />
    );

  const getField = () => screen.getByRole('spinbutton', { name: 'MinimumBookingDays.label' });

  // fireEvent rather than userEvent: userEvent types a number input one character at a
  // time, and the intermediate "2." is not a value a number input will hold, so "2.5"
  // would never reach the validator.
  const enterValue = value => {
    const field = getField();
    fireEvent.change(field, { target: { value } });
    fireEvent.blur(field);
  };

  const errorFor = suffix => screen.queryByText(`MinimumBookingDays.${suffix}`);

  it('is shown for a day-based booking listing', () => {
    renderForm();
    expect(getField()).toBeInTheDocument();
  });

  it('is not shown for a listing that is not booked in days', () => {
    renderForm({
      unitType: 'item',
      listingTypeConfig: { transactionType: { process: 'default-purchase' } },
    });
    expect(
      screen.queryByRole('spinbutton', { name: 'MinimumBookingDays.label' })
    ).not.toBeInTheDocument();
  });

  it('accepts the boundaries of the range and rejects everything outside it', () => {
    renderForm();

    // Blank – the field is optional, absent means no minimum.
    enterValue('');
    expect(errorFor('tooSmall')).not.toBeInTheDocument();
    expect(errorFor('notAnInteger')).not.toBeInTheDocument();
    expect(errorFor('tooBig')).not.toBeInTheDocument();

    // 0 is below the minimum of 1.
    enterValue('0');
    expect(errorFor('tooSmall')).toBeInTheDocument();

    // 1 is the smallest accepted value.
    enterValue('1');
    expect(errorFor('tooSmall')).not.toBeInTheDocument();

    // A decimal is rejected, not rounded.
    enterValue('2.5');
    expect(errorFor('notAnInteger')).toBeInTheDocument();

    // The default max is accepted, one more than it is not.
    enterValue(`${DEFAULT_MAX_MINIMUM_BOOKING_DAYS}`);
    expect(errorFor('tooBig')).not.toBeInTheDocument();

    enterValue(`${DEFAULT_MAX_MINIMUM_BOOKING_DAYS + 1}`);
    expect(errorFor('tooBig')).toBeInTheDocument();
  });
});
