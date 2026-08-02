import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';
import { statusLabelKey } from '../../util/laundryStatuses';

import { statusTone } from './LaundryOpsPage.helpers';
import css from './LaundryOpsPage.module.css';

/**
 * "Inventory in studio" card grid (mockup 04.jpg) - one card per garment
 * assigned to this laundry, showing its rack location and status badge.
 *
 * This is the listing-readiness view of the same data the Orders table renders
 * as transactions (design doc §8): exactly one card per assigned listing,
 * regardless of how many bookings that garment has had.
 *
 * @param {Object} props
 * @param {Array} props.inventory - `inventory` rows from /api/laundry-orders
 * @returns {JSX.Element}
 */
const LaundryInventory = props => {
  const { inventory } = props;

  if (inventory.length === 0) {
    return (
      <p className={css.emptyState}>
        <FormattedMessage id="LaundryOpsPage.inventory.empty" />
      </p>
    );
  }

  return (
    <ul className={css.inventoryGrid}>
      {inventory.map(item => {
        const labelKey = statusLabelKey(item);
        return (
          <li key={item.id} className={css.inventoryCard}>
            <div className={css.inventoryImage}>
              {item.imageUrl ? (
                <img src={item.imageUrl} alt={item.title || ''} className={css.thumb} />
              ) : (
                <span className={css.thumbPlaceholder}>
                  <FormattedMessage id="LaundryOpsPage.detail.noImage" />
                </span>
              )}
            </div>
            <span className={css.primaryText}>{item.title || '—'}</span>
            <span className={css.secondaryText}>
              {item.currentRack || <FormattedMessage id="LaundryOpsPage.inventory.noRack" />}
            </span>
            {labelKey ? (
              <span className={classNames(css.statusBadge, css[`tone${statusTone(item)}`])}>
                <FormattedMessage id={labelKey} />
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};

export default LaundryInventory;
