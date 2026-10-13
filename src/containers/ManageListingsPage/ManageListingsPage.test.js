import React from 'react';
import '@testing-library/jest-dom';

jest.mock('../../util/api', () => ({
  ...jest.requireActual('../../util/api'),
  checkListingPauseEligibility: jest.fn(),
}));

import { types as sdkTypes } from '../../util/sdkLoader';
import { renderWithProviders, testingLibrary } from '../../util/testHelpers';
import { createOwnListing, fakeIntl } from '../../util/testData';
import { checkListingPauseEligibility } from '../../util/api';

import { ManageListingsPageComponent } from './ManageListingsPage';

const render = ui => renderWithProviders(ui);
const { screen, fireEvent, waitFor } = testingLibrary;
const { Money } = sdkTypes;
const noop = () => null;

const dayAvailabilityPlan = {
  type: 'availability-plan/time',
  timezone: 'Etc/UTC',
  entries: [{ dayOfWeek: 'mon', startTime: '00:00', endTime: '00:00', seats: 1 }],
};

const bookableListing = (id, metadataOverrides = {}, otherOverrides = {}) =>
  createOwnListing(id, {
    title: `${id} title`,
    price: new Money(1000, 'USD'),
    availabilityPlan: dayAvailabilityPlan,
    metadata: metadataOverrides,
    publicData: {
      listingType: 'rent-bicycles-daily',
      transactionProcessAlias: 'default-booking/release-1',
      unitType: 'hour',
    },
    ...otherOverrides,
  });

// WHY THIS FILE EXISTS
//
// Closing a listing never touches an in-progress transaction or the garment's physical
// custody - sdk.ownListings.close only affects marketplace visibility (see
// ManageListingsPage.duck.js). So a provider who closes a listing while a transaction is
// still active strands it there, with no listing left to release it from. Jonathan
// (2026-09-29): block the close in that case, don't just warn after the fact.
//
// The block used to run entirely client-side, keyed on `metadata.onLaundry` - which,
// per listingCustody.js, is true for most idle garments (stored at the laundry between
// rentals), not just mid-transaction ones. Jonathan (2026-10-13) reported this blocked
// the ordinary "pause to go collect it" flow outright. The guard now asks the server
// (`checkListingPauseEligibility`, Integration-API-backed) whether a transaction is
// genuinely active, rather than guessing from a field that doesn't mean that.
const renderPage = (props = {}, renderFn = render) =>
  renderFn(
    <ManageListingsPageComponent
      listings={[]}
      pagination={{ totalItems: 0, totalPages: 1 }}
      queryInProgress={false}
      scrollingDisabled={false}
      onCloseListing={noop}
      onOpenListing={noop}
      onDiscardDraft={noop}
      onManageDisableScrolling={noop}
      intl={fakeIntl}
      {...props}
    />
  );

// PickupQrModal renders through #portal-root (usePortal on Modal) - without withPortals
// it mounts to nothing and the assertions below would pass or fail for the wrong reason.
const renderPageWithPortals = props => renderPage(props, ui => renderWithProviders(ui, { withPortals: true }));

describe('ManageListingsPageComponent - close listing guard', () => {
  it('closes a listing normally when the server says pausing is allowed - even if it is onLaundry', () => {
    // onLaundry: true on purpose - the idle-storage case the guard used to (wrongly) block.
    const listing = bookableListing('garment-free', { onLaundry: true });
    const onCloseListing = jest.fn();
    checkListingPauseEligibility.mockResolvedValue({ data: { allowed: true } });

    renderPage({
      listings: [listing],
      pagination: { totalItems: 1, totalPages: 1 },
      onCloseListing,
    });

    fireEvent.click(screen.getByText('ManageListingCard.closeListing'));

    expect(checkListingPauseEligibility).toHaveBeenCalledWith({ listingId: listing.id.uuid });
    return waitFor(() => expect(onCloseListing).toHaveBeenCalledTimes(1)).then(() => {
      expect(onCloseListing).toHaveBeenCalledWith(listing.id);
      expect(
        screen.queryByText('ManageListingCard.closeBlockedOnLaundry')
      ).not.toBeInTheDocument();
    });
  });

  it('blocks closing when the server refuses - a transaction is genuinely active', () => {
    const listing = bookableListing('garment-on-laundry', { onLaundry: true });
    const onCloseListing = jest.fn();
    checkListingPauseEligibility.mockRejectedValue({ status: 409 });

    renderPage({
      listings: [listing],
      pagination: { totalItems: 1, totalPages: 1 },
      onCloseListing,
    });

    fireEvent.click(screen.getByText('ManageListingCard.closeListing'));

    return waitFor(() =>
      expect(screen.getByText('ManageListingCard.closeBlockedOnLaundry')).toBeInTheDocument()
    ).then(() => {
      expect(onCloseListing).not.toHaveBeenCalled();
    });
  });

  it('only blocks the specific listing the server refused, not every card', () => {
    const blockedListing = bookableListing('garment-on-laundry', { onLaundry: true });
    const freeListing = bookableListing('garment-free', { onLaundry: true });
    const onCloseListing = jest.fn();
    checkListingPauseEligibility.mockImplementation(({ listingId }) =>
      listingId === blockedListing.id.uuid
        ? Promise.reject({ status: 409 })
        : Promise.resolve({ data: { allowed: true } })
    );

    renderPage({
      listings: [blockedListing, freeListing],
      pagination: { totalItems: 2, totalPages: 1 },
      onCloseListing,
    });

    const [blockedButton, freeButton] = screen.getAllByText('ManageListingCard.closeListing');

    fireEvent.click(blockedButton);
    return waitFor(() =>
      expect(screen.getByText('ManageListingCard.closeBlockedOnLaundry')).toBeInTheDocument()
    ).then(() => {
      expect(onCloseListing).not.toHaveBeenCalled();

      fireEvent.click(freeButton);
      return waitFor(() => expect(onCloseListing).toHaveBeenCalledTimes(1)).then(() => {
        expect(onCloseListing).toHaveBeenCalledWith(freeListing.id);
      });
    });
  });

  it('shows the pickup notice when a listing is at the laundry', () => {
    const listing = bookableListing('garment-on-laundry', { onLaundry: true });

    renderPage({ listings: [listing], pagination: { totalItems: 1, totalPages: 1 } });

    expect(screen.getByText('LaundryPickupNotice.heading')).toBeInTheDocument();
    expect(screen.getByText('LaundryPickupNotice.step4')).toBeInTheDocument();
  });

  it('does not show the pickup notice when nothing is at the laundry', () => {
    const listing = bookableListing('garment-free', { onLaundry: false });

    renderPage({ listings: [listing], pagination: { totalItems: 1, totalPages: 1 } });

    expect(screen.queryByText('LaundryPickupNotice.heading')).not.toBeInTheDocument();
  });

  it('does not show the pickup notice before any listing has loaded', () => {
    renderPage({ listings: [], pagination: { totalItems: 0, totalPages: 1 } });

    expect(screen.queryByText('LaundryPickupNotice.heading')).not.toBeInTheDocument();
  });

  it('drops the "go to Your listings" step on its own pickup notice - the provider is already there', () => {
    const listing = bookableListing('garment-on-laundry', { onLaundry: true });

    renderPage({ listings: [listing], pagination: { totalItems: 1, totalPages: 1 } });

    expect(screen.getByText('LaundryPickupNotice.heading')).toBeInTheDocument();
    expect(screen.queryByText('LaundryPickupNotice.step1')).not.toBeInTheDocument();
  });
});

describe('ManageListingsPageComponent - pickup QR modal', () => {
  it('opens the pickup QR modal for the clicked listing, and closes it again', () => {
    const listing = bookableListing(
      'garment-on-laundry',
      { onLaundry: true },
      { state: 'closed' }
    );

    renderPageWithPortals({ listings: [listing], pagination: { totalItems: 1, totalPages: 1 } });

    expect(screen.queryByText('PickupQrModal.title')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('ManageListingCard.viewPickupQr'));

    expect(screen.getByText('PickupQrModal.title')).toBeInTheDocument();
    expect(screen.getByAltText('PickupQrCode.imageAlt')).toHaveAttribute(
      'src',
      `/api/listing-pickup-qr?id=${listing.id.uuid}`
    );

    fireEvent.click(screen.getByText('PickupQrModal.close'));

    expect(screen.queryByText('PickupQrModal.title')).not.toBeInTheDocument();
  });
});
