import React from 'react';
import '@testing-library/jest-dom';

import { types as sdkTypes } from '../../util/sdkLoader';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import SectionMapMaybe from './SectionMapMaybe';

const { screen } = testingLibrary;
const { UUID } = sdkTypes;

const listingId = new UUID('listing-1');
const geolocation = { lat: 48.8797, lng: 2.3378 };
// No map provider API key is configured under test, so <Map> renders an empty
// div. That is fine and intentional here: what is under test is the ADDRESS
// TEXT, which is the half that was missing.
const mapsConfig = { fuzzy: { enabled: false } };

const LAUNDRY_ADDRESS = '21 Rue Frochot, 75009 Paris';
const OWNER_HOME_ADDRESS = '4 Owner Street, 69002 Lyon';

describe('SectionMapMaybe', () => {
  it('shows the assigned laundry studio name and address as text', () => {
    render(
      <SectionMapMaybe
        geolocation={geolocation}
        publicData={{
          pickupAddress: LAUNDRY_ADDRESS,
          assignedLaundryName: 'Studio Pigalle',
        }}
        listingId={listingId}
        mapsConfig={mapsConfig}
      />
    );

    expect(screen.getByRole('heading', { name: 'ListingPage.locationTitle' })).toBeInTheDocument();
    expect(screen.getByText('Studio Pigalle')).toBeInTheDocument();
    expect(screen.getByText(LAUNDRY_ADDRESS)).toBeInTheDocument();
    expect(screen.getByText('ListingPage.pickupLocationNote')).toBeInTheDocument();
  });

  it('shows the address alone when the assigned laundry has no studio name', () => {
    render(
      <SectionMapMaybe
        geolocation={geolocation}
        publicData={{ pickupAddress: LAUNDRY_ADDRESS }}
        listingId={listingId}
        mapsConfig={mapsConfig}
      />
    );

    expect(screen.getByText(LAUNDRY_ADDRESS)).toBeInTheDocument();
  });

  // THE PRIVACY REGRESSION TEST. On listings created before
  // EditListingLocationPanel was repurposed, `publicData.location` holds the
  // OWNER'S OWN HOME ADDRESS. ListingPage is public. getPickupLocation falls
  // back to that value on purpose (so legacy listings still render a map
  // caption), and this section must NOT print it.
  it('does not print a legacy publicData.location when no laundry is assigned', () => {
    render(
      <SectionMapMaybe
        geolocation={geolocation}
        publicData={{ location: { address: OWNER_HOME_ADDRESS, building: 'Apt 3' } }}
        listingId={listingId}
        mapsConfig={mapsConfig}
      />
    );

    // The section itself still renders — the map is still legitimate.
    expect(screen.getByRole('heading', { name: 'ListingPage.locationTitle' })).toBeInTheDocument();
    expect(screen.queryByText(OWNER_HOME_ADDRESS)).not.toBeInTheDocument();
    expect(screen.queryByText('Apt 3')).not.toBeInTheDocument();
    expect(screen.queryByText('ListingPage.pickupLocationNote')).not.toBeInTheDocument();
  });

  it('renders nothing at all when there is neither a geolocation nor a laundry address', () => {
    const { container } = render(
      <SectionMapMaybe publicData={{}} listingId={listingId} mapsConfig={mapsConfig} />
    );

    expect(container.querySelector('#listing-location')).toBeNull();
  });

  // A laundry is always assigned with coordinates (the assignment endpoint
  // refuses a studio with no usable `origin`), but an address a renter can read
  // is worth more than the map it came with, so a missing geolocation must not
  // swallow it.
  it('still shows the address when the listing has no geolocation', () => {
    render(
      <SectionMapMaybe
        publicData={{ pickupAddress: LAUNDRY_ADDRESS, assignedLaundryName: 'Studio Pigalle' }}
        listingId={listingId}
        mapsConfig={mapsConfig}
      />
    );

    expect(screen.getByText(LAUNDRY_ADDRESS)).toBeInTheDocument();
  });
});
