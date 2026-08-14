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
// turnaroundDays, which is the kind of value B6 silently destroyed (it was cleaningFee
// at the time; the fee has since moved into the server environment).
//
// The privateData also carries a legacy `cleaningFee`, which is exactly what a real Dev
// profile looks like after the fee moved out: dead data that must neither be shown nor
// written back.
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
      privateData: { turnaroundDays: 3, cleaningFee: 12.5 },
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
  // fields, saved, and their configured values were wiped.
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
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
    // The legacy stored fee has no input to appear in any more.
    expect(screen.queryByDisplayValue('12.5')).not.toBeInTheDocument();
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
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
  });

  it('submits the saved turnaroundDays unchanged when only another field is edited', async () => {
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
    expect(submitted.privateData.turnaroundDays).toBe(3);
    // No fee is written at all, not even the one still sitting in storage: re-sending it
    // would keep a value alive that nothing reads and the studio cannot see.
    expect(submitted.privateData.cleaningFee).toBeUndefined();
    expect(submitted.privateData).not.toHaveProperty('cleaningFee');
    expect(submitted.publicData.laundryProfile.businessHours).toBe('Mon-Fri 09-19');
    expect(submitted.publicData.laundryProfile.studioName).toBe('Studio Pigalle');
    expect(submitted.publicData.laundryProfile.origin).toEqual(ORIGIN);
    expect(submitted.publicData.acceptedCategories).toEqual(['Eveningwear', 'Sequins']);
  });

  // An emptied number field submits as null, and a null turnaround would change how long
  // every listing this studio handles stays blocked after a rental. Two independent things
  // stop that: the field is `required`, so the form refuses to submit at all (asserted
  // here), and the page's `preserved()` guard would keep the stored value even if a submit
  // did get through with an absent one (asserted in the round-trip tests below, where a
  // save that touches only another field still writes turnaroundDays: 3).
  it('refuses to save at all when the studio-wide turnaround is emptied', async () => {
    const onUpdateProfile = jest.fn();
    await act(async () => {
      renderPage(laundryUser, onUpdateProfile);
    });

    await act(async () => {
      await userEvent.clear(screen.getByDisplayValue('3'));
    });

    const saveButton = screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' });
    expect(saveButton).toBeDisabled();

    await act(async () => {
      await userEvent.click(saveButton);
    });

    expect(onUpdateProfile).not.toHaveBeenCalled();
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

  // ================ The address: the alert, the lock, and the split write ============
  //
  // The two booleans the form renders from are DERIVED here, from the stored profile
  // and the admin-granted `metadata.addressChangeAllowed`. util/laundryProfile.js owns
  // the rules (and is parity-tested against the server's own predicates); these tests
  // assert this page wires the right currentUser into them.

  const withLaundryProfile = (laundryProfile, metadata = {}) => ({
    ...laundryUser,
    attributes: {
      ...laundryUser.attributes,
      profile: {
        ...laundryUser.attributes.profile,
        metadata: { ...laundryUser.attributes.profile.metadata, ...metadata },
        publicData: { ...laundryUser.attributes.profile.publicData, laundryProfile },
      },
    },
  });

  // By id, not by testid: the Topbar renders its own location search on this page, so
  // `getByTestId('location-search')` finds two.
  const addressInput = () => document.getElementById('LaundryProfileForm.location');

  it('warns a studio with no address that nothing can be assigned to it, and lets it set one', async () => {
    await act(async () => {
      renderPage(withLaundryProfile({ studioName: 'Studio Pigalle', businessHours: 'Mon-Sat' }));
    });

    expect(screen.getByText('LaundryProfileForm.noAddressAlertTitle')).toBeInTheDocument();
    // Onboarding must always work.
    expect(addressInput()).toBeEnabled();
  });

  // THE TRAP. An address string with no geocoded coordinates is dropped by
  // /api/laundries exactly as hard as no address at all, so the alert has to fire for
  // it too - otherwise the studio reads "you have an address" and still receives
  // nothing - and the field has to stay editable so it can be fixed.
  it('warns a studio whose address has no usable coordinates, and lets it fix it', async () => {
    await act(async () => {
      renderPage(withLaundryProfile({ studioName: 'Studio Pigalle', address: '21 Rue Frochot' }));
    });

    expect(screen.getByText('LaundryProfileForm.noAddressAlertTitle')).toBeInTheDocument();
    expect(addressInput()).toBeEnabled();
  });

  it('locks the address of a studio with a complete profile and no grant', async () => {
    await act(async () => {
      renderPage(laundryUser);
    });

    expect(screen.queryByText('LaundryProfileForm.noAddressAlertTitle')).not.toBeInTheDocument();
    expect(addressInput()).toBeDisabled();
    expect(screen.getByText('LaundryProfileForm.addressChangeRequiresSupport')).toBeInTheDocument();
  });

  it('opens the address of a studio an admin has granted a change to', async () => {
    await act(async () => {
      renderPage(
        withLaundryProfile(laundryUser.attributes.profile.publicData.laundryProfile, {
          addressChangeAllowed: true,
        })
      );
    });

    expect(addressInput()).toBeEnabled();
    expect(screen.getByText('LaundryProfileForm.addressChangeGranted')).toBeInTheDocument();
  });

  // A permission a string could satisfy is not a permission.
  it('does not open the address for a truthy-but-not-true grant', async () => {
    await act(async () => {
      renderPage(
        withLaundryProfile(laundryUser.attributes.profile.publicData.laundryProfile, {
          addressChangeAllowed: 'true',
        })
      );
    });

    expect(addressInput()).toBeDisabled();
  });

  // THE SPLIT WRITE. The ordinary profile save must carry the STORED address back
  // verbatim, never a submitted one: `laundryProfile` is ONE top-level extended-data
  // key holding a nested object, so omitting the address would DELETE it, and
  // forwarding a submitted one would move it through the ungated path.
  it('re-sends the stored address on the ordinary profile write, and asks for no address change', async () => {
    const onUpdateProfile = jest.fn();
    await act(async () => {
      renderPage(laundryUser, onUpdateProfile);
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('checkbox', { name: 'Pants' }));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' }));
    });

    expect(onUpdateProfile).toHaveBeenCalledTimes(1);
    const [profile, addressChange] = onUpdateProfile.mock.calls[0];
    expect(profile.publicData.laundryProfile.address).toBe('21 Rue Frochot, Paris');
    expect(profile.publicData.laundryProfile.origin).toEqual(ORIGIN);
    // Nothing changed about the address, so no grant is spent on a no-op.
    expect(addressChange).toBeNull();
  });

  // What happens when the studio submits a DIFFERENT address is tested in
  // LaundryProfilePage.addressWrite.test.js: selecting a place here means driving the
  // geocoder's debounced prediction list, which is a lot of machinery to stand between
  // a test and the one-line rule it is checking. That file stubs the form and calls
  // its `onSubmit` directly.

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

// ── PER-CATEGORY TURNAROUND: STORAGE ROUND-TRIP ──────────────────────────────
// The form holds these as FLAT fields (`categoryPricing__turnaroundDays__dresses`)
// because React Final Form reads dots in a field name as a path and Console category
// ids are free-form operator input. The nested `privateData.categoryPricing` object is
// assembled on submit — these tests pin both directions.
describe('LaundryProfilePage per-category turnaround', () => {
  const daysInput = categoryId =>
    document.getElementById(`LaundryProfileForm.categoryPricing__turnaroundDays__${categoryId}`);

  const withPricing = (acceptedCategories, categoryPricing) => ({
    ...laundryUser,
    attributes: {
      ...laundryUser.attributes,
      profile: {
        ...laundryUser.attributes.profile,
        publicData: { ...laundryUser.attributes.profile.publicData, acceptedCategories },
        privateData: { ...laundryUser.attributes.profile.privateData, categoryPricing },
      },
    },
  });

  it('prefills the boxes from the stored table', async () => {
    await act(async () => {
      renderPage(
        withPricing(['dresses', 'pants'], {
          dresses: { turnaroundDays: 5 },
          pants: { turnaroundDays: 1 },
        })
      );
    });

    expect(daysInput('dresses')).toHaveValue(5);
    expect(daysInput('pants')).toHaveValue(1);
  });

  it('ignores legacy per-category fees stored in the same table', async () => {
    // A real Dev profile still holds fee rows. They must not resurface as inputs, and
    // (see below) must not be written back on the next save either.
    await act(async () => {
      renderPage(
        withPricing(['dresses', 'midi_dress'], {
          dresses: { turnaroundDays: 5, cleaningFee: 15 },
          midi_dress: { cleaningFee: 22 },
        })
      );
    });

    expect(daysInput('dresses')).toHaveValue(5);
    expect(screen.queryByDisplayValue('15')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('22')).not.toBeInTheDocument();
  });

  it('saves what was typed as a nested categoryPricing object', async () => {
    const onUpdateProfile = jest.fn();
    await act(async () => {
      renderPage(withPricing(['dresses', 'pants'], undefined), onUpdateProfile);
    });

    await act(async () => {
      await userEvent.type(daysInput('dresses'), '5');
      await userEvent.type(daysInput('pants'), '1');
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' }));
    });

    expect(onUpdateProfile).toHaveBeenCalledTimes(1);
    expect(onUpdateProfile.mock.calls[0][0].privateData.categoryPricing).toEqual({
      dresses: { turnaroundDays: 5 },
      pants: { turnaroundDays: 1 },
    });
    // The studio-wide value is untouched — it is the fallback, not a duplicate.
    expect(onUpdateProfile.mock.calls[0][0].privateData.turnaroundDays).toBe(3);
  });

  it('does not write a legacy per-category cleaningFee back into storage', async () => {
    // Sharetribe merges privateData per TOP-LEVEL key, so the whole categoryPricing
    // object is replaced on every save. That is what finally retires the stored fees: the
    // rebuilt table contains turnaround only.
    const onUpdateProfile = jest.fn();
    await act(async () => {
      renderPage(
        withPricing(['dresses'], { dresses: { turnaroundDays: 5, cleaningFee: 15 } }),
        onUpdateProfile
      );
    });

    await act(async () => {
      await userEvent.clear(daysInput('dresses'));
      await userEvent.type(daysInput('dresses'), '4');
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' }));
    });

    expect(onUpdateProfile.mock.calls[0][0].privateData.categoryPricing).toEqual({
      dresses: { turnaroundDays: 4 },
    });
  });

  it('DROPS a stored turnaround for a category the studio un-ticked', async () => {
    //   > "si luego hace uncheck, el dato de turnaround aun se guarda, pero debe ser el
    //   >  default, no el que haya escrito ya que la propiedad se desmarcó"
    //
    // `pants` is in the tree, so the studio saw its checkbox and left it un-ticked. That is
    // a decision, and the value goes - the garment falls back to the studio-wide turnaround.
    // It survived before because the input UNMOUNTS while its final-form value does not, so
    // the abandoned number was rebuilt into the table and saved, and came back as the
    // pre-filled default when the garment was returned.
    const onUpdateProfile = jest.fn();
    await act(async () => {
      renderPage(
        withPricing(['dresses'], {
          dresses: { turnaroundDays: 5 },
          pants: { turnaroundDays: 1 },
        }),
        onUpdateProfile
      );
    });

    await act(async () => {
      await userEvent.clear(daysInput('dresses'));
      await userEvent.type(daysInput('dresses'), '4');
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' }));
    });

    expect(onUpdateProfile.mock.calls[0][0].privateData.categoryPricing).toEqual({
      dresses: { turnaroundDays: 4 },
    });
  });

  it('RETAINS a stored turnaround for a category that is not in the tree at all', async () => {
    // The distinction that keeps the pruning safe. `blazers` is not in this marketplace's
    // category tree, so the studio never saw a checkbox for it and its absence from the
    // accepted list is not a decision. Deleting it would mean one empty hosted-asset fetch
    // could wipe a studio's whole table - the failure server/api-util/categoryPricing.js has
    // warned about since it was written. It stays, and the form surfaces it as orphaned.
    const onUpdateProfile = jest.fn();
    await act(async () => {
      renderPage(
        withPricing(['dresses'], {
          dresses: { turnaroundDays: 5 },
          blazers: { turnaroundDays: 6 },
        }),
        onUpdateProfile
      );
    });

    await act(async () => {
      await userEvent.clear(daysInput('dresses'));
      await userEvent.type(daysInput('dresses'), '4');
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' }));
    });

    expect(onUpdateProfile.mock.calls[0][0].privateData.categoryPricing).toEqual({
      dresses: { turnaroundDays: 4 },
      blazers: { turnaroundDays: 6 },
    });
  });

  it('lets the studio clear a retained value on purpose', async () => {
    const onUpdateProfile = jest.fn();
    await act(async () => {
      renderPage(
        withPricing(['dresses'], {
          dresses: { turnaroundDays: 5 },
          retired_category: { turnaroundDays: 1 },
        }),
        onUpdateProfile
      );
    });

    await act(async () => {
      await userEvent.click(screen.getByTitle('LaundryProfileForm.categoryPricingOrphanedRemove'));
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' }));
    });

    expect(onUpdateProfile.mock.calls[0][0].privateData.categoryPricing).toEqual({
      dresses: { turnaroundDays: 5 },
    });
  });

  it('drops a cleared box rather than storing a null over it', async () => {
    // An empty box means "use the studio-wide value", which is the key being absent.
    // A stored null would be a row that means nothing and has to be skipped on read.
    const onUpdateProfile = jest.fn();
    await act(async () => {
      renderPage(withPricing(['dresses'], { dresses: { turnaroundDays: 5 } }), onUpdateProfile);
    });

    await act(async () => {
      await userEvent.clear(daysInput('dresses'));
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'LaundryProfileForm.saveChanges' }));
    });

    expect(onUpdateProfile.mock.calls[0][0].privateData.categoryPricing).toEqual({});
  });
});
