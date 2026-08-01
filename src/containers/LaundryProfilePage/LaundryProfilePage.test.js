import React, { act } from 'react';
import '@testing-library/jest-dom';

import { types as sdkTypes } from '../../util/sdkLoader';
import { fakeIntl } from '../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import { LaundryProfilePageComponent } from './LaundryProfilePage';

const { screen, userEvent } = testingLibrary;
const { LatLng } = sdkTypes;

// The address field validates with `origin instanceof LatLng`, so the fixture
// has to use the real SDK type — that's what currentUser carries in the app.
const ORIGIN = new LatLng(48.882, 2.338);

const noop = () => null;

beforeAll(() => {
  window.mapboxgl = { accessToken: 'test' };
  window.mapboxSdk = () => ({
    geocoding: {
      forwardGeocode: () => ({ send: () => Promise.resolve({ body: { features: [] } }) }),
    },
  });
});

// A laundry user with a fully configured profile — in particular a saved
// cleaningFee, which is the value B6 silently destroyed.
const laundryUser = {
  id: { uuid: 'laundry-user-id' },
  type: 'currentUser',
  attributes: {
    email: 'test-laundry-cocloset@example.com',
    profile: {
      displayName: 'Pigalle Pressing',
      publicData: {
        laundryProfile: {
          studioName: 'Studio Pigalle',
          address: '21 Rue Frochot, Paris',
          origin: ORIGIN,
          businessHours: 'Mon-Sat 11-21',
        },
        acceptedCategories: ['Eveningwear', 'Sequins'],
      },
      privateData: { turnaroundHours: 36, cleaningFee: 12.5 },
      metadata: { isLaundry: true },
    },
  },
};

const renderPage = currentUser =>
  render(
    <LaundryProfilePageComponent
      intl={fakeIntl}
      currentUser={currentUser}
      scrollingDisabled={false}
      onUpdateProfile={noop}
      updateProfileInProgress={false}
      updateProfileError={null}
    />
  );

describe('LaundryProfilePage', () => {
  // THE REGRESSION TEST FOR B6.
  //
  // On a hard load of /laundry-profile, currentUser is null on the first
  // render. The page used to snapshot initialValues in a useState initializer
  // at that moment, which runs exactly once — so the snapshot stayed
  // all-undefined forever. The laundry saw a blank form, retyped the required
  // fields, saved, and their configured cleaningFee was wiped.
  it('shows the saved profile when currentUser arrives after the first render', async () => {
    let rendered;
    await act(async () => {
      rendered = renderPage(null);
    });

    // Nothing rendered yet — but crucially, no snapshot was taken either.
    expect(screen.queryByDisplayValue('Studio Pigalle')).not.toBeInTheDocument();

    await act(async () => {
      rendered.rerender(
        <LaundryProfilePageComponent
          intl={fakeIntl}
          currentUser={laundryUser}
          scrollingDisabled={false}
          onUpdateProfile={noop}
          updateProfileInProgress={false}
          updateProfileError={null}
        />
      );
    });

    expect(screen.getByDisplayValue('Studio Pigalle')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Mon-Sat 11-21')).toBeInTheDocument();
    expect(screen.getByDisplayValue('36')).toBeInTheDocument();
    // The value the old code destroyed.
    expect(screen.getByDisplayValue('12.5')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Eveningwear, Sequins')).toBeInTheDocument();
  });

  it('shows the saved profile when currentUser is already loaded on first render', async () => {
    await act(async () => {
      renderPage(laundryUser);
    });

    expect(screen.getByDisplayValue('Studio Pigalle')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12.5')).toBeInTheDocument();
  });

  it('submits the saved cleaningFee unchanged when only another field is edited', async () => {
    const onUpdateProfile = jest.fn();
    let rendered;
    await act(async () => {
      rendered = render(
        <LaundryProfilePageComponent
          intl={fakeIntl}
          currentUser={null}
          scrollingDisabled={false}
          onUpdateProfile={onUpdateProfile}
          updateProfileInProgress={false}
          updateProfileError={null}
        />
      );
    });
    await act(async () => {
      rendered.rerender(
        <LaundryProfilePageComponent
          intl={fakeIntl}
          currentUser={laundryUser}
          scrollingDisabled={false}
          onUpdateProfile={onUpdateProfile}
          updateProfileInProgress={false}
          updateProfileError={null}
        />
      );
    });

    const businessHours = screen.getByDisplayValue('Mon-Sat 11-21');
    await act(async () => {
      await userEvent.clear(businessHours);
      await userEvent.type(businessHours, 'Mon-Fri 09-19');
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' }));
    });

    expect(onUpdateProfile).toHaveBeenCalledTimes(1);
    const submitted = onUpdateProfile.mock.calls[0][0];
    expect(submitted.privateData.cleaningFee).toBe(12.5);
    expect(submitted.privateData.turnaroundHours).toBe(36);
    expect(submitted.publicData.laundryProfile.businessHours).toBe('Mon-Fri 09-19');
    expect(submitted.publicData.laundryProfile.studioName).toBe('Studio Pigalle');
    expect(submitted.publicData.laundryProfile.origin).toEqual(ORIGIN);
    expect(submitted.publicData.acceptedCategories).toEqual(['Eveningwear', 'Sequins']);
  });

  // cleaningFee has no `validate` on the form, so an emptied field submits as
  // null. The page must not let that erase the stored fee — every future
  // booking's price depends on it.
  it('never writes a null over a saved cleaningFee if the field is emptied', async () => {
    const onUpdateProfile = jest.fn();
    await act(async () => {
      render(
        <LaundryProfilePageComponent
          intl={fakeIntl}
          currentUser={laundryUser}
          scrollingDisabled={false}
          onUpdateProfile={onUpdateProfile}
          updateProfileInProgress={false}
          updateProfileError={null}
        />
      );
    });

    await act(async () => {
      await userEvent.clear(screen.getByDisplayValue('12.5'));
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' }));
    });

    expect(onUpdateProfile).toHaveBeenCalledTimes(1);
    expect(onUpdateProfile.mock.calls[0][0].privateData.cleaningFee).toBe(12.5);
  });

  it('renders NotFoundPage for a non-laundry user', async () => {
    const ordinaryUser = {
      ...laundryUser,
      attributes: {
        ...laundryUser.attributes,
        profile: { ...laundryUser.attributes.profile, metadata: { isLaundry: false } },
      },
    };

    await act(async () => {
      renderPage(ordinaryUser);
    });

    expect(screen.queryByDisplayValue('Studio Pigalle')).not.toBeInTheDocument();
  });
});
