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
    // Opening hours is a row per day now, not one free-text line - see
    // util/businessHours.js. Seven checkboxes, and two time inputs on each row.
    expect(screen.getByText('LaundryProfileForm.businessHoursLabel')).toBeInTheDocument();
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(day => {
      expect(
        screen.getByRole('checkbox', { name: `LaundryProfileForm.day.${day}` })
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole('spinbutton', { name: 'LaundryProfileForm.turnaroundDaysLabel' })
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

  it('collects NO cleaning fee, studio-wide or per category', async () => {
    // The fee is marketplace-level env configuration now (CLEANING_FEE_<CATEGORY_ID>).
    // The input has to be gone, not merely unused: a studio typing a number that no
    // longer prices anything is worse than no field.
    await act(async () => {
      render(
        <LaundryProfileForm
          intl={fakeIntl}
          dispatch={noop}
          onSubmit={noop}
          updateInProgress={false}
          initialValues={{ acceptedCategories: ['dresses', 'midi_dress'] }}
        />,
        { config: configWithCategories }
      );
    });

    expect(
      screen.queryByRole('spinbutton', { name: 'LaundryProfileForm.cleaningFeeLabel' })
    ).not.toBeInTheDocument();
    expect(document.getElementById('LaundryProfileForm.cleaningFee')).toBeNull();
    expect(
      document.getElementById('LaundryProfileForm.categoryPricing__cleaningFee__dresses')
    ).toBeNull();
    expect(
      document.getElementById('LaundryProfileForm.categoryPricing__cleaningFee__midi_dress')
    ).toBeNull();
    // And no separate pricing section survives either.
    expect(screen.queryByText('LaundryProfileForm.categoryPricingLabel')).not.toBeInTheDocument();
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
    // No CATEGORY checkbox. The seven opening-hours ones are a different fieldset and are
    // always there, so this asserts the absence by name rather than by role alone.
    expect(
      screen.queryByRole('checkbox', { name: 'LaundryProfileForm.acceptedCategoriesLabel' })
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(7);
  });

  it('prefills fields from initialValues and keeps the submit button disabled when pristine', async () => {
    const initialValues = {
      studioName: 'Studio Pigalle',
      businessHours: 'Mon–Sat · 11:00–21:00',
      turnaroundDays: 2,
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
      screen.getByRole('spinbutton', { name: 'LaundryProfileForm.turnaroundDaysLabel' })
    ).toHaveValue(2);
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
      turnaroundDays: 2,
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

// ── ONE TABLE: ACCEPT + TURNAROUND PER CATEGORY ──────────────────────────────
// The accept checkbox and the turnaround-days input are on the SAME row now, per the
// client ("es mejor si lo dejamos en la misma tabla que selecciona las categorias, no en
// una sección mas abajo"). Turnaround is configured per TOP-LEVEL category only.
//
// The tests below query the turnaround inputs by input id rather than accessible name:
// every one of them shares one visible label, and the per-row aria-label uses an ICU
// placeholder that the test IntlProvider (which has no messages) renders as the bare key.
describe('LaundryProfileForm category table', () => {
  const daysInput = categoryId =>
    document.getElementById(`LaundryProfileForm.categoryPricing__turnaroundDays__${categoryId}`);

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

  it('puts the turnaround input on the same row as its category', async () => {
    await renderForm({ acceptedCategories: ['dresses'] });

    const checkbox = screen.getByRole('checkbox', { name: 'Dresses' });
    const row = checkbox.closest('li');
    // Same row, not a separate section further down the form: this is the whole point of
    // the change, so assert the DOM relationship rather than mere co-existence.
    expect(row).toContainElement(daysInput('dresses'));
  });

  it('renders a turnaround input for top-level categories ONLY', async () => {
    await renderForm({ acceptedCategories: ['dresses', 'midi_dress'] });

    expect(daysInput('dresses')).toBeInTheDocument();
    // Turnaround is "por categoría grande" — a subcategory must NOT get an input,
    // because a value stored there is never read when the availability buffer is sized,
    // so the control would silently do nothing.
    expect(daysInput('midi_dress')).toBeNull();
    expect(daysInput('maxi_dress')).toBeNull();
  });

  it('lists every category as a row, even ones the studio does not accept', async () => {
    // The table IS the picker, so every category must appear whether or not it is
    // accepted. Only the turnaround input is conditional.
    await renderForm({ acceptedCategories: ['dresses'] });

    expect(screen.getByRole('checkbox', { name: 'Pants' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Pants' })).not.toBeChecked();
    expect(daysInput('pants')).toBeNull();
  });

  it('renders the top-level input even when only a subcategory is accepted', async () => {
    // A midi-dress listing resolves its turnaround from `dresses` whether or not the
    // studio ticked `dresses`. Without this input there is no way to set the number the
    // buffer actually reads.
    await renderForm({ acceptedCategories: ['midi_dress'] });

    expect(daysInput('dresses')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Midi Dress' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Dresses' })).not.toBeChecked();
  });

  it('adds the turnaround input as soon as a category is ticked, without a save first', async () => {
    const user = userEvent.setup();
    await renderForm({ acceptedCategories: [] });

    expect(daysInput('pants')).toBeNull();

    await act(async () => {
      await user.click(screen.getByRole('checkbox', { name: 'Pants' }));
    });

    expect(daysInput('pants')).toBeInTheDocument();
  });

  it('ticking a parent accepts the branch without ticking every child', async () => {
    // The parent-match semantics the resolution rule relies on (see
    // isCategoryAcceptedByLaundry): the value written is just the parent id.
    const user = userEvent.setup();
    const submitted = [];
    await renderForm(
      {
        studioName: 'Studio Pigalle',
        businessHours: 'Mon–Sat',
        turnaroundDays: 2,
        acceptedCategories: [],
        location: {
          search: '21 Rue Frochot, Paris',
          selectedPlace: { address: '21 Rue Frochot, Paris', origin: new LatLng(48.88, 2.34) },
        },
      },
      { onSubmit: values => submitted.push(values) }
    );

    await act(async () => {
      await user.click(screen.getByRole('checkbox', { name: 'Dresses' }));
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' }));
    });

    expect(submitted[0].acceptedCategories).toEqual(['dresses']);
    expect(screen.getByRole('checkbox', { name: 'Midi Dress' })).not.toBeChecked();
  });

  it('un-ticking removes only that id and leaves legacy free text alone', async () => {
    const user = userEvent.setup();
    const submitted = [];
    await renderForm(
      {
        studioName: 'Studio Pigalle',
        businessHours: 'Mon–Sat',
        turnaroundDays: 2,
        acceptedCategories: ['dresses', 'pants', 'Eveningwear'],
        location: {
          search: '21 Rue Frochot, Paris',
          selectedPlace: { address: '21 Rue Frochot, Paris', origin: new LatLng(48.88, 2.34) },
        },
      },
      { onSubmit: values => submitted.push(values) }
    );

    await act(async () => {
      await user.click(screen.getByRole('checkbox', { name: 'Pants' }));
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' }));
    });

    expect(submitted[0].acceptedCategories).toEqual(['dresses', 'Eveningwear']);
  });

  it('removes a legacy free-text value on request', async () => {
    const user = userEvent.setup();
    await renderForm({ acceptedCategories: ['dresses', 'Eveningwear'] });

    expect(screen.getByText('Eveningwear')).toBeInTheDocument();

    await act(async () => {
      await user.click(
        screen.getByRole('button', { name: 'LaundryProfileForm.acceptedCategoriesLegacyRemove' })
      );
    });

    expect(screen.queryByText('Eveningwear')).not.toBeInTheDocument();
  });

  it('names the category in each input aria-label, since the visible label repeats', async () => {
    // The visible label is identical on every row and conveys the category only by
    // visual proximity, which tells a screen reader user nothing about which garment
    // they are on.
    await renderForm({ acceptedCategories: ['dresses', 'pants'] });

    expect(daysInput('dresses')).toHaveAttribute('aria-label');
    expect(daysInput('pants')).toHaveAttribute('aria-label');
  });

  it('prefills the stored per-category values', async () => {
    await renderForm({
      acceptedCategories: ['dresses', 'pants'],
      categoryPricing__turnaroundDays__dresses: 3,
      categoryPricing__turnaroundDays__pants: 1,
    });

    expect(daysInput('dresses')).toHaveValue(3);
    expect(daysInput('pants')).toHaveValue(1);
  });

  it('says which boxes fall back to the studio-wide value, and stops saying it once filled', async () => {
    // A column of blank boxes is ambiguous: a studio cannot tell "not configured" apart
    // from "configured to nothing", and the number that will really be used is invisible.
    // The hint is the answer, and it must not linger as noise.
    const user = userEvent.setup();
    await renderForm({
      acceptedCategories: ['dresses'],
      turnaroundDays: 2,
    });

    expect(screen.getAllByText('LaundryProfileForm.pricingFallbackDays').length).toBe(1);

    await act(async () => {
      await user.type(daysInput('dresses'), '3');
    });

    expect(screen.queryByText('LaundryProfileForm.pricingFallbackDays')).not.toBeInTheDocument();
  });

  it('warns when there is no studio-wide value to fall back TO', async () => {
    // Blank category box + blank studio default means the server env default decides the
    // window — a number nobody in this UI can see. Saying "Studio default: " with nothing
    // after it would be worse than useless.
    await renderForm({ acceptedCategories: ['dresses'] });

    expect(screen.getAllByText('LaundryProfileForm.pricingFallbackUnset').length).toBe(1);
  });

  it('surfaces a stored turnaround for a category the studio no longer accepts', async () => {
    // Values are retained rather than pruned when a category is un-ticked (see
    // server/api-util/categoryPricing.js). A retained-but-invisible turnaround is how a
    // studio ends up blocking its calendar for a reason nobody can locate, so it has to
    // be shown and clearable.
    await renderForm({
      acceptedCategories: ['pants'],
      categoryPricing__turnaroundDays__dresses: 3,
      // A category Console has since dropped: it has no row in the table at all, so the
      // notice is the only place it can ever be seen. Its label falls back to the raw id.
      categoryPricing__turnaroundDays__retired_category: 4,
    });

    expect(screen.getByText('LaundryProfileForm.categoryPricingOrphanedNote')).toBeInTheDocument();
    expect(screen.getByText('retired_category')).toBeInTheDocument();
    // "Dresses" also appears as a row label in the table, so match the chip's own
    // clear-this control rather than the bare text.
    expect(
      screen.getAllByRole('button', { name: 'LaundryProfileForm.categoryPricingOrphanedRemove' })
    ).toHaveLength(2);
  });

  it('clears an orphaned value and enables the save that commits the removal', async () => {
    // `pristine` is derived only from REGISTERED fields, so a stored value with no input
    // could otherwise be changed without the form noticing — leaving "Save changes"
    // disabled and the studio unable to commit the removal it just asked for.
    const user = userEvent.setup();
    await renderForm({
      studioName: 'Studio Pigalle',
      businessHours: 'Mon–Sat',
      turnaroundDays: 2,
      acceptedCategories: ['pants'],
      categoryPricing__turnaroundDays__dresses: 3,
      location: {
        search: '21 Rue Frochot, Paris',
        selectedPlace: { address: '21 Rue Frochot, Paris', origin: new LatLng(48.88, 2.34) },
      },
    });

    expect(screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' })).toBeDisabled();

    await act(async () => {
      await user.click(
        screen.getByRole('button', { name: 'LaundryProfileForm.categoryPricingOrphanedRemove' })
      );
    });

    expect(
      screen.queryByText('LaundryProfileForm.categoryPricingOrphanedNote')
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' })
    ).not.toBeDisabled();
  });

  it('shows no orphan notice when every stored value has a visible box', async () => {
    await renderForm({
      acceptedCategories: ['dresses'],
      categoryPricing__turnaroundDays__dresses: 3,
    });

    expect(
      screen.queryByText('LaundryProfileForm.categoryPricingOrphanedNote')
    ).not.toBeInTheDocument();
  });
});

// ── THE ADDRESS: THE ALERT AND THE LOCK ──────────────────────────────────────────
//
//   > "la laundry no puede estar en la lista de disponibles si no tiene dirección,
//   >  por lo que en el form de laundry hay que poner una alerta llamativa de que no
//   >  se le pueden asignar prendas si no tiene dirección establecida, a su vez, en
//   >  ese mismo form, debemos indicar al usuario que no puede cambiar su dirección y
//   >  que si desea modificar la dirección, debe solicitar apoyo al administrador o
//   >  soporte"
//
// These tests drive the two booleans directly. What DERIVES them from the stored
// profile lives in util/laundryProfile.js (parity-tested against the server's own
// predicates) and is asserted end to end in LaundryProfilePage.test.js.
describe('LaundryProfileForm address alert and lock', () => {
  const COMPLETE_LOCATION = {
    search: '21 Rue Frochot, Paris',
    selectedPlace: { address: '21 Rue Frochot, Paris', origin: new LatLng(48.879, 2.337) },
  };

  const renderAddressForm = (extraProps = {}) =>
    act(async () => {
      render(
        <LaundryProfileForm
          intl={fakeIntl}
          dispatch={noop}
          onSubmit={noop}
          updateInProgress={false}
          initialValues={{ location: COMPLETE_LOCATION }}
          {...extraProps}
        />,
        { config: configWithCategories }
      );
    });

  const addressInput = () => screen.getByTestId('location-search');

  it('shows a prominent alert when the studio has no usable address', async () => {
    await renderAddressForm({ hasUsableAddress: false, addressEditable: true });

    // `role="alert"` rather than `role="status"`: this is the reason the studio is
    // receiving nothing, and it should interrupt.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('LaundryProfileForm.noAddressAlertTitle')).toBeInTheDocument();
    expect(screen.getByText('LaundryProfileForm.noAddressAlertText')).toBeInTheDocument();
  });

  it('shows no alert once the studio has a usable address', async () => {
    await renderAddressForm({ hasUsableAddress: true, addressEditable: false });

    expect(screen.queryByText('LaundryProfileForm.noAddressAlertTitle')).not.toBeInTheDocument();
  });

  // A STUDIO WITH NO ADDRESS MUST BE ABLE TO SET ONE. A permanently disabled empty
  // field would strand every new studio: it is invisible in the picker until it has
  // an address, and it could never get one.
  it('leaves the address field editable, with no lock note, while onboarding', async () => {
    await renderAddressForm({ hasUsableAddress: false, addressEditable: true });

    expect(addressInput()).toBeEnabled();
    expect(
      screen.queryByText('LaundryProfileForm.addressChangeRequiresSupport')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('LaundryProfileForm.addressChangeGranted')).not.toBeInTheDocument();
  });

  it('locks the address field and points at support when the change is not permitted', async () => {
    await renderAddressForm({ hasUsableAddress: true, addressEditable: false });

    expect(addressInput()).toBeDisabled();
    expect(screen.getByText('LaundryProfileForm.addressChangeRequiresSupport')).toBeInTheDocument();
  });

  // A studio that has just been granted the change has to be able to tell.
  it('opens the field and says so once an admin has granted the change', async () => {
    await renderAddressForm({ hasUsableAddress: true, addressEditable: true });

    expect(addressInput()).toBeEnabled();
    expect(screen.getByText('LaundryProfileForm.addressChangeGranted')).toBeInTheDocument();
    expect(
      screen.queryByText('LaundryProfileForm.addressChangeRequiresSupport')
    ).not.toBeInTheDocument();
  });

  // The message is switched on the server's machine-readable `data.code`, never on
  // its English `statusText`, which would put a server sentence on a translated page.
  it('shows the ask-support message for a refused address change', async () => {
    await renderAddressForm({
      hasUsableAddress: true,
      addressEditable: true,
      updateAddressError: { type: 'error', status: 403, code: 'change-not-allowed' },
    });

    expect(screen.getByText('LaundryProfileForm.addressChangeNotAllowed')).toBeInTheDocument();
    expect(screen.queryByText('LaundryProfileForm.updateAddressFailed')).not.toBeInTheDocument();
  });

  it('shows a generic failure for any other address error', async () => {
    await renderAddressForm({
      hasUsableAddress: true,
      addressEditable: true,
      updateAddressError: { type: 'error', status: 500, code: null },
    });

    expect(screen.getByText('LaundryProfileForm.updateAddressFailed')).toBeInTheDocument();
  });

  // Defensive default: a caller that passes neither prop gets the pre-existing
  // editable form rather than a silently frozen one.
  it('defaults to an editable address field when the props are absent', async () => {
    await renderAddressForm();

    expect(addressInput()).toBeEnabled();
  });
});
