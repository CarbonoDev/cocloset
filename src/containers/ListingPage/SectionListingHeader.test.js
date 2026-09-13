import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import SectionListingHeader from './SectionListingHeader';

const { screen } = testingLibrary;

const renderHeader = (props = {}) =>
  render(<SectionListingHeader publicData={{}} title="A dress" {...props} />);

// -------------------------------------------------------------------------
//   > "la tag debe ser mostrada para los listings que esten en laundry y que esten
//   >  disponibles para hoy" (Jonathan, 2026-09-11)
//
// This component takes a plain boolean rather than the listing entity - the caller
// (ListingPageCarousel.js / ListingPageCoverPhoto.js) holds the full listing and computes
// it via util/searchCleaningFloor.js's isPickupTodayListing.
// -------------------------------------------------------------------------
describe('SectionListingHeader: the "Pickup Today" tag', () => {
  it('is absent by default', () => {
    renderHeader();

    expect(screen.queryByText('PickupTodayBadge.label')).not.toBeInTheDocument();
  });

  it('shows when the caller says the listing is bookable today', () => {
    renderHeader({ showPickupToday: true });

    expect(screen.getByText('PickupTodayBadge.label')).toBeInTheDocument();
  });
});
