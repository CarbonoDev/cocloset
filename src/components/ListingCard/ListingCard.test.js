import React from 'react';
import '@testing-library/jest-dom';

import {
  getHostedConfiguration,
  renderWithProviders as render,
  testingLibrary,
} from '../../util/testHelpers';
import en from '../../translations/en.json';
import { createUser, createListing, fakeIntl } from '../../util/testData';

import { ListingCard } from './ListingCard';

const { screen } = testingLibrary;

const getConfig = () => {
  const hostedConfig = getHostedConfiguration();
  return {
    ...hostedConfig,
    listingTypes: {
      listingTypes: [
        {
          id: 'free-inquiry',
          transactionProcess: {
            name: 'default-inquiry',
            alias: 'default-inquiry/release-1',
          },
          unitType: 'inquiry',
          defaultListingFields: {
            price: false,
          },
        },
      ],
    },
  };
};

describe('ListingCard', () => {
  it('matches snapshot', () => {
    // This is quite small component what comes to rendered HTML
    // For now, we rely on snapshot-testing.
    const listing = createListing('listing1', {}, { author: createUser('user1') });
    const tree = render(<ListingCard listing={listing} intl={fakeIntl} />);
    expect(tree.asFragment().firstChild).toMatchSnapshot();
  });

  it('matches snapshot without price', () => {
    const config = getConfig();
    const listing = createListing(
      'listing1',
      { publicData: { listingType: 'free-inquiry' } },
      { author: createUser('user1') }
    );
    const tree = render(<ListingCard listing={listing} intl={fakeIntl} />, { config });
    expect(tree.asFragment().firstChild).toMatchSnapshot();
  });
});

// -------------------------------------------------------------------------
//   > "la tag debe ser mostrada para los listings que esten en laundry y que esten
//   >  disponibles para hoy (...) esquina superior derecha de la listing card"
//   >   (Jonathan, 2026-09-11)
// -------------------------------------------------------------------------
describe('ListingCard: the "Pickup Today" tag', () => {
  const onLaundryListing = () =>
    createListing(
      'listing1',
      { metadata: { onLaundry: true } },
      { author: createUser('user1') }
    );

  it('shows the tag for a listing on laundry and free today', () => {
    render(<ListingCard listing={onLaundryListing()} intl={fakeIntl} />);

    expect(screen.getByText('PickupTodayBadge.label')).toBeInTheDocument();
  });

  it('does not show the tag for a listing that has never reached its laundry', () => {
    const listing = createListing('listing1', {}, { author: createUser('user1') });

    render(<ListingCard listing={listing} intl={fakeIntl} />);

    expect(screen.queryByText('PickupTodayBadge.label')).not.toBeInTheDocument();
  });

  it('renders both the tag and the favorite heart without one hiding the other', () => {
    const { container } = render(
      <ListingCard listing={onLaundryListing()} intl={fakeIntl} showFavorite />
    );

    expect(screen.getByText('PickupTodayBadge.label')).toBeInTheDocument();
    expect(container.querySelector('[class*="cardFavoriteShifted"]')).toBeInTheDocument();
  });
});

// ================ Cocloset: the editorial variant ================
//
// The landing page's "New & noteworthy" carousel. Every one of the three extra fields is
// OPTIONAL on a real listing - brand and size are Console listing fields nobody is forced to
// fill, and `assignedLaundryName` only exists once a laundry has been assigned - so the tests
// that matter are the ones where a field is missing.
//
// The snapshots above are the other half of this: they are rendered without `variant`, so
// they fail if the default card ever picks up the editorial layout by accident.

describe('ListingCard: the editorial variant', () => {
  const { screen } = require('../../util/testHelpers').testingLibrary;

  const editorialListing = (publicData = {}) =>
    createListing(
      'listing1',
      {
        title: 'Bias-cut silk slip dress, oyster',
        publicData: {
          brand: 'Galvan',
          size: 'FR 38 / UK 10',
          assignedLaundryName: 'Studio Pigalle',
          ...publicData,
        },
      },
      { author: createUser('user1') }
    );

  // Rendered with the REAL message catalogue, not the key-as-value default: the meta line is
  // assembled from two translations plus a separator, and asserting on message KEYS would pass
  // just as happily if the size and the studio name never reached them.
  const renderEditorial = publicData =>
    render(
      <ListingCard listing={editorialListing(publicData)} intl={fakeIntl} variant="editorial" />,
      { messages: en }
    );

  it('shows the brand, the garment and where it is collected', () => {
    // Asserted on the rendered text rather than per element: the meta line is deliberately
    // several nodes (two messages and a separator between them), and a matcher that demanded
    // one node would be testing the markup instead of what a reader sees.
    const { container } = renderEditorial();

    expect(container.textContent).toContain('Galvan');
    expect(container.textContent).toContain('Bias-cut silk slip dress, oyster');
    expect(container.textContent).toContain('FR 38 / UK 10');
    expect(container.textContent).toContain('Studio Pigalle');
  });

  it.each([
    ['brand', { brand: null }, 'Galvan'],
    ['size', { size: null }, 'FR 38 / UK 10'],
    ['collection point', { assignedLaundryName: null }, 'Studio Pigalle'],
  ])('renders without a %s rather than printing an empty row', (_label, missing, absentText) => {
    const { container } = renderEditorial(missing);

    expect(container.textContent).not.toContain(absentText);
    // ...and the garment itself is still there, which is the point.
    expect(container.textContent).toContain('Bias-cut silk slip dress, oyster');
  });

  it('drops the separator when only one of the two meta facts exists', () => {
    // A trailing "· " after a lone size is the sort of thing that ships and then sits there.
    const { container } = renderEditorial({ assignedLaundryName: null });
    expect(container.textContent).not.toContain('·');
  });

  it('does not print the author, which the default card does', () => {
    // The editorial row is about the garment. The stock card names the seller because a
    // browsing grid is about comparing sellers; this one is not.
    renderEditorial();
    expect(screen.queryByText(/user1/i)).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  //   > "se muestra 'x_small', lo cual es correcto porque es su valor guardado, pero debe
  //   >  mostrar 'X-Small', que es el valor del label de listing field que viene de la
  //   >  consola" (Jonathan, 2026-09-19)
  // -------------------------------------------------------------------------
  it("shows the Console label for size, not the stored enum option", () => {
    const hostedConfig = getHostedConfiguration();
    const config = {
      ...hostedConfig,
      // The raw hosted-asset shape mergeConfig expects (see ListingPage.test.js's getConfig) -
      // it processes this into config.listing.listingFields, which is what the component
      // actually reads.
      listingFields: {
        listingFields: [
          {
            key: 'size',
            scope: 'public',
            schemaType: 'enum',
            enumOptions: [
              { option: 'x_small', label: 'X-Small' },
              { option: 'medium', label: 'Medium' },
            ],
          },
        ],
      },
    };

    const { container } = render(
      <ListingCard
        listing={editorialListing({ size: 'x_small' })}
        intl={fakeIntl}
        variant="editorial"
      />,
      { messages: en, config }
    );

    expect(container.textContent).toContain('X-Small');
    expect(container.textContent).not.toContain('x_small');
  });

  it('falls back to the stored value when Console has no matching option (renamed or deleted)', () => {
    const hostedConfig = getHostedConfiguration();
    const config = {
      ...hostedConfig,
      listingFields: {
        listingFields: [{ key: 'size', scope: 'public', schemaType: 'enum', enumOptions: [] }],
      },
    };

    const { container } = render(
      <ListingCard
        listing={editorialListing({ size: 'x_small' })}
        intl={fakeIntl}
        variant="editorial"
      />,
      { messages: en, config }
    );

    expect(container.textContent).toContain('x_small');
  });

  it('still links to the listing', () => {
    renderEditorial();
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      expect.stringContaining('/l/bias-cut-silk-slip-dress-oyster/listing1')
    );
  });
});
