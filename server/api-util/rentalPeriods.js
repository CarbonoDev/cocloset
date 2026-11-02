const { startOfDayInTimeZone } = require('./bookingRules');

// FIXED RENTAL PERIODS — THE SERVER HALF
// ======================================
//
//   > "el precio que el cliente va a pagar es el precio que marque el provider, es decir,
//   >  si puso el precio para 7 días en $100, el cliente va a pagar $100, no $700, pero el
//   >  booking se queda como 7 días mas los días que necesite laundry"
//
// A garment on `cocloset-booking` is rented for one of the periods its owner priced (7 or
// 14 days), at a FLAT price, starting on a day the customer picks. The client half of this
// lives in src/util/rentalPeriods.js; read that file first, it carries the design.
//
// WHY THIS EXISTS SERVER-SIDE AT ALL
// Exactly the argument in bookingRules.js, and it matters more here. `bookingStart`,
// `bookingEnd` and `priceVariantName` are ordinary request parameters. Without this module
// a caller could post `priceVariantName: '7-days'` (the cheap one) with a 90-day date
// range and be charged the 7-day price for it — the line-item builder prices from the
// named variant and never looks at the dates. The calendar refusing to build that request
// is UX; this is the rule.
//
// WHAT IT DOES NOT DO
// It does not check AVAILABILITY. The Marketplace API rejects a booking that overlaps
// blocked days or another booking, and it is the only thing that can do so without a race.
// What this module enforces is the SHAPE of the request: the right length for the price
// being charged.
//
// It also does not check the CLEANING WINDOW AFTER the rental. The booking calendar does
// (src/components/OrderPanel/BookingRentalPeriodForm.js `isWindowAvailableFn` requires the
// period plus the laundry's turnaround to be free), but that is the one half of this
// feature with no server-side twin, and the gap is deliberate: verifying it here needs an
// availability query on the checkout path, and the cleaning days themselves are not on the
// listing - resolving them means an Integration API round trip between a customer and
// their payment, which a previous change removed on purpose. The consequence of a caller
// bypassing the calendar is a rental whose cleaning window collides with the next booking:
// server/api/create-availability-buffer.js already detects and logs that case
// ('create-availability-buffer-bookable-overlap'), so it surfaces rather than silently
// corrupting the calendar. Closing it properly belongs with the event-driven buffer worker
// that file describes.

const RENTAL_PERIOD_LENGTH_KEY = 'bookingLengthInDays';

// Mirrors MAX_RENTAL_PERIOD_DAYS in src/util/rentalPeriods.js. Duplicated rather than
// imported because src/ and server/ cannot import each other (ESM/transpiled versus plain
// CommonJS); rentalPeriodsAgreement.test.js asserts the two are equal, so the duplication
// is checked rather than trusted.
const MAX_RENTAL_PERIOD_DAYS = 365;

const COCLOSET_BOOKING_PROCESS_NAME = 'cocloset-booking';

const parseWholeNumber = value => {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return /^-?\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : null;
};

/**
 * Whether this listing is rented by fixed periods.
 *
 * The server has no restructured listing-type config — that is a browser-side merge of the
 * hosted asset — so it keys on what the listing itself carries: the process alias that was
 * baked onto it at creation (`publicData.transactionProcessAlias`, e.g.
 * 'cocloset-booking/release-1') plus the day unit. That is the same pair the client's
 * `usesFixedRentalPeriods` resolves to, and it has the useful property of being per-listing:
 * a listing created before this feature keeps whatever alias it was created with.
 *
 * @param {Object} [publicData] - listing.attributes.publicData
 * @returns {boolean}
 */
const usesFixedRentalPeriods = publicData => {
  const alias = publicData?.transactionProcessAlias;
  const processName = typeof alias === 'string' ? alias.split('/')[0] : null;
  return processName === COCLOSET_BOOKING_PROCESS_NAME && publicData?.unitType === 'day';
};

const isUsableRentalPeriod = variant => {
  const days = parseWholeNumber(variant?.[RENTAL_PERIOD_LENGTH_KEY]);
  const price = parseWholeNumber(variant?.priceInSubunits);
  return (
    typeof variant?.name === 'string' &&
    variant.name.length > 0 &&
    days !== null &&
    days > 0 &&
    days <= MAX_RENTAL_PERIOD_DAYS &&
    price !== null &&
    price >= 0
  );
};

/**
 * The fixed rental periods a listing offers, shortest first.
 *
 * @param {Object} [publicData] - listing.attributes.publicData
 * @returns {Array<{name: string, bookingLengthInDays: number, priceInSubunits: number}>}
 */
const getRentalPeriods = publicData => {
  const variants = publicData?.priceVariants;
  if (!Array.isArray(variants)) {
    return [];
  }
  return variants
    .filter(isUsableRentalPeriod)
    .map(variant => ({
      ...variant,
      [RENTAL_PERIOD_LENGTH_KEY]: parseWholeNumber(variant[RENTAL_PERIOD_LENGTH_KEY]),
      priceInSubunits: parseWholeNumber(variant.priceInSubunits),
    }))
    .sort((a, b) => a[RENTAL_PERIOD_LENGTH_KEY] - b[RENTAL_PERIOD_LENGTH_KEY]);
};

/**
 * How many days does the named period last on THIS listing?
 *
 * @param {Object} [publicData] - listing.attributes.publicData
 * @param {string} [priceVariantName]
 * @returns {number|null}
 */
const resolveRentalPeriodDays = (publicData, priceVariantName) => {
  if (!priceVariantName) {
    return null;
  }
  const period = getRentalPeriods(publicData).find(p => p.name === priceVariantName);
  return period ? period[RENTAL_PERIOD_LENGTH_KEY] : null;
};

const rentalPeriodError = (code, message, data) => {
  const error = new Error(message);
  error.status = 400;
  error.statusText = message;
  // Machine-readable and distinct per fault, for the same reason
  // 'booking-below-minimum-days' and 'booking-before-initial-cleaning' are distinct: "this
  // garment is not offered in that period" and "your dates do not match the period you
  // picked" need different sentences in front of a customer.
  error.data = { code, ...data };
  return error;
};

/**
 * Throw unless the requested dates are exactly the period being charged for.
 *
 * Listings that do not use fixed periods are not checked at all, so this is a no-op on
 * every other listing type in the marketplace.
 *
 * `bookingEnd` is the EXCLUSIVE end, matching the rest of the booking path: a 7-day rental
 * arrives as start = D, end = D+7.
 *
 * THE COMPARISON IS IN WHOLE DAYS, IN THE LISTING'S TIME ZONE. Comparing instants would
 * make the rule depend on the hour the customer is shopping and on DST: a 7-day rental
 * across a spring-forward boundary is 167 hours, not 168, and an instant-based check would
 * reject it. `startOfDayInTimeZone` is the same helper the initial-cleaning gate uses, so
 * the two rules agree on what "a day" is.
 *
 * @param {Object} params
 * @param {Object} params.listing - a listing API entity
 * @param {string} [params.priceVariantName]
 * @param {Date|string} [params.bookingStart]
 * @param {Date|string} [params.bookingEnd]
 * @throws {Error} 400 with data.code 'rental-period-unknown' or 'rental-period-length-mismatch'
 */
const assertRentalPeriodBooking = ({ listing, priceVariantName, bookingStart, bookingEnd }) => {
  const publicData = listing?.attributes?.publicData || {};

  if (!usesFixedRentalPeriods(publicData)) {
    return;
  }

  const periods = getRentalPeriods(publicData);
  if (periods.length === 0) {
    // The owner has priced nothing. There is no period to check the dates against, and
    // pricing will fail on its own with a message about the missing price — relabelling
    // that as a period fault would point at the wrong thing.
    return;
  }

  const periodDays = resolveRentalPeriodDays(publicData, priceVariantName);
  if (periodDays === null) {
    throw rentalPeriodError(
      'rental-period-unknown',
      `This garment is not offered for the rental period "${priceVariantName}".`,
      {
        priceVariantName: priceVariantName || null,
        availablePeriods: periods.map(p => p[RENTAL_PERIOD_LENGTH_KEY]),
      }
    );
  }

  // Missing or unparseable dates are NOT this rule's problem: the line-item builder already
  // 400s on a booking with no usable range, with a message about the actual fault.
  const start = bookingStart instanceof Date ? bookingStart : new Date(bookingStart);
  const end = bookingEnd instanceof Date ? bookingEnd : new Date(bookingEnd);
  if (isNaN(start) || isNaN(end)) {
    return;
  }

  const timeZone = listing?.attributes?.availabilityPlan?.timezone;
  const expectedEnd = startOfDayInTimeZone(start, timeZone, periodDays);
  const requestedEnd = startOfDayInTimeZone(end, timeZone);

  if (requestedEnd.getTime() !== expectedEnd.getTime()) {
    throw rentalPeriodError(
      'rental-period-length-mismatch',
      `A "${priceVariantName}" rental is ${periodDays} days. The requested dates do not match it.`,
      {
        priceVariantName,
        periodDays,
        expectedBookingEnd: expectedEnd.toISOString(),
      }
    );
  }
};

/**
 * The booking end implied by a start date and a period, in the listing's time zone.
 *
 * Exported so the checkout path and any future server-side booking construction derive the
 * end from the same expression the assertion above checks against, rather than from a
 * second copy of `start + n days`.
 *
 * @param {Object} params
 * @param {Date} params.bookingStart
 * @param {number} params.periodDays
 * @param {string} [params.timeZone]
 * @returns {Date}
 */
const rentalPeriodBookingEnd = ({ bookingStart, periodDays, timeZone }) =>
  startOfDayInTimeZone(bookingStart, timeZone, periodDays);

module.exports = {
  MAX_RENTAL_PERIOD_DAYS,
  RENTAL_PERIOD_LENGTH_KEY,
  usesFixedRentalPeriods,
  getRentalPeriods,
  resolveRentalPeriodDays,
  assertRentalPeriodBooking,
  rentalPeriodBookingEnd,
};
