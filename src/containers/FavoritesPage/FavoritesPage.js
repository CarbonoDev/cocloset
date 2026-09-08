import React from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { useConfiguration } from '../../context/configurationContext';
import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { propTypes } from '../../util/types';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { getMarketplaceEntities } from '../../ducks/marketplaceData.duck';

import {
  H3,
  IconSpinner,
  LayoutSingleColumn,
  ListingCard,
  NamedLink,
  Page,
} from '../../components';

import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import css from './FavoritesPage.module.css';

/**
 * The garments this person saved.
 *
 *   > "debe crear una página adicional que muestre la lista de mis favoritos, ahi puedo quitar
 *   >  alguno" (Jonathan, 2026-09-08)
 *
 * REMOVING IS THE SAME HEART, not a separate delete control. The card already carries one and
 * it is already filled here; pressing it takes the garment off the list. A second control
 * would mean two ways to do one thing, and the one on the card would be the confusing one -
 * filled, on a page of nothing but favourites, appearing to do nothing.
 *
 * The card disappears on the next render because this page renders `favoriteListingIds`, which
 * the toggle rewrites. Nothing here listens for the removal.
 */
export const FavoritesPageComponent = props => {
  const { listings, fetchInProgress, fetchError, scrollingDisabled } = props;
  const intl = useIntl();
  const config = useConfiguration();

  const title = intl.formatMessage({ id: 'FavoritesPage.title' });

  const { aspectWidth = 1, aspectHeight = 1, variantPrefix = 'listing-card' } =
    config?.layout?.listingImage || {};

  const content = (() => {
    if (fetchInProgress && listings.length === 0) {
      return <IconSpinner />;
    }
    if (fetchError) {
      return (
        <p className={css.error}>
          <FormattedMessage id="FavoritesPage.fetchFailed" />
        </p>
      );
    }
    if (listings.length === 0) {
      // An empty list is the FIRST thing most people will see here, so it says what the page
      // is for and offers the way out - rather than reporting an absence and stopping.
      return (
        <div className={css.empty}>
          <p className={css.emptyText}>
            <FormattedMessage id="FavoritesPage.empty" />
          </p>
          <NamedLink name="SearchPage" className={css.emptyLink}>
            <FormattedMessage id="FavoritesPage.emptyCta" />
          </NamedLink>
        </div>
      );
    }

    return (
      <ul className={css.grid}>
        {listings.map(listing => (
          <li key={listing.id.uuid} className={css.gridItem}>
            <ListingCard
              listing={listing}
              renderSizes="(max-width: 549px) 100vw, (max-width: 767px) 50vw, 33vw"
              aspectWidth={aspectWidth}
              aspectHeight={aspectHeight}
              variantPrefix={variantPrefix}
              showFavorite
            />
          </li>
        ))}
      </ul>
    );
  })();

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn topbar={<TopbarContainer />} footer={<FooterContainer />}>
        <div className={css.content}>
          <H3 as="h1" className={css.heading}>
            <FormattedMessage id="FavoritesPage.heading" />
          </H3>
          {content}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => {
  const { listingIds, fetchInProgress, fetchError } = state.FavoritesPage;
  // Resolved from the entity store rather than held in the slice: a listing whose title or
  // price changes elsewhere in the session should not be stale here.
  const listings = getMarketplaceEntities(
    state,
    listingIds.map(id => ({ id: { uuid: id }, type: 'listing' }))
  );

  return {
    listings,
    fetchInProgress,
    fetchError,
    scrollingDisabled: isScrollingDisabled(state),
  };
};

const FavoritesPage = compose(connect(mapStateToProps))(FavoritesPageComponent);

export default FavoritesPage;
