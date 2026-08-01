import React, { act } from 'react';
import '@testing-library/jest-dom';

import { fakeIntl } from '../../../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';

import EditListingLaundryForm from './EditListingLaundryForm';

const { screen, userEvent } = testingLibrary;

const noop = () => null;

const laundries = [
  {
    id: 'laundry-1',
    displayName: 'Studio Pigalle',
    publicData: {
      laundryProfile: {
        studioName: 'Studio Pigalle',
        address: '21 Rue Frochot, Paris',
        businessHours: 'Mon–Sat · 11:00–21:00',
      },
      acceptedCategories: ['Eveningwear', 'Sequins', 'Embroidery'],
    },
    turnaroundHours: 48,
  },
  {
    id: 'laundry-2',
    displayName: 'Maison du Marais',
    publicData: {
      laundryProfile: {
        studioName: 'Maison du Marais',
        address: '5 Rue des Rosiers, Paris',
        businessHours: 'Tue–Sun · 10:00–19:00',
      },
      acceptedCategories: ['Denim', 'Cotton', 'Leather goods'],
    },
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
          listingCategory="Outerwear"
        />
      );
    });

    const radios = screen.getAllByRole('radio', {
      name: 'EditListingLaundryForm.screenreader.chooseLaundry',
    });
    await user.click(radios[0]);

    expect(screen.getByText('EditListingLaundryForm.categoryWarning')).toBeInTheDocument();
  });
});
