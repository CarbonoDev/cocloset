import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';

import LaundryOrderRow from './LaundryOrderRow';
import { ORDER_TABS, filterByTab, filterBySearch, sortRows } from './LaundryOpsPage.helpers';
import css from './LaundryOpsPage.module.css';

/**
 * The master orders table (mockup 08.jpg) and, via the `showTabs` prop, the
 * Pickups / Returns / Cleaning screens (mockups 05-07.jpg).
 *
 * Those three screens are the same table over a pre-filtered set of rows
 * rather than three separate implementations - the filtering that produces
 * them lives in LaundryOpsPage.helpers.js (`filterByView`) and happens before
 * rows reach this component. Only the Orders screen shows the filter tabs.
 *
 * @param {Object} props
 * @param {Array} props.rows - already view-filtered rows
 * @param {boolean} [props.showTabs] - render the Orders filter tabs
 * @param {Function} props.onAdvanceStatus
 * @param {string|null} props.advanceStatusTransactionId - row currently updating
 * @param {Function} [props.onHandBackToOwner] - ({listingId}) => void
 * @param {string|null} [props.handBackListingId] - garment currently being handed back
 * @param {Object} [props.handBackError]
 * @returns {JSX.Element}
 */
const LaundryOrdersTable = props => {
  const intl = useIntl();
  const {
    rows,
    showTabs = false,
    onAdvanceStatus,
    advanceStatusTransactionId,
    onHandBackToOwner,
    handBackListingId,
    handBackError,
  } = props;

  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');

  const tabbed = showTabs ? filterByTab(rows, tab) : rows;
  const visible = sortRows(filterBySearch(tabbed, search));

  return (
    <div className={css.tableWrapper}>
      <div className={css.tableControls}>
        {showTabs ? (
          <div className={css.tabs}>
            {ORDER_TABS.map(t => (
              <button
                key={t}
                type="button"
                className={classNames(css.tab, { [css.tabActive]: t === tab })}
                onClick={() => setTab(t)}
              >
                <FormattedMessage id={`LaundryOpsPage.tab.${t}`} />
              </button>
            ))}
          </div>
        ) : null}
        <input
          type="search"
          className={css.search}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={intl.formatMessage({ id: 'LaundryOpsPage.table.searchPlaceholder' })}
          aria-label={intl.formatMessage({ id: 'LaundryOpsPage.table.searchPlaceholder' })}
        />
      </div>

      {handBackError ? (
        <p className={css.error}>
          <FormattedMessage
            id={
              handBackError?.status === 409
                ? 'LaundryOpsPage.inventory.handBackActiveRental'
                : 'LaundryOpsPage.inventory.handBackFailed'
            }
          />
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className={css.emptyState}>
          <FormattedMessage id="LaundryOpsPage.table.empty" />
        </p>
      ) : (
        // Six columns can't compress to a phone width, so the table gets its own
        // horizontal scroll container rather than being reflowed.
        <div className={css.tableScroll}>
          <table className={css.table}>
            <thead>
              <tr>
                <th className={css.th}>
                  <FormattedMessage id="LaundryOpsPage.table.ticket" />
                </th>
                <th className={css.th}>
                  <FormattedMessage id="LaundryOpsPage.table.customerOwner" />
                </th>
                <th className={css.th}>
                  <FormattedMessage id="LaundryOpsPage.table.garment" />
                </th>
                <th className={css.th}>
                  <FormattedMessage id="LaundryOpsPage.table.pickupReturn" />
                </th>
                <th className={css.th}>
                  <FormattedMessage id="LaundryOpsPage.table.status" />
                </th>
                <th className={css.th}>
                  <span className={css.visuallyHidden}>
                    <FormattedMessage id="LaundryOpsPage.table.actions" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row => (
                <LaundryOrderRow
                  key={row.id}
                  row={row}
                  onAdvanceStatus={onAdvanceStatus}
                  advanceInProgress={
                    !!row.transactionId && row.transactionId === advanceStatusTransactionId
                  }
                  onHandBackToOwner={onHandBackToOwner}
                  handBackInProgress={!!row.listingId && row.listingId === handBackListingId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default LaundryOrdersTable;
