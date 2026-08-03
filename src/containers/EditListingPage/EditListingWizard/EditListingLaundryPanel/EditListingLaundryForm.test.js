import React, { act } from 'react';
import '@testing-library/jest-dom';

import { fakeIntl } from '../../../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';

import EditListingLaundryForm from './EditListingLaundryForm';

const { screen, userEvent } = testingLibrary;

const noop = () => null;

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
});
