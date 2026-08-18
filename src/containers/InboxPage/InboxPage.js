import React, { useState } from 'react';
import { useLocation, useHistory } from 'react-router-dom';
import { compose } from 'redux';
import { connect } from 'react-redux';
import classNames from 'classnames';

import { useConfiguration } from '../../context/configurationContext';
import { useRouteConfiguration } from '../../context/routeConfigurationContext';

import { FormattedMessage, intlShape, useIntl } from '../../util/reactIntl';
import { parse, stringify } from '../../util/urlHelpers';
import { getCurrentUserTypeRoles } from '../../util/userHelpers';
import {
  propTypes,
  DATE_TYPE_DATE,
  DATE_TYPE_DATETIME,
  LINE_ITEM_DAY,
  LINE_ITEM_HOUR,
  LISTING_UNIT_TYPES,
  STOCK_MULTIPLE_ITEMS,
  AVAILABILITY_MULTIPLE_SEATS,
  LINE_ITEM_FIXED,
} from '../../util/types';
import { subtractTime } from '../../util/dates';

import InboxTransactionPanel from './InboxTransactionPanel';
import { createResourceLocatorString } from '../../util/routes';
import {
  TX_TRANSITION_ACTOR_CUSTOMER,
  TX_TRANSITION_ACTOR_PROVIDER,
  resolveLatestProcessName,
  getProcess,
  isBookingProcess,
  isPurchaseProcess,
  isNegotiationProcess,
} from '../../transactions/transaction';

import { getMarketplaceEntities } from '../../ducks/marketplaceData.duck';
import { isScrollingDisabled, manageDisableScrolling } from '../../ducks/ui.duck';
import {
  H2,
  Avatar,
  NamedLink,
  NotificationBadge,
  Page,
  PaginationLinks,
  ResponsiveImage,
  TabNav,
  IconSpinner,
  TimeRange,
  UserDisplayName,
  LayoutSideNavigation,
} from '../../components';

import TopbarContainer from '../../containers/TopbarContainer/TopbarContainer';
import FooterContainer from '../../containers/FooterContainer/FooterContainer';
import NotFoundPage from '../../containers/NotFoundPage/NotFoundPage';
import InboxSearchForm from './InboxSearchForm/InboxSearchForm';

import { stateDataShape, getStateData } from './InboxPage.stateData';
import css from './InboxPage.module.css';

// Check if the transaction line-items use booking-related units
const getUnitLineItem = lineItems => {
  const unitLineItem = lineItems?.find(
    item => LISTING_UNIT_TYPES.includes(item.code) && !item.reversal
  );
  return unitLineItem;
};

// Booking data (start & end) are bit different depending on display times and
// if "end" refers to last day booked or the first exclusive day
const bookingData = (tx, lineItemUnitType, timeZone) => {
  // Attributes: displayStart and displayEnd can be used to differentiate shown time range
  // from actual start and end times used for availability reservation. It can help in situations
  // where there are preparation time needed between bookings.
  // Read more: https://www.sharetribe.com/api-reference/marketplace.html#bookings
  const { start, end, displayStart, displayEnd } = tx.booking.attributes;
  const bookingStart = displayStart || start;
  const bookingEndRaw = displayEnd || end;

  // LINE_ITEM_DAY uses exclusive end day, so we subtract one day from the end date
  const isDayBooking = [LINE_ITEM_DAY].includes(lineItemUnitType);
  const bookingEnd = isDayBooking
    ? subtractTime(bookingEndRaw, 1, 'days', timeZone)
    : bookingEndRaw;

  return { bookingStart, bookingEnd };
};

const BookingTimeInfoMaybe = props => {
  const { transaction, ...rest } = props;
  const processName = resolveLatestProcessName(transaction?.attributes?.processName);
  const process = getProcess(processName);
  const isInquiry = process.getState(transaction) === process.states.INQUIRY;

  if (isInquiry) {
    return null;
  }

  const hasLineItems = transaction?.attributes?.lineItems?.length > 0;
  const unitLineItem = hasLineItems
    ? transaction.attributes?.lineItems?.find(
        item => LISTING_UNIT_TYPES.includes(item.code) && !item.reversal
      )
    : null;

  const lineItemUnitType = unitLineItem ? unitLineItem.code : null;
  const dateType = [LINE_ITEM_HOUR, LINE_ITEM_FIXED].includes(lineItemUnitType)
    ? DATE_TYPE_DATETIME
    : DATE_TYPE_DATE;

  const timeZone = transaction?.listing?.attributes?.availabilityPlan?.timezone || 'Etc/UTC';
  const { bookingStart, bookingEnd } = bookingData(transaction, lineItemUnitType, timeZone);

  return (
    <TimeRange
      startDate={bookingStart}
      endDate={bookingEnd}
      dateType={dateType}
      timeZone={timeZone}
      {...rest}
    />
  );
};

// Build and push path string for routing - based on sort selection as selected in InboxSearchForm
const handleSortSelect = (tab, routeConfiguration, history) => urlParam => {
  const pathParams = {
    tab: tab,
  };
  const searchParams = {
    sort: urlParam,
  };

  const sortPath = createResourceLocatorString(
    'InboxPage',
    routeConfiguration,
    pathParams,
    searchParams
  );

  history.push(sortPath);
};

/**
 * The InboxItem component.
 *
 * @component
 * @param {Object} props
 * @param {TX_TRANSITION_ACTOR_CUSTOMER | TX_TRANSITION_ACTOR_PROVIDER} props.transactionRole - The transaction role
 * @param {propTypes.transaction} props.tx - The transaction
 * @param {intlShape} props.intl - The intl object
 * @param {stateDataShape} props.stateData - The state data
 * @returns {JSX.Element} inbox item component
 */
export const InboxItem = props => {
  const {
    transactionRole,
    tx,
    intl,
    stateData,
    isBooking,
    isPurchase,
    availabilityType,
    stockType = STOCK_MULTIPLE_ITEMS,
    // Cocloset: selecting opens the detail beside the list rather than navigating to it.
    isSelected,
    onSelect,
  } = props;
  const { customer, provider, listing } = tx;
  const {
    processName,
    processState,
    actionNeeded,
    isSaleNotification,
    isOrderNotification,
    isFinal,
  } = stateData;
  const isCustomer = transactionRole === TX_TRANSITION_ACTOR_CUSTOMER;

  const lineItems = tx.attributes?.lineItems;
  const hasPricingData = lineItems.length > 0;
  const unitLineItem = getUnitLineItem(lineItems);
  const quantity = hasPricingData && isPurchase ? unitLineItem.quantity.toString() : null;
  const showStock = stockType === STOCK_MULTIPLE_ITEMS || (quantity && unitLineItem.quantity > 1);
  const otherUser = isCustomer ? provider : customer;
  const otherUserDisplayName = <UserDisplayName user={otherUser} intl={intl} />;
  const isOtherUserBanned = otherUser.attributes.banned;

  const rowNotificationDot =
    isSaleNotification || isOrderNotification ? <div className={css.notificationDot} /> : null;

  const linkClasses = classNames(css.itemLink, {
    [css.bannedUserLink]: isOtherUserBanned,
  });
  const stateClasses = classNames(css.stateName, {
    [css.stateConcluded]: isFinal,
    [css.stateActionNeeded]: actionNeeded,
    [css.stateNoActionNeeded]: !actionNeeded,
  });

  return (
    <div className={classNames(css.item, { [css.itemSelected]: isSelected })}>
      {/* THE GARMENT, NOT THE COUNTERPARTY.
            The stock row leads with the other person's avatar, which is right for a
            marketplace where the conversation is the thing. Here the reader is scanning their
            own wardrobe: the design leads with the piece, and a column of identical avatars
            would be unreadable at a glance. */}
      <div className={css.itemAvatar}>
        {listing?.images?.[0] ? (
          <ResponsiveImage
            rootClassName={css.itemThumb}
            alt={listing?.attributes?.title || ''}
            image={listing.images[0]}
            variants={['listing-card', 'listing-card-2x']}
          />
        ) : (
          <Avatar user={otherUser} />
        )}
      </div>
      {/* A BUTTON, NOT A LINK, because selecting no longer navigates away - it opens the
          detail beside this list. The URL still changes (see `onSelect`), so the rental is
          linkable and the back button works; what it is not is a page transition. */}
      <button
        type="button"
        className={classNames(linkClasses, css.itemButton)}
        onClick={onSelect}
        aria-current={isSelected ? 'true' : undefined}
      >
        <div className={css.rowNotificationDot}>{rowNotificationDot}</div>
        <div className={css.itemTitle}>{listing?.attributes?.title}</div>
        <div className={css.itemDetails}>
          {isBooking ? (
            <BookingTimeInfoMaybe transaction={tx} />
          ) : isPurchase && hasPricingData && showStock ? (
            <FormattedMessage id="InboxPage.quantity" values={{ quantity }} />
          ) : null}
        </div>
        {/* The counterparty moved BELOW the garment and into the quiet line. The design leads
            with the piece; who it is with is context, not the headline. */}
        {otherUserDisplayName ? (
          <div className={css.itemUsername}>{otherUserDisplayName}</div>
        ) : null}
        {availabilityType == AVAILABILITY_MULTIPLE_SEATS && unitLineItem?.seats ? (
          <div className={css.itemSeats}>
            <FormattedMessage id="InboxPage.seats" values={{ seats: unitLineItem.seats }} />
          </div>
        ) : null}
        <div className={stateClasses}>
          <FormattedMessage
            id={`InboxPage.${processName}.${processState}.status`}
            values={{ transactionRole }}
          />
        </div>
      </button>
    </div>
  );
};

/**
 * The InboxPage component.
 *
 * @component
 * @param {Object} props
 * @param {Object} props.currentUser - The current user
 * @param {boolean} props.fetchInProgress - Whether the fetch is in progress
 * @param {propTypes.error} props.fetchOrdersOrSalesError - The fetch orders or sales error
 * @param {propTypes.pagination} props.pagination - The pagination object
 * @param {Object} props.params - The params object
 * @param {string} props.params.tab - The tab
 * @param {number} props.providerNotificationCount - The provider notification count
 * @param {number} props.customerNotificationCount - The customer notification count
 * @param {boolean} props.scrollingDisabled - Whether scrolling is disabled
 * @param {Array<propTypes.transaction>} props.transactions - The transactions array
 * @param {Object} props.intl - The intl object
 * @returns {JSX.Element} inbox page component
 */
export const InboxPageComponent = props => {
  const config = useConfiguration();
  const routeConfiguration = useRouteConfiguration();
  const history = useHistory();
  const intl = useIntl();
  const location = useLocation();
  const {
    currentUser,
    fetchInProgress,
    fetchOrdersOrSalesError,
    pagination,
    params,
    providerNotificationCount = 0,
    customerNotificationCount = 0,
    scrollingDisabled,
    transactions,
  } = props;
  const { tab } = params;
  const validTab = tab === 'orders' || tab === 'sales';
  if (!validTab) {
    return <NotFoundPage staticContext={props.staticContext} />;
  }

  const { customer: isCustomerUserType, provider: isProviderUserType } = getCurrentUserTypeRoles(
    config,
    currentUser
  );

  const isOrders = tab === 'orders';
  const hasNoResults = !fetchInProgress && transactions.length === 0 && !fetchOrdersOrSalesError;
  const ordersTitle = intl.formatMessage({ id: 'InboxPage.ordersTitle' });
  const salesTitle = intl.formatMessage({ id: 'InboxPage.salesTitle' });
  const title = isOrders ? ordersTitle : salesTitle;
  const search = parse(location.search);

  // WHICH RENTAL IS OPEN, IN THE URL.
  //
  //   > "al seleccionar uno, abre el detalle de la transacción sin ocultar el listado"
  //
  // A QUERY PARAM RATHER THAN A PATH SEGMENT. `/inbox/:tab` is a route this app and its
  // links already know; adding `/:id?` means a second route entry, a second loadData
  // signature and every existing link becoming a special case, in exchange for a prettier
  // URL. What the param buys is what actually matters: the back button works, a rental can
  // be linked to, and a reload does not drop the reader back on the empty state.
  const selectedTxId = typeof search.tx === 'string' ? search.tx : null;
  const selectedTransaction = selectedTxId
    ? transactions.find(tx => tx.id?.uuid === selectedTxId)
    : null;

  // Collapsed on a phone once something is open, per the client: the list and a full detail
  // stacked would be a very long page. On desktop both are always visible - that is the point
  // of the layout - so this state is only ever consulted by the mobile styles.
  //
  // Initial value derived rather than defaulted: arriving on a link to one rental should show
  // that rental, and arriving on the inbox should show the list.
  const [isListOpenOnMobile, setListOpenOnMobile] = useState(!selectedTxId);

  const pickType = lt => conf => conf.listingType === lt;
  const findListingTypeConfig = publicData => {
    const listingTypeConfigs = config.listing?.listingTypes;
    const { listingType } = publicData || {};
    const foundConfig = listingTypeConfigs?.find(pickType(listingType));
    return foundConfig;
  };
  // Derived the same way the row's is, from the same function, so the panel and the row that
  // opened it cannot describe one rental with two different phrases.
  let selectedStateData = null;
  try {
    selectedStateData = selectedTransaction
      ? getStateData({
          transaction: selectedTransaction,
          transactionRole: isOrders ? TX_TRANSITION_ACTOR_CUSTOMER : TX_TRANSITION_ACTOR_PROVIDER,
          intl,
        })
      : null;
  } catch (error) {
    // Same swallow as the list's: a transaction in a state this app does not model renders
    // without a status rather than taking the page down.
  }

  const toTxItem = tx => {
    const transactionRole = isOrders ? TX_TRANSITION_ACTOR_CUSTOMER : TX_TRANSITION_ACTOR_PROVIDER;
    let stateData = null;
    try {
      stateData = getStateData({ transaction: tx, transactionRole, intl });
    } catch (error) {
      // If stateData is missing, omit the transaction from InboxItem list.
    }

    const publicData = tx?.listing?.attributes?.publicData || {};
    const foundListingTypeConfig = findListingTypeConfig(publicData);
    const { transactionType, stockType, availabilityType } = foundListingTypeConfig || {};
    const process = tx?.attributes?.processName || transactionType?.transactionType;
    const transactionProcess = resolveLatestProcessName(process);
    const isBooking = isBookingProcess(transactionProcess);
    const isPurchase = isPurchaseProcess(transactionProcess);
    const isNegotiation = isNegotiationProcess(transactionProcess);

    // Render InboxItem only if the latest transition of the transaction is handled in the `txState` function.
    return stateData ? (
      <li key={tx.id.uuid} className={css.listItem}>
        <InboxItem
          transactionRole={transactionRole}
          tx={tx}
          intl={intl}
          stateData={stateData}
          stockType={stockType}
          availabilityType={availabilityType}
          isBooking={isBooking}
          isPurchase={isPurchase}
          isSelected={tx.id?.uuid === selectedTxId}
          onSelect={() => {
            // Replace rather than push: clicking through five rentals should leave one entry
            // in the history, not five, so Back returns to wherever the reader came FROM.
            history.replace(`${location.pathname}?${stringify({ ...search, tx: tx.id?.uuid })}`);
            setListOpenOnMobile(false);
          }}
        />
      </li>
    ) : null;
  };

  const hasOrderOrSaleTransactions = (tx, isOrdersTab, user) => {
    return isOrdersTab
      ? user?.id && tx && tx.length > 0 && tx[0].customer.id.uuid === user?.id?.uuid
      : user?.id && tx && tx.length > 0 && tx[0].provider.id.uuid === user?.id?.uuid;
  };
  const hasTransactions =
    !fetchInProgress && hasOrderOrSaleTransactions(transactions, isOrders, currentUser);

  const ordersTabMaybe = isCustomerUserType
    ? [
        {
          text: (
            <span>
              <FormattedMessage id="InboxPage.ordersTabTitle" />
              {customerNotificationCount > 0 ? (
                <NotificationBadge count={customerNotificationCount} />
              ) : null}
            </span>
          ),
          selected: isOrders,
          linkProps: {
            name: 'InboxPage',
            params: { tab: 'orders' },
          },
        },
      ]
    : [];

  const salesTabMaybe = isProviderUserType
    ? [
        {
          text: (
            <span>
              <FormattedMessage id="InboxPage.salesTabTitle" />
              {providerNotificationCount > 0 ? (
                <NotificationBadge count={providerNotificationCount} />
              ) : null}
            </span>
          ),
          selected: !isOrders,
          linkProps: {
            name: 'InboxPage',
            params: { tab: 'sales' },
          },
        },
      ]
    : [];

  const tabs = [...ordersTabMaybe, ...salesTabMaybe];

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSideNavigation
        sideNavClassName={css.navigation}
        topbar={
          <TopbarContainer
            mobileRootClassName={css.mobileTopbar}
            desktopClassName={css.desktopTopbar}
          />
        }
        sideNav={
          <>
            <H2 as="h1" className={css.title}>
              <FormattedMessage id="InboxPage.title" />
            </H2>
            <TabNav
              rootClassName={css.tabs}
              tabRootClassName={css.tab}
              tabLinkClassName={css.tabLink}
              tabSelectedLinkClassName={css.tabLinkSelected}
              tabs={tabs}
              ariaLabel={intl.formatMessage({ id: 'InboxPage.screenreader.sidenav' })}
            />

            {/* THE LIST MOVED IN HERE, which is the whole structural change.
                  > "hay un listado de transacciones como panel lateral (...) al seleccionar
                  >  uno, abre el detalle de la transacción sin ocultar el listado"

                It used to be the page's content, with the detail on a route of its own. Now
                it is the column, and the content is whichever rental is open - so selecting
                one no longer takes the others off the screen. */}
            <InboxSearchForm
              onSubmit={() => {}}
              onSelect={handleSortSelect(tab, routeConfiguration, history)}
              intl={intl}
              tab={tab}
              routeConfiguration={routeConfiguration}
              history={history}
            />

            {/* On a phone the list collapses once a rental is open, per the client: stacked,
                a full list and a full detail make a very long page. The button exists only at
                that width - on desktop the list is simply always there, which is the point of
                the layout - so it is hidden by CSS rather than by a JS breakpoint, and no
                reader ever gets a control that does nothing. */}
            <button
              type="button"
              className={css.listToggle}
              aria-expanded={isListOpenOnMobile}
              aria-controls="inbox-transaction-list"
              onClick={() => setListOpenOnMobile(open => !open)}
            >
              <FormattedMessage
                id={isListOpenOnMobile ? 'InboxPage.hideList' : 'InboxPage.showList'}
              />
            </button>

            {fetchOrdersOrSalesError ? (
              <p className={css.error}>
                <FormattedMessage id="InboxPage.fetchFailed" />
              </p>
            ) : null}
            <ul
              id="inbox-transaction-list"
              className={classNames(css.itemList, {
                [css.itemListCollapsedOnMobile]: !isListOpenOnMobile,
              })}
            >
              {!fetchInProgress ? (
                transactions.map(toTxItem)
              ) : (
                <li className={css.listItemsLoading}>
                  <IconSpinner />
                </li>
              )}
              {hasNoResults ? (
                <li key="noResults" className={css.noResults}>
                  <FormattedMessage
                    id={isOrders ? 'InboxPage.noOrdersFound' : 'InboxPage.noSalesFound'}
                  />
                </li>
              ) : null}
            </ul>
          </>
        }
        footer={<FooterContainer />}
      >
        {selectedTransaction ? (
          <InboxTransactionPanel
            transaction={selectedTransaction}
            stateData={selectedStateData}
            transactionRole={isOrders ? TX_TRANSITION_ACTOR_CUSTOMER : TX_TRANSITION_ACTOR_PROVIDER}
            onManageDisableScrolling={props.onManageDisableScrolling}
          />
        ) : (
          // The empty state the design draws, rather than a blank column. A reader who has
          // not picked anything yet is not looking at a broken page, and should be told so.
          <p className={css.panelEmpty}>
            <FormattedMessage id="InboxPage.selectATransaction" />
          </p>
        )}
        {hasTransactions && pagination && pagination.totalPages > 1 ? (
          <PaginationLinks
            className={css.pagination}
            pageName="InboxPage"
            pagePathParams={params}
            pageSearchParams={search}
            pagination={pagination}
          />
        ) : null}
      </LayoutSideNavigation>
    </Page>
  );
};

const mapStateToProps = state => {
  const { fetchInProgress, fetchOrdersOrSalesError, pagination, transactionRefs } = state.InboxPage;
  const {
    currentUser,
    currentUserSaleNotificationCount,
    currentUserOrderNotificationCount,
  } = state.user;
  return {
    currentUser,
    fetchInProgress,
    fetchOrdersOrSalesError,
    pagination,
    providerNotificationCount: currentUserSaleNotificationCount,
    customerNotificationCount: currentUserOrderNotificationCount,
    scrollingDisabled: isScrollingDisabled(state),
    transactions: getMarketplaceEntities(state, transactionRefs),
  };
};

// THE PAGE HAD NO DISPATCH PROPS, because the stock inbox never opened a modal. The QR modal
// does, and `Modal` calls `onManageDisableScrolling` to lock the page behind it - so passing
// `undefined` threw, and the browser tab locked up the moment a rental was selected. Found by
// the client, on the first screen I shipped without opening it myself.
const mapDispatchToProps = dispatch => ({
  onManageDisableScrolling: (componentId, disableScrolling) =>
    dispatch(manageDisableScrolling(componentId, disableScrolling)),
});

const InboxPage = compose(
  connect(
    mapStateToProps,
    mapDispatchToProps
  )
)(InboxPageComponent);

export default InboxPage;
