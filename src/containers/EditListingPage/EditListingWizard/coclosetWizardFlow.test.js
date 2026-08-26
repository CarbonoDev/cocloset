import React from 'react';
import '@testing-library/jest-dom';

// The laundry panel talks to the app's own server. Both calls are mocked per-test: what
// this suite is about is which of them are made, and whether a refusal from one of them
// can stop a finished garment from being published.
jest.mock('../../../util/api', () => ({
  fetchLaundries: jest.fn(),
  assignListingLaundry: jest.fn(),
  // The details panel fetches the brands its autocomplete suggests. Resolved rather than left
  // undefined so these tests exercise the real 'the list never arrives is not an error' path
  // instead of blowing up on a missing mock.
  fetchBrands: jest.fn(() => Promise.resolve({ data: [] })),
}));

import { types as sdkTypes } from '../../../util/sdkLoader';
import { mergeConfig } from '../../../util/configHelpers';
import {
  LISTING_PAGE_PARAM_TYPE_DRAFT,
  LISTING_PAGE_PARAM_TYPE_NEW,
} from '../../../util/urlHelpers';
import { assignListingLaundry, fetchLaundries } from '../../../util/api';
import { ensureOwnListing } from '../../../util/data';
import { createCurrentUser, createImage, createOwnListing, fakeIntl } from '../../../util/testData';
import {
  getDefaultConfiguration,
  getHostedConfiguration,
  getRouteConfiguration,
  renderWithProviders as render,
  testingLibrary,
} from '../../../util/testHelpers';

import EditListingWizard from './EditListingWizard';
import EditListingWizardTab, { DETAILS, LAUNDRY, PHOTOS } from './EditListingWizardTab';

const { userEvent, waitFor } = testingLibrary;
const { UUID } = sdkTypes;

// https://en.wikipedia.org/wiki/Universally_unique_identifier#Nil_UUID - the placeholder id
// the /l/new route uses before a draft exists.
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const DRAFT_UUID = '11111111-1111-1111-1111-111111111111';

// The reordered cocloset-booking wizard. Pinned by tabsForListingType.test.js; repeated
// here because these tests are about what happens when each of these tabs is submitted.
const COCLOSET_TABS = ['photos', 'details', 'pricing', 'laundry'];

// Console cannot point a listing type at a custom transaction process, so the hosted asset
// says `default-booking` and LISTING_TYPE_PROCESS_OVERRIDES rewrites `garment-rental` to
// cocloset-booking as the config is merged. That rewrite is what puts this listing type on
// the reordered wizard, so the tests go through the real merge rather than hand-building a
// config that already says cocloset-booking.
const garmentRentalListingType = {
  id: 'garment-rental',
  label: 'Garment rental',
  transactionProcess: { name: 'default-booking', alias: 'default-booking/release-1' },
  unitType: 'day',
  availabilityType: 'oneSeat',
  defaultListingFields: { description: true },
};

const hostedConfig = (listingTypes = [garmentRentalListingType]) => ({
  ...getHostedConfiguration(),
  listingTypes: { listingTypes },
  // No configured listing fields: this suite is about the wizard's plumbing, and a required
  // extended-data field would only add form-filling noise to every test.
  listingFields: { listingFields: [] },
});

const mergedConfig = (listingTypes = [garmentRentalListingType]) =>
  mergeConfig(hostedConfig(listingTypes), getDefaultConfiguration());

const okResponse = uuid => ({ data: { data: { id: new UUID(uuid) } } });

const renderTab = (tab, overrides = {}) => {
  const { listingTypes, ...propOverrides } = overrides;
  const hosted = hostedConfig(listingTypes);
  const config = mergedConfig(listingTypes);
  const routeConfiguration = getRouteConfiguration(config.layout);

  const onCreateListingDraft = jest.fn(() => Promise.resolve(okResponse(DRAFT_UUID)));
  const onUpdateListing = jest.fn(() => Promise.resolve(okResponse(DRAFT_UUID)));
  const handlePublishListing = jest.fn();
  const history = { push: jest.fn(), replace: jest.fn() };

  const props = {
    tab,
    marketplaceTabs: COCLOSET_TABS,
    params: { id: NIL_UUID, slug: 'draft', type: LISTING_PAGE_PARAM_TYPE_NEW, tab },
    errors: {},
    fetchInProgress: false,
    handleCreateFlowTabScrolling: jest.fn(),
    handlePublishListing,
    history,
    images: [],
    // What EditListingPage always hands down before a draft exists: an id-less shell with
    // empty attributes, not null. The details panel destructures `publicData`.
    listing: ensureOwnListing(null),
    onCreateListingDraft,
    onUpdateListing,
    onImageUpload: jest.fn(),
    onRemoveImage: jest.fn(),
    onListingTypeChange: jest.fn(),
    onManageDisableScrolling: jest.fn(),
    updatedTab: null,
    updateInProgress: false,
    tabSubmitButtonText: `submit-${tab}`,
    config,
    routeConfiguration,
    titleId: 'EditListingPage.titleCreateListing',
    intl: fakeIntl,
    captureOwnerAddress: true,
    ...propOverrides,
  };

  const view = render(<EditListingWizardTab {...props} />, {
    config: hosted,
    routeConfiguration,
  });

  return { view, onCreateListingDraft, onUpdateListing, handlePublishListing, history, props };
};

const submitButton = view => view.getByRole('button', { name: /^submit-/ });

describe('cocloset-booking wizard: which tab creates the draft', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.scrollTo = jest.fn();
  });

  it('saves nothing when PHOTOS is submitted and no listing exists yet', async () => {
    // PHOTOS is the first tab, but `ownListings.createDraft` requires `title` and
    // `listingType` and this panel has neither. Creating here would either fail outright or
    // - worse - create a titleless draft. So the submit writes nothing at all; the uploaded
    // image ids stay in Redux and are handed to createDraft when DETAILS runs.
    const user = userEvent.setup();
    const { view, onCreateListingDraft, onUpdateListing, history } = renderTab(PHOTOS, {
      // Two, not one: the photos form requires MIN_LISTING_IMAGES to submit at all, and a
      // form that will not submit would pass this test for the wrong reason.
      images: [createImage('image-1'), createImage('image-2')],
    });

    await user.click(submitButton(view));

    await waitFor(() => {
      expect(history.push).toHaveBeenCalledTimes(1);
    });

    // The whole point: no API call of any kind.
    expect(onCreateListingDraft).not.toHaveBeenCalled();
    expect(onUpdateListing).not.toHaveBeenCalled();
  });

  it('advances from PHOTOS to DETAILS and leaves the URL on "new"', async () => {
    // The URL must stay `new` until a draft really exists, because
    // `redirectAfterDraftUpdate` performs the new -> draft swap on the first real save. A
    // premature `history.replace` would point the back button, and the next tab's submit,
    // at a draft id that does not exist.
    const user = userEvent.setup();
    const { view, history } = renderTab(PHOTOS, {
      images: [createImage('image-1'), createImage('image-2')],
    });

    await user.click(submitButton(view));

    await waitFor(() => {
      expect(history.push).toHaveBeenCalledWith(`/l/draft/${NIL_UUID}/new/details`);
    });
    expect(history.replace).not.toHaveBeenCalled();
  });

  it('creates the draft when DETAILS is submitted, carrying the images collected on PHOTOS', async () => {
    const user = userEvent.setup();
    const image = createImage('image-1');
    const { view, onCreateListingDraft, onUpdateListing } = renderTab(DETAILS, {
      images: [image],
    });

    await user.type(view.getByRole('textbox', { name: 'EditListingDetailsForm.title' }), 'A frock');
    await user.type(
      view.getByRole('textbox', { name: 'EditListingDetailsForm.description' }),
      'Lorem ipsum'
    );
    await user.type(
      view.getByRole('textbox', { name: 'EditListingDetailsForm.ownerStreet' }),
      'Main Street 123'
    );
    await user.type(
      view.getByRole('textbox', { name: 'EditListingDetailsForm.ownerCity' }),
      'Springfield'
    );
    await user.type(
      view.getByRole('textbox', { name: 'EditListingDetailsForm.ownerPostcode' }),
      '12345'
    );

    await user.click(submitButton(view));

    await waitFor(() => {
      expect(onCreateListingDraft).toHaveBeenCalledTimes(1);
    });
    expect(onUpdateListing).not.toHaveBeenCalled();

    const [values] = onCreateListingDraft.mock.calls[0];
    expect(values.title).toEqual('A frock');
    expect(values.publicData.listingType).toEqual('garment-rental');
    expect(values.publicData.transactionProcessAlias).toEqual('cocloset-booking/release-1');
    // The images uploaded on the earlier tab. The duck maps these to ids via `imageIds()`
    // on the create path exactly as it does on update.
    expect(values.images).toEqual([image]);
  });

  it('does not invent an images key when there is nothing collected', async () => {
    // Every process other than cocloset-booking still has DETAILS first, and must send
    // exactly what it sent before this change. `typeof images !== 'undefined'` is what the
    // duck branches on, so an empty array here would be a behaviour change for them.
    const user = userEvent.setup();
    const { view, onCreateListingDraft } = renderTab(DETAILS, { images: [] });

    await user.type(view.getByRole('textbox', { name: 'EditListingDetailsForm.title' }), 'A frock');
    await user.type(
      view.getByRole('textbox', { name: 'EditListingDetailsForm.description' }),
      'Lorem ipsum'
    );
    await user.type(
      view.getByRole('textbox', { name: 'EditListingDetailsForm.ownerStreet' }),
      'Main Street 123'
    );
    await user.type(
      view.getByRole('textbox', { name: 'EditListingDetailsForm.ownerCity' }),
      'Springfield'
    );
    await user.type(
      view.getByRole('textbox', { name: 'EditListingDetailsForm.ownerPostcode' }),
      '12345'
    );
    await user.click(submitButton(view));

    await waitFor(() => {
      expect(onCreateListingDraft).toHaveBeenCalledTimes(1);
    });
    expect(onCreateListingDraft.mock.calls[0][0]).not.toHaveProperty('images');
  });

  it('writes a full 24/7 availability plan in the same create call', async () => {
    // Nothing else writes one now the AVAILABILITY tab is gone from this process, and
    // OrderPanel gates its booking form on `availabilityPlan.timezone` - so without this
    // the listing would publish and then be unbookable, with nothing to show why.
    const user = userEvent.setup();
    const { view, onCreateListingDraft } = renderTab(DETAILS, { images: [createImage('i')] });

    await user.type(view.getByRole('textbox', { name: 'EditListingDetailsForm.title' }), 'A frock');
    await user.type(
      view.getByRole('textbox', { name: 'EditListingDetailsForm.description' }),
      'Lorem ipsum'
    );
    await user.type(
      view.getByRole('textbox', { name: 'EditListingDetailsForm.ownerStreet' }),
      'Main Street 123'
    );
    await user.type(
      view.getByRole('textbox', { name: 'EditListingDetailsForm.ownerCity' }),
      'Springfield'
    );
    await user.type(
      view.getByRole('textbox', { name: 'EditListingDetailsForm.ownerPostcode' }),
      '12345'
    );
    await user.click(submitButton(view));

    await waitFor(() => {
      expect(onCreateListingDraft).toHaveBeenCalledTimes(1);
    });

    // The exact persisted shape of a full-day oneSeat plan. `endTime: '00:00'` is not a
    // typo - the availability form normalises a whole day's 24:00 down to 00:00 on save.
    expect(onCreateListingDraft.mock.calls[0][0].availabilityPlan).toEqual({
      type: 'availability-plan/time',
      timezone: 'Etc/UTC',
      entries: [
        { dayOfWeek: 'mon', startTime: '00:00', endTime: '00:00', seats: 1 },
        { dayOfWeek: 'tue', startTime: '00:00', endTime: '00:00', seats: 1 },
        { dayOfWeek: 'wed', startTime: '00:00', endTime: '00:00', seats: 1 },
        { dayOfWeek: 'thu', startTime: '00:00', endTime: '00:00', seats: 1 },
        { dayOfWeek: 'fri', startTime: '00:00', endTime: '00:00', seats: 1 },
        { dayOfWeek: 'sat', startTime: '00:00', endTime: '00:00', seats: 1 },
        { dayOfWeek: 'sun', startTime: '00:00', endTime: '00:00', seats: 1 },
      ],
    });
  });

  it('still captures privateData.ownerAddress now that the location tab is gone', async () => {
    // The LOCATION tab was repurposed to hold the owner's OWN private shipping address -
    // the counterpart of the public, laundry-derived pickup address. It has no downstream
    // readers yet, which is exactly why losing it would be silent.
    const user = userEvent.setup();
    const { view, onCreateListingDraft } = renderTab(DETAILS, { images: [createImage('i')] });

    await user.type(view.getByRole('textbox', { name: 'EditListingDetailsForm.title' }), 'A frock');
    await user.type(
      view.getByRole('textbox', { name: 'EditListingDetailsForm.description' }),
      'Lorem ipsum'
    );
    await user.type(
      view.getByRole('textbox', { name: 'EditListingDetailsForm.ownerStreet' }),
      'Main Street 123'
    );
    await user.type(
      view.getByRole('textbox', { name: 'EditListingDetailsForm.ownerCity' }),
      'Springfield'
    );
    await user.type(
      view.getByRole('textbox', { name: 'EditListingDetailsForm.ownerPostcode' }),
      '12345'
    );
    await user.click(submitButton(view));

    await waitFor(() => {
      expect(onCreateListingDraft).toHaveBeenCalledTimes(1);
    });
    expect(onCreateListingDraft.mock.calls[0][0].privateData.ownerAddress).toEqual({
      street: 'Main Street 123',
      city: 'Springfield',
      postcode: '12345',
    });
  });

  it('does not ask for the owner address when the process still has a location tab', async () => {
    // The flag is off for every process that kept its LOCATION step. Asking twice would be
    // bad enough; the real hazard is that submitting details would then overwrite a saved
    // address with three undefineds.
    const { view } = renderTab(DETAILS, {
      images: [],
      captureOwnerAddress: false,
    });

    await waitFor(() => {
      expect(view.getByRole('textbox', { name: 'EditListingDetailsForm.title' })).toBeVisible();
    });
    expect(
      view.queryByRole('textbox', { name: 'EditListingDetailsForm.ownerStreet' })
    ).not.toBeInTheDocument();
  });
});

describe('cocloset-booking wizard: publishing from the laundry tab', () => {
  const laundry = {
    id: 'laundry-1',
    displayName: 'Studio One',
    studioName: 'Studio One',
    address: 'Rue Example 1',
    origin: { lat: 48.857, lng: 2.359 },
    acceptedCategories: [],
  };

  // A draft that has already been through the laundry step. Its URL type is `draft`, so
  // submits take the update path.
  const draftWithLaundry = (metadata = {}) =>
    createOwnListing(DRAFT_UUID, {
      title: 'A frock',
      state: 'draft',
      publicData: {
        listingType: 'garment-rental',
        transactionProcessAlias: 'cocloset-booking/release-1',
        unitType: 'day',
      },
      metadata: { assignedLaundryId: 'laundry-1', ...metadata },
    });

  const renderLaundryTab = (listing, overrides = {}) =>
    renderTab(LAUNDRY, {
      listing,
      params: {
        id: DRAFT_UUID,
        slug: 'a-frock',
        type: LISTING_PAGE_PARAM_TYPE_DRAFT,
        tab: LAUNDRY,
      },
      ...overrides,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    window.scrollTo = jest.fn();
  });

  it('publishes when the garment is at the laundry and the assignment is unchanged', async () => {
    // The trap this guards. LAUNDRY is the last tab, so submitting it publishes. An owner
    // whose garment is physically at the studio cannot change the assignment - the picker
    // locks - so a panel that refused to submit would turn `metadata.onLaundry === true`
    // into "this garment can never be published", where today it only means "the laundry
    // cannot be changed".
    //
    // The server is mocked as REFUSING with the custody 409 even for this re-save. It does
    // not actually do that - evaluateLaundryAssignment short-circuits on an unchanged id
    // before the onLaundry check - but pinning the harsher case means this stays true even
    // if that short-circuit is ever tightened, and it is the exact scenario the tab has to
    // survive: a refusal arriving on the step that publishes.
    fetchLaundries.mockResolvedValue({ data: [laundry] });
    assignListingLaundry.mockRejectedValue({ status: 409, data: { reason: 'on-laundry' } });

    const user = userEvent.setup();
    const { view, onUpdateListing, handlePublishListing } = renderLaundryTab(
      draftWithLaundry({ onLaundry: true })
    );

    await waitFor(() => {
      expect(view.getByText('EditListingLaundryForm.laundryLocked')).toBeInTheDocument();
    });

    await user.click(submitButton(view));

    await waitFor(() => {
      expect(handlePublishListing).toHaveBeenCalledTimes(1);
    });
    expect(onUpdateListing).toHaveBeenCalledTimes(1);
    // And it is not reported as a refusal, because nothing was refused: the owner asked for
    // no change.
    expect(view.queryByText('EditListingLaundryPanel.laundryLockedError')).not.toBeInTheDocument();
  });

  it('publishes even when the laundry directory failed to load', async () => {
    // A failed /api/laundries leaves `laundries` empty, so there is no `selectedLaundry`
    // to validate even though the listing carries a perfectly good saved assignment. That
    // used to hit the "laundry unavailable" guard and return without submitting - i.e. an
    // unrelated fetch failure made a finished garment unpublishable.
    fetchLaundries.mockRejectedValue(new Error('directory down'));

    const user = userEvent.setup();
    const { view, handlePublishListing } = renderLaundryTab(draftWithLaundry());

    await waitFor(() => {
      expect(view.getByText('EditListingLaundryPanel.fetchLaundriesFailed')).toBeInTheDocument();
    });

    await user.click(submitButton(view));

    await waitFor(() => {
      expect(handlePublishListing).toHaveBeenCalledTimes(1);
    });
    // Nothing to refresh without a resolved laundry record, so no pointless server call.
    expect(assignListingLaundry).not.toHaveBeenCalled();
    expect(view.queryByText('EditListingLaundryPanel.laundryUnavailable')).not.toBeInTheDocument();
  });

  it('publishes even if the no-op assignment refresh fails', async () => {
    // The unchanged-assignment call only re-derives the pickup address and cleaning days
    // from the studio's live profile. The owner asked for no change, so its failure is not
    // news they can act on, and it must not stand between them and publishing.
    fetchLaundries.mockResolvedValue({ data: [laundry] });
    assignListingLaundry.mockRejectedValue({ status: 500 });

    const user = userEvent.setup();
    const { view, handlePublishListing } = renderLaundryTab(draftWithLaundry());

    await waitFor(() => {
      expect(view.getByText('Studio One')).toBeInTheDocument();
    });
    await user.click(submitButton(view));

    await waitFor(() => {
      expect(handlePublishListing).toHaveBeenCalledTimes(1);
    });
  });

  it('still refuses — and still says why — when the owner tries to CHANGE a locked laundry', async () => {
    // The other half. Making publish reachable must not have quietly removed the rule:
    // a real change that the server refuses with 409 must not publish, and must say which
    // condition refused it.
    fetchLaundries.mockResolvedValue({
      // A second STUDIO, so it needs a second studio name: the card is named by
      // `studioName` now, not by the account behind it.
      data: [
        laundry,
        { ...laundry, id: 'laundry-2', displayName: 'Studio Two', studioName: 'Studio Two' },
      ],
    });
    assignListingLaundry.mockRejectedValue({ status: 409, data: { reason: 'active-transaction' } });

    const user = userEvent.setup();
    const { view, handlePublishListing, onUpdateListing } = renderLaundryTab(draftWithLaundry());

    await waitFor(() => {
      expect(view.getByText('Studio Two')).toBeInTheDocument();
    });

    await user.click(view.getByText('Studio Two'));
    await user.click(submitButton(view));

    await waitFor(() => {
      expect(view.getByText('EditListingLaundryPanel.activeTransactionError')).toBeInTheDocument();
    });
    expect(assignListingLaundry).toHaveBeenCalledWith({
      listingId: DRAFT_UUID,
      assignedLaundryId: 'laundry-2',
    });
    expect(handlePublishListing).not.toHaveBeenCalled();
    expect(onUpdateListing).not.toHaveBeenCalled();
  });

  it('surfaces a failed publish on the laundry panel', async () => {
    // publishListingError had no rendering surface for this process: it lived only in
    // EditListingPhotosForm, which is no longer the last panel here. Without it a failed
    // publish looks like a button that does nothing.
    fetchLaundries.mockResolvedValue({ data: [laundry] });

    const { view } = renderLaundryTab(draftWithLaundry(), {
      errors: { publishListingError: { status: 500 } },
    });

    await waitFor(() => {
      expect(view.getByText('EditListingLaundryForm.publishListingFailed')).toBeInTheDocument();
    });
  });
});

describe('cocloset-booking wizard: the single-listing-type dependency', () => {
  // WHY THIS IS PINNED, even though nothing in it is new.
  //
  // On the very first tab nothing is saved yet, so there is no
  // `publicData.transactionProcessAlias` to read. EditListingWizard falls back to
  // `validListingTypes[0].transactionType.process` - but ONLY when there is exactly one
  // listing type; with two or more it falls back to `default-inquiry` and, because
  // `hasListingTypeSelected` goes false at the same moment, serves TABS_DETAILS_ONLY.
  //
  // Cocloset has exactly one listing type today (garment-rental), which is the entire
  // reason a photos-first wizard can work at all: on tab 1 the process is already known to
  // be cocloset-booking. Add a second listing type in Console and the reorder silently
  // stops applying - the owner gets a one-step wizard - with no error anywhere. That is a
  // hosted-config change nobody would think to test, so the dependency is made explicit
  // here rather than left as a comment.
  const secondListingType = {
    id: 'accessory-rental',
    label: 'Accessory rental',
    transactionProcess: { name: 'default-booking', alias: 'default-booking/release-1' },
    unitType: 'day',
    availabilityType: 'oneSeat',
    defaultListingFields: { description: true },
  };

  const renderWizard = (listingTypes, tab, images = []) => {
    const hosted = hostedConfig(listingTypes);
    const config = mergedConfig(listingTypes);
    const routeConfiguration = getRouteConfiguration(config.layout);

    return render(
      <EditListingWizard
        id="EditListingWizard"
        params={{ id: NIL_UUID, slug: 'draft', type: LISTING_PAGE_PARAM_TYPE_NEW, tab }}
        listing={ensureOwnListing(null)}
        errors={{}}
        fetchInProgress={false}
        images={images}
        history={{ push: jest.fn(), replace: jest.fn() }}
        currentUser={createCurrentUser('id-of-me-myself')}
        onManageDisableScrolling={jest.fn()}
        onCreateListingDraft={jest.fn()}
        onUpdateListing={jest.fn()}
        onImageUpload={jest.fn()}
        onRemoveImage={jest.fn()}
        titleId="EditListingPage.titleCreateListing"
      />,
      { config: hosted, routeConfiguration }
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    window.scrollTo = jest.fn();
    fetchLaundries.mockResolvedValue({ data: [] });
  });

  it('serves the full reordered rail on tab 1 when there is exactly one listing type', async () => {
    const view = renderWizard([garmentRentalListingType], PHOTOS);

    await waitFor(() => {
      expect(view.getByText('EditListingWizard.tabLabelPhotos')).toBeInTheDocument();
    });
    expect(view.getByText('EditListingWizard.tabLabelDetails')).toBeInTheDocument();
    expect(view.getByText('EditListingWizard.tabLabelPricing')).toBeInTheDocument();
    expect(view.getByText('EditListingWizard.tabLabelLaundry')).toBeInTheDocument();

    // And the two removed steps really are gone from the rail.
    expect(view.queryByText('EditListingWizard.tabLabelLocation')).not.toBeInTheDocument();
    expect(view.queryByText('EditListingWizard.tabLabelAvailability')).not.toBeInTheDocument();
  });

  it('degrades to a details-only wizard as soon as a second listing type exists', async () => {
    // The regression this exists to make visible. Nothing throws; the owner simply gets one
    // step. If this ever starts failing because the wizard resolves the process some other
    // way, the photos-first order no longer depends on the listing-type count - which would
    // be an improvement worth recording, not a test to delete.
    const view = renderWizard([garmentRentalListingType, secondListingType], DETAILS);

    await waitFor(() => {
      expect(view.getByText('EditListingWizard.tabLabelDetails')).toBeInTheDocument();
    });
    expect(view.queryByText('EditListingWizard.tabLabelPhotos')).not.toBeInTheDocument();
    expect(view.queryByText('EditListingWizard.tabLabelPricing')).not.toBeInTheDocument();
    expect(view.queryByText('EditListingWizard.tabLabelLaundry')).not.toBeInTheDocument();
  });

  it('unlocks the details tab from images that exist only in Redux', async () => {
    // The other end of `collectedImages`. `tabsActive` asks whether PHOTOS is complete
    // before it will let DETAILS render at all, and before the draft exists the answer can
    // only come from the Redux-held uploads - `ensureListing` reports no images. Without
    // this the owner uploads photos, presses Next, and is bounced straight back.
    const view = renderWizard([garmentRentalListingType], DETAILS, [createImage('image-1')]);

    await waitFor(() => {
      expect(view.getByText('EditListingDetailsPanel.createListingTitle')).toBeInTheDocument();
    });
  });

  it('asks for the owner address on the details panel, but only for this process', async () => {
    // The gate is the process, not the panel: EditListingWizard turns the capture on only
    // when the resolved process is cocloset-booking AND its tab list has no LOCATION step.
    // Turning it on unconditionally would ask every marketplace's owners twice and - worse -
    // overwrite an address saved on the location tab with three undefineds.
    const cocloset = renderWizard([garmentRentalListingType], DETAILS, [createImage('image-1')]);

    await waitFor(() => {
      expect(
        cocloset.getByRole('textbox', { name: 'EditListingDetailsForm.ownerStreet' })
      ).toBeInTheDocument();
    });
    cocloset.unmount();

    // `daily-booking` has no entry in LISTING_TYPE_PROCESS_OVERRIDES, so it stays on
    // default-booking - which keeps its own LOCATION step and must not gain these fields.
    const stockBooking = renderWizard(
      [
        {
          id: 'daily-booking',
          label: 'Daily booking',
          transactionProcess: { name: 'default-booking', alias: 'default-booking/release-1' },
          unitType: 'day',
          availabilityType: 'oneSeat',
          defaultListingFields: { description: true },
        },
      ],
      DETAILS
    );

    await waitFor(() => {
      expect(
        stockBooking.getByRole('textbox', { name: 'EditListingDetailsForm.title' })
      ).toBeInTheDocument();
    });
    expect(
      stockBooking.queryByRole('textbox', { name: 'EditListingDetailsForm.ownerStreet' })
    ).not.toBeInTheDocument();
  });
});
