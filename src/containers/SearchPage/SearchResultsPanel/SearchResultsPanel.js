import React from 'react';
import classNames from 'classnames';

import { propTypes } from '../../../util/types';
import { ListingCard, PaginationLinks } from '../../../components';

import css from './SearchResultsPanel.module.css';

/**
 * SearchResultsPanel component
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that extends the default class for the root element
 * @param {Array<propTypes.listing>} props.listings - The listings
 * @param {propTypes.pagination} props.pagination - The pagination
 * @param {Object} props.search - The search
 * @param {Function} props.setActiveListing - The function to handle the active listing
 * @param {boolean} [props.isMapVariant] - Whether the map variant is enabled
 * @returns {JSX.Element}
 */
const SearchResultsPanel = props => {
  const {
    className,
    rootClassName,
    listings = [],
    pagination,
    search,
    setActiveListing,
    isMapVariant = true,
    listingTypeParam,
    intl,
  } = props;
  const classes = classNames(rootClassName || css.root, className);
  const pageName = listingTypeParam ? 'SearchPageWithListingType' : 'SearchPage';

  const paginationLinks =
    pagination && pagination.totalPages > 1 ? (
      <PaginationLinks
        className={css.pagination}
        pageName={pageName}
        pagePathParams={{ listingType: listingTypeParam }}
        pageSearchParams={search}
        pagination={pagination}
        aria-label={intl.formatMessage({ id: 'SearchResultsPanel.screenreader.pagination' })}
      />
    ) : null;

  const cardRenderSizes = isMapVariant => {
    if (isMapVariant) {
      // Panel width relative to the viewport
      const panelMediumWidth = 50;
      const panelLargeWidth = 62.5;
      return [
        '(max-width: 767px) 100vw',
        `(max-width: 1023px) ${panelMediumWidth}vw`,
        `(max-width: 1920px) ${panelLargeWidth / 2}vw`,
        `${panelLargeWidth / 3}vw`,
      ].join(', ');
    } else {
      // Panel width relative to the viewport
      const panelMediumWidth = 50;
      const panelLargeWidth = 62.5;
      return [
        '(max-width: 549px) 100vw',
        '(max-width: 767px) 50vw',
        `(max-width: 1439px) 26vw`,
        `(max-width: 1920px) 18vw`,
        `14vw`,
      ].join(', ');
    }
  };

  return (
    <div className={classes}>
      <ul className={isMapVariant ? css.listingCardsMapVariant : css.listingCards}>
        {listings.map(l => (
          <li key={l.id.uuid} className={css.resultItem}>
            {/* THE EDITORIAL CARD, per the client's search-page design: brand eyebrow, title,
                price set against it, then size and collection point on one line.

                This component was written for the landing page's carousel, and its own header
                says the search grid deliberately kept the default layout - "a browsing grid
                wants the price first and the seller named, because the reader is comparing".
                The client's design says otherwise for this marketplace, and the design decides
                what a browsing grid should look like. One variant, two surfaces, no new card.

                NB the fields it shows (brand, size, assignedLaundryName) have to be asked for
                in SearchPage.duck.js's `fields.listing` allowlist, or every card renders the
                image and nothing else. */}
            <ListingCard
              className={css.listingCard}
              listing={l}
              renderSizes={cardRenderSizes(isMapVariant)}
              setActiveListing={setActiveListing}
              variant="editorial"
              showFavorite
            />
          </li>
        ))}
        {props.children}
      </ul>
      {paginationLinks}
    </div>
  );
};

export default SearchResultsPanel;
