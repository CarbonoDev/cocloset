// The 10-year-range build, matching api-util/lineItemHelpers.js and src/util/dates.js.
// A full tz database is ~180kB of data this module does not need: the only dates it
// looks at are today and a booking start a few weeks out.
const momentTz = require('moment-timezone/builds/moment-timezone-with-data-10-year-range.min');

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

// ---------------------------------------------------------------------------
// THE INITIAL CLEANING LEAD TIME
// ---------------------------------------------------------------------------
//
//   > "Al hacer booking, el calendario muestra el siguiente día como disponible,
//   >  pero no esta considerando los tiempos de lavado inicial, esto debe aplicar
//   >  solo para la primera vez en esa prenda, si la prenda aun no esta en el
//   >  laundry, si la prenda ya esta en laundry entonces si debe aparecer
//   >  disponible al siguiente día"
//
// A garment that has never physically reached its assigned laundry cannot be
// rented tomorrow: it has to get there and be cleaned first. Once it HAS arrived,
// tomorrow is correct and this rule must change nothing whatsoever.
//
// WHY `metadata.onLaundry !== true` IS THE WHOLE CONDITION
// It is literally "la prenda aun no esta en el laundry", and it is also what makes
// the rule first-time-only without any extra bookkeeping: `onLaundry` is set true
// by the event of a laundry receiving the garment (api-util/listingCustody.js) and
// only ever goes back to false when the garment is returned to its OWNER - by
// which point it has been cleaned at least once. So there is no "has this ever
// happened before" flag to maintain and no state machine to get wrong; the
// condition expires by itself, permanently, the first time a studio takes
// delivery.
//
// WHY THIS IS ENFORCEABLE AT ALL
// Both inputs live in `metadata`, which the Marketplace API refuses to let a
// listing's own author write (400 `validation-disallowed-key`, verified against
// Dev - see api-util/laundryAssignment.js). So an owner cannot clear their own
// `initialCleaningDays` to make their garment bookable sooner, and the server does
// not need to re-read the laundry's profile to check the rule. That last part is
// load-bearing: the checkout path on this branch deliberately has NO Integration
// API call in it, and reintroducing one to price a booking would put an admin-
// credentialled round trip between a customer and their payment.
//
// The `initialCleaningDays` value itself is written at assignment time - see
// api-util/laundryAssignment.js `resolveInitialCleaningDays` and
// server/api/listing-laundry-assignment.js.

const INITIAL_CLEANING_DAYS_KEY = 'initialCleaningDays';

// `initialCleaningDays` is server-written, but it is DERIVED from a number the
// laundry types into its own profile (`privateData.turnaroundDays`, or a
// per-category entry). A studio that fat-fingers 4000 would take every garment it
// has ever been assigned off the market for a decade, and nothing would say so.
// Same reasoning and same order of magnitude as MAX_CLEANING_DAYS in
// api-util/listingCustody.js; clamped rather than rejected here because this runs
// on the checkout path, where throwing is a lost sale.
const MAX_INITIAL_CLEANING_DAYS = 365;

/**
 * Start of day in the listing's time zone, optionally offset by whole days.
 *
 * DAY GRANULARITY IS THE POINT. Comparing raw instants would make the rule
 * depend on the hour the customer happens to be shopping: a 1-day lead time
 * checked as `now + 24h` blocks tomorrow morning but allows tomorrow evening,
 * which is not a day count, and would differ between the browser's calendar and
 * this check by up to a whole day.
 *
 * The `.add(10, 'hours')` is not superstition - it is the same workaround
 * src/util/dates.js `getStartOf` carries, for the handful of zones (Atlantic/Azores
 * among them) that apply DST at midnight, where the instant 00:00 does not exist
 * on the changeover day and `startOf('day')` after a plain `.add(1, 'day')`
 * silently lands back on the previous date.
 *
 * An unknown or missing time zone falls back to UTC rather than to the server's
 * local zone: a Railway container's TZ is an accident of deployment, and the
 * booking dates on the wire are UTC instants.
 *
 * @param {Date} date
 * @param {string} [timeZone] - IANA key, e.g. listing.availabilityPlan.timezone
 * @param {number} [offsetDays]
 * @returns {Date}
 */
const startOfDayInTimeZone = (date, timeZone, offsetDays = 0) => {
  const zone = timeZone && momentTz.tz.zone(timeZone) ? timeZone : 'Etc/UTC';
  const startOfDay = momentTz(date)
    .tz(zone)
    .startOf('day');

  return offsetDays === 0
    ? startOfDay.toDate()
    : startOfDay
        .add(offsetDays, 'days')
        .add(10, 'hours')
        .startOf('day')
        .toDate();
};

/**
 * How many days must pass before this garment can be rented at all?
 *
 * PRECEDENCE: the live value wins, the stored snapshot is the fallback.
 *
 * `metadata.initialCleaningDays` is a snapshot taken when the laundry was assigned, so
 * it goes stale the moment that studio changes its turnaround. The client asked for the
 * laundry's CURRENT number to be honoured, which means the browser's calendar starts
 * using a live value - and if this gate kept reading only the snapshot the two could
 * disagree, which is precisely the failure
 * src/components/OrderPanel/BookingDatesForm/initialCleaningAgreement.test.js exists to
 * prevent: a calendar that offers a date checkout then refuses. So the caller resolves
 * the same live number (api-util/liveInitialCleaning.js) and passes it here.
 *
 * A NULL LIVE VALUE FALLS BACK TO THE SNAPSHOT, NOT TO "NO BLOCK". `null` is what the
 * resolver returns for every failure it can have - a deleted laundry, an Integration API
 * outage, an unreadable profile. Treating a failed read as "no lead time" would let a
 * transient error open the gate on a garment that is still in its owner's wardrobe. The
 * snapshot is stale at worst; "no block" is wrong.
 *
 * @param {Object} [metadata] - the listing's `metadata`
 * @param {number} [liveInitialCleaningDays] - from
 *   api-util/liveInitialCleaning.js `resolveLiveInitialCleaningDays`; null/undefined
 *   means "no live answer available"
 * @returns {number|null} a positive integer, or null when the rule does not apply
 */
const resolveInitialCleaningBlockDays = (metadata, liveInitialCleaningDays) => {
  // The garment is at the laundry. Per the client, tomorrow is then correct: the
  // rule is spent and this function must be indistinguishable from absent.
  // `=== true` and not truthiness, matching evaluateLaundryAssignment: only a real
  // boolean is custody, and bad data must not be able to switch the rule off.
  //
  // Checked FIRST, before the live value is even looked at, so `onLaundry === true`
  // remains the single condition that retires this rule - a live turnaround must not be
  // able to resurrect it.
  if (metadata?.onLaundry === true) {
    return null;
  }

  const live = parseStrictInteger(liveInitialCleaningDays);
  const parsed =
    live !== null && live > 0 ? live : parseStrictInteger(metadata?.[INITIAL_CLEANING_DAYS_KEY]);

  // ABSENT MEANS NO BLOCK, DELIBERATELY. Every listing assigned before this field
  // existed has no value, and there is no migration: per the client, "en producción
  // iniciaremos limpio". Defaulting to some turnaround instead would need this
  // module to know a laundry's configuration, and it deliberately does not - the
  // Integration API read happens in the caller, only for the first-rental case.
  // 0 and negatives are the same non-answer. A malformed value (fractional, a string
  // of garbage, an object) also means no block: a bad write must not silently take a
  // listing off the market.
  if (parsed === null || parsed <= 0) {
    return null;
  }
  return Math.min(parsed, MAX_INITIAL_CLEANING_DAYS);
};

/**
 * The first day this garment can be rented, given the lead time.
 *
 * @param {Object} params
 * @param {number} params.initialCleaningDays
 * @param {string} [params.timeZone]
 * @param {Date} [params.now]
 * @returns {Date} start of that day, in the listing's time zone
 */
const earliestBookingStart = ({ initialCleaningDays, timeZone, now = new Date() }) =>
  startOfDayInTimeZone(now, timeZone, initialCleaningDays);

const tooEarlyError = ({ initialCleaningDays, earliestStart }) => {
  const message =
    `This garment has not reached its laundry yet, so it needs ${initialCleaningDays} day(s) ` +
    `for initial cleaning. The earliest possible start date is ` +
    `${earliestStart.toISOString().slice(0, 10)}.`;
  const error = new Error(message);
  error.status = 400;
  error.statusText = message;
  // Its OWN code, distinct from 'booking-below-minimum-days' and from an
  // availability rejection. All three refuse a booking and all three need a
  // different sentence in front of the customer: "wait a few days", "book more
  // days", "pick other days". A single generic 400 would send them to fix the
  // wrong thing.
  error.data = {
    code: 'booking-before-initial-cleaning',
    initialCleaningDays,
    earliestBookingStart: earliestStart.toISOString(),
  };
  return error;
};

/**
 * Throw when a booking would start before the garment's initial cleaning is done.
 *
 * Applies ONLY while `metadata.onLaundry !== true`. Unlike the minimum-length rule
 * above this is NOT restricted to day-unit listings: it is a physical fact about
 * where the garment is, not a comparison of two day counts, and an hourly listing
 * of a garment that is still in its owner's wardrobe is just as unbookable.
 *
 * Missing or unparseable dates are not this rule's complaint - the line-item
 * builder already reports that fault with a message about the actual problem.
 *
 * @param {Object} params
 * @param {Object} params.listing - a listing API entity
 * @param {Date|string} [params.bookingStart]
 * @param {Date} [params.now] - injectable for tests; production passes nothing
 * @param {number} [params.liveInitialCleaningDays] - the assigned laundry's CURRENT
 *   turnaround, resolved by api-util/liveInitialCleaning.js. Omitting it (or passing
 *   null, which is what a failed resolution returns) falls back to the stored snapshot,
 *   so every existing caller keeps its previous behaviour.
 * @throws {Error} 400 with data.code 'booking-before-initial-cleaning'
 */
const assertInitialCleaningLeadTime = ({
  listing,
  bookingStart,
  now = new Date(),
  liveInitialCleaningDays,
}) => {
  const initialCleaningDays = resolveInitialCleaningBlockDays(
    listing?.attributes?.metadata,
    liveInitialCleaningDays
  );
  if (initialCleaningDays === null) {
    return;
  }

  const start = bookingStart instanceof Date ? bookingStart : new Date(bookingStart);
  if (isNaN(start)) {
    return;
  }

  const timeZone = listing?.attributes?.availabilityPlan?.timezone;
  const earliestStart = earliestBookingStart({ initialCleaningDays, timeZone, now });
  const requestedStartDay = startOfDayInTimeZone(start, timeZone);

  // Strictly earlier. A booking starting exactly on the earliest day is ALLOWED:
  // `initialCleaningDays` is a number of days of cleaning, so day + n is the first
  // day the garment is ready, not the last day it is not. Off by one here silently
  // costs the owner a day of every new garment's availability.
  if (requestedStartDay.getTime() < earliestStart.getTime()) {
    throw tooEarlyError({ initialCleaningDays, earliestStart });
  }
};

module.exports = {
  ABSOLUTE_MINIMUM_DAYS,
  HARDCODED_MAX_MINIMUM_DAYS,
  INITIAL_CLEANING_DAYS_KEY,
  MAX_INITIAL_CLEANING_DAYS,
  resolveMaxMinimumBookingDays,
  resolveMinimumBookingDays,
  assertMinimumBookingDays,
  startOfDayInTimeZone,
  resolveInitialCleaningBlockDays,
  earliestBookingStart,
  assertInitialCleaningLeadTime,
};
