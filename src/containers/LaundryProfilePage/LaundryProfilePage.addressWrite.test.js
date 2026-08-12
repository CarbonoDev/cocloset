// ── THE SPLIT WRITE ──────────────────────────────────────────────────────────────
//
//   > "Igual podemos hacer una llamada secundaria que solo guarde la dirección, el
//   >  resto se sigue guardando igual, pero la dirección (aun en publicData) se guarda
//   >  a través de integration API"
//
// One submit produces two different writes, and which value goes where is the whole
// rule:
//   * the ordinary `currentUser.updateProfile` write carries the STORED address back
//     verbatim. Not the submitted one - that would move the address through the
//     ungated path. And not nothing - `laundryProfile` is ONE top-level extended-data
//     key holding a nested object, so omitting the address DELETES it.
//   * the submitted address is handed over separately, for the gated server call, and
//     only when it actually differs and the studio may currently change it.
//
// WHY THIS FILE STUBS THE FORM. Reaching the "studio submits a different address"
// case through the real UI means driving FieldLocationAutocompleteInput's debounced
// geocoder prediction list (300ms/1000ms, a mocked Mapbox client, a click on a
// transient list). That is a great deal of machinery standing between the test and a
// rule that is four lines of the page. LaundryProfilePage.test.js covers the real form
// end to end - including the alert and the lock - so what is left here is the rule
// itself, exercised directly through the form's own `onSubmit` contract.
import React from 'react';
import '@testing-library/jest-dom';

let capturedProps = null;

jest.mock('./LaundryProfileForm/LaundryProfileForm', () => props => {
  capturedProps = props;
  return null;
});

const { types: sdkTypes } = require('../../util/sdkLoader');
const { fakeIntl } = require('../../util/testData');
const { renderWithProviders: render } = require('../../util/testHelpers');
const { LaundryProfilePageComponent } = require('./LaundryProfilePage');

const { LatLng } = sdkTypes;

const OLD_ORIGIN = new LatLng(48.879, 2.337);
const OLD_ADDRESS = '21 Rue Frochot, Paris';
const NEW_ORIGIN = new LatLng(48.857, 2.359);
const NEW_ADDRESS = '5 Rue des Rosiers, 75004 Paris';

const noop = () => null;

const laundryUser = ({ laundryProfile, metadata = {} } = {}) => ({
  id: { uuid: 'laundry-user-id' },
  type: 'currentUser',
  attributes: {
    email: 'test-laundry-cocloset@example.com',
    profile: {
      displayName: 'Pigalle Pressing',
      publicData: {
        laundryProfile:
          laundryProfile === undefined
            ? {
                studioName: 'Studio Pigalle',
                address: OLD_ADDRESS,
                origin: OLD_ORIGIN,
                businessHours: 'Mon-Sat 11-21',
              }
            : laundryProfile,
        acceptedCategories: ['dresses'],
      },
      privateData: { turnaroundDays: 3 },
      metadata: { isLaundry: true, ...metadata },
    },
  },
});

const renderPage = (currentUser, onUpdateProfile = noop) => {
  capturedProps = null;
  render(
    <LaundryProfilePageComponent
      intl={fakeIntl}
      currentUser={currentUser}
      scrollingDisabled={false}
      onUpdateProfile={onUpdateProfile}
      updateProfileInProgress={false}
      updateProfileError={null}
    />
  );
  return capturedProps;
};

// The values the real form hands to `onSubmit`, with whatever address is being tried.
const submitValues = ({ address, origin }) => ({
  studioName: 'Studio Pigalle',
  businessHours: 'Mon-Sat 11-21',
  turnaroundDays: 3,
  acceptedCategories: ['dresses'],
  location: address && origin ? { search: address, selectedPlace: { address, origin } } : null,
});

describe('LaundryProfilePage address write split', () => {
  it('sends the new address separately and keeps the stored one on the profile write', () => {
    const onUpdateProfile = jest.fn();
    const props = renderPage(
      laundryUser({ metadata: { addressChangeAllowed: true } }),
      onUpdateProfile
    );

    props.onSubmit(submitValues({ address: NEW_ADDRESS, origin: NEW_ORIGIN }));

    const [profile, addressChange] = onUpdateProfile.mock.calls[0];
    // The ungated write cannot move the address.
    expect(profile.publicData.laundryProfile.address).toBe(OLD_ADDRESS);
    expect(profile.publicData.laundryProfile.origin).toEqual(OLD_ORIGIN);
    // The gated call gets the new one.
    expect(addressChange).toEqual({ address: NEW_ADDRESS, origin: NEW_ORIGIN });
  });

  it('asks for no address change when the submitted address is unchanged', () => {
    const onUpdateProfile = jest.fn();
    const props = renderPage(
      laundryUser({ metadata: { addressChangeAllowed: true } }),
      onUpdateProfile
    );

    props.onSubmit(submitValues({ address: OLD_ADDRESS, origin: OLD_ORIGIN }));

    // No grant is spent on a no-op re-save of another field.
    expect(onUpdateProfile.mock.calls[0][1]).toBeNull();
  });

  // Same address text, different coordinates: still a move, and still has to
  // propagate, or the listings' `geolocation` silently disagrees with the profile's.
  it('treats a changed origin at the same address text as a change', () => {
    const onUpdateProfile = jest.fn();
    const props = renderPage(
      laundryUser({ metadata: { addressChangeAllowed: true } }),
      onUpdateProfile
    );

    props.onSubmit(submitValues({ address: OLD_ADDRESS, origin: NEW_ORIGIN }));

    expect(onUpdateProfile.mock.calls[0][1]).toEqual({
      address: OLD_ADDRESS,
      origin: NEW_ORIGIN,
    });
  });

  // The disabled input is UX; this is the client-side half of the rule. (The server
  // takes the same decision again - and even that gates only our own write path.)
  it('does not ask for an address change when the studio may not change it', () => {
    const onUpdateProfile = jest.fn();
    const props = renderPage(laundryUser(), onUpdateProfile);

    props.onSubmit(submitValues({ address: NEW_ADDRESS, origin: NEW_ORIGIN }));

    const [profile, addressChange] = onUpdateProfile.mock.calls[0];
    expect(addressChange).toBeNull();
    expect(profile.publicData.laundryProfile.address).toBe(OLD_ADDRESS);
  });

  // ONBOARDING. Nothing stored to preserve, so the keys are omitted rather than
  // written as undefined, and the gated call is what puts the address there.
  it('omits the address keys and sends the first address when nothing is stored', () => {
    const onUpdateProfile = jest.fn();
    const props = renderPage(
      laundryUser({ laundryProfile: { studioName: 'Studio Pigalle' } }),
      onUpdateProfile
    );

    props.onSubmit(submitValues({ address: NEW_ADDRESS, origin: NEW_ORIGIN }));

    const [profile, addressChange] = onUpdateProfile.mock.calls[0];
    expect(profile.publicData.laundryProfile).not.toHaveProperty('address');
    expect(profile.publicData.laundryProfile).not.toHaveProperty('origin');
    expect(addressChange).toEqual({ address: NEW_ADDRESS, origin: NEW_ORIGIN });
  });

  // Profiles seeded through the Integration API / a script store `origin` as plain
  // JSON. Re-saving normalises it to the LatLng a browser write stores, rather than
  // round-tripping two shapes of the same coordinate.
  it('rehydrates a plain-JSON stored origin before re-sending it', () => {
    const onUpdateProfile = jest.fn();
    const props = renderPage(
      laundryUser({
        laundryProfile: {
          studioName: 'Studio Pigalle',
          address: OLD_ADDRESS,
          origin: { lat: 48.879, lng: 2.337 },
        },
      }),
      onUpdateProfile
    );

    props.onSubmit(submitValues({ address: OLD_ADDRESS, origin: OLD_ORIGIN }));

    const [profile] = onUpdateProfile.mock.calls[0];
    expect(profile.publicData.laundryProfile.origin).toBeInstanceOf(LatLng);
    expect(profile.publicData.laundryProfile.origin).toEqual(OLD_ORIGIN);
  });

  // The two booleans the form renders the alert and the lock from.
  it('derives the alert and lock flags from the stored profile and the grant', () => {
    expect(renderPage(laundryUser())).toMatchObject({
      hasUsableAddress: true,
      addressEditable: false,
    });
    expect(renderPage(laundryUser({ metadata: { addressChangeAllowed: true } }))).toMatchObject({
      hasUsableAddress: true,
      addressEditable: true,
    });
    expect(renderPage(laundryUser({ laundryProfile: {} }))).toMatchObject({
      hasUsableAddress: false,
      addressEditable: true,
    });
    // An address with no usable coordinates: excluded by the server just as hard, so
    // the alert fires AND the field stays editable.
    expect(renderPage(laundryUser({ laundryProfile: { address: OLD_ADDRESS } }))).toMatchObject({
      hasUsableAddress: false,
      addressEditable: true,
    });
  });
});
