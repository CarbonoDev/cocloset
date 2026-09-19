import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../util/testHelpers';
import { createListing, fakeIntl } from '../../../util/testData';

import SearchResultsPanel from './SearchResultsPanel';

const { screen } = testingLibrary;

// -------------------------------------------------------------------------
//   > "Puedes revisar lo necesario para que en una listing card, solo se muestre 'Pickup
//   >  today' solo si realmente puedo reservar a partir de hoy?" (Jonathan, 2026-09-19)
//
// This is the wiring test: does the panel actually pass each card the verified answer for
// ITS OWN id, rather than e.g. one shared boolean for the whole page. The verification logic
// itself (which ids end up in pickupTodayIds) is pinned in SearchPage.duck.test.js; the
// per-card override behaviour is pinned in ListingCard.test.js. This is the seam between them.
// -------------------------------------------------------------------------
describe('SearchResultsPanel: pickupTodayIds wiring', () => {
  const onLaundryListing = id =>
    createListing(id, { metadata: { onLaundry: true } });

  it("passes each card verification for its OWN id, not the page's", () => {
    const verified = onLaundryListing('verified');
    const notVerified = onLaundryListing('not-verified');

    render(
      <SearchResultsPanel
        listings={[verified, notVerified]}
        pagination={null}
        search={{}}
        setActiveListing={() => {}}
        intl={fakeIntl}
        pickupTodayIds={['verified']}
      />
    );

    expect(screen.getAllByText('PickupTodayBadge.label')).toHaveLength(1);
  });

  it('shows the tag for nobody when pickupTodayIds is empty', () => {
    render(
      <SearchResultsPanel
        listings={[onLaundryListing('a'), onLaundryListing('b')]}
        pagination={null}
        search={{}}
        setActiveListing={() => {}}
        intl={fakeIntl}
        pickupTodayIds={[]}
      />
    );

    expect(screen.queryByText('PickupTodayBadge.label')).not.toBeInTheDocument();
  });
});
