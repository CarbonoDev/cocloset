import { restructureListingTypes, LISTING_TYPE_PROCESS_OVERRIDES } from './configHelpers';

// Shape mirrors the real listings/listing-types.json asset (see Console).
const hostedListingType = (id, processName, alias, unitType = 'day') => ({
  id,
  label: id,
  unitType,
  availabilityType: 'oneSeat',
  transactionProcess: { name: processName, alias },
});

const listingTypesFromConfig = listingTypes => restructureListingTypes(listingTypes);

describe('configHelpers — custom transaction process override', () => {
  // Sharetribe Console only lets you pick Sharetribe's own built-in processes when editing a
  // listing type, so the hosted asset permanently reports `default-booking` even though
  // Cocloset's garment rentals must run on the custom `cocloset-booking` process. These tests
  // guard the code-side substitution that makes that possible — without it, every booking
  // silently starts on the wrong process and none of the laundry transitions exist.
  it('substitutes the custom process for an overridden listing type', () => {
    const listingTypes = [
      hostedListingType('garment-rental', 'default-booking', 'default-booking/release-1'),
    ];

    const [garmentRental] = listingTypesFromConfig(listingTypes);

    expect(garmentRental.transactionType.process).toEqual('cocloset-booking');
    expect(garmentRental.transactionType.alias).toEqual('cocloset-booking/release-1');
  });

  it('leaves the unit type and other hosted settings untouched', () => {
    const listingTypes = [
      hostedListingType('garment-rental', 'default-booking', 'default-booking/release-1'),
    ];

    const [garmentRental] = listingTypesFromConfig(listingTypes);

    // Per-day billing comes from Console and must survive the process substitution — a
    // 'fixed' unit type would charge a 2-day and an 11-day rental the same.
    expect(garmentRental.transactionType.unitType).toEqual('day');
    expect(garmentRental.listingType).toEqual('garment-rental');
    expect(garmentRental.availabilityType).toEqual('oneSeat');
  });

  it('does not touch listing types that are not overridden', () => {
    const listingTypes = [
      hostedListingType('3_day_rental', 'default-booking', 'default-booking/release-1', 'fixed'),
    ];

    const [legacyType] = listingTypesFromConfig(listingTypes);

    expect(legacyType.transactionType.process).toEqual('default-booking');
    expect(legacyType.transactionType.alias).toEqual('default-booking/release-1');
  });

  it('overrides only the mapped listing type when several are configured', () => {
    const listingTypes = [
      hostedListingType('3_day_rental', 'default-booking', 'default-booking/release-1', 'fixed'),
      hostedListingType('garment-rental', 'default-booking', 'default-booking/release-1'),
    ];

    const byId = Object.fromEntries(
      listingTypesFromConfig(listingTypes).map(lt => [lt.listingType, lt])
    );

    expect(byId['3_day_rental'].transactionType.alias).toEqual('default-booking/release-1');
    expect(byId['garment-rental'].transactionType.alias).toEqual('cocloset-booking/release-1');
  });

  it('yields null for a hosted listing type with no transaction process', () => {
    // Unchanged pre-existing behaviour. mergeListingConfig filters these out before anything
    // dereferences them — without that filter one malformed entry took down config parsing,
    // and with it the whole app.
    const listingTypes = [{ id: 'broken', label: 'Broken', unitType: 'day' }];

    expect(listingTypesFromConfig(listingTypes)).toEqual([null]);
  });

  it('keeps every override alias consistent with its process name', () => {
    // A mismatch here (e.g. process 'cocloset-booking' with a 'default-booking/...' alias)
    // would be accepted by the code but reject every transition at runtime.
    Object.entries(LISTING_TYPE_PROCESS_OVERRIDES).forEach(([, { process, alias }]) => {
      expect(alias.split('/')[0]).toEqual(process);
    });
  });
});
