import React from 'react';
import { FormattedMessage, intlShape } from '../../util/reactIntl';
import { formatMoney } from '../../util/currency';
import {
  LINE_ITEM_DAY,
  LINE_ITEM_FILE,
  LINE_ITEM_FIXED,
  LINE_ITEM_HOUR,
  LINE_ITEM_NIGHT,
  LINE_ITEM_OFFER,
  LINE_ITEM_REQUEST,
  propTypes,
} from '../../util/types';

import css from './OrderBreakdown.module.css';

/**
 * A component that renders the base price as a line item.
 *
 * @component
 * @param {Object} props
 * @param {Array<propTypes.lineItem>} props.lineItems - The line items to render
 * @param {propTypes.lineItemUnitType} props.code - The code of the line item
 * @param {number} [props.flatRatePeriodDays] - Cocloset: the length of the booking in days
 *   when the base line item prices the WHOLE period rather than a day of it (a fixed 7- or
 *   14-day garment rental). Resolved by OrderBreakdown; see the comment there. Absent on
 *   every other kind of listing, which keeps the stock per-unit rendering below untouched.
 * @param {intlShape} props.intl - The intl object
 * @returns {JSX.Element}
 */
const LineItemBasePriceMaybe = props => {
  const { lineItems, code, flatRatePeriodDays, intl } = props;
  const isDigitalItem = code === LINE_ITEM_FILE;
  const isNightly = code === LINE_ITEM_NIGHT;
  const isDaily = code === LINE_ITEM_DAY;
  const isHourly = code === LINE_ITEM_HOUR;
  const isFixed = code === LINE_ITEM_FIXED;
  const isRequest = code === LINE_ITEM_REQUEST;
  const isOffer = code === LINE_ITEM_OFFER;
  const translationKey = isDigitalItem
    ? 'OrderBreakdown.baseUnitDigitalItem'
    : isNightly
    ? 'OrderBreakdown.baseUnitNight'
    : isDaily
    ? 'OrderBreakdown.baseUnitDay'
    : isHourly
    ? 'OrderBreakdown.baseUnitHour'
    : isFixed
    ? 'OrderBreakdown.baseUnitFixedBooking'
    : isRequest
    ? 'OrderBreakdown.baseUnitRequest'
    : isOffer
    ? 'OrderBreakdown.baseUnitOffer'
    : 'OrderBreakdown.baseUnitQuantity';

  // Find correct line-item for given code prop.
  // It should be one of the following: 'line-item/night, 'line-item/day', 'line-item/hour', 'line-item/fixed', 'line-item/item', 'line-item/offer', 'line-item/request' or 'line-item/file
  // These are defined in '../../util/types';
  const unitPurchase = lineItems.find(item => item.code === code && !item.reversal);

  const quantity = unitPurchase?.units
    ? unitPurchase.units.toString()
    : unitPurchase?.quantity
    ? unitPurchase.quantity.toString()
    : null;
  const unitPrice = unitPurchase ? formatMoney(intl, unitPurchase.unitPrice) : null;
  const total = unitPurchase ? formatMoney(intl, unitPurchase.lineTotal) : null;

  // Cocloset: the price is for the whole rental period, so say so instead of multiplying it
  // by a quantity of 1. Placed ahead of the seats branch because a fixed-period garment
  // rental has no seats — a garment is one physical object.
  const message = flatRatePeriodDays ? (
    <FormattedMessage
      id="OrderBreakdown.baseUnitRentalPeriod"
      values={{ unitPrice, days: flatRatePeriodDays }}
    />
  ) : unitPurchase?.seats ? (
    <FormattedMessage
      id={`${translationKey}Seats`}
      values={{ unitPrice, quantity, seats: unitPurchase.seats }}
    />
  ) : (
    <FormattedMessage id={translationKey} values={{ unitPrice, quantity }} />
  );

  return quantity && total ? (
    <div className={css.lineItem}>
      <span className={css.itemLabel}>{message}</span>
      <span className={css.itemValue}>{total}</span>
    </div>
  ) : null;
};

export default LineItemBasePriceMaybe;
