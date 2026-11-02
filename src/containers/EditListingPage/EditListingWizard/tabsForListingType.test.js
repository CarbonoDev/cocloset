import { tabsForListingType } from './EditListingWizard';

// tabsForListingType falls back to the `default-inquiry` tab list for any process name it
// does not recognise. That fallback is silent — no error, no warning — so when Cocloset
// moved onto its own `cocloset-booking` process and the map still only knew
// `default-booking`, the live wizard quietly dropped the Laundry Assignment and
// Availability steps. Both panels were fully built and wired; they simply never rendered,
// and the only signal was a person noticing two steps were gone.
//
// `cocloset-booking` has since stopped mirroring `default-booking`: it runs
// Photos → Details → Pricing → Laundry, with no Location and no Availability step. The
// tests below pin that divergence in both directions, because "the two processes resolve
// identically" was itself an assertion here until the reorder.
const listingTypeConfig = {
  defaultListingFields: {
    location: true,
    price: true,
    availability: true,
    images: true,
    shipping: false,
    pickup: false,
    stock: false,
  },
};

describe('tabsForListingType', () => {
  it('gives cocloset-booking the laundry step', () => {
    expect(tabsForListingType('cocloset-booking', listingTypeConfig)).toContain('laundry');
  });

  it('does not leave cocloset-booking on the unknown-process fallback', () => {
    // The tell-tale of the original bug: an unrecognised process silently resolves to the
    // inquiry layout. Comparing against it directly means a future rename of the process —
    // or of the map key — fails here rather than in someone's browser.
    const cocloset = tabsForListingType('cocloset-booking', listingTypeConfig);
    const unknownProcessFallback = tabsForListingType('not-a-real-process', listingTypeConfig);

    expect(cocloset).not.toEqual(unknownProcessFallback);
  });

  it('orders the steps the way the wizard is designed to run', () => {
    // Order is load-bearing, not cosmetic. Photos is first but does NOT create the draft
    // (see EditListingWizardTab's onCompleteEditListingWizardTab — creation is pinned to
    // the details tab); laundry is last, and submitting the last tab is what publishes.
    expect(tabsForListingType('cocloset-booking', listingTypeConfig)).toEqual([
      'photos',
      'details',
      'pricing',
      'laundry',
    ]);
  });

  it('drops the location step for cocloset-booking even when the listing type enables it', () => {
    // `location: true` above would add LOCATION to any other process's list. The public
    // pickup address comes from the assigned laundry instead, and the owner's own private
    // address moved onto the details panel — so the tab has no remaining job here.
    expect(tabsForListingType('cocloset-booking', listingTypeConfig)).not.toContain('location');
  });

  it('drops the availability step for cocloset-booking even when the listing type enables it', () => {
    // Availability is written automatically at draft creation. If this tab ever comes back
    // into the array, the automatic write and the manual panel would both own the plan.
    expect(tabsForListingType('cocloset-booking', listingTypeConfig)).not.toContain('availability');
  });

  it('diverges from the stock booking process — deliberately', () => {
    // This assertion is the inverse of the one it replaced. The two lists used to be
    // required to be identical; equality now means the cocloset entry has been reverted to
    // a mirror of `default-booking` and the reorder has been lost.
    expect(tabsForListingType('cocloset-booking', listingTypeConfig)).not.toEqual(
      tabsForListingType('default-booking', listingTypeConfig)
    );
  });

  it('leaves the stock booking process exactly as it was', () => {
    // Other processes must not be collateral damage: default-booking keeps location,
    // availability, and photos-last.
    expect(tabsForListingType('default-booking', listingTypeConfig)).toEqual([
      'details',
      'location',
      'pricing',
      'laundry',
      'availability',
      'photos',
    ]);
  });

  it('keeps falling back for a genuinely unknown process', () => {
    const tabs = tabsForListingType('some-future-process', listingTypeConfig);

    expect(tabs).not.toContain('laundry');
    expect(tabs[0]).toEqual('details');
  });
});
