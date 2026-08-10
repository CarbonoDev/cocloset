const Decimal = require('decimal.js');
const moment = require('moment-timezone/builds/moment-timezone-with-data-10-year-range.min');
const { types } = require('sharetribe-flex-sdk');
const { Money } = types;

const { getAmountAsDecimalJS, convertDecimalJSToNumber, unitDivisor } = require('./currency');
const { nightsBetween, daysBetween } = require('./dates');
const { getIntegrationSdk } = require('./integrationSdk');
const { isLaundryUserEntity } = require('./laundryDirectory');
const { readAssignedLaundryId } = require('./laundryAssignment');
const { getListingCategoryValues, resolveCategoryCleaningFee } = require('./categoryPricing');
const log = require('../log');
const LINE_ITEM_NIGHT = 'line-item/night';
const LINE_ITEM_DAY = 'line-item/day';
const LINE_ITEM_CLEANING_FEE = 'line-item/cleaning-fee';

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

// Parses process.env.DEFAULT_CLEANING_FEE (a plain, major-unit number, e.g. "12.5"
// for €12.50 - same convention as the laundry's own privateData.cleaningFee, see
// LaundryProfileForm). Returns 0 if it's unset or not a valid number, so that
// pricing never breaks over a missing/invalid env var (Phase 1: degrade gracefully).
const getDefaultCleaningFeeMajorUnits = () => {
  const parsed = parseFloat(process.env.DEFAULT_CLEANING_FEE);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Converts a cleaning fee given in major currency units (e.g. euros) to the
// currency's subunits (e.g. cents), the unit Money/line items expect.
// Non-positive or invalid amounts collapse to 0 - a zero cleaning fee simply
// means no cleaning-fee line item gets added (see getCleaningFeeLineItemMaybe).
const cleaningFeeToSubunits = (amountMajorUnits, currency) => {
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
 * Resolves the cleaning fee for a listing's assigned laundry, in the given
 * currency's subunits (ready to hand to getCleaningFeeLineItemMaybe).
 *
 * The cleaning fee is set by the laundry itself as privateData.cleaningFee on
 * its own user profile (see LaundryProfilePage) - privateData is only visible
 * to its owner and the operator, so it can't be read through the customer's or
 * provider's own trusted Marketplace SDK token. This uses the Integration API
 * instead (mirrors the lookup in server/api/laundries.js).
 *
 * PER-CATEGORY PRICING: the fee charged is the one the laundry configured for THIS
 * garment's category, not one flat studio-wide number. A laundry sets a fee per
 * accepted category/subcategory in privateData.categoryPricing, and of every level of
 * the listing's own category chain that carries a fee, the HIGHEST wins. If no level
 * of the chain is priced, the studio-wide privateData.cleaningFee applies as the
 * deliberate fallback (it is not a competitor in the max). See
 * api-util/categoryPricing.js for the full rule and why it is a separate pure module.
 *
 * Falls back to process.env.DEFAULT_CLEANING_FEE (also major units, server-only)
 * when the listing has no assigned laundry, the laundry hasn't set a fee at any
 * level, or the Integration API lookup fails for any reason (e.g. the laundry user
 * was removed) - Phase 1 pricing should never fail booking creation over this.
 *
 * PREVIEW AND CHARGE AGREE BY CONSTRUCTION: this is called only from
 * lineItems.buildLineItemsForListing, which is the single entry point used by
 * /api/transaction-line-items (the preview the customer sees),
 * /api/initiate-privileged and /api/transition-privileged (what is actually charged).
 * The category chain is read from the same stored listing entity in all three, so the
 * resolved fee cannot differ between the quote and the charge.
 *
 * SECURITY: `assignedLaundryId` now lives in the listing's `metadata`, which only
 * the Integration API can write, so a provider can no longer point it at their own
 * account directly (see api-util/laundryAssignment.js). The isLaundry check below
 * STAYS ANYWAY, and removing it because "the field is protected now" would be a
 * mistake:
 *   - This value sets a customer's payin total. Two independent checks on money is
 *     the right number, and this one costs one lookup that is made regardless.
 *   - The new write path can only refuse a non-laundry going FORWARD. Listings
 *     migrated off the old `publicData` key carry whatever was written under the
 *     old, unguarded regime - scripts/migrate-assigned-laundry-to-metadata.js
 *     relocates the value verbatim, it does not audit it.
 *   - A laundry can be DE-FLAGGED after being assigned, at which point a
 *     historically valid id points at a user who must no longer be trusted with a
 *     price.
 * So the fee is still only honoured when the referenced user is genuinely flagged
 * `metadata.isLaundry === true`; anyone else falls back to the env default.
 *
 * @param {Object} listing
 * @param {string} currency
 * @returns {Promise<number>} cleaning fee amount in the currency's subunits
 */
exports.resolveCleaningFeeInSubunits = (listing, currency) => {
  const assignedLaundryId = readAssignedLaundryId(listing);
  const fallbackFeeMajorUnits = getDefaultCleaningFeeMajorUnits();

  if (!assignedLaundryId) {
    return Promise.resolve(cleaningFeeToSubunits(fallbackFeeMajorUnits, currency));
  }

  let integrationSdk;
  try {
    integrationSdk = getIntegrationSdk();
  } catch (e) {
    log.error(e, 'resolve-cleaning-fee-no-integration-sdk', {});
    return Promise.resolve(cleaningFeeToSubunits(fallbackFeeMajorUnits, currency));
  }

  return integrationSdk.users
    .show({ id: assignedLaundryId }, { expand: true })
    .then(response => {
      const profile = response.data.data.attributes.profile;

      if (!isLaundryUserEntity(response.data.data)) {
        // The listing points at a user who is not a laundry. Never honour a
        // fee from them - see the SECURITY note above.
        log.error(
          new Error('assignedLaundryId does not reference a user flagged isLaundry'),
          'resolve-cleaning-fee-untrusted-laundry',
          { listingId: listing?.id?.uuid, assignedLaundryId }
        );
        return cleaningFeeToSubunits(fallbackFeeMajorUnits, currency);
      }

      // Resolve against the LISTING's category chain: highest matching per-category
      // fee -> studio-wide scalar -> null. Null means "configured nowhere", which is
      // when the env default applies. resolveCategoryCleaningFee is pure and never
      // throws, so a malformed pricing table degrades to the fallback rather than
      // failing the booking.
      const laundryCleaningFee = resolveCategoryCleaningFee(
        profile.privateData,
        getListingCategoryValues(listing?.attributes?.publicData)
      );
      const feeMajorUnits =
        laundryCleaningFee !== null ? laundryCleaningFee : fallbackFeeMajorUnits;
      return cleaningFeeToSubunits(feeMajorUnits, currency);
    })
    .catch(e => {
      // Previously this error was discarded entirely, which made a transient
      // Integration API failure indistinguishable from "this laundry hasn't
      // set a fee" - and silently repriced the booking. Still fall back
      // (Phase 1: pricing must not fail booking creation) but make it visible.
      log.error(e, 'resolve-cleaning-fee-lookup-failed', {
        listingId: listing?.id?.uuid,
        assignedLaundryId,
      });
      return cleaningFeeToSubunits(fallbackFeeMajorUnits, currency);
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
