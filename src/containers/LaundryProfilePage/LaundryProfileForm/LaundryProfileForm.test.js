import React, { act } from 'react';
import '@testing-library/jest-dom';

import { types as sdkTypes } from '../../../util/sdkLoader';
import { fakeIntl } from '../../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../../util/testHelpers';

import LaundryProfileForm from './LaundryProfileForm';

const { screen, userEvent } = testingLibrary;
const { LatLng } = sdkTypes;

const noop = () => null;

beforeAll(() => {
  // Mock window.scroll - otherwise, Jest/JSDOM will print a not-implemented error.
  window.mapboxgl = { accessToken: 'test' };
  window.mapboxSdk = () => ({
    geocoding: {
      forwardGeocode: () => ({
        send: () =>
          Promise.resolve({
            body: { features: [] },
          }),
      }),
    },
  });
});

describe('LaundryProfileForm', () => {
  it('shows the fields for the laundry studio profile', async () => {
    await act(async () => {
      render(
        <LaundryProfileForm
          intl={fakeIntl}
          dispatch={noop}
          onSubmit={noop}
          updateInProgress={false}
        />
      );
    });

    expect(
      screen.getByRole('textbox', { name: 'LaundryProfileForm.studioNameLabel' })
    ).toBeInTheDocument();
    expect(screen.getByText('LaundryProfileForm.addressLabel')).toBeInTheDocument();
    expect(screen.getByTestId('location-search')).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'LaundryProfileForm.businessHoursLabel' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('spinbutton', { name: 'LaundryProfileForm.turnaroundHoursLabel' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('spinbutton', { name: 'LaundryProfileForm.cleaningFeeLabel' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'LaundryProfileForm.acceptedCategoriesLabel' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' })
    ).toBeInTheDocument();
  });

  it('prefills fields from initialValues and keeps the submit button disabled when pristine', async () => {
    const initialValues = {
      studioName: 'Studio Pigalle',
      businessHours: 'Mon–Sat · 11:00–21:00',
      turnaroundHours: 48,
      cleaningFee: 12,
      acceptedCategories: 'Eveningwear, Sequins, Embroidery',
      location: {
        search: '21 Rue Frochot, Paris',
        selectedPlace: { address: '21 Rue Frochot, Paris', origin: new LatLng(48.88, 2.34) },
      },
    };

    await act(async () => {
      render(
        <LaundryProfileForm
          intl={fakeIntl}
          dispatch={noop}
          onSubmit={noop}
          updateInProgress={false}
          initialValues={initialValues}
        />
      );
    });

    expect(screen.getByRole('textbox', { name: 'LaundryProfileForm.studioNameLabel' })).toHaveValue(
      'Studio Pigalle'
    );
    expect(
      screen.getByRole('spinbutton', { name: 'LaundryProfileForm.turnaroundHoursLabel' })
    ).toHaveValue(48);
    expect(
      screen.getByRole('textbox', { name: 'LaundryProfileForm.acceptedCategoriesLabel' })
    ).toHaveValue('Eveningwear, Sequins, Embroidery');

    // Form is pristine (no edits yet), so the save button should be disabled.
    expect(screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' })).toBeDisabled();
  });

  it('enables the submit button once a required field is edited', async () => {
    const user = userEvent.setup();
    const initialValues = {
      studioName: 'Studio Pigalle',
      businessHours: 'Mon–Sat · 11:00–21:00',
      turnaroundHours: 48,
      cleaningFee: 12,
      acceptedCategories: 'Eveningwear',
      location: {
        search: '21 Rue Frochot, Paris',
        selectedPlace: { address: '21 Rue Frochot, Paris', origin: new LatLng(48.88, 2.34) },
      },
    };

    await act(async () => {
      render(
        <LaundryProfileForm
          intl={fakeIntl}
          dispatch={noop}
          onSubmit={noop}
          updateInProgress={false}
          initialValues={initialValues}
        />
      );
    });

    const studioNameInput = screen.getByRole('textbox', {
      name: 'LaundryProfileForm.studioNameLabel',
    });
    await user.type(studioNameInput, ' Updated');

    expect(
      screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' })
    ).not.toBeDisabled();
  });
});
