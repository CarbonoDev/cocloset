import { tabCompleted } from './EditListingWizard';

// The LAUNDRY tab's completion rule.
//
// `assignedLaundryId` moved from `publicData` to `metadata` so that the
// Marketplace API would refuse an owner's direct write to it (see
// server/api-util/laundryAssignment.js). This check is the place that move is most
// likely to be quietly reverted, and where a revert is hardest to notice: reading
// the wrong scope does not throw, it reads `undefined`, and the tab then reports
// itself incomplete forever. The owner saves successfully, is redirected forward,
// is bounced straight back, and is told nothing. That exact failure mode is why
// EditListingLaundryPanel already guards against assigning a laundry with no
// origin - this pins the other half of it.
//
// `config` is only consulted by other tabs' branches, so a minimal one is enough.
const config = { listing: { listingTypes: [] } };

const listing = attributes => ({ attributes, images: [] });

describe('tabCompleted: photos', () => {
  // cocloset-booking puts PHOTOS first, BEFORE the draft listing exists. Until DETAILS
  // creates that draft there is nothing to attach images to, so `ensureListing` hands this
  // check an image-less listing and `listing.images` is `[]` no matter how many photos the
  // owner uploaded. Reading only that field locks the second tab forever: the owner adds
  // photos, presses Next, and the wizard sends them straight back with no explanation.
  //
  // The uploads are real by then - `sdk.images.upload` takes no listing id, and the ids it
  // returns live in Redux (EditListingPage.uploadedImages) keyed by a client-side temp id.
  // `options.collectedImages` is EditListingPage's `pickRenderableImages` output, i.e. the
  // listing's own images plus those Redux-held ones.
  const image = { id: 'photo_1', imageId: { uuid: 'aaaa' } };

  it('is complete from images held only in Redux, with no listing yet', () => {
    expect(tabCompleted('photos', listing({}), config, { collectedImages: [image] })).toBe(true);
  });

  it('is incomplete when nothing has been uploaded at all', () => {
    expect(tabCompleted('photos', listing({}), config, { collectedImages: [] })).toBe(false);
  });

  it("is still complete from the listing's own images when Redux holds none", () => {
    // The edit flow and every details-first process. Passing no options at all must behave
    // exactly as it did before `collectedImages` existed.
    const withImages = { attributes: {}, images: [image] };

    expect(tabCompleted('photos', withImages, config)).toBe(true);
    expect(tabCompleted('photos', withImages, config, { collectedImages: [] })).toBe(true);
  });
});

describe('tabCompleted: laundry', () => {
  const geolocation = { lat: 48.857, lng: 2.359 };

  it('is complete when the geolocation and the assigned laundry are both set', () => {
    expect(
      tabCompleted(
        'laundry',
        listing({ geolocation, metadata: { assignedLaundryId: 'laundry-1' } }),
        config
      )
    ).toBe(true);
  });

  it('reads the assignment from metadata, NOT publicData', () => {
    // The regression guard. A listing carrying only the legacy owner-writable copy
    // must NOT pass: every reader now consults metadata, so passing the tab here
    // would walk the owner into a listing whose laundry nothing else can see.
    expect(
      tabCompleted(
        'laundry',
        listing({ geolocation, publicData: { assignedLaundryId: 'laundry-1' } }),
        config
      )
    ).toBe(false);
  });

  it('is incomplete with no assigned laundry at all', () => {
    expect(tabCompleted('laundry', listing({ geolocation, metadata: {} }), config)).toBe(false);
  });

  it('is incomplete without a geolocation, even with a laundry assigned', () => {
    // A laundry with no usable origin writes no geolocation, which leaves the
    // listing unpublishable. Requiring both keeps that visible as an incomplete
    // tab rather than a publish button that fails later.
    expect(
      tabCompleted(
        'laundry',
        listing({ geolocation: null, metadata: { assignedLaundryId: 'laundry-1' } }),
        config
      )
    ).toBe(false);
  });
});
