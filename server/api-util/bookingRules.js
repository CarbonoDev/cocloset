const { daysBetween } = require('./dates');

// The per-listing minimum rental length, enforced server-side.
//
//   > "El calendario debe bloquear una entrada de menos días del mínimo que
//   >  estableció el owner de la prenda, es decir, si estableció 3, solo puedo
//   >  hacer booking de 3 en adelante, no menos días"
//
// WHY THIS EXISTS SERVER-SIDE AT ALL
// The client half of this rule lives in the booking calendar, which refuses to
// complete a too-short range. That is UX, not enforcement: `bookingStart` and
// `bookingEnd` are ordinary request parameters, and before this module
// `server/api/initiate-privileged.js` forwarded them to the Marketplace API
// verbatim, inspecting nothing but the price. A minimum that only the calendar
// knows about is not a minimum — anyone posting straight at the endpoint gets a
// one-day rental on a three-day listing, priced and charged.
//
// Sharetribe cannot enforce it for us either: a booking's LENGTH is not part of
// the availability model. The API rejects days that are blocked, not ranges that
// are too short.
//
// WHY THE STORED VALUE IS CLAMPED, NOT TRUSTED
// `publicData` is owner-writable, so `minimumBookingDays` is a number its own
// owner can set to anything — including 4000, which would silently make the
// listing unbookable rather than erroring anywhere visible. The marketplace-wide
// bound (REACT_APP_MAX_MINIMUM_BOOKING_DAYS) is therefore applied here as well as
// in the wizard: the wizard bound is what the owner is *offered*, this one is what
// the platform will *honour*. They are the same number for a value that came
// through the form, and only diverge for a value that did not.

const ABSOLUTE_MINIMUM_DAYS = 1;
const HARDCODED_MAX_MINIMUM_DAYS = 30;

// Number.parseInt is the wrong tool for validating a whole number: it truncates
// and ignores trailing garbage, so '3.5' becomes 3 and '5 days' becomes 5. That
// would make a string behave differently from the equivalent number (2.5 is
// rejected as fractional, '2.5' would be accepted as 2) - the sort of asymmetry
// that turns "the fee/minimum is wrong" into an unreproducible report. A value
// is either an integer or it is malformed.
const parseStrictInteger = value => {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return /^-?\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : null;
};

// Kept in sync with the wizard field (see EditListingPricingPanel). The var is
// REACT_APP_-prefixed because the browser needs the same bound to build the form;
// it is a UI/rule bound, not a secret, so reading it here is not a leak.
const resolveMaxMinimumBookingDays = () => {
  const parsed = parseStrictInteger(process.env.REACT_APP_MAX_MINIMUM_BOOKING_DAYS);
  const usable = parsed !== null && parsed >= ABSOLUTE_MINIMUM_DAYS;
  return usable ? parsed : HARDCODED_MAX_MINIMUM_DAYS;
};

/**
 * The effective minimum rental length for a listing, in days.
 *
 * Absent, blank, non-numeric, fractional and out-of-range values all resolve to
 * 1 (i.e. "no minimum") or the nearest bound rather than throwing: a malformed
 * stored value must not be able to take a listing off the market, and this is
 * called on the checkout path where an exception is a failed sale.
 *
 * @param {Object} [publicData] - the listing's publicData
 * @returns {number} an integer >= 1
 */
const resolveMinimumBookingDays = publicData => {
  const parsed = parseStrictInteger(publicData?.minimumBookingDays);

  if (parsed === null || parsed <= ABSOLUTE_MINIMUM_DAYS) {
    return ABSOLUTE_MINIMUM_DAYS;
  }
  return Math.min(parsed, resolveMaxMinimumBookingDays());
};

const tooShortError = ({ minimumDays, requestedDays }) => {
  const message = `Booking is shorter than this listing's minimum of ${minimumDays} days.`;
  const error = new Error(message);
  error.status = 400;
  error.statusText = message;
  // Machine-readable so the browser can show a translated message instead of
  // this English one, and can tell this apart from an availability rejection —
  // "those days are taken" and "your booking is too short" are different
  // problems with different fixes.
  error.data = {
    code: 'booking-below-minimum-days',
    minimumBookingDays: minimumDays,
    requestedDays,
  };
  return error;
};

/**
 * Throw when a booking is shorter than the listing's minimum.
 *
 * Only day-unit listings are checked. The rule is expressed in days by the
 * client and by the owner's field, so applying it to an hour or fixed-duration
 * listing would be comparing two different units — and Cocloset's
 * `garment-rental` type is day-based ("Los listing types deben ser de cobro por
 * día"). A listing with no minimum configured is not checked at all.
 *
 * `bookingEnd` is the EXCLUSIVE end date, matching daysBetween and the rest of
 * the booking path: a one-day rental arrives as start = D, end = D+1.
 *
 * @param {Object} params
 * @param {Object} params.listing - a listing API entity
 * @param {Date} [params.bookingStart]
 * @param {Date} [params.bookingEnd]
 * @throws {Error} 400 with data.code 'booking-below-minimum-days'
 */
const assertMinimumBookingDays = ({ listing, bookingStart, bookingEnd }) => {
  const publicData = listing?.attributes?.publicData || {};

  if (publicData.unitType !== 'day') {
    return;
  }

  const minimumDays = resolveMinimumBookingDays(publicData);
  if (minimumDays <= ABSOLUTE_MINIMUM_DAYS) {
    return;
  }

  // Missing or unparseable dates are NOT this rule's problem: the line-item
  // builder already 400s on a booking with no usable range, with a message about
  // the actual fault. Rejecting here too would relabel "you sent no dates" as
  // "your booking is too short".
  const start = bookingStart instanceof Date ? bookingStart : new Date(bookingStart);
  const end = bookingEnd instanceof Date ? bookingEnd : new Date(bookingEnd);
  if (isNaN(start) || isNaN(end)) {
    return;
  }

  // daysBetween throws on a reversed range; that is also not this rule's
  // problem, and it is already surfaced elsewhere on this path.
  let requestedDays = null;
  try {
    requestedDays = daysBetween(start, end);
  } catch (e) {
    return;
  }

  if (requestedDays < minimumDays) {
    throw tooShortError({ minimumDays, requestedDays });
  }
};

module.exports = {
  ABSOLUTE_MINIMUM_DAYS,
  HARDCODED_MAX_MINIMUM_DAYS,
  resolveMaxMinimumBookingDays,
  resolveMinimumBookingDays,
  assertMinimumBookingDays,
};
