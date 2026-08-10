import React, { act } from 'react';
import '@testing-library/jest-dom';

import { fakeIntl } from '../../../../util/testData';
import {
  getHostedConfiguration,
  renderWithProviders as render,
  testingLibrary,
} from '../../../../util/testHelpers';

jest.mock('../../../../util/api', () => ({
  fetchLaundries: jest.fn(),
  checkListingLaundryAssignment: jest.fn(),
}));

import { checkListingLaundryAssignment, fetchLaundries } from '../../../../util/api';

import EditListingLaundryPanel from './EditListingLaundryPanel';

const { screen, userEvent } = testingLibrary;

// The assigned-laundry guard, from the owner's side.
//
//   > "No se debe cambiar la laundry seleccionada por el provider para un listing a
//   >  menos que ya se haya devuelto la prenda onLaundry = false"
//
// The behaviour worth pinning is NOT the notice - it is that the panel never
// writes `publicData.assignedLaundryId` without first getting a 200 from the
// server-side check. The check re-reads `metadata.onLaundry` from the API, so it
// is the only part of this that a client cannot talk its way past. (What it still
// does not stop is a caller who skips the panel entirely - see the header of
// server/api/listing-laundry-assignment.js.)

const SAVE = 'Save laundry assignment';

const LAUNDRIES = [
  {
    id: 'laundry-1',
    displayName: 'Studio Pigalle',
    studioName: 'Studio Pigalle',
    address: '21 Rue Frochot, Paris',
    origin: { lat: 48.882, lng: 2.338 },
    acceptedCategories: ['dresses'],
    turnaroundHours: 48,
  },
  {
    id: 'laundry-2',
    displayName: 'Maison du Marais',
    studioName: 'Maison du Marais',
    address: '5 Rue des Rosiers, Paris',
    origin: { lat: 48.857, lng: 2.359 },
    acceptedCategories: ['dresses'],
    turnaroundHours: 36,
  },
];

const listingWith = ({ metadata = {}, assignedLaundryId = 'laundry-1' } = {}) => ({
  id: { uuid: 'listing-1' },
  type: 'ownListing',
  attributes: {
    title: 'Draped jersey gown, crimson',
    state: 'published',
    publicData: { assignedLaundryId, categoryLevel1: 'dresses' },
    metadata,
  },
});

const renderPanel = async (props = {}) => {
  const onSubmit = props.onSubmit || jest.fn(() => Promise.resolve());
  await act(async () => {
    render(
      <EditListingLaundryPanel
        intl={fakeIntl}
        listing={listingWith()}
        disabled={false}
        ready={false}
        panelUpdated={false}
        updateInProgress={false}
        errors={{}}
        submitButtonText={SAVE}
        updatePageTitle={() => null}
        {...props}
        onSubmit={onSubmit}
      />,
      { config: { ...getHostedConfiguration(), categories: { categories: [] } } }
    );
  });
  return { onSubmit };
};

const pickSecondLaundry = async user => {
  const radios = screen.getAllByRole('radio', {
    name: 'EditListingLaundryForm.screenreader.chooseLaundry',
  });
  await user.click(radios[1]);
};

const conflict = () => {
  const error = new Error('at the laundry');
  error.status = 409;
  return error;
};

describe('EditListingLaundryPanel', () => {
  beforeEach(() => {
    // The shared jest config sets `resetMocks: true`.
    fetchLaundries.mockResolvedValue({ data: LAUNDRIES });
    checkListingLaundryAssignment.mockResolvedValue({ data: { allowed: true } });
  });

  it('asks the server before writing the new assignment', async () => {
    const user = userEvent.setup();
    const { onSubmit } = await renderPanel();

    await pickSecondLaundry(user);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: SAVE }));
    });

    expect(checkListingLaundryAssignment).toHaveBeenCalledWith({
      listingId: 'listing-1',
      assignedLaundryId: 'laundry-2',
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        publicData: expect.objectContaining({ assignedLaundryId: 'laundry-2' }),
      })
    );
  });

  it('DOES NOT write when the server refuses with 409', async () => {
    // The load-bearing assertion of this file. A silent pass here would write the
    // reassignment of a garment that is physically in another studio.
    const user = userEvent.setup();
    checkListingLaundryAssignment.mockRejectedValue(conflict());
    const { onSubmit } = await renderPanel();

    await pickSecondLaundry(user);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: SAVE }));
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('EditListingLaundryPanel.laundryLockedError')).toBeInTheDocument();
  });

  it('DOES NOT write when the check fails for any other reason', async () => {
    // Fails closed. A dropped request is not permission.
    const user = userEvent.setup();
    checkListingLaundryAssignment.mockRejectedValue(new Error('Network down'));
    const { onSubmit } = await renderPanel();

    await pickSecondLaundry(user);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: SAVE }));
    });

    expect(onSubmit).not.toHaveBeenCalled();
    // ...and says so honestly, rather than blaming the laundry for a network fault.
    expect(screen.getByText('EditListingLaundryPanel.assignmentCheckFailed')).toBeInTheDocument();
    expect(
      screen.queryByText('EditListingLaundryPanel.laundryLockedError')
    ).not.toBeInTheDocument();
  });

  it('locks the picker when the listing says the garment is at the laundry', async () => {
    await renderPanel({ listing: listingWith({ metadata: { onLaundry: true } }) });

    screen
      .getAllByRole('radio', { name: 'EditListingLaundryForm.screenreader.chooseLaundry' })
      .forEach(radio => expect(radio).toBeDisabled());
    expect(screen.getByText('EditListingLaundryForm.laundryLocked')).toBeInTheDocument();
  });

  it('does not lock on a non-boolean onLaundry', async () => {
    // `metadata.onLaundry: "true"` is bad data, not custody. Locking on it would
    // freeze an owner's listing with no way out from the UI.
    await renderPanel({ listing: listingWith({ metadata: { onLaundry: 'true' } }) });

    expect(screen.queryByText('EditListingLaundryForm.laundryLocked')).not.toBeInTheDocument();
  });

  it('leaves the picker open when the garment is back with its owner', async () => {
    await renderPanel({ listing: listingWith({ metadata: { onLaundry: false } }) });

    screen
      .getAllByRole('radio', { name: 'EditListingLaundryForm.screenreader.chooseLaundry' })
      .forEach(radio => expect(radio).toBeEnabled());
    expect(screen.queryByText('EditListingLaundryForm.laundryLocked')).not.toBeInTheDocument();
  });

  it('still checks with the server on an unchanged re-save', async () => {
    // The panel does not try to decide locally whether this counts as a change -
    // `evaluateLaundryAssignment` on the server owns that rule, and duplicating it
    // here is how the two would drift.
    const user = userEvent.setup();
    const { onSubmit } = await renderPanel();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: SAVE }));
    });

    expect(checkListingLaundryAssignment).toHaveBeenCalledWith({
      listingId: 'listing-1',
      assignedLaundryId: 'laundry-1',
    });
    expect(onSubmit).toHaveBeenCalled();
  });
});
