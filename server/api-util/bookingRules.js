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
 * THE CLEANING STARTS TOMORROW, NOT TODAY - hence the +1.
 *
 *   > "hoy es 12 de agosto, si un listing tiene un periodo de 1 día de laundry segun la
 *   >  limpieza, el próximo día disponible debe ser el 14 de agosto, ya que es un día de
 *   >  lavado (13 de agosto) y el siguiente día disponible es 14"
 *
 * Today is already partly over: the garment cannot reach the studio, be washed and be handed
 * over inside the hours that are left. The first cleaning day is tomorrow, n cleaning days
 * run from there, and the first bookable day is the one after those.
 *
 * MUST MATCH `earliestBookableDate` in src/components/OrderPanel/BookingDatesForm - a
 * calendar floor and a checkout gate that disagree by a day present as "the calendar offered
 * me a date and then payment refused it". initialCleaningAgreement.test.js holds them
 * together.
 *
 * A falsy day count means no block and yields the start of today, matching the client
 * exactly. Production never reaches here in that case - `assertInitialCleaningLeadTime`
 * returns before calling this - but making the two functions genuinely interchangeable is
 * what lets the agreement test compare them over the whole input space instead of only over
 * the inputs one of them happens to accept.
 *
 * @param {Object} params
 * @param {number} params.initialCleaningDays
 * @param {string} [params.timeZone]
 * @param {Date} [params.now]
 * @returns {Date} start of that day, in the listing's time zone
 */
const earliestBookingStart = ({ initialCleaningDays, timeZone, now = new Date() }) =>
  startOfDayInTimeZone(now, timeZone, initialCleaningDays ? initialCleaningDays + 1 : 0);

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

// ---------------------------------------------------------------------------
// THE POST-RENTAL CLEANING WINDOW
// ---------------------------------------------------------------------------
//
//   > "al momento en que un laundry recibe la prenda, puede ingresar cuantos dias necesita
//   >  para la lavada, esto debe apartar dias para que la prenda vuelva a estar disponible
//   >  (...) la prenda debe estar disponible el 18, 4 días despues, no antes"
//
// The rule above is the FIRST cleaning and retires itself the moment a studio takes
// delivery (`onLaundry === true`). This one is every cleaning after that: it is written by
// the studio at the counter, from the days it actually needs for the garment in its hands,
// and it applies for the rest of the listing's life.
//
// ── WHY THIS GATE EXISTS AT ALL, GIVEN THE CALENDAR IS ALREADY BLOCKED ──────
// Until now the cleaning window was enforced by ONE mechanism: an availability exception
// written at the return (api-util/availabilityBuffer.js). That write is best-effort by
// design - it runs after a transition that has already succeeded, so its failures are
// swallowed and logged rather than surfaced, because failing the request would make the ops
// UI retry a step Sharetribe now answers 409 for. That is the right call for a transition
// that already happened. It is the wrong number of places to enforce a rule.
//
// So every way the calendar write can come up short - the exception query rejecting, an
// owner-blocked week overlapping with `seats > 0` (findBookableOverlaps), a transient
// Integration API failure, a garment returned before this code shipped - ended with the
// listing bookable the day the rental ended and nothing anywhere saying so. Which is
// exactly the symptom reported, twice.
//
// `metadata.readyAt` is not best-effort in the same way: it is written BEFORE the calendar
// (custody first, availability second - see handleRealReturn), it is a single field rather
// than a reconciliation against whatever else is on the calendar, and it is read fresh on
// every checkout. Two independent mechanisms, and the authoritative one is the one that
// cannot silently write nothing.
//
// It is also unforgeable for the same reason `initialCleaningDays` is: `metadata` is
// Integration-API-writable only, so a garment owner cannot clear their own cleaning window
// to put the listing back on the market early (400 `validation-disallowed-key`).
//
// This costs the checkout path NO extra API call: `readyAt` is on the listing entity the
// privileged endpoints have already fetched.

const READY_AT_KEY = 'readyAt';

/**
 * The moment this garment finishes cleaning, if it is currently in one.
 *
 * Written by api-util/listingCustody.js `writeCustodyMetadata` as an ISO string; a Date is
 * accepted too, since the SDK would hand one back if it were ever stored as a transit
 * timestamp. Anything unparseable is treated as absent - a malformed write must not be able
 * to take a listing off the market, the same direction
 * `resolveInitialCleaningBlockDays` errs in.
 *
 * @param {Object} [metadata] - the listing's `metadata`
 * @returns {Date|null}
 */
const resolveReadyAt = metadata => {
  const raw = metadata?.[READY_AT_KEY];
  if (!raw) {
    return null;
  }
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * The first day a garment in cleaning can be rented again.
 *
 * `readyAt` is already a midnight in the listing's zone when listingCustody wrote it, so
 * this is normally the identity. It floors anyway, because a value written before that was
 * true (or by a future caller passing an instant) must still resolve to a whole day - the
 * comparison below is day against day, and half a day of skew here is a whole day of
 * disagreement with the calendar.
 *
 * MUST MATCH `earliestBookableStart` in src/components/OrderPanel/BookingDatesForm.
 * cleaningReadinessAgreement.test.js holds them together, for the same reason
 * initialCleaningAgreement.test.js holds the other pair together: a calendar floor and a
 * checkout gate that disagree by a day present to the customer as "it let me pick this date
 * and then refused my card".
 *
 * @param {Object} params
 * @param {Date|string} params.readyAt
 * @param {string} [params.timeZone]
 * @returns {Date|null}
 */
const earliestStartAfterCleaning = ({ readyAt, timeZone }) => {
  const resolved = readyAt instanceof Date ? readyAt : new Date(readyAt);
  return Number.isNaN(resolved?.getTime?.()) ? null : startOfDayInTimeZone(resolved, timeZone);
};

const notReadyError = ({ earliestStart }) => {
  const message =
    `This garment is being cleaned after its last rental. The earliest date it can be ` +
    `booked from is ${earliestStart.toISOString().slice(0, 10)}.`;
  const error = new Error(message);
  error.status = 400;
  error.statusText = message;
  // Its own code, distinct from 'booking-before-initial-cleaning'. Both refuse a start date
  // for a cleaning reason, but one means "this garment has never been to a laundry yet" and
  // the other means "it is in a wash right now"; a customer told the wrong one is told to
  // wait for something that already happened.
  error.data = {
    code: 'booking-before-cleaning-ready',
    readyAt: earliestStart.toISOString(),
  };
  return error;
};

/**
 * Throw when a booking would start before the garment's current cleaning is finished.
 *
 * A no-op for the overwhelming majority of listings: `readyAt` only exists between a return
 * and the end of the cleaning days the studio asked for, and a value in the past can never
 * refuse a start date, since starts are not in the past either.
 *
 * Missing or unparseable booking dates are not this rule's complaint - the line-item builder
 * already reports that fault with a message about the actual problem.
 *
 * @param {Object} params
 * @param {Object} params.listing - a listing API entity
 * @param {Date|string} [params.bookingStart]
 * @throws {Error} 400 with data.code 'booking-before-cleaning-ready'
 */
const assertCleaningReadiness = ({ listing, bookingStart }) => {
  const readyAt = resolveReadyAt(listing?.attributes?.metadata);
  if (!readyAt) {
    return;
  }

  const timeZone = listing?.attributes?.availabilityPlan?.timezone;
  const earliestStart = earliestStartAfterCleaning({ readyAt, timeZone });
  if (!earliestStart) {
    return;
  }

  const start = bookingStart instanceof Date ? bookingStart : new Date(bookingStart);
  if (isNaN(start)) {
    return;
  }

  // Strictly earlier, matching assertInitialCleaningLeadTime: `readyAt` is the first day the
  // garment IS ready, not the last day it is not. Off by one here costs the owner a day of
  // availability after every single rental.
  if (startOfDayInTimeZone(start, timeZone).getTime() < earliestStart.getTime()) {
    throw notReadyError({ earliestStart });
  }
};

module.exports = {
  INITIAL_CLEANING_DAYS_KEY,
  MAX_INITIAL_CLEANING_DAYS,
  READY_AT_KEY,
  startOfDayInTimeZone,
  resolveInitialCleaningBlockDays,
  earliestBookingStart,
  assertInitialCleaningLeadTime,
  resolveReadyAt,
  earliestStartAfterCleaning,
  assertCleaningReadiness,
};
