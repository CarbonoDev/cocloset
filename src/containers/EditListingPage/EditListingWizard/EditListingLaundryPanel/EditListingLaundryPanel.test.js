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
  assignListingLaundry: jest.fn(),
}));

import { assignListingLaundry, fetchLaundries } from '../../../../util/api';

import EditListingLaundryPanel from './EditListingLaundryPanel';

const { screen, userEvent } = testingLibrary;

// The assigned-laundry guard, from the owner's side.
//
//   > "se puede editar la laundry mientras que no este en una transaction activa y
//   >  que onLaundry sea false"
//
// The behaviour worth pinning is NOT the notice. It is that this panel does not
// write the assignment AT ALL any more: it POSTs to /api/listing-laundry-assignment
// and the server performs the write. The field lives in `metadata`, which the
// Marketplace API refuses to let an owner write (400 `validation-disallowed-key`),
// so the guard is no longer a question a client may decline to ask - which is
// exactly what the previous version of this file could only document as a gap.
//
// So the assertions below are, in order of importance: nothing about the
// assignment goes through `onSubmit` (i.e. through `ownListings.update`), a
// refusal is never treated as a success, and a refusal says which of the two
// conditions caused it.

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

// The saved assignment is in `metadata`, alongside `onLaundry`. A fixture that
// still put it in `publicData` would render an empty picker and pass for the
// wrong reason.
const listingWith = ({ metadata = {}, assignedLaundryId = 'laundry-1' } = {}) => ({
  id: { uuid: 'listing-1' },
  type: 'ownListing',
  attributes: {
    title: 'Draped jersey gown, crimson',
    state: 'published',
    publicData: { categoryLevel1: 'dresses' },
    metadata: { assignedLaundryId, ...metadata },
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

// A 409 as api-util/sdk.js's handleError actually shapes it: `data.reason` names
// which condition refused the change, and the panel picks a translated string off
// it rather than printing the server's English `statusText`.
const conflict = (reason = 'on-laundry') => {
  const error = new Error('refused');
  error.status = 409;
  error.data = { reason };
  return error;
};

describe('EditListingLaundryPanel', () => {
  beforeEach(() => {
    // The shared jest config sets `resetMocks: true`.
    fetchLaundries.mockResolvedValue({ data: LAUNDRIES });
    assignListingLaundry.mockResolvedValue({ data: { allowed: true } });
  });

  it('sends the new assignment to the server, which does the write', async () => {
    const user = userEvent.setup();
    const { onSubmit } = await renderPanel();

    await pickSecondLaundry(user);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: SAVE }));
    });

    expect(assignListingLaundry).toHaveBeenCalledWith({
      listingId: 'listing-1',
      assignedLaundryId: 'laundry-2',
    });
  });

  it('sends NO listing attributes through onSubmit', async () => {
    // The load-bearing assertion of the relocation. `onSubmit` reaches
    // `ownListings.update` from the browser, so anything passed here is a
    // client-controlled write. The assignment, the pickup address and the
    // geolocation are all the server's to write now; this call exists only as a
    // read-back that refreshes the Redux entity and lets the wizard mark the tab
    // updated. Passing `geolocation`/`publicData` here would reopen exactly the
    // owner-writable path this change closed.
    const user = userEvent.setup();
    const { onSubmit } = await renderPanel();

    await pickSecondLaundry(user);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: SAVE }));
    });

    expect(onSubmit).toHaveBeenCalledWith({});
  });

  it('does not pass the tab when the server refuses with 409', async () => {
    // A silent pass here would mark the LAUNDRY tab complete and walk the owner
    // forward as though the reassignment had happened, when the server refused it.
    const user = userEvent.setup();
    assignListingLaundry.mockRejectedValue(conflict());
    const { onSubmit } = await renderPanel();

    await pickSecondLaundry(user);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: SAVE }));
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('EditListingLaundryPanel.laundryLockedError')).toBeInTheDocument();
  });

  it('says which condition refused it: an active rental is not the same news', async () => {
    // Two different facts about the owner's own garment. Telling someone with a
    // live rental that their garment is sitting in a studio sends them to check a
    // shelf instead of waiting for a renter.
    const user = userEvent.setup();
    assignListingLaundry.mockRejectedValue(conflict('active-transaction'));
    await renderPanel();

    await pickSecondLaundry(user);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: SAVE }));
    });

    expect(screen.getByText('EditListingLaundryPanel.activeTransactionError')).toBeInTheDocument();
    expect(
      screen.queryByText('EditListingLaundryPanel.laundryLockedError')
    ).not.toBeInTheDocument();
  });

  it('falls back to the locked message on a 409 with no reason', async () => {
    // An older server build, or a proxy that ate the body. Still a refusal, and
    // still has to say so - a blank would read as a silent failure.
    const user = userEvent.setup();
    const bare = new Error('refused');
    bare.status = 409;
    assignListingLaundry.mockRejectedValue(bare);
    const { onSubmit } = await renderPanel();

    await pickSecondLaundry(user);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: SAVE }));
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('EditListingLaundryPanel.laundryLockedError')).toBeInTheDocument();
  });

  it('does not pass the tab when the save fails for any other reason', async () => {
    // Fails closed. A dropped request is not a save.
    const user = userEvent.setup();
    assignListingLaundry.mockRejectedValue(new Error('Network down'));
    const { onSubmit } = await renderPanel();

    await pickSecondLaundry(user);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: SAVE }));
    });

    expect(onSubmit).not.toHaveBeenCalled();
    // ...and says so honestly, rather than blaming the laundry for a network fault.
    expect(screen.getByText('EditListingLaundryPanel.assignmentFailed')).toBeInTheDocument();
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

  it('still calls the server on an unchanged re-save', async () => {
    // The panel does not try to decide locally whether this counts as a change -
    // `evaluateLaundryAssignment` on the server owns that rule, and duplicating it
    // here is how the two would drift. It also cannot skip the call: the server is
    // the only party that can write, so skipping it would leave the derived fields
    // unrefreshed and the tab unmarked.
    const user = userEvent.setup();
    const { onSubmit } = await renderPanel();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: SAVE }));
    });

    expect(assignListingLaundry).toHaveBeenCalledWith({
      listingId: 'listing-1',
      assignedLaundryId: 'laundry-1',
    });
    expect(onSubmit).toHaveBeenCalled();
  });

  it('reads the saved laundry from metadata, not publicData', async () => {
    // If this regressed, the picker would render with nothing selected for every
    // listing that already has a laundry, and an owner walking back through the
    // wizard would be asked to choose again from scratch.
    await renderPanel({ listing: listingWith({ assignedLaundryId: 'laundry-2' }) });

    const radios = screen.getAllByRole('radio', {
      name: 'EditListingLaundryForm.screenreader.chooseLaundry',
    });
    expect(radios[1]).toBeChecked();
    expect(radios[0]).not.toBeChecked();
  });
});
