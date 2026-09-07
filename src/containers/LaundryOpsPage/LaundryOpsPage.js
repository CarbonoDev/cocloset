import React from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { isLaundryUser } from '../../util/userHelpers';
import { isScrollingDisabled } from '../../ducks/ui.duck';

import { H3, IconSpinner, Page, UserNav, LayoutSideNavigation } from '../../components';

import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';
import NotFoundPage from '../NotFoundPage/NotFoundPage';

import LaundryOpsNav from './LaundryOpsNav';
import LaundryOrdersTable from './LaundryOrdersTable';
import LaundryDashboard from './LaundryDashboard';
import LaundryInventory from './LaundryInventory';
import { filterByView } from './LaundryOpsPage.helpers';
import { advanceStatus, handBackToOwner } from './LaundryOpsPage.duck';
import css from './LaundryOpsPage.module.css';

// The six ops screens, distinguished by the `tab` extraProp set per route in
// routeConfiguration.js. They share one container, one duck and one fetch:
// Dashboard/Inventory present the same payload differently, and
// Pickups/Returns/Cleaning are the Orders table over a preset filter
// (LaundryOpsPage.helpers.filterByView) rather than three duplicate tables.
export const OPS_TABS = ['dashboard', 'orders', 'pickups', 'returns', 'cleaning', 'inventory'];

const ROUTE_NAME_BY_TAB = {
  dashboard: 'LaundryOpsDashboardPage',
  orders: 'LaundryOpsOrdersPage',
  pickups: 'LaundryOpsPickupsPage',
  returns: 'LaundryOpsReturnsPage',
  cleaning: 'LaundryOpsCleaningPage',
  inventory: 'LaundryOpsInventoryPage',
};

/**
 * LaundryOpsPage
 *
 * Laundry-only operations dashboard (mockups 04-09.jpg). Access is gated with
 * `isLaundryUser` exactly as LaundryProfilePage does it - non-laundry users
 * get NotFoundPage rather than a redirect, so the route's existence isn't
 * disclosed. The server re-checks on every call (server/api-util/laundryAuth.js),
 * so this gate is a UX affordance, not the security boundary.
 *
 * @param {Object} props
 * @param {string} props.tab - which ops screen to render (see OPS_TABS)
 * @param {propTypes.currentUser} [props.currentUser]
 * @param {Array} props.orders - rows from /api/laundry-orders
 * @param {Array} props.inventory - per-garment rows from /api/laundry-orders
 * @param {boolean} props.truncated - endpoint hit its crawl cap
 * @param {boolean} props.fetchOrdersInProgress
 * @param {propTypes.error} [props.fetchOrdersError]
 * @param {string|null} props.advanceStatusTransactionId
 * @param {propTypes.error} [props.advanceStatusError]
 * @param {Function} props.onAdvanceStatus
 * @param {string} [props.handBackListingId] - the listing whose hand-back is in flight
 * @param {propTypes.error} [props.handBackError]
 * @param {Function} props.onHandBackToOwner
 * @param {boolean} props.scrollingDisabled
 * @returns {JSX.Element}
 */
export const LaundryOpsPageComponent = props => {
  const intl = useIntl();
  const {
    tab = 'dashboard',
    currentUser,
    orders = [],
    inventory = [],
    truncated = false,
    fetchOrdersInProgress = false,
    fetchOrdersError,
    advanceStatusTransactionId = null,
    advanceStatusError,
    onAdvanceStatus,
    handBackListingId,
    handBackError,
    onHandBackToOwner,
    scrollingDisabled,
    staticContext,
  } = props;

  const currentUserLoaded = !!currentUser?.id;

  if (currentUserLoaded && !isLaundryUser(currentUser)) {
    return <NotFoundPage staticContext={staticContext} />;
  }

  if (!currentUserLoaded) {
    // currentUser hasn't loaded yet (e.g. straight after login) - avoid a
    // flash of NotFoundPage before we know whether this user is a laundry.
    return null;
  }

  const studioName = currentUser?.attributes?.profile?.publicData?.laundryProfile?.studioName;

  const title = intl.formatMessage({ id: `LaundryOpsPage.title.${tab}` });

  const renderContent = () => {
    if (fetchOrdersInProgress && orders.length === 0 && inventory.length === 0) {
      return <IconSpinner />;
    }
    if (fetchOrdersError) {
      return (
        <p className={css.error}>
          <FormattedMessage id="LaundryOpsPage.fetchFailed" />
        </p>
      );
    }

    switch (tab) {
      case 'dashboard':
        return <LaundryDashboard rows={orders} />;
      case 'inventory':
        return (
          <LaundryInventory
            inventory={inventory}
            onHandBackToOwner={onHandBackToOwner}
            handBackListingId={handBackListingId}
            handBackError={handBackError}
          />
        );
      case 'orders':
      case 'pickups':
      case 'returns':
      case 'cleaning':
      default:
        return (
          <LaundryOrdersTable
            rows={filterByView(orders, tab === 'orders' ? 'all' : tab)}
            showTabs={tab === 'orders'}
            onAdvanceStatus={onAdvanceStatus}
            advanceStatusTransactionId={advanceStatusTransactionId}
          />
        );
    }
  };

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSideNavigation
        topbar={
          <>
            <TopbarContainer
              desktopClassName={css.desktopTopbar}
              mobileClassName={css.mobileTopbar}
            />
            {/* This page already renders NotFoundPage for anyone who isn't a laundry, so
                reaching here is itself the isLaundryUser check. */}
            <UserNav
              currentPage={ROUTE_NAME_BY_TAB[tab]}
              showLaundryProfileLink
              showManageListingsLink
            />
          </>
        }
        sideNav={<LaundryOpsNav currentPage={ROUTE_NAME_BY_TAB[tab]} studioName={studioName} />}
        useAccountSettingsNav={false}
        footer={<FooterContainer />}
        mainColumnClassName={css.opsMain}
        sideNavClassName={css.opsSideNav}
        intl={intl}
      >
        <div className={css.content}>
          <H3 as="h1" className={css.pageTitle}>
            <FormattedMessage id={`LaundryOpsPage.heading.${tab}`} />
          </H3>

          {truncated ? (
            <p className={css.warning}>
              <FormattedMessage id="LaundryOpsPage.truncated" />
            </p>
          ) : null}
          {advanceStatusError ? (
            <p className={css.error}>
              <FormattedMessage id="LaundryOpsPage.advanceFailed" />
            </p>
          ) : null}

          {renderContent()}
        </div>
      </LayoutSideNavigation>
    </Page>
  );
};

const mapStateToProps = state => {
  const { currentUser } = state.user;
  const {
    orders,
    inventory,
    truncated,
    fetchOrdersInProgress,
    fetchOrdersError,
    advanceStatusTransactionId,
    advanceStatusError,
    handBackListingId,
    handBackError,
  } = state.LaundryOpsPage;

  return {
    currentUser,
    orders,
    inventory,
    truncated,
    fetchOrdersInProgress,
    fetchOrdersError,
    advanceStatusTransactionId,
    advanceStatusError,
    scrollingDisabled: isScrollingDisabled(state),
  };
};

const mapDispatchToProps = dispatch => ({
  onHandBackToOwner: params => dispatch(handBackToOwner(params)),
  onAdvanceStatus: params => dispatch(advanceStatus(params)),
});

const LaundryOpsPage = compose(
  connect(
    mapStateToProps,
    mapDispatchToProps
  )
)(LaundryOpsPageComponent);

export default LaundryOpsPage;
