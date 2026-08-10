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
    turnaroundHours: 48,
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
    turnaroundHours: 48,
  },
  {
    id: 'laundry-2',
    displayName: 'Maison du Marais',
    studioName: 'Maison du Marais',
    address: '5 Rue des Rosiers, Paris',
    origin: { lat: 48.857, lng: 2.359 },
    businessHours: 'Tue–Sun · 10:00–19:00',
    acceptedCategories: ['Denim', 'Cotton', 'Leather goods'],
    turnaroundHours: 36,
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

  it('shows a soft warning when the listing category is not in the selected laundry accepted categories', async () => {
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

    expect(screen.getByText('EditListingLaundryForm.categoryWarning')).toBeInTheDocument();
  });

  // NEGATIVE CASE for the soft category validation. Without this, an
  // implementation that ALWAYS shows the warning passes the test above - which
  // is how the dead `publicData.category` read slipped through review.
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

  it('shows human category names on the laundry cards, never raw Console ids', async () => {
    await act(async () => {
      renderForm();
    });

    expect(screen.getByText('Dresses')).toBeInTheDocument();
    expect(screen.queryByText('dresses')).not.toBeInTheDocument();
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

  it('warns when no level of the listing category chain is accepted', async () => {
    const user = userEvent.setup();
    await act(async () => {
      renderForm({ listingCategories: ['pants'] });
    });

    await selectFirstLaundry(user);

    expect(screen.getByText('EditListingLaundryForm.categoryWarning')).toBeInTheDocument();
  });

  // Ids alone in the warning ("dresses / midi_dress") told the garment owner nothing.
  // The default test messages don't interpolate, so this one supplies a real message.
  it('names the listing category in the warning the way Console names it', async () => {
    const user = userEvent.setup();
    await act(async () => {
      renderForm(
        {
          laundries: [{ ...idBasedLaundries[0], acceptedCategories: ['pants'] }],
          listingCategories: ['dresses', 'midi_dress'],
        },
        { messages: { 'EditListingLaundryForm.categoryWarning': 'Not accepted: {category}' } }
      );
    });

    await selectFirstLaundry(user);

    expect(screen.getByText('Not accepted: Dresses › Midi Dress')).toBeInTheDocument();
  });

  // Laundries that never revisited their profile still have free text stored. It can't
  // match a Console id, so the warning fires — but it must not crash, and the chip must
  // still read as words.
  it('renders pre-migration free-text accepted categories without crashing', async () => {
    const user = userEvent.setup();
    await act(async () => {
      renderForm({
        laundries: [{ ...idBasedLaundries[0], acceptedCategories: ['Eveningwear'] }],
        listingCategories: ['dresses'],
      });
    });

    expect(screen.getByText('Eveningwear')).toBeInTheDocument();

    await selectFirstLaundry(user);
    expect(screen.getByText('EditListingLaundryForm.categoryWarning')).toBeInTheDocument();
  });
  // The turnaround on a card is now resolved for the garment being assigned (a laundry
  // sets hours per top-level category), so the card has to say WHICH kind of number it
  // is showing. Labelling a studio-wide average as if it were a promise about this
  // garment is the failure mode being guarded here.
  it('labels a category-specific turnaround differently from a studio-wide one', async () => {
    await act(async () => {
      renderForm({
        laundries: [{ ...idBasedLaundries[0], turnaroundHoursIsCategorySpecific: true }],
        listingCategories: ['dresses'],
      });
    });

    expect(screen.getByText('EditListingLaundryForm.turnaroundForCategory')).toBeInTheDocument();
    expect(screen.queryByText('EditListingLaundryForm.turnaround')).not.toBeInTheDocument();
  });

  it('falls back to the plain turnaround label when the number is studio-wide', async () => {
    await act(async () => {
      renderForm({
        laundries: [{ ...idBasedLaundries[0], turnaroundHoursIsCategorySpecific: false }],
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
});
