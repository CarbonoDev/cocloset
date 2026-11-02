import React, { act } from 'react';
import '@testing-library/jest-dom';

import { fakeIntl } from '../../../../util/testData';
import {
  getHostedConfiguration,
  renderWithProviders as render,
  testingLibrary,
} from '../../../../util/testHelpers';

import EditListingLaundryForm from './EditListingLaundryForm';

const { screen, userEvent } = testingLibrary;

const noop = () => null;

// Console's category tree, in the shape the hosted asset delivers it.
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

// Laundries whose acceptedCategories are Console IDs — what LaundryProfilePage now
// writes. `listingCategories` from the panel are IDs too, so the two sides finally
// share a vocabulary.
const idBasedLaundries = [
  {
    id: 'laundry-1',
    displayName: 'Studio Pigalle',
    studioName: 'Studio Pigalle',
    address: '21 Rue Frochot, Paris',
    origin: { lat: 48.882, lng: 2.338 },
    businessHours: 'Mon–Sat · 11:00–21:00',
    acceptedCategories: ['dresses'],
    turnaroundDays: 2,
  },
];

const renderForm = (props = {}, options = {}) =>
  render(
    <EditListingLaundryForm
      intl={fakeIntl}
      dispatch={noop}
      onSubmit={noop}
      saveActionMsg="Save laundry assignment"
      updated={false}
      updateInProgress={false}
      disabled={false}
      ready={false}
      fetchLaundriesInProgress={false}
      laundries={idBasedLaundries}
      {...props}
    />,
    { config: configWithCategories, ...options }
  );

const selectFirstLaundry = async user => {
  const radios = screen.getAllByRole('radio', {
    name: 'EditListingLaundryForm.screenreader.chooseLaundry',
  });
  await user.click(radios[0]);
};

// The flat, explicitly allowlisted record shape returned by /api/laundries -
// see server/api-util/laundryDirectory.js. The endpoint no longer forwards the
// raw publicData blob.
const laundries = [
  {
    id: 'laundry-1',
    displayName: 'Studio Pigalle',
    studioName: 'Studio Pigalle',
    address: '21 Rue Frochot, Paris',
    origin: { lat: 48.882, lng: 2.338 },
    businessHours: 'Mon–Sat · 11:00–21:00',
    acceptedCategories: ['Eveningwear', 'Sequins', 'Embroidery'],
    turnaroundDays: 2,
  },
  {
    id: 'laundry-2',
    displayName: 'Maison du Marais',
    studioName: 'Maison du Marais',
    address: '5 Rue des Rosiers, Paris',
    origin: { lat: 48.857, lng: 2.359 },
    businessHours: 'Tue–Sun · 10:00–19:00',
    acceptedCategories: ['Denim', 'Cotton', 'Leather goods'],
    turnaroundDays: 3,
  },
];

describe('EditListingLaundryForm', () => {
  it('shows a loading state while laundries are being fetched', async () => {
    await act(async () => {
      render(
        <EditListingLaundryForm
          intl={fakeIntl}
          dispatch={noop}
          onSubmit={noop}
          saveActionMsg="Save laundry assignment"
          updated={false}
          updateInProgress={false}
          disabled={false}
          ready={false}
          laundries={[]}
          fetchLaundriesInProgress={true}
        />
      );
    });

    expect(screen.getByText('EditListingLaundryForm.loading')).toBeInTheDocument();
  });

  it('renders a card per laundry and enables submit once one is selected', async () => {
    const user = userEvent.setup();
    const saveActionMsg = 'Save laundry assignment';

    await act(async () => {
      render(
        <EditListingLaundryForm
          intl={fakeIntl}
          dispatch={noop}
          onSubmit={noop}
          saveActionMsg={saveActionMsg}
          updated={false}
          updateInProgress={false}
          disabled={false}
          ready={false}
          laundries={laundries}
          fetchLaundriesInProgress={false}
        />
      );
    });

    expect(screen.getByText('Studio Pigalle')).toBeInTheDocument();
    expect(screen.getByText('Maison du Marais')).toBeInTheDocument();
    expect(screen.getByText('21 Rue Frochot, Paris')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: saveActionMsg })).toBeDisabled();

    // The screenreader label is the same for every card (fakeIntl/test messages
    // don't interpolate the {name} value), so there are two matching radios -
    // pick the first one (Studio Pigalle).
    const radios = screen.getAllByRole('radio', {
      name: 'EditListingLaundryForm.screenreader.chooseLaundry',
    });
    expect(radios).toHaveLength(2);
    await user.click(radios[0]);

    expect(screen.getByRole('button', { name: saveActionMsg })).toBeEnabled();
  });

  // ================ The category warning, currently hidden ================
  //
  // Commit 989ecce09 (2026-08-31) commented the warning out of the form: "Hide category
  // list for dry cleaning partners, since every partner is assumed to handle all
  // categories". `showCategoryWarning` is still computed, so restoring the JSX restores
  // the behaviour - which is why these are "not shown" assertions rather than deletions.
  //
  // The three negative tests below now pass for this reason rather than for the reason
  // they were written for. They are kept because they are what has to start failing if
  // the warning comes back for a category the studio DOES accept.
  it('does NOT show the category warning even when the category is not accepted', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(
        <EditListingLaundryForm
          intl={fakeIntl}
          dispatch={noop}
          onSubmit={noop}
          saveActionMsg="Save laundry assignment"
          updated={false}
          updateInProgress={false}
          disabled={false}
          ready={false}
          laundries={laundries}
          fetchLaundriesInProgress={false}
          listingCategories={['Outerwear']}
        />
      );
    });

    const radios = screen.getAllByRole('radio', {
      name: 'EditListingLaundryForm.screenreader.chooseLaundry',
    });
    await user.click(radios[0]);

    expect(screen.queryByText('EditListingLaundryForm.categoryWarning')).not.toBeInTheDocument();
  });

  it('does NOT show the category warning when the category IS accepted', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(
        <EditListingLaundryForm
          intl={fakeIntl}
          dispatch={noop}
          onSubmit={noop}
          saveActionMsg="Save laundry assignment"
          updated={false}
          updateInProgress={false}
          disabled={false}
          ready={false}
          laundries={laundries}
          fetchLaundriesInProgress={false}
          listingCategories={['Eveningwear']}
        />
      );
    });

    const radios = screen.getAllByRole('radio', {
      name: 'EditListingLaundryForm.screenreader.chooseLaundry',
    });
    await user.click(radios[0]);

    expect(screen.queryByText('EditListingLaundryForm.categoryWarning')).not.toBeInTheDocument();
  });

  it('does NOT show the category warning before any laundry is selected', async () => {
    await act(async () => {
      render(
        <EditListingLaundryForm
          intl={fakeIntl}
          dispatch={noop}
          onSubmit={noop}
          saveActionMsg="Save laundry assignment"
          updated={false}
          updateInProgress={false}
          disabled={false}
          ready={false}
          laundries={laundries}
          fetchLaundriesInProgress={false}
          listingCategories={['Outerwear']}
        />
      );
    });

    expect(screen.queryByText('EditListingLaundryForm.categoryWarning')).not.toBeInTheDocument();
  });

  it('renders a laundry card without crashing when optional fields are missing', async () => {
    await act(async () => {
      render(
        <EditListingLaundryForm
          intl={fakeIntl}
          dispatch={noop}
          onSubmit={noop}
          saveActionMsg="Save laundry assignment"
          updated={false}
          updateInProgress={false}
          disabled={false}
          ready={false}
          laundries={[{ id: 'sparse', displayName: 'Sparse Laundry' }]}
          fetchLaundriesInProgress={false}
        />
      );
    });

    expect(screen.getByText('Sparse Laundry')).toBeInTheDocument();
  });

  // ================ Console category ids on both sides ================

  it('lists no accepted categories on a laundry card, and never a raw Console id', async () => {
    // Same removal as the warning (9cdecc241, 2026-08-25): every partner is assumed to
    // handle every category, so the chips are gone. The half of this test that still
    // matters is the second line - whatever the card does show, it is never a raw id.
    await act(async () => {
      renderForm();
    });

    expect(screen.queryByText('Dresses')).not.toBeInTheDocument();
    expect(screen.queryByText('dresses')).not.toBeInTheDocument();
    // The card is not empty, though: name, address, hours and turnaround are still on it.
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0);
  });

  // THE HIERARCHY RULE. The listing carries every level of its chain, so accepting the
  // parent accepts the whole branch — a laundry that ticks "Dresses" doesn't have to
  // tick every dress subcategory.
  it('does NOT warn when the laundry accepts the listing category PARENT', async () => {
    const user = userEvent.setup();
    await act(async () => {
      renderForm({ listingCategories: ['dresses', 'midi_dress'] });
    });

    await selectFirstLaundry(user);

    expect(screen.queryByText('EditListingLaundryForm.categoryWarning')).not.toBeInTheDocument();
  });

  it('does NOT warn when the laundry accepts the exact leaf category', async () => {
    const user = userEvent.setup();
    await act(async () => {
      renderForm({
        laundries: [{ ...idBasedLaundries[0], acceptedCategories: ['midi_dress'] }],
        listingCategories: ['dresses', 'midi_dress'],
      });
    });

    await selectFirstLaundry(user);

    expect(screen.queryByText('EditListingLaundryForm.categoryWarning')).not.toBeInTheDocument();
  });

  it('stays silent when no level of the listing category chain is accepted', async () => {
    // The case the warning existed for. It is the one that has to be revisited first if
    // the marketplace ever stops assuming every partner handles every category.
    const user = userEvent.setup();
    await act(async () => {
      renderForm({ listingCategories: ['pants'] });
    });

    await selectFirstLaundry(user);

    expect(screen.queryByText('EditListingLaundryForm.categoryWarning')).not.toBeInTheDocument();
  });

  // Laundries that never revisited their profile still have free text stored where a
  // Console id is expected. Nothing renders it now, but it still reaches
  // `getCategoryLabels`, so the guard against crashing on it is still worth having.
  it('renders pre-migration free-text accepted categories without crashing', async () => {
    const user = userEvent.setup();
    await act(async () => {
      renderForm({
        laundries: [{ ...idBasedLaundries[0], acceptedCategories: ['Eveningwear'] }],
        listingCategories: ['dresses'],
      });
    });

    expect(screen.getByText('Studio Pigalle')).toBeInTheDocument();

    await selectFirstLaundry(user);
    expect(screen.queryByText('EditListingLaundryForm.categoryWarning')).not.toBeInTheDocument();
  });
  // The turnaround on a card is now resolved for the garment being assigned (a laundry
  // sets hours per top-level category), so the card has to say WHICH kind of number it
  // is showing. Labelling a studio-wide average as if it were a promise about this
  // garment is the failure mode being guarded here.
  it('labels a category-specific turnaround differently from a studio-wide one', async () => {
    await act(async () => {
      renderForm({
        laundries: [{ ...idBasedLaundries[0], turnaroundDaysIsCategorySpecific: true }],
        listingCategories: ['dresses'],
      });
    });

    expect(screen.getByText('EditListingLaundryForm.turnaroundForCategory')).toBeInTheDocument();
    expect(screen.queryByText('EditListingLaundryForm.turnaround')).not.toBeInTheDocument();
  });

  it('falls back to the plain turnaround label when the number is studio-wide', async () => {
    await act(async () => {
      renderForm({
        laundries: [{ ...idBasedLaundries[0], turnaroundDaysIsCategorySpecific: false }],
        listingCategories: ['dresses'],
      });
    });

    expect(screen.getByText('EditListingLaundryForm.turnaround')).toBeInTheDocument();
    expect(
      screen.queryByText('EditListingLaundryForm.turnaroundForCategory')
    ).not.toBeInTheDocument();
  });

  // The picker lock. This is the visible half of the assigned-laundry guard: the
  // enforcement is server-side (see EditListingLaundryPanel's docblock and
  // server/api/listing-laundry-assignment.js), and this is what stops an owner
  // running into it blind.
  describe('when the garment is at the laundry (laundryLocked)', () => {
    it('is unlocked by default', async () => {
      await act(async () => {
        renderForm();
      });

      expect(
        screen.getByRole('radio', { name: 'EditListingLaundryForm.screenreader.chooseLaundry' })
      ).toBeEnabled();
      expect(screen.queryByText('EditListingLaundryForm.laundryLocked')).not.toBeInTheDocument();
    });

    it('disables every card and explains why', async () => {
      await act(async () => {
        renderForm({ laundries, laundryLocked: true });
      });

      const radios = screen.getAllByRole('radio', {
        name: 'EditListingLaundryForm.screenreader.chooseLaundry',
      });
      expect(radios).toHaveLength(2);
      radios.forEach(radio => expect(radio).toBeDisabled());

      expect(screen.getByText('EditListingLaundryForm.laundryLocked')).toBeInTheDocument();
    });

    it('still shows which laundry has the garment', async () => {
      // Disabled, not hidden: the one thing an owner opens this tab for while the
      // garment is out is "who has it".
      await act(async () => {
        renderForm({ laundries, laundryLocked: true });
      });

      expect(screen.getByText('Studio Pigalle')).toBeInTheDocument();
      expect(screen.getByText('21 Rue Frochot, Paris')).toBeInTheDocument();
    });

    it('leaves Save usable, so re-saving the same laundry does not dead-end the tab', async () => {
      const saveActionMsg = 'Save laundry assignment';
      await act(async () => {
        renderForm({
          laundries,
          laundryLocked: true,
          saveActionMsg,
          initialValues: { assignedLaundryId: 'laundry-1' },
        });
      });

      // The server allows a no-op re-save (evaluateLaundryAssignment: changed
      // false); disabling submit here would make the wizard tab impassable rather
      // than making the assignment immutable.
      expect(screen.getByRole('button', { name: saveActionMsg })).toBeEnabled();
    });

    it('does not let a click change the selection', async () => {
      const user = userEvent.setup();
      await act(async () => {
        renderForm({
          laundries,
          laundryLocked: true,
          initialValues: { assignedLaundryId: 'laundry-1' },
        });
      });

      const radios = screen.getAllByRole('radio', {
        name: 'EditListingLaundryForm.screenreader.chooseLaundry',
      });
      await user.click(radios[1]);

      expect(radios[0]).toBeChecked();
      expect(radios[1]).not.toBeChecked();
    });
  });

  // ---------------------------------------------------------------------------
  //   > "se muestra el displayName de cada laundry, pero debe ser el nombre de la laundry, no
  //   >  del user"
  //
  // `displayName` is whatever the person who signed the studio up called themselves, often
  // their own name. An owner choosing where their garment goes is choosing a PLACE. The two
  // fixtures above give both the same value, which is why the precedence was invisible here.
  // ---------------------------------------------------------------------------
  describe('the name on a laundry card', () => {
    const namedDifferently = [
      {
        ...laundries[0],
        displayName: 'Jonathan P',
        studioName: 'Studio Pigalle',
      },
    ];

    it('is the studio name, not the account holder name', async () => {
      await act(async () => {
        renderForm({ laundries: namedDifferently });
      });

      expect(screen.getByText('Studio Pigalle')).toBeInTheDocument();
      expect(screen.queryByText('Jonathan P')).not.toBeInTheDocument();
    });

    // Blank would be worse than the account name: the owner still has to tell the options
    // apart, and a studio that has not named itself yet must remain identifiable.
    it('falls back to the account name when the studio has not named itself', async () => {
      await act(async () => {
        renderForm({
          laundries: [{ ...laundries[0], displayName: 'Jonathan P', studioName: null }],
        });
      });

      expect(screen.getByText('Jonathan P')).toBeInTheDocument();
    });
  });
});
