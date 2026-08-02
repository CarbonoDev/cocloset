import { getPickupLocation, getListingPickupLocation } from './listingLocation';

describe('getPickupLocation()', () => {
  // THE REGRESSION TEST FOR B7. Repurposing EditListingLocationPanel stopped
  // anything writing `publicData.location` for booking listings, and five
  // display surfaces still read it — most visibly, the whole pickup/location
  // block disappeared from checkout.
  it('uses the assigned laundry as the pickup location', () => {
    expect(
      getPickupLocation({
        pickupAddress: '21 Rue Frochot, Paris',
        assignedLaundryName: 'Studio Pigalle',
        assignedLaundryId: 'laundry-1',
      })
    ).toEqual({ address: '21 Rue Frochot, Paris', building: 'Studio Pigalle' });
  });

  it('omits `building` when the laundry has no name, rather than emitting undefined', () => {
    expect(getPickupLocation({ pickupAddress: '21 Rue Frochot, Paris' })).toEqual({
      address: '21 Rue Frochot, Paris',
    });
  });

  it('prefers the laundry pickup address over a legacy publicData.location', () => {
    expect(
      getPickupLocation({
        pickupAddress: '21 Rue Frochot, Paris',
        assignedLaundryName: 'Studio Pigalle',
        location: { address: '4 Owner Street, Lyon', building: 'Apt 3' },
      })
    ).toEqual({ address: '21 Rue Frochot, Paris', building: 'Studio Pigalle' });
  });

  it('falls back to a legacy publicData.location on pre-existing listings', () => {
    expect(getPickupLocation({ location: { address: '4 Owner Street, Lyon' } })).toEqual({
      address: '4 Owner Street, Lyon',
    });
  });

  it('returns an empty object rather than null/undefined when there is nothing to show', () => {
    expect(getPickupLocation({})).toEqual({});
    expect(getPickupLocation(undefined)).toEqual({});
    expect(getPickupLocation(null)).toEqual({});
  });

  it('does not treat an empty-string pickupAddress as a usable address', () => {
    expect(getPickupLocation({ pickupAddress: '', location: { address: 'legacy' } })).toEqual({
      address: 'legacy',
    });
  });
});

describe('getListingPickupLocation()', () => {
  it('reads through a listing entity', () => {
    const listing = {
      id: { uuid: 'l1' },
      attributes: {
        publicData: { pickupAddress: '21 Rue Frochot, Paris', assignedLaundryName: 'Pigalle' },
      },
    };
    expect(getListingPickupLocation(listing)).toEqual({
      address: '21 Rue Frochot, Paris',
      building: 'Pigalle',
    });
  });

  it('tolerates a missing listing', () => {
    expect(getListingPickupLocation(undefined)).toEqual({});
    expect(getListingPickupLocation({})).toEqual({});
  });
});
