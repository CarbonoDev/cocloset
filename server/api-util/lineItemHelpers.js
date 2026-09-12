const Decimal = require('decimal.js');
const moment = require('moment-timezone/builds/moment-timezone-with-data-10-year-range.min');
const { types } = require('sharetribe-flex-sdk');
const { Money } = types;

const { getAmountAsDecimalJS, convertDecimalJSToNumber, unitDivisor } = require('./currency');
const { nightsBetween, daysBetween } = require('./dates');
const { getListingCategoryValues } = require('./categoryPricing');
const { resolveCleaningFeeMajorUnits } = require('./cleaningFeeEnv');
const { resolveSpecialHandlingFeeMajorUnits } = require('./specialHandlingFeeEnv');
const { getIntegrationSdk } = require('./integrationSdk');
const LINE_ITEM_NIGHT = 'line-item/night';
const LINE_ITEM_DAY = 'line-item/day';
const LINE_ITEM_CLEANING_FEE = 'line-item/cleaning-fee';
const LINE_ITEM_SPECIAL_HANDLING_FEE = 'line-item/special-handling-fee';

/** Helper functions for constructing line items*/

const isNumber = value => {
  return typeof value === 'number' && !isNaN(value);
};

// Provider commission reduces the amount of money that is paid out to provider.
// Therefore, the provider commission line-item should have negative effect to the payout total.
const getNegation = numberValue => {
  return -1 * numberValue;
};

// Returns percentage applied to a given amount if applicable and valid, otherwise returns 0
const calculateCommissionWithPercentage = (percentage, amount) => {
  const hasValidAmountAndPercentage = amount != null && percentage != null && percentage > 0;

  if (hasValidAmountAndPercentage) {
    return new Decimal(amount)
      .times(percentage)
      .dividedBy(100)
      .toNearest(1, Decimal.ROUND_HALF_UP)
      .toNumber();
  }
  return 0;
};

/**
 * Calculates shipping fee based on saved public data fields and quantity.
 * The total will be `shippingPriceInSubunitsOneItem + (shippingPriceInSubunitsAdditionalItems * (quantity - 1))`.
 * E.g. 4 items ordered with shipping fees €10 for first item and €5 for additional items:
 * €10 + (3 * €5) => €25
 *
 * @param {Money} shippingPriceInSubunitsOneItem
 * @param {Money} shippingPriceInSubunitsAdditionalItems
 * @param {string} currency code
 * @param {int} quantity
 *
 * @returns {Money} lineTotal
 */
exports.calculateShippingFee = (
  shippingPriceInSubunitsOneItem,
  shippingPriceInSubunitsAdditionalItems,
  currency,
  quantity
) => {
  if (
    isNumber(shippingPriceInSubunitsOneItem) &&
    shippingPriceInSubunitsOneItem >= 0 &&
    currency &&
    quantity === 1
  ) {
    return new Money(shippingPriceInSubunitsOneItem, currency);
  } else if (
    isNumber(shippingPriceInSubunitsOneItem) &&
    isNumber(shippingPriceInSubunitsAdditionalItems) &&
    shippingPriceInSubunitsOneItem >= 0 &&
    shippingPriceInSubunitsAdditionalItems >= 0 &&
    currency &&
    quantity > 1
  ) {
    const oneItemFee = getAmountAsDecimalJS(new Money(shippingPriceInSubunitsOneItem, currency));
    const additionalItemsFee = getAmountAsDecimalJS(
      new Money(shippingPriceInSubunitsAdditionalItems, currency)
    );
    const additionalItemsTotal = additionalItemsFee.times(quantity - 1);
    const numericShippingFee = convertDecimalJSToNumber(oneItemFee.plus(additionalItemsTotal));
    return new Money(numericShippingFee, currency);
  } else if (
    currency &&
    quantity > 1 &&
    (!isNumber(shippingPriceInSubunitsOneItem) || !isNumber(shippingPriceInSubunitsAdditionalItems))
  ) {
    // If both shippingPriceInSubunitsOneItem and shippingPriceInSubunitsAdditionalItems are NOT set,
    // when quantity is greater than 1, there's an error somewhere in the code
    throw new Error('Shipping fee is not set correctly for multiple items');
  }
  return null;
};

/**
 * Calculates lineTotal for lineItem based on quantity.
 * The total will be `unitPrice * quantity`.
 *
 * @param {Money} unitPrice
 * @param {int} quantity
 *
 * @returns {Money} lineTotal
 */
exports.calculateTotalPriceFromQuantity = (unitPrice, unitCount) => {
  const amountFromUnitPrice = getAmountAsDecimalJS(unitPrice);

  // NOTE: We round the total price to the nearest integer.
  //       Payment processors don't support fractional subunits.
  const totalPrice = amountFromUnitPrice.times(unitCount).toNearest(1, Decimal.ROUND_HALF_UP);
  // Get total price as Number (and validate that the conversion is safe)
  const numericTotalPrice = convertDecimalJSToNumber(totalPrice);

  return new Money(numericTotalPrice, unitPrice.currency);
};

/**
 * Calculates lineTotal for lineItem based on percentage.
 * The total will be `unitPrice * (percentage / 100)`.
 *
 * @param {Money} unitPrice
 * @param {int} percentage
 *
 * @returns {Money} lineTotal
 */
exports.calculateTotalPriceFromPercentage = (unitPrice, percentage) => {
  const amountFromUnitPrice = getAmountAsDecimalJS(unitPrice);

  // NOTE: We round the total price to the nearest integer.
  //       Payment processors don't support fractional subunits.
  const totalPrice = amountFromUnitPrice
    .times(percentage)
    .dividedBy(100)
    .toNearest(1, Decimal.ROUND_HALF_UP);

  // Get total price as Number (and validate that the conversion is safe)
  const numericTotalPrice = convertDecimalJSToNumber(totalPrice);

  return new Money(numericTotalPrice, unitPrice.currency);
};

/**
 * Calculates lineTotal for lineItem based on seats and units.
 * The total will be `unitPrice * units * seats`.
 *
 * @param {Money} unitPrice
 * @param {int} unitCount
 * @param {int} seats
 *
 * @returns {Money} lineTotal
 */
exports.calculateTotalPriceFromSeats = (unitPrice, unitCount, seats) => {
  if (seats < 0) {
    throw new Error(`Value of seats can't be negative`);
  }

  const amountFromUnitPrice = getAmountAsDecimalJS(unitPrice);

  // NOTE: We round the total price to the nearest integer.
  //       Payment processors don't support fractional subunits.
  const totalPrice = amountFromUnitPrice
    .times(unitCount)
    .times(seats)
    .toNearest(1, Decimal.ROUND_HALF_UP);

  // Get total price as Number (and validate that the conversion is safe)
  const numericTotalPrice = convertDecimalJSToNumber(totalPrice);

  return new Money(numericTotalPrice, unitPrice.currency);
};

/**
 * Calculates the quantity based on the booking start and end dates depending on booking type.
 *
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {string} type
 *
 * @returns {number} quantity
 */
exports.calculateQuantityFromDates = (startDate, endDate, type) => {
  if (type === LINE_ITEM_NIGHT) {
    return nightsBetween(startDate, endDate);
  } else if (type === LINE_ITEM_DAY) {
    return daysBetween(startDate, endDate);
  }
  throw new Error(`Can't calculate quantity from dates to unit type: ${type}`);
};

/**
 * Calculate the quantity of hours between start and end dates.
 * If the length of the timeslot is something else than hour (e.g. 30 minutes)
 * you can change parameter 'hours' to 'minutes' and use that to calculate the
 * quantity of timeslots.
 *
 * See moment documentation about diff:
 * https://momentjs.com/docs/#/displaying/difference/
 *
 * @param {Date} startDate
 * @param {Date} endDate
 *
 * @returns {int} quantity of hours between start and end
 *
 */
exports.calculateQuantityFromHours = (startDate, endDate) => {
  // Note: the last parameter (true) ensures that floats are returned.
  return moment(endDate).diff(moment(startDate), 'hours', true);
};

/**
 *
 *  `lineTotal` is calculated by the following rules:
 * - If `quantity` is provided, the line total will be `unitPrice * quantity`.
 * - If `percentage` is provided, the line total will be `unitPrice * (percentage / 100)`.
 * - If `seats` and `units` are provided the line item will contain `quantity` as a product of `seats` and `units` and the line total will be `unitPrice * units * seats`.
 *
 * @param {Object} lineItem
 * @return {Money} lineTotal
 *
 */
exports.calculateLineTotal = lineItem => {
  const { code, unitPrice, quantity, percentage, seats, units } = lineItem;

  if (quantity) {
    return exports.calculateTotalPriceFromQuantity(unitPrice, quantity);
  } else if (percentage != null) {
    return exports.calculateTotalPriceFromPercentage(unitPrice, percentage);
  } else if (seats && units) {
    return exports.calculateTotalPriceFromSeats(unitPrice, units, seats);
  } else {
    throw new Error(
      `Can't calculate the lineTotal of lineItem: ${code}. Make sure the lineItem has quantity, percentage or both seats and units`
    );
  }
};

/**
 * Calculates the total sum of lineTotals for given lineItems
 *
 * @param {Array} lineItems
 * @retuns {Money} total sum
 */
exports.calculateTotalFromLineItems = lineItems => {
  const totalPrice = lineItems.reduce((sum, lineItem) => {
    const lineTotal = exports.calculateLineTotal(lineItem);
    return getAmountAsDecimalJS(lineTotal).add(sum);
  }, 0);

  // Get total price as Number (and validate that the conversion is safe)
  const numericTotalPrice = convertDecimalJSToNumber(totalPrice);
  const unitPrice = lineItems[0].unitPrice;

  return new Money(numericTotalPrice, unitPrice.currency);
};

/**
 * Calculates the total sum of lineTotals for given lineItems where `includeFor` includes `provider`
 * @param {*} lineItems
 * @returns {Money} total sum
 */
exports.calculateTotalForProvider = lineItems => {
  const providerLineItems = lineItems.filter(lineItem => lineItem.includeFor.includes('provider'));
  return exports.calculateTotalFromLineItems(providerLineItems);
};

/**
 * Calculates the total sum of lineTotals for given lineItems where `includeFor` includes `customer`
 * @param {*} lineItems
 * @returns {Money} total sum
 */
exports.calculateTotalForCustomer = lineItems => {
  const providerLineItems = lineItems.filter(lineItem => lineItem.includeFor.includes('customer'));
  return exports.calculateTotalFromLineItems(providerLineItems);
};

/**
 * Constructs lineItems that can be used directly in this template.
 * This function checks lineItem code and adds attributes like lineTotal and reversal
 * which are added in API response and some UI components are expecting.
 *
 * This can be used when user is not authenticated and we can't call speculative API endpoints directly
 *
 * @param {Array} lineItems
 * @returns {Array} lineItems with lineTotal and reversal info
 *
 */
exports.constructValidLineItems = lineItems => {
  const lineItemsWithTotals = lineItems.map(lineItem => {
    const { code, quantity, percentage } = lineItem;

    if (!/^line-item\/.+/.test(code)) {
      throw new Error(`Invalid line item code: ${code}`);
    }

    // lineItems are expected to be in similar format as when they are returned from API
    // so that we can use them in e.g. OrderBreakdown component.
    // This means we need to convert quantity to Decimal and add attributes lineTotal and reversal to lineItems
    const lineTotal = exports.calculateLineTotal(lineItem);
    return {
      ...lineItem,
      lineTotal,
      quantity: quantity ? new Decimal(quantity) : null,
      percentage: percentage ? new Decimal(percentage) : null,
      reversal: false,
    };
  });
  return lineItemsWithTotals;
};

/**
 * Check if commission object has percentage property defined.
 * @param {Object} commission object potentially containing percentage property.
 * @returns boolean
 */
exports.hasCommissionPercentage = commission => {
  const percentage = commission?.percentage;
  const isDefined = percentage != null;
  const isNumber = typeof percentage === 'number' && !isNaN(percentage);
  if (isDefined && !isNumber) {
    throw new Error(`${percentage} is not a number.`);
  }

  // Only create a line item if the percentage is set to be more than zero
  const isMoreThanZero = percentage > 0;
  return isDefined && isMoreThanZero;
};

/**
 * Check if commission object has minimum commission property defined.
 * @param {Object} commission object potentially containing minimum commission property.
 * @returns boolean
 */
exports.hasMinimumCommission = commission => {
  const minimum = commission?.minimum_amount;
  const isDefined = minimum != null;
  const isNumber = typeof minimum === 'number' && !isNaN(minimum);
  if (isDefined && !isNumber) {
    throw new Error(`${minimum} is not a number.`);
  }

  const isMoreThanZero = minimum > 0;
  return isDefined && isMoreThanZero;
};

/**
 * Get provider commission
 * @param {Object} providerCommission object containing provider commission info
 * @param {Object} order object containing order line items
 * @param {Object} priceAttribute object containing listing price information
 * @returns {Array} provider commission line item
 */
exports.getProviderCommissionMaybe = (providerCommission, order, currency) => {
  // Check if either minimum commission or percentage are defined in the commission object
  const hasMinimumCommission = exports.hasMinimumCommission(providerCommission);
  const hasCommissionPercentage = exports.hasCommissionPercentage(providerCommission);

  if (!hasMinimumCommission && !hasCommissionPercentage) {
    return [];
  }

  // Calculate the total money paid into the transaction
  const totalMoneyIn = exports.calculateTotalFromLineItems([order]);
  // Calculate the estimated commission with percentage applied, if applicable
  const estimatedCommissionFromPercentage = calculateCommissionWithPercentage(
    providerCommission?.percentage,
    totalMoneyIn.amount
  );

  // Minimum commission is preferred if it is greated than the estimated transaction amount
  const useMinimumCommission =
    providerCommission?.minimum_amount > estimatedCommissionFromPercentage;

  if (providerCommission?.minimum_amount > totalMoneyIn.amount) {
    throw new Error('Minimum commission amount is greater than the amount of money paid in');
  }

  // Note: extraLineItems for product selling (aka shipping fee)
  // is not included in either customer or provider commission calculation.

  // The provider commission is what the provider pays for the transaction, and
  // it is the subtracted from the order price to get the provider payout:
  // orderPrice - providerCommission = providerPayout
  return useMinimumCommission
    ? [
        {
          code: 'line-item/provider-commission',
          unitPrice: new Money(providerCommission?.minimum_amount, currency),
          quantity: getNegation(1),
          includeFor: ['provider'],
        },
      ]
    : [
        {
          code: 'line-item/provider-commission',
          unitPrice: totalMoneyIn,
          percentage: getNegation(providerCommission.percentage),
          includeFor: ['provider'],
        },
      ];
};

/**
 * Get customer commission
 * @param {Object} customerCommission object containing customer commission info
 * @param {Object} order object containing order line items
 * @returns {Array} customer commission line item
 */
exports.getCustomerCommissionMaybe = (customerCommission, order, currency) => {
  // Check if either minimum commission or percentage are defined in the commission object
  const hasMinimumCommission = exports.hasMinimumCommission(customerCommission);
  const hasCommissionPercentage = exports.hasCommissionPercentage(customerCommission);

  if (!hasMinimumCommission && !hasCommissionPercentage) {
    return [];
  }

  // Calculate the total money paid into the transaction
  const totalMoneyIn = exports.calculateTotalFromLineItems([order]);
  // Calculate the estimated commission with percentage applied, if applicable
  const estimatedCommissionFromPercentage = calculateCommissionWithPercentage(
    customerCommission?.percentage,
    totalMoneyIn.amount
  );

  // Minimum commission is preferred if it is greated than the estimated transaction amount
  const useMinimumCommission =
    customerCommission?.minimum_amount > estimatedCommissionFromPercentage;

  // The customer commission is what the customer pays for the transaction, and
  // it is added on top of the order price to get the customer's payin price:
  // orderPrice + customerCommission = customerPayin
  return useMinimumCommission
    ? [
        {
          code: 'line-item/customer-commission',
          unitPrice: new Money(customerCommission?.minimum_amount, currency),
          quantity: 1,
          includeFor: ['customer'],
        },
      ]
    : [
        {
          code: 'line-item/customer-commission',
          unitPrice: exports.calculateTotalFromLineItems([order]),
          percentage: customerCommission.percentage,
          includeFor: ['customer'],
        },
      ];
};

// Converts a flat fee given in major currency units (e.g. euros) to the
// currency's subunits (e.g. cents), the unit Money/line items expect. Shared by
// every flat customer-paid fee this file resolves (cleaning fee, special-handling
// fee) - non-positive or invalid amounts collapse to 0, which each fee's own
// getXFeeLineItemMaybe reads as "no line item".
const positiveMajorUnitsToSubunits = (amountMajorUnits, currency) => {
  const isValidAmount =
    typeof amountMajorUnits === 'number' &&
    Number.isFinite(amountMajorUnits) &&
    amountMajorUnits > 0;
  if (!isValidAmount || !currency) {
    return 0;
  }
  return new Decimal(amountMajorUnits)
    .times(unitDivisor(currency))
    .toNearest(1, Decimal.ROUND_HALF_UP)
    .toNumber();
};

/**
 * Resolves the cleaning fee for a listing, in the given currency's subunits (ready to
 * hand to getCleaningFeeLineItemMaybe).
 *
 * THE FEE COMES FROM THE SERVER ENVIRONMENT, NOT FROM THE LAUNDRY. A category's fee is
 * `CLEANING_FEE_<CATEGORY_ID>` (see api-util/cleaningFeeEnv.js for the convention, the
 * highest-in-the-chain rule and the malformed-value handling); of every category in this
 * listing's own chain that is priced, the highest wins, then DEFAULT_CLEANING_FEE, then
 * nothing (which adds no line item at all).
 *
 * WHAT THIS DELIBERATELY NO LONGER DOES: it used to look the listing's assigned laundry
 * up through the Integration API and read `privateData.cleaningFee` /
 * `privateData.categoryPricing.<id>.cleaningFee` off its profile. Per the client the fee
 * is now marketplace-level env configuration, and the laundry's form no longer collects
 * one — so reading those keys would only let stale stored data keep pricing rentals after
 * the input that produced it was removed. Nothing here may read a fee from a laundry
 * profile again, and there is no longer any laundry lookup on the checkout path at all:
 * the whole `isLaundry` trust question this function used to carry (a de-flagged
 * laundry, a listing migrated from the unguarded `publicData.assignedLaundryId`) simply
 * cannot affect a price any more, because no laundry-owned value is an input to one.
 *
 * PREVIEW AND CHARGE AGREE BY CONSTRUCTION: this is called only from
 * lineItems.buildLineItemsForListing, which is the single entry point used by
 * /api/transaction-line-items (the preview the customer sees),
 * /api/initiate-privileged and /api/transition-privileged (what is actually charged).
 * The category chain is read from the same stored listing entity in all three, so the
 * resolved fee cannot differ between the quote and the charge.
 *
 * Synchronous, unlike the version that had to make an API call. buildLineItemsForListing
 * still returns a Promise so no endpoint had to change.
 *
 * @param {Object} listing
 * @param {string} currency
 * @returns {number} cleaning fee amount in the currency's subunits
 */
exports.resolveCleaningFeeInSubunits = (listing, currency) => {
  const feeMajorUnits = resolveCleaningFeeMajorUnits(
    getListingCategoryValues(listing?.attributes?.publicData)
  );

  // null means "configured nowhere", which is a zero fee and therefore no line item.
  // positiveMajorUnitsToSubunits already collapses that to 0, so there is nothing to branch on.
  return positiveMajorUnitsToSubunits(feeMajorUnits, currency);
};

/**
 * Resolves the special-handling fee for a listing, in the given currency's subunits
 * (ready to hand to getSpecialHandlingFeeLineItemMaybe).
 *
 * Charged whenever the listing carries ANY Special Care flag (see
 * src/util/specialCare.js) - which flag doesn't matter, the fee is flat and per-booking,
 * not per-flag. The amount itself comes from the server environment
 * (specialHandlingFeeEnv.js): $15 unless overridden, and the override can be $0.
 *
 * UNLIKE resolveCleaningFeeInSubunits, THIS MAKES AN INTEGRATION API CALL. Special Care
 * lives in the listing's `privateData` (owner + operator only, by design - see
 * src/util/specialCare.js for why), so the `listing` this function receives from a
 * customer's own session (initiate-privileged.js, transition-privileged.js, and
 * transaction-line-items.js for an anonymous/customer preview) never carries it - the
 * Marketplace API simply omits privateData the caller isn't allowed to read. There is no
 * way around this that doesn't also read a party's own privateData through their own
 * session, which a renter does not have for someone else's listing. Both
 * initiate-privileged.js and transition-privileged.js already call the Integration API
 * on this same request for other reasons (cleaning-gap checks, handover QR), so this is
 * not a new category of cost on the checkout path, only one more call on it.
 *
 * PREVIEW AND CHARGE AGREE BY CONSTRUCTION, same reasoning as the cleaning fee: this is
 * called only from lineItems.buildLineItemsForListing, the single entry point all three
 * endpoints share, and it always re-fetches the listing fresh rather than trusting
 * whatever privateData (if any) happened to be on the object it was passed - an owner
 * previewing their OWN listing would otherwise see a different fee than what a customer
 * is later charged, purely because `ownListings.show` exposes privateData and
 * `listings.show` doesn't.
 *
 * @param {Object} listing
 * @param {string} currency
 * @returns {Promise<number>} special-handling fee amount in the currency's subunits
 */
exports.resolveSpecialHandlingFeeInSubunits = (listing, currency) => {
  const listingId = listing?.id;
  if (!listingId) {
    return Promise.resolve(0);
  }

  return getIntegrationSdk()
    .listings.show({ id: listingId })
    .then(response => {
      const privateData = response.data.data.attributes.privateData;
      const flags = privateData?.specialCare?.flags;
      const hasSpecialCare = Array.isArray(flags) && flags.length > 0;

      if (!hasSpecialCare) {
        return 0;
      }

      return positiveMajorUnitsToSubunits(resolveSpecialHandlingFeeMajorUnits(), currency);
    });
};

/**
 * Builds the cleaning-fee line item, if applicable. It's a flat fee (quantity 1)
 * paid entirely by the customer and added on top of the customer's total - it is
 * NOT netted against the provider's payout, same pattern as customer-commission
 * (`includeFor: ['customer']` only). A zero/invalid amount means no line item is
 * added at all (mirrors how the item unit type skips its shipping-fee line item
 * for free/pickup delivery).
 *
 * @param {number} cleaningFeeInSubunits
 * @param {string} currency
 * @returns {Array} cleaning fee line item, or [] if there's nothing to charge
 */
exports.getCleaningFeeLineItemMaybe = (cleaningFeeInSubunits, currency) => {
  const isPositiveAmount =
    typeof cleaningFeeInSubunits === 'number' &&
    Number.isFinite(cleaningFeeInSubunits) &&
    cleaningFeeInSubunits > 0;

  if (!isPositiveAmount || !currency) {
    return [];
  }

  return [
    {
      code: LINE_ITEM_CLEANING_FEE,
      unitPrice: new Money(cleaningFeeInSubunits, currency),
      quantity: 1,
      includeFor: ['customer'],
    },
  ];
};

/**
 * Builds the special-handling-fee line item, if applicable. Same shape as the cleaning
 * fee: a flat fee (quantity 1) paid entirely by the customer, on top of the customer's
 * total, NOT netted against the provider's payout (`includeFor: ['customer']` only). A
 * zero/invalid amount means no line item is added at all - which is also how
 * `SPECIAL_HANDLING_FEE=0` disables the fee outright rather than charging nothing-looking
 * like-something.
 *
 * Deliberately not added to `LINE_ITEMS` in src/util/types.js: like the cleaning fee, it
 * falls through to LineItemUnknownItemsMaybe, which turns `line-item/special-handling-fee`
 * into "Special handling fee" automatically. No client/translation change needed.
 *
 * @param {number} specialHandlingFeeInSubunits
 * @param {string} currency
 * @returns {Array} special-handling-fee line item, or [] if there's nothing to charge
 */
exports.getSpecialHandlingFeeLineItemMaybe = (specialHandlingFeeInSubunits, currency) => {
  const isPositiveAmount =
    typeof specialHandlingFeeInSubunits === 'number' &&
    Number.isFinite(specialHandlingFeeInSubunits) &&
    specialHandlingFeeInSubunits > 0;

  if (!isPositiveAmount || !currency) {
    return [];
  }

  return [
    {
      code: LINE_ITEM_SPECIAL_HANDLING_FEE,
      unitPrice: new Money(specialHandlingFeeInSubunits, currency),
      quantity: 1,
      includeFor: ['customer'],
    },
  ];
};
