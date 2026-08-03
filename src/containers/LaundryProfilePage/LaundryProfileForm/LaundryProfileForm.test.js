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

// ── PER-CATEGORY PRICING ─────────────────────────────────────────────────────
// Turnaround is configured per TOP-LEVEL category, price on any accepted node. The
// tests below query by input id rather than accessible name: every price box shares
// one visible label, and the per-row aria-label uses an ICU placeholder that the test
// IntlProvider (which has no messages) renders as the bare key.
describe('LaundryProfileForm per-category pricing', () => {
  const fieldId = name => `LaundryProfileForm.categoryPricing__${name}`;
  const priceInput = categoryId => document.getElementById(fieldId(`cleaningFee__${categoryId}`));
  const hoursInput = categoryId =>
    document.getElementById(fieldId(`turnaroundHours__${categoryId}`));

  const renderForm = (initialValues, extraProps = {}) =>
    act(async () => {
      render(
        <LaundryProfileForm
          intl={fakeIntl}
          dispatch={noop}
          onSubmit={noop}
          updateInProgress={false}
          initialValues={initialValues}
          {...extraProps}
        />,
        { config: configWithCategories }
      );
    });

  it('renders a price box for every accepted category and hours for the top level only', async () => {
    await renderForm({ acceptedCategories: ['dresses', 'midi_dress'] });

    expect(priceInput('dresses')).toBeInTheDocument();
    expect(priceInput('midi_dress')).toBeInTheDocument();
    // Hours are "por categoría grande" — a subcategory must NOT get one, because a
    // value stored there is never read when the availability buffer is sized.
    expect(hoursInput('dresses')).toBeInTheDocument();
    expect(hoursInput('midi_dress')).toBeNull();
    // A category the studio does not accept gets no row at all.
    expect(priceInput('pants')).toBeNull();
    expect(hoursInput('pants')).toBeNull();
  });

  it('renders the top-level hours box even when only a subcategory is accepted', async () => {
    // A midi-dress listing resolves its turnaround from `dresses` whether or not the
    // studio ticked `dresses`. Without this input there is no way to set the number
    // the buffer actually reads.
    await renderForm({ acceptedCategories: ['midi_dress'] });

    expect(hoursInput('dresses')).toBeInTheDocument();
    expect(priceInput('midi_dress')).toBeInTheDocument();
    expect(priceInput('dresses')).toBeNull();
  });

  it('explains itself instead of rendering an empty grid when nothing is accepted', async () => {
    await renderForm({ acceptedCategories: [] });

    expect(screen.getByText('LaundryProfileForm.categoryPricingEmpty')).toBeInTheDocument();
  });

  it('adds a price box as soon as a category is ticked, without a save first', async () => {
    const user = userEvent.setup();
    await renderForm({ acceptedCategories: [] });

    expect(priceInput('pants')).toBeNull();

    await act(async () => {
      await user.click(screen.getByRole('checkbox', { name: 'Pants' }));
    });

    expect(priceInput('pants')).toBeInTheDocument();
  });

  it('prefills the stored per-category values', async () => {
    await renderForm({
      acceptedCategories: ['dresses', 'midi_dress'],
      categoryPricing__turnaroundHours__dresses: 72,
      categoryPricing__cleaningFee__dresses: 15,
      categoryPricing__cleaningFee__midi_dress: 22,
    });

    expect(hoursInput('dresses')).toHaveValue(72);
    expect(priceInput('dresses')).toHaveValue(15);
    expect(priceInput('midi_dress')).toHaveValue(22);
  });

  it('says which boxes fall back to the studio-wide value, and stops saying it once filled', async () => {
    // A grid of blank boxes is ambiguous: a studio cannot tell "not configured" apart
    // from "configured to nothing", and the number that will really be charged is
    // invisible. The hint is the answer, and it must not linger as noise.
    const user = userEvent.setup();
    await renderForm({
      acceptedCategories: ['dresses'],
      turnaroundHours: 48,
      cleaningFee: 12,
    });

    expect(screen.getAllByText('LaundryProfileForm.pricingFallbackHours').length).toBe(1);
    expect(screen.getAllByText('LaundryProfileForm.pricingFallbackFee').length).toBe(1);

    await act(async () => {
      await user.type(priceInput('dresses'), '15');
    });

    expect(screen.queryByText('LaundryProfileForm.pricingFallbackFee')).not.toBeInTheDocument();
    // The untouched turnaround box still says it is falling back.
    expect(screen.getByText('LaundryProfileForm.pricingFallbackHours')).toBeInTheDocument();
  });

  it('warns when there is no studio-wide value to fall back TO', async () => {
    // Blank category box + blank studio default means the server env default decides
    // the charge — a number nobody in this UI can see. Saying "Studio default: " with
    // nothing after it would be worse than useless.
    await renderForm({ acceptedCategories: ['dresses'] });

    expect(screen.getAllByText('LaundryProfileForm.pricingFallbackUnset').length).toBe(2);
  });

  it('surfaces stored pricing for a category the studio no longer accepts', async () => {
    // Values are retained rather than pruned when a category is un-ticked (see
    // server/api-util/categoryPricing.js). Retained-but-invisible money is how a
    // mispriced studio goes unnoticed, so it has to be shown and clearable.
    await renderForm({
      acceptedCategories: ['pants'],
      categoryPricing__cleaningFee__midi_dress: 22,
    });

    expect(screen.getByText('LaundryProfileForm.categoryPricingOrphanedNote')).toBeInTheDocument();
    expect(screen.getByText('Dresses › Midi Dress')).toBeInTheDocument();
  });

  it('shows no orphan notice when every stored value has a visible box', async () => {
    await renderForm({
      acceptedCategories: ['midi_dress'],
      categoryPricing__cleaningFee__midi_dress: 22,
    });

    expect(
      screen.queryByText('LaundryProfileForm.categoryPricingOrphanedNote')
    ).not.toBeInTheDocument();
  });
});
