/**
 * This component will show the booking info and calculated total price.
 * I.e. dates and other details related to payment decision in receipt format.
 */
import React from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import {
  DATE_TYPE_DATE,
  DATE_TYPE_DATETIME,
  DATE_TYPE_TIME,
  LINE_ITEM_CUSTOMER_COMMISSION,
  LINE_ITEM_FIXED,
  LINE_ITEM_HOUR,
  LINE_ITEM_PROVIDER_COMMISSION,
  LINE_ITEM_DAY,
  LINE_ITEM_NIGHT,
  LISTING_UNIT_TYPES,
  propTypes,
} from '../../util/types';
import { daysBetween } from '../../util/dates';

import LineItemBookingPeriod from './LineItemBookingPeriod';
import LineItemBasePriceMaybe from './LineItemBasePriceMaybe';
import LineItemSubTotalMaybe from './LineItemSubTotalMaybe';
import LineItemShippingFeeMaybe from './LineItemShippingFeeMaybe';
import LineItemPickupFeeMaybe from './LineItemPickupFeeMaybe';
import LineItemCustomerCommissionMaybe from './LineItemCustomerCommissionMaybe';
import LineItemCustomerCommissionRefundMaybe from './LineItemCustomerCommissionRefundMaybe';
import LineItemProviderCommissionMaybe from './LineItemProviderCommissionMaybe';
import LineItemProviderCommissionRefundMaybe from './LineItemProviderCommissionRefundMaybe';
import LineItemRefundMaybe from './LineItemRefundMaybe';
import LineItemTotalPrice from './LineItemTotalPrice';
import LineItemUnknownItemsMaybe from './LineItemUnknownItemsMaybe';

import css from './OrderBreakdown.module.css';

export const OrderBreakdownComponent = props => {
  const {
    rootClassName,
    className,
    userRole,
    transaction,
    booking,
    timeZone,
    currency,
    marketplaceName,
    intl,
  } = props;

  const isCustomer = userRole === 'customer';
  const isProvider = userRole === 'provider';
  const allLineItems = transaction.attributes.lineItems || [];
  // We'll show only line-items that are specific for the current userRole (customer vs provider)
  const lineItems = allLineItems.filter(lineItem => lineItem.includeFor.includes(userRole));
  const unitLineItem = lineItems.find(
    item => LISTING_UNIT_TYPES.includes(item.code) && !item.reversal
  );
  // Line-item code that matches with base unit: day, night, hour, fixed, item
  const lineItemUnitType = unitLineItem?.code;
  const dateType = [LINE_ITEM_HOUR, LINE_ITEM_FIXED].includes(lineItemUnitType)
    ? DATE_TYPE_DATETIME
    : DATE_TYPE_DATE;

  // Cocloset: a garment rented for a fixed period (7 or 14 days) is charged a FLAT price
  // for the whole period, so its base line item carries `quantity: 1` while the booking
  // spans many days (server/api-util/lineItems.js). Rendering that through the stock
  // "{unitPrice} × {quantity} days" template would read "$100.00 × 1 day" against a booking
  // that visibly runs a week — the same confusion the flat price exists to remove.
  //
  // The condition is the fact itself rather than a listing-type lookup: a day/night unit
  // line item whose quantity is 1 across a booking longer than one day IS a flat rate, by
  // arithmetic, and OrderBreakdown has no access to the listing (it is rendered for a
  // speculative estimate and for a stored transaction alike). Bookings of exactly one day
  // are untouched — there is nothing to disambiguate there.
  const isDateRangeUnit = [LINE_ITEM_DAY, LINE_ITEM_NIGHT].includes(lineItemUnitType);
  // daysBetween throws on a reversed range, and this is a display component: a transaction
  // with impossible dates must still render its price, not blank the whole page.
  let bookedDays = null;
  try {
    bookedDays =
      isDateRangeUnit && booking?.attributes?.start && booking?.attributes?.end
        ? daysBetween(booking.attributes.start, booking.attributes.end)
        : null;
  } catch (e) {
    bookedDays = null;
  }
  // `quantity` arrives as a decimal.js Decimal on a stored transaction and as a plain
  // number on the speculative estimate, so it is coerced before comparing. A bare
  // `quantity === 1` is false for the Decimal in every case, which would silently disable
  // this whole branch on real transactions while passing in the estimate.
  const unitQuantity = unitLineItem?.quantity != null ? Number(unitLineItem.quantity) : null;
  const flatRatePeriodDays = unitQuantity === 1 && bookedDays > 1 ? bookedDays : null;

  const hasCommissionLineItem = lineItems.find(item => {
    const hasCustomerCommission = isCustomer && item.code === LINE_ITEM_CUSTOMER_COMMISSION;
    const hasProviderCommission = isProvider && item.code === LINE_ITEM_PROVIDER_COMMISSION;
    return (hasCustomerCommission || hasProviderCommission) && !item.reversal;
  });

  const classes = classNames(rootClassName || css.root, className);

  /**
   * OrderBreakdown contains different line items:
   *
   * LineItemBookingPeriod: prints booking start and booking end types. Prop dateType
   * determines if the date and time or only the date is shown
   *
   * LineItemShippingFeeMaybe: prints the shipping fee (combining additional fee of
   * additional items into it).
   *
   * LineItemShippingFeeRefundMaybe: prints the amount of refunded shipping fee
   *
   * LineItemBasePriceMaybe: prints the base price calculation for the listing, e.g.
   * "$150.00 * 2 nights $300"
   *
   * LineItemUnknownItemsMaybe: prints the line items that are unknown. In ideal case there
   * should not be unknown line items. If you are using custom pricing, you should create
   * new custom line items if you need them.
   *
   * LineItemSubTotalMaybe: prints subtotal of line items before possible
   * commission or refunds
   *
   * LineItemRefundMaybe: prints the amount of refund
   *
   * LineItemCustomerCommissionMaybe: prints the amount of customer commission
   * The default transaction process used by this template doesn't include the customer commission.
   *
   * LineItemCustomerCommissionRefundMaybe: prints the amount of refunded customer commission
   *
   * LineItemProviderCommissionMaybe: prints the amount of provider commission
   *
   * LineItemProviderCommissionRefundMaybe: prints the amount of refunded provider commission
   *
   * LineItemTotalPrice: prints total price of the transaction
   *
   */

  return (
    <div className={classes}>
      <LineItemBookingPeriod
        booking={booking}
        code={lineItemUnitType}
        dateType={dateType}
        timeZone={timeZone}
      />

      <LineItemBasePriceMaybe
        lineItems={lineItems}
        code={lineItemUnitType}
        flatRatePeriodDays={flatRatePeriodDays}
        intl={intl}
      />
      <LineItemShippingFeeMaybe lineItems={lineItems} intl={intl} />
      <LineItemPickupFeeMaybe lineItems={lineItems} intl={intl} />
      <LineItemUnknownItemsMaybe lineItems={lineItems} isProvider={isProvider} intl={intl} />

      <LineItemSubTotalMaybe
        lineItems={lineItems}
        code={lineItemUnitType}
        userRole={userRole}
        intl={intl}
        marketplaceCurrency={currency}
      />
      <LineItemRefundMaybe lineItems={lineItems} intl={intl} marketplaceCurrency={currency} />

      <LineItemCustomerCommissionMaybe
        lineItems={lineItems}
        isCustomer={isCustomer}
        marketplaceName={marketplaceName}
        intl={intl}
      />
      <LineItemCustomerCommissionRefundMaybe
        lineItems={lineItems}
        isCustomer={isCustomer}
        marketplaceName={marketplaceName}
        intl={intl}
      />

      <LineItemProviderCommissionMaybe
        lineItems={lineItems}
        isProvider={isProvider}
        marketplaceName={marketplaceName}
        intl={intl}
      />
      <LineItemProviderCommissionRefundMaybe
        lineItems={lineItems}
        isProvider={isProvider}
        marketplaceName={marketplaceName}
        intl={intl}
      />

      <LineItemTotalPrice transaction={transaction} isProvider={isProvider} intl={intl} />

      {hasCommissionLineItem ? (
        <span className={css.feeInfo}>
          <FormattedMessage id="OrderBreakdown.commissionFeeNote" />
        </span>
      ) : null}
    </div>
  );
};

/**
 * Order breakdown aka receipt
 *
 * @component
 * @param {Object} props
 * @param {string?} props.className add more style rules in addition to component's own css.root
 * @param {string?} props.rootClassName overwrite components own css.root
 * @param {string} props.marketplaceName
 * @param {string} props.timeZone IANA time zone name
 * @param {string} props.currency E.g. 'USD'
 * @param {'customer' | 'provider'} props.userRole
 * @param {propTypes.transaction} props.transaction
 * @param {propTypes.booking?} props.booking
 * @param {DATE_TYPE_DATE | DATE_TYPE_TIME | DATE_TYPE_DATETIME} props.dateType
 * @returns {JSX.Element} the order breakdown component
 */
const OrderBreakdown = props => {
  const intl = useIntl();
  return <OrderBreakdownComponent intl={intl} {...props} />;
};

export default OrderBreakdown;
