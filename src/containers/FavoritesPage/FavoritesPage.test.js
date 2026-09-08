import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';
import { types as sdkTypes } from '../../util/sdkLoader';

import { FavoritesPageComponent } from './FavoritesPage';

const { screen } = testingLibrary;

//   > "debe crear una página adicional que muestre la lista de mis favoritos, ahi puedo quitar
//   >  alguno" (Jonathan, 2026-09-08)

const listing = (id, title) => ({
  id: { uuid: id },
  type: 'listing',
  attributes: {
    title,
    publicData: { listingType: 'garment-rental' },
    // A real Money instance: the card formats it, and a plain object throws.
    price: new sdkTypes.Money(5000, 'USD'),
  },
  images: [],
  author: { id: { uuid: 'author-1' }, attributes: { profile: { displayName: 'Ana' } } },
});

const renderPage = (props = {}) =>
  render(
    <FavoritesPageComponent
      listings={[]}
      fetchInProgress={false}
      fetchError={null}
      scrollingDisabled={false}
      {...props}
    />
  );

describe('FavoritesPage', () => {
  it('renders a card per saved garment', () => {
    renderPage({ listings: [listing('a', 'Silk slip dress'), listing('b', 'Camel coat')] });

    expect(screen.getByText('Silk slip dress')).toBeInTheDocument();
    expect(screen.getByText('Camel coat')).toBeInTheDocument();
  });

  it('offers a way out of an empty list rather than just reporting one', () => {
    // This is the FIRST thing most people will see here, so it says what the page is for.
    renderPage({ listings: [] });

    expect(screen.getByText('FavoritesPage.empty')).toBeInTheDocument();
    expect(screen.getByText('FavoritesPage.emptyCta')).toBeInTheDocument();
  });

  it('says so when the listings could not be loaded', () => {
    // Distinct from empty: "you have saved nothing" and "we could not read your list" send
    // the reader to do completely different things.
    renderPage({ fetchError: { status: 500 } });

    expect(screen.getByText('FavoritesPage.fetchFailed')).toBeInTheDocument();
    expect(screen.queryByText('FavoritesPage.empty')).not.toBeInTheDocument();
  });

  it('does not show the empty state while it is still loading', () => {
    renderPage({ fetchInProgress: true });

    expect(screen.queryByText('FavoritesPage.empty')).not.toBeInTheDocument();
  });
});
