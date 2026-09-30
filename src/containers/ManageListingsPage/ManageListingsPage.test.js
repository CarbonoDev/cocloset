import React from 'react';
import '@testing-library/jest-dom';

import { types as sdkTypes } from '../../util/sdkLoader';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';
import { createOwnListing, fakeIntl } from '../../util/testData';

import { ManageListingsPageComponent } from './ManageListingsPage';

const { screen, fireEvent } = testingLibrary;
const { Money } = sdkTypes;
const noop = () => null;

const dayAvailabilityPlan = {
  type: 'availability-plan/time',
  timezone: 'Etc/UTC',
  entries: [{ dayOfWeek: 'mon', startTime: '00:00', endTime: '00:00', seats: 1 }],
};

const bookableListing = (id, metadataOverrides = {}) =>
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
  });

// WHY THIS FILE EXISTS
//
// Closing a listing never touches an in-progress transaction or the garment's physical
// custody - sdk.ownListings.close only affects marketplace visibility (see
// ManageListingsPage.duck.js). So a provider who closes a listing while its garment is
// still at the laundry partner (metadata.onLaundry === true) strands it there, with no
// listing left to release it from. Jonathan (2026-09-29): block the close in that case,
// don't just warn after the fact. These tests are about the block actually firing -
// handleCloseListing intercepts the click before it ever reaches onCloseListing.
const renderPage = (props = {}) =>
  render(
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

describe('ManageListingsPageComponent - close listing guard', () => {
  it('closes a listing normally when the garment is not at the laundry', () => {
    const listing = bookableListing('garment-free', { onLaundry: false });
    const onCloseListing = jest.fn();

    renderPage({
      listings: [listing],
      pagination: { totalItems: 1, totalPages: 1 },
      onCloseListing,
    });

    fireEvent.click(screen.getByText('ManageListingCard.closeListing'));

    expect(onCloseListing).toHaveBeenCalledTimes(1);
    expect(onCloseListing).toHaveBeenCalledWith(listing.id);
    expect(
      screen.queryByText('ManageListingCard.closeBlockedOnLaundry')
    ).not.toBeInTheDocument();
  });

  it('blocks closing a listing whose garment is still at the laundry', () => {
    const listing = bookableListing('garment-on-laundry', { onLaundry: true });
    const onCloseListing = jest.fn();

    renderPage({
      listings: [listing],
      pagination: { totalItems: 1, totalPages: 1 },
      onCloseListing,
    });

    fireEvent.click(screen.getByText('ManageListingCard.closeListing'));

    expect(onCloseListing).not.toHaveBeenCalled();
    expect(screen.getByText('ManageListingCard.closeBlockedOnLaundry')).toBeInTheDocument();
  });

  it('only blocks the specific listing that is on laundry, not every card', () => {
    const onLaundryListing = bookableListing('garment-on-laundry', { onLaundry: true });
    const freeListing = bookableListing('garment-free', { onLaundry: false });
    const onCloseListing = jest.fn();

    renderPage({
      listings: [onLaundryListing, freeListing],
      pagination: { totalItems: 2, totalPages: 1 },
      onCloseListing,
    });

    const [blockedButton, freeButton] = screen.getAllByText('ManageListingCard.closeListing');

    fireEvent.click(blockedButton);
    expect(onCloseListing).not.toHaveBeenCalled();
    expect(screen.getByText('ManageListingCard.closeBlockedOnLaundry')).toBeInTheDocument();

    fireEvent.click(freeButton);
    expect(onCloseListing).toHaveBeenCalledTimes(1);
    expect(onCloseListing).toHaveBeenCalledWith(freeListing.id);
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
});
