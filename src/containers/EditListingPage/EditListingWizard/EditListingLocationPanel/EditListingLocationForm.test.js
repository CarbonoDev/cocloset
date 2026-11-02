import React, { act } from 'react';
import '@testing-library/jest-dom';

import { fakeIntl } from '../../../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';

import EditListingLocationForm from './EditListingLocationForm';

const { screen, userEvent } = testingLibrary;

const noop = () => null;

describe('EditListingLocationForm', () => {
  it('Check that owner address fields can be given and submit button activates', async () => {
    const user = userEvent.setup();
    const saveActionMsg = 'Save location';
    await act(async () => {
      render(
        <EditListingLocationForm
          intl={fakeIntl}
          dispatch={noop}
          onSubmit={noop}
          saveActionMsg={saveActionMsg}
          updated={false}
          updateInProgress={false}
          disabled={false}
          ready={false}
        />
      );
    });

    const street = 'EditListingLocationForm.street';
    expect(screen.getByText(street)).toBeInTheDocument();

    const city = 'EditListingLocationForm.city';
    expect(screen.getByText(city)).toBeInTheDocument();

    const postcode = 'EditListingLocationForm.postcode';
    expect(screen.getByText(postcode)).toBeInTheDocument();

    // Test that save button is disabled at first
    expect(screen.getByRole('button', { name: saveActionMsg })).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: street }), 'Main Street 123');
    await user.type(screen.getByRole('textbox', { name: city }), 'Paris');
    await user.type(screen.getByRole('textbox', { name: postcode }), '75009');

    expect(screen.getByRole('button', { name: saveActionMsg })).toBeEnabled();
  });
});
