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
        // THE STUDIO'S OWN CODE, NOT THE TRANSACTION'S TICKET.
        //
        //   > "en la sección de inventory, hay que mostrar el ticket que se haya
        //   >  ingresado internamente, no el ticket de la transacción"
        //   >  (Jonathan, 2026-09-03)
        //
        // `ticketCode` belongs to a rental. `laundryCode` is what this studio
        // wrote on the garment when it received it - the label that says where
        // it is on their own shelving (server/api-util/laundryCode.js) - which
        // is the only one of the two that answers the question this screen is
        // for: go and find that garment.
        //
        // It is also shown regardless of state now. The old condition hid it on
        // `delivered`, which is precisely the garment sitting in stock waiting
        // to be found again.
        const internalCode = item.laundryCode;
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
            {internalCode ? <span className={css.secondaryText}>#{internalCode}</span> : null}
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
