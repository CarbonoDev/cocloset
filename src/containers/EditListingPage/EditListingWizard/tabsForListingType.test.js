import { tabsForListingType } from './EditListingWizard';

// tabsForListingType falls back to the `default-inquiry` tab list for any process name it
// does not recognise. That fallback is silent — no error, no warning — so when Cocloset
// moved onto its own `cocloset-booking` process and the map still only knew
// `default-booking`, the live wizard quietly dropped the Laundry Assignment and
// Availability steps. Both panels were fully built and wired; they simply never rendered,
// and the only signal was a person noticing two steps were gone.
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
  it('gives cocloset-booking the laundry and availability steps', () => {
    const tabs = tabsForListingType('cocloset-booking', listingTypeConfig);

    expect(tabs).toContain('laundry');
    expect(tabs).toContain('availability');
  });

  it('does not leave cocloset-booking on the unknown-process fallback', () => {
    // The tell-tale of the bug: an unrecognised process silently resolves to the inquiry
    // layout. Comparing against it directly means a future rename of the process — or of
    // the map key — fails here rather than in someone's browser.
    const cocloset = tabsForListingType('cocloset-booking', listingTypeConfig);
    const unknownProcessFallback = tabsForListingType('not-a-real-process', listingTypeConfig);

    expect(cocloset).not.toEqual(unknownProcessFallback);
  });

  it('orders the steps the way the wizard is designed to run', () => {
    // Order is load-bearing, not cosmetic: the first tab creates the draft listing and the
    // last one publishes it.
    expect(tabsForListingType('cocloset-booking', listingTypeConfig)).toEqual([
      'details',
      'location',
      'pricing',
      'laundry',
      'availability',
      'photos',
    ]);
  });

  it('still resolves the stock booking process unchanged', () => {
    expect(tabsForListingType('default-booking', listingTypeConfig)).toEqual(
      tabsForListingType('cocloset-booking', listingTypeConfig)
    );
  });

  it('keeps falling back for a genuinely unknown process', () => {
    const tabs = tabsForListingType('some-future-process', listingTypeConfig);

    expect(tabs).not.toContain('laundry');
    expect(tabs[0]).toEqual('details');
  });
});
