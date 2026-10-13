import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { useRouteConfiguration } from '../../context/routeConfigurationContext';
import { useConfiguration } from '../../context/configurationContext';
import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { pathByRouteName } from '../../util/routes';
import {
  hasPermissionToPostListings,
  showCreateListingLinkForUser,
  isLaundryUser,
} from '../../util/userHelpers';
import { NO_ACCESS_PAGE_POST_LISTINGS } from '../../util/urlHelpers';
import { propTypes, LISTING_STATE_PUBLISHED } from '../../util/types';
import { isErrorNoPermissionToPostListings } from '../../util/errors';
import { checkListingPauseEligibility, fetchListingsActiveTransactions } from '../../util/api';
import { isScrollingDisabled, manageDisableScrolling } from '../../ducks/ui.duck';

import {
  H3,
  Page,
  PaginationLinks,
  UserNav,
  LayoutSingleColumn,
  NamedLink,
  Modal,
  LaundryPickupNotice,
} from '../../components';

import TopbarContainer from '../../containers/TopbarContainer/TopbarContainer';
import FooterContainer from '../../containers/FooterContainer/FooterContainer';
import NotFoundPage from '../NotFoundPage/NotFoundPage';

import ManageListingCard from './ManageListingCard/ManageListingCard';

import {
  closeListing,
  openListing,
  getOwnListingsById,
  discardDraft,
} from './ManageListingsPage.duck';
import css from './ManageListingsPage.module.css';
import DiscardDraftModal from './DiscardDraftModal/DiscardDraftModal';
import PickupQrModal from './PickupQrModal/PickupQrModal';

const Heading = props => {
  const { listingsAreLoaded, pagination } = props;
  const hasResults = listingsAreLoaded && pagination.totalItems > 0;
  const hasNoResults = listingsAreLoaded && pagination.totalItems === 0;

  return hasResults ? (
    <H3 as="h1" className={css.heading}>
      <FormattedMessage
        id="ManageListingsPage.youHaveListings"
        values={{ count: pagination.totalItems }}
      />
    </H3>
  ) : hasNoResults ? (
    <div className={css.noResultsContainer}>
      <H3 as="h1" className={css.headingNoListings}>
        <FormattedMessage id="ManageListingsPage.noResults" />
      </H3>
      <p className={css.createListingParagraph}>
        <NamedLink className={css.createListingLink} name="NewListingPage">
          <FormattedMessage id="ManageListingsPage.createListing" />
        </NamedLink>
      </p>
    </div>
  ) : null;
};

const PaginationLinksMaybe = props => {
  const { listingsAreLoaded, pagination, page } = props;
  return listingsAreLoaded && pagination && pagination.totalPages > 1 ? (
    <PaginationLinks
      className={css.pagination}
      pageName="ManageListingsPage"
      pageSearchParams={{ page }}
      pagination={pagination}
    />
  ) : null;
};

/**
 * The ManageListingsPage component.
 *
 * @component
 * @param {Object} props
 * @param {propTypes.currentUser} props.currentUser - The current user
 * @param {propTypes.uuid} props.closingListing - The closing listing
 * @param {Object} props.closingListingError - The closing listing error
 * @param {propTypes.error} props.closingListingError.listingId - The closing listing id
 * @param {propTypes.error} props.closingListingError.error - The closing listing error
 * @param {propTypes.ownListing[]} props.listings - The listings
 * @param {function} props.onCloseListing - The onCloseListing function
 * @param {function} props.onDiscardDraft - The onDiscardDraft function
 * @param {function} props.onOpenListing - The onOpenListing function
 * @param {Object} props.openingListing - The opening listing
 * @param {propTypes.uuid} props.openingListing.uuid - The opening listing uuid
 * @param {Object} props.openingListingError - The opening listing error
 * @param {propTypes.uuid} props.openingListingError.listingId - The opening listing id
 * @param {propTypes.error} props.openingListingError.error - The opening listing error
 * @param {propTypes.pagination} props.pagination - The pagination
 * @param {boolean} props.queryInProgress - Whether the query is in progress
 * @param {propTypes.error} props.queryListingsError - The query listings error
 * @param {Object} props.queryParams - The query params
 * @param {boolean} props.scrollingDisabled - Whether the scrolling is disabled
 * @param {function} props.onManageDisableScrolling - The onManageDisableScrolling function
 * @returns {JSX.Element} manage listings page component
 */
export const ManageListingsPageComponent = props => {
  const [listingMenuOpen, setListingMenuOpen] = useState(null);
  const [discardDraftModalOpen, setDiscardDraftModalOpen] = useState(null);
  const [discardDraftModalId, setDiscardDraftModalId] = useState(null);
  const [closeBlockedListingId, setCloseBlockedListingId] = useState(null);
  const [pickupQrListing, setPickupQrListing] = useState(null);
  const [activeTransactionByListingId, setActiveTransactionByListingId] = useState({});
  const history = useHistory();
  const routeConfiguration = useRouteConfiguration();
  const config = useConfiguration();
  const intl = useIntl();

  const {
    currentUser,
    closingListing,
    closingListingError,
    discardingDraft,
    discardingDraftError,
    listings = [],
    onCloseListing,
    onDiscardDraft,
    onOpenListing,
    openingListing,
    openingListingError,
    pagination,
    queryInProgress,
    queryListingsError,
    queryParams,
    scrollingDisabled,
    onManageDisableScrolling,
    staticContext,
  } = props;

  const currentUserLoaded = !!currentUser?.id;

  if (currentUserLoaded && isLaundryUser(currentUser)) {
    return <NotFoundPage staticContext={staticContext} />;
  }

  useEffect(() => {
    if (isErrorNoPermissionToPostListings(openingListingError?.error)) {
      const noAccessPagePath = pathByRouteName('NoAccessPage', routeConfiguration, {
        missingAccessRight: NO_ACCESS_PAGE_POST_LISTINGS,
      });
      history.push(noAccessPagePath);
    }
  }, [openingListingError]);

  const onToggleMenu = listing => {
    setListingMenuOpen(listing);
    setCloseBlockedListingId(null);
  };

  // A listing whose garment is part of a still-active transaction can't be paused
  // yet - it would be stranded with no listing to release it from. `onLaundry`
  // alone is NOT that signal (per listingCustody.js, a garment is onLaundry for
  // every idle period between rentals, not just mid-transaction), so the real
  // question - is a transaction actually active - is asked server-side, where
  // the Integration API can answer it. Any failure here (a real 409, or anything
  // else going wrong) is treated as "don't pause" - see checkListingPauseEligibility.
  const handleCloseListing = listingId => {
    checkListingPauseEligibility({ listingId: listingId.uuid })
      .then(() => {
        setCloseBlockedListingId(null);
        onCloseListing(listingId);
      })
      .catch(() => {
        setCloseBlockedListingId(listingId);
      });
  };

  const handleOpenListing = listingId => {
    const hasPostingRights = hasPermissionToPostListings(currentUser);

    if (!hasPostingRights) {
      const noAccessPagePath = pathByRouteName('NoAccessPage', routeConfiguration, {
        missingAccessRight: NO_ACCESS_PAGE_POST_LISTINGS,
      });
      history.push(noAccessPagePath);
    } else {
      onOpenListing(listingId);
    }
  };

  const openDiscardDraftModal = listingId => {
    setDiscardDraftModalId(listingId);
    setDiscardDraftModalOpen(true);
  };

  const handleDiscardDraft = () => {
    onDiscardDraft(discardDraftModalId);
    setDiscardDraftModalOpen(false);
    setDiscardDraftModalId(null);
  };

  const closePickupQrModal = () => setPickupQrListing(null);

  const hasPaginationInfo = !!pagination && pagination.totalItems != null;
  const listingsAreLoaded = !queryInProgress && hasPaginationInfo;
  // Only worth nagging a provider about pickup steps when something of theirs is
  // actually sitting at a laundry partner right now.
  const hasListingAtLaundry =
    listingsAreLoaded && listings.some(l => l?.attributes?.metadata?.onLaundry === true);

  // Published listings only - a draft/closed/pendingApproval/outOfStock card never
  // offers "Pause Listing" in the first place (see CardMenu's own getMenuItems), so
  // there is nothing for this badge to inform there either.
  const pausableListingIds = listingsAreLoaded
    ? listings
        .filter(l => l?.attributes?.state === LISTING_STATE_PUBLISHED)
        .map(l => l.id.uuid)
    : [];
  // Joined to a stable string so the effect only re-fires when the actual set of ids
  // changes, not on every render (a new array from the same ids would otherwise be a
  // "different" dependency every time).
  const pausableListingIdsKey = pausableListingIds.join(',');

  useEffect(() => {
    if (pausableListingIds.length === 0) {
      return;
    }
    let cancelled = false;
    fetchListingsActiveTransactions(pausableListingIds)
      .then(response => {
        if (!cancelled) {
          setActiveTransactionByListingId(prev => ({ ...prev, ...response.data.active }));
        }
      })
      .catch(() => {
        // UI-only read: leave the previous (or absent) badge state rather than block
        // anything the page otherwise rendered successfully.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pausableListingIdsKey]);

  const loadingResults = (
    <div className={css.messagePanel}>
      <H3 as="h2" className={css.heading}>
        <FormattedMessage id="ManageListingsPage.loadingOwnListings" />
      </H3>
    </div>
  );

  const queryError = (
    <div className={css.messagePanel}>
      <H3 as="h2" className={css.heading}>
        <FormattedMessage id="ManageListingsPage.queryError" />
      </H3>
    </div>
  );

  const closingErrorListingId = !!closingListingError && closingListingError.listingId;
  const openingErrorListingId = !!openingListingError && openingListingError.listingId;
  const discardingErrorListingId = !!discardingDraftError && discardingDraft.listingId;

  const panelWidth = 62.5;
  // Render hints for responsive image
  const renderSizes = [
    `(max-width: 767px) 100vw`,
    `(max-width: 1920px) ${panelWidth / 2}vw`,
    `${panelWidth / 3}vw`,
  ].join(', ');

  const showManageListingsLink = showCreateListingLinkForUser(config, currentUser);

  return (
    <Page
      title={intl.formatMessage({ id: 'ManageListingsPage.title' })}
      scrollingDisabled={scrollingDisabled}
    >
      <LayoutSingleColumn
        topbar={
          <>
            <TopbarContainer />
            <UserNav
              currentPage="ManageListingsPage"
              showLaundryProfileLink={isLaundryUser(currentUser)}
              showManageListingsLink={showManageListingsLink}
            />
          </>
        }
        footer={<FooterContainer />}
      >
        {queryInProgress ? loadingResults : null}
        {queryListingsError ? queryError : null}

        <div className={css.listingPanel}>
          <Heading listingsAreLoaded={listingsAreLoaded} pagination={pagination} />

          {hasListingAtLaundry ? (
            <LaundryPickupNotice
              className={css.pickupNotice}
              includeNavigationStep={false}
            />
          ) : null}

          <ul className={css.listingCards}>
            {listings.map(l => (
              <li key={l.id.uuid} className={css.listingCard}>
                <ManageListingCard
                  listing={l}
                  isMenuOpen={!!listingMenuOpen && listingMenuOpen.id.uuid === l.id.uuid}
                  actionsInProgressListingId={openingListing || closingListing || discardingDraft}
                  onToggleMenu={onToggleMenu}
                  onCloseListing={handleCloseListing}
                  onOpenListing={handleOpenListing}
                  onDiscardDraft={openDiscardDraftModal}
                  hasOpeningError={openingErrorListingId.uuid === l.id.uuid}
                  hasClosingError={closingErrorListingId.uuid === l.id.uuid}
                  hasDiscardingError={discardingErrorListingId.uuid === l.id.uuid}
                  isCloseBlockedOnLaundry={
                    !!closeBlockedListingId && closeBlockedListingId.uuid === l.id.uuid
                  }
                  onShowPickupQr={setPickupQrListing}
                  hasActiveTransaction={activeTransactionByListingId[l.id.uuid] === true}
                  renderSizes={renderSizes}
                />
              </li>
            ))}
          </ul>
          {onManageDisableScrolling && discardDraftModalOpen ? (
            <DiscardDraftModal
              id="ManageListingsPage"
              isOpen={discardDraftModalOpen}
              onManageDisableScrolling={onManageDisableScrolling}
              onCloseModal={() => setDiscardDraftModalOpen(false)}
              onDiscardDraft={handleDiscardDraft}
              focusElementId={
                discardDraftModalId ? `discardButton_${discardDraftModalId.uuid}` : null
              }
            />
          ) : null}

          {onManageDisableScrolling && pickupQrListing ? (
            <PickupQrModal
              id="ManageListingsPage"
              isOpen={!!pickupQrListing}
              onManageDisableScrolling={onManageDisableScrolling}
              onCloseModal={closePickupQrModal}
              listingId={pickupQrListing.id.uuid}
              listingTitle={pickupQrListing.title}
            />
          ) : null}

          <PaginationLinksMaybe
            listingsAreLoaded={listingsAreLoaded}
            pagination={pagination}
            page={queryParams ? queryParams.page : 1}
          />
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => {
  const { currentUser } = state.user;
  const {
    currentPageResultIds,
    pagination,
    queryInProgress,
    queryListingsError,
    queryParams,
    openingListing,
    openingListingError,
    closingListing,
    closingListingError,
    discardingDraft,
    discardingDraftError,
  } = state.ManageListingsPage;
  const listings = getOwnListingsById(state, currentPageResultIds);
  return {
    currentUser,
    currentPageResultIds,
    listings,
    pagination,
    queryInProgress,
    queryListingsError,
    queryParams,
    scrollingDisabled: isScrollingDisabled(state),
    openingListing,
    openingListingError,
    closingListing,
    closingListingError,
    discardingDraft,
    discardingDraftError,
  };
};

const mapDispatchToProps = dispatch => ({
  onCloseListing: listingId => dispatch(closeListing(listingId)),
  onOpenListing: listingId => dispatch(openListing(listingId)),
  onDiscardDraft: listingId => dispatch(discardDraft(listingId)),
  onManageDisableScrolling: (componentId, disableScrolling) =>
    dispatch(manageDisableScrolling(componentId, disableScrolling)),
});

const ManageListingsPage = compose(
  connect(
    mapStateToProps,
    mapDispatchToProps
  )
)(ManageListingsPageComponent);

export default ManageListingsPage;
