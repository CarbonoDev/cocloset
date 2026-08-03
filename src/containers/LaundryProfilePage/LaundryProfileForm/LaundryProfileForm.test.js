import React, { act } from 'react';
import '@testing-library/jest-dom';

import { types as sdkTypes } from '../../../util/sdkLoader';
import { fakeIntl } from '../../../util/testData';
import {
  getHostedConfiguration,
  renderWithProviders as render,
  testingLibrary,
} from '../../../util/testHelpers';

import LaundryProfileForm from './LaundryProfileForm';

const { screen, userEvent } = testingLibrary;
const { LatLng } = sdkTypes;

const noop = () => null;

// Console-shaped category tree: a branch with children (one of which has no
// `subcategories` key at all) plus a childless top-level category.
const CATEGORIES = [
  {
    name: 'Dresses',
    id: 'dresses',
    subcategories: [
      { name: 'Maxi Dress', id: 'maxi_dress' },
      { name: 'Midi Dress', id: 'midi_dress' },
    ],
  },
  { name: 'Pants', id: 'pants' },
];

const configWithCategories = {
  ...getHostedConfiguration(),
  categories: { categories: CATEGORIES },
};

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
        />,
        { config: configWithCategories }
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
    // Accepted categories is a multi-select over Console's category tree, not a
    // free-text box: every option comes from the tree, so a value that no listing
    // could ever carry can't be entered.
    expect(
      screen.getByRole('group', { name: 'LaundryProfileForm.acceptedCategoriesLabel' })
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Dresses' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Maxi Dress' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Midi Dress' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Pants' })).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: 'LaundryProfileForm.acceptedCategoriesLabel' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' })
    ).toBeInTheDocument();
  });

  it('explains itself instead of rendering an empty fieldset when Console has no categories', async () => {
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

    expect(screen.getByText('LaundryProfileForm.acceptedCategoriesEmpty')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('prefills fields from initialValues and keeps the submit button disabled when pristine', async () => {
    const initialValues = {
      studioName: 'Studio Pigalle',
      businessHours: 'Mon–Sat · 11:00–21:00',
      turnaroundHours: 48,
      cleaningFee: 12,
      // Mixed on purpose: a Console id the picker knows plus a free-text value left
      // over from the old comma-separated field.
      acceptedCategories: ['dresses', 'Eveningwear'],
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
        />,
        { config: configWithCategories }
      );
    });

    expect(screen.getByRole('textbox', { name: 'LaundryProfileForm.studioNameLabel' })).toHaveValue(
      'Studio Pigalle'
    );
    expect(
      screen.getByRole('spinbutton', { name: 'LaundryProfileForm.turnaroundHoursLabel' })
    ).toHaveValue(48);
    expect(screen.getByRole('checkbox', { name: 'Dresses' })).toBeChecked();
    // The unrecognised value is shown, not dropped and not silently re-tickable.
    expect(screen.getByText('LaundryProfileForm.acceptedCategoriesLegacyNote')).toBeInTheDocument();
    expect(screen.getByText('Eveningwear')).toBeInTheDocument();

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
      acceptedCategories: ['dresses'],
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
        />,
        { config: configWithCategories }
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
