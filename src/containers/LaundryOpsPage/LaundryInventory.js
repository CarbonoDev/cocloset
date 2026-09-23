import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';
import { HandBackToOwnerButton } from '../../components';
import { canHandBackToOwner, statusLabelKey } from '../../util/laundryStatuses';

import { statusTone } from './LaundryOpsPage.helpers';
import css from './LaundryOpsPage.module.css';

/**
 * "Inventory in studio" card grid - one card per garment
 * assigned to this laundry, showing its internal laundry code
 * and status badge.
 *
 * This is the listing-readiness view of the same data the Orders table renders
 * as transactions (design doc §8): exactly one card per assigned listing,
 * regardless of how many bookings that garment has had.
 *
 * @param {Object} props
 * @param {Array} props.inventory - `inventory` rows from /api/laundry-orders
 * @returns {JSX.Element}
 */
// A garment can only leave the studio's inventory when it is actually there and nothing is
// renting it. The server is the authority - it answers 409 while the listing has an active
// transaction, which is what enforces "una vez que finalice la limpieza" - but offering a
// button that is going to be refused is its own kind of wrong, so the card asks the same
// question from what it already knows. Shared with the orders table and the handover page,
// because the same garment has to answer the same way on all three (util/laundryStatuses.js).
const LaundryInventory = props => {
  const {
    inventory,
    onHandBackToOwner,
    handBackListingId,
    handBackError,
    onManageDisableScrolling,
  } = props;

  if (inventory.length === 0) {
    return (
      <p className={css.emptyState}>
        <FormattedMessage id="LaundryOpsPage.inventory.empty" />
      </p>
    );
  }

  return (
    <>
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
      <ul className={css.inventoryGrid}>
        {inventory.map(item => {
          const labelKey = statusLabelKey(item);
          // THE STUDIO'S OWN CODE, NOT THE TRANSACTION'S TICKET.
          //
          //   > "en la sección de inventory, hay que mostrar el ticket que se haya
          //   >  ingresado internamente, no el ticket de la transacción"
          //   >  (Jonathan, 2026-09-03)
          //
          // `ticketCode` belongs to a rental. `laundryCode` is the internal identifier
          // that this studio assigns to the garment when it receives it. It is the code
          // used by the laundry to recognize the garment within its own inventory and
          // is the identifier this screen should display.
          //
          // The laundry code is shown regardless of garment state. Previously it was
          // hidden for `delivered`, even though delivered garments are still part of
          // the studio inventory and need to be identifiable.
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
              {internalCode ? <span className={css.secondaryText}>#{internalCode}</span> : null}
              {labelKey ? (
                <span className={classNames(css.statusBadge, css[`tone${statusTone(item)}`])}>
                  <FormattedMessage id={labelKey} />
                </span>
              ) : null}
              {/* HANDING IT BACK.
                  > "no hay ninguna manera en que un provider pueda recoger la prenda y se
                  >  pueda cambiar ese status (...) laundry siempre tiene que estar ahi para
                  >  recolectar la prenda" (Jonathan, 2026-09-07)

                The studio records it, because the studio is the one at the counter when the
                owner collects. Until this button existed the flag could only ever be set to
                true, so a garment that went home stayed in the studio's inventory forever -
                and its laundry could never be reassigned. */}
              {canHandBackToOwner(item) ? (
                <HandBackToOwnerButton
                  id={`LaundryInventory.handBack.${item.listingId}`}
                  className={css.handBackButton}
                  garmentTitle={item.title}
                  inProgress={handBackListingId === item.listingId}
                  onManageDisableScrolling={onManageDisableScrolling}
                  onConfirm={() => onHandBackToOwner({ listingId: item.listingId })}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
};

export default LaundryInventory;
