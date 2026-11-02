import React, { act } from 'react';
import { Route } from 'react-router-dom';
import '@testing-library/jest-dom';

import { createCurrentUser, fakeIntl } from '../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import { ProfileSettingsPageComponent } from './ProfileSettingsPage';

const { screen } = testingLibrary;

const noop = () => null;

describe('ProfileSettingsPage', () => {
  it('Check that there is a link to ProfilePage', async () => {
    const props = {
      authInProgress: false,
      currentUser: createCurrentUser('userId'),
      history: { push: noop },
      isAuthenticated: false,
      location: { search: '' },
      onChange: noop,
      onImageUpload: noop,
      onLogout: noop,
      onManageDisableScrolling: noop,
      onUpdateProfile: noop,
      params: { displayName: 'my-shop' },
      scrollingDisabled: false,
      updateInProgress: false,
      uploadInProgress: false,
      sendVerificationEmailInProgress: false,
      onResendVerificationEmail: noop,
      intl: fakeIntl,
    };

    await act(async () => {
      render(<ProfileSettingsPageComponent {...props} />);
    });

    const viewProfileLink = 'ProfileSettingsPage.viewProfileLink';
    expect(screen.getByText(viewProfileLink)).toBeInTheDocument();
  });

  // A LAUNDRY'S REAL SETTINGS PAGE IS /laundry-profile (Jonathan, 2026-09-11).
  it('redirects a laundry user to LaundryProfilePage instead of rendering this form', async () => {
    const laundryUser = createCurrentUser('laundry-userId', {
      profile: { metadata: { isLaundry: true } },
    });
    const props = {
      authInProgress: false,
      currentUser: laundryUser,
      history: { push: noop },
      isAuthenticated: false,
      location: { search: '' },
      onChange: noop,
      onImageUpload: noop,
      onLogout: noop,
      onManageDisableScrolling: noop,
      onUpdateProfile: noop,
      params: {},
      scrollingDisabled: false,
      updateInProgress: false,
      uploadInProgress: false,
      sendVerificationEmailInProgress: false,
      onResendVerificationEmail: noop,
      intl: fakeIntl,
    };

    await act(async () => {
      render(
        <>
          <ProfileSettingsPageComponent {...props} />
          {/* Location probe: NamedRedirect navigates via react-router's own
              <Redirect>, which leaves nothing to assert on directly. */}
          <Route
            path="*"
            render={({ location }) => <div data-testid="location">{location.pathname}</div>}
          />
        </>
      );
    });

    expect(screen.getByTestId('location')).toHaveTextContent('/laundry-profile');
    expect(screen.queryByText('ProfileSettingsPage.viewProfileLink')).not.toBeInTheDocument();
  });
});
