// The 10-year-range build, matching api-util/lineItemHelpers.js and src/util/dates.js.
// A full tz database is ~180kB of data this module does not need: the only dates it
// looks at are today and a booking start a few weeks out.
const momentTz = require('moment-timezone/builds/moment-timezone-with-data-10-year-range.min');

// Number.parseInt is the wrong tool for validating a whole number: it truncates
// and ignores trailing garbage, so '3.5' becomes 3 and '5 days' becomes 5. That
// would make a string behave differently from the equivalent number (2.5 is
// rejected as fractional, '2.5' would be accepted as 2) - the sort of asymmetry
// that turns "the value is wrong" into an unreproducible report. A value is
// either an integer or it is malformed.
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
  INITIAL_CLEANING_DAYS_KEY,
  MAX_INITIAL_CLEANING_DAYS,
  startOfDayInTimeZone,
  resolveInitialCleaningBlockDays,
  earliestBookingStart,
  assertInitialCleaningLeadTime,
};
