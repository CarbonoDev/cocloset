import React, { act } from 'react';
import '@testing-library/jest-dom';

import { types as sdkTypes } from '../../util/sdkLoader';
import { fakeIntl } from '../../util/testData';
import {
  getHostedConfiguration,
  renderWithProviders as render,
  testingLibrary,
} from '../../util/testHelpers';

import { LaundryProfilePageComponent } from './LaundryProfilePage';

const { screen, userEvent } = testingLibrary;
const { LatLng } = sdkTypes;

// The address field validates with `origin instanceof LatLng`, so the fixture
// has to use the real SDK type — that's what currentUser carries in the app.
const ORIGIN = new LatLng(48.882, 2.338);

const noop = () => null;

// A Console-shaped category tree covering the three shapes the hosted asset actually
// produces: a branch with children, a child with no `subcategories` key at all, and a
// top-level category with no children.
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
  window.mapboxgl = { accessToken: 'test' };
  window.mapboxSdk = () => ({
    geocoding: {
      forwardGeocode: () => ({ send: () => Promise.resolve({ body: { features: [] } }) }),
    },
  });
});

// A laundry user with a fully configured profile — in particular a saved
// cleaningFee, which is the value B6 silently destroyed.
//
// `acceptedCategories` is deliberately the OLD free-text shape. Real laundries have
// exactly this stored, and the multi-select migration must not lose it.
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

const withAcceptedCategories = acceptedCategories => ({
  ...laundryUser,
  attributes: {
    ...laundryUser.attributes,
    profile: {
      ...laundryUser.attributes.profile,
      publicData: { ...laundryUser.attributes.profile.publicData, acceptedCategories },
    },
  },
});

const renderPage = (currentUser, onUpdateProfile = noop) =>
  render(
    <LaundryProfilePageComponent
      intl={fakeIntl}
      currentUser={currentUser}
      scrollingDisabled={false}
      onUpdateProfile={onUpdateProfile}
      updateProfileInProgress={false}
      updateProfileError={null}
    />,
    { config: configWithCategories }
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
    // Accepted categories are no longer a comma-joined text input: the stored
    // free-text values now surface as legacy chips (see the legacy tests below).
    expect(screen.getByText('Eveningwear')).toBeInTheDocument();
    expect(screen.getByText('Sequins')).toBeInTheDocument();
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
        />,
        { config: configWithCategories }
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
      renderPage(laundryUser, onUpdateProfile);
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

  // Profiles seeded through the Integration API / scripts store `origin` as plain JSON,
  // not as a LatLng. The address validator requires `origin instanceof LatLng`, so those
  // laundries used to face a form that was silently, permanently invalid: no error shown
  // anywhere, "Save changes" never enabling, and no way to configure the studio at all.
  it('can be saved when the stored origin is plain JSON rather than a LatLng', async () => {
    const onUpdateProfile = jest.fn();
    const seededUser = {
      ...laundryUser,
      attributes: {
        ...laundryUser.attributes,
        profile: {
          ...laundryUser.attributes.profile,
          publicData: {
            ...laundryUser.attributes.profile.publicData,
            laundryProfile: {
              ...laundryUser.attributes.profile.publicData.laundryProfile,
              origin: { lat: 48.882, lng: 2.338 },
            },
          },
        },
      },
    };

    await act(async () => {
      renderPage(seededUser, onUpdateProfile);
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('checkbox', { name: 'Pants' }));
    });

    const saveButton = screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' });
    expect(saveButton).toBeEnabled();

    await act(async () => {
      await userEvent.click(saveButton);
    });

    expect(onUpdateProfile).toHaveBeenCalledTimes(1);
    expect(onUpdateProfile.mock.calls[0][0].publicData.laundryProfile.origin).toEqual(ORIGIN);
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

  // ================ Accepted categories: Console ids, not free text ================

  it('saves Console category IDs — not labels — when categories are ticked', async () => {
    const onUpdateProfile = jest.fn();
    await act(async () => {
      renderPage(withAcceptedCategories([]), onUpdateProfile);
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('checkbox', { name: 'Dresses' }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'Pants' }));
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' }));
    });

    // The whole point of the migration: what lands in publicData is the same
    // vocabulary the listing wizard compares against.
    expect(onUpdateProfile.mock.calls[0][0].publicData.acceptedCategories).toEqual([
      'dresses',
      'pants',
    ]);
  });

  it('pre-ticks the boxes for already-saved category ids, including subcategories', async () => {
    await act(async () => {
      renderPage(withAcceptedCategories(['dresses', 'midi_dress']));
    });

    expect(screen.getByRole('checkbox', { name: 'Dresses' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Midi Dress' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Maxi Dress' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Pants' })).not.toBeChecked();
  });

  // THE DATA-LOSS GUARD. Every laundry in the marketplace currently has free-text
  // values stored. Saving after this migration must not drop them just because they
  // aren't in Console's tree.
  it('keeps unrecognised legacy free-text values when the picker is used', async () => {
    const onUpdateProfile = jest.fn();
    await act(async () => {
      renderPage(laundryUser, onUpdateProfile);
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('checkbox', { name: 'Dresses' }));
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' }));
    });

    const saved = onUpdateProfile.mock.calls[0][0].publicData.acceptedCategories;
    expect(saved).toContain('Eveningwear');
    expect(saved).toContain('Sequins');
    expect(saved).toContain('dresses');
  });

  it('lets the laundry remove a legacy value deliberately', async () => {
    const onUpdateProfile = jest.fn();
    await act(async () => {
      renderPage(laundryUser, onUpdateProfile);
    });

    // fakeIntl/test messages don't interpolate {category}, so both chips' remove buttons
    // carry the same accessible name — index 0 is "Eveningwear".
    await act(async () => {
      const removeButtons = screen.getAllByRole('button', {
        name: 'LaundryProfileForm.acceptedCategoriesLegacyRemove',
      });
      expect(removeButtons).toHaveLength(2);
      await userEvent.click(removeButtons[0]);
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' }));
    });

    const saved = onUpdateProfile.mock.calls[0][0].publicData.acceptedCategories;
    expect(saved).not.toContain('Eveningwear');
    expect(saved).toEqual(['Sequins']);
  });
});
