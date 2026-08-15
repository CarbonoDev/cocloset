const { startOfDayInTimeZone, MAX_INITIAL_CLEANING_DAYS } = require('./bookingRules');
const { STATES, stateFromLastTransition } = require('./coclosetBookingProcess');

// ---------------------------------------------------------------------------
// THE CLEANING GAP BETWEEN TWO BOOKINGS
// ---------------------------------------------------------------------------
//
//   > "Sigue sin respetarse el buffer de dias de limpieza (Revisa los dias antes del
//   >  booking y despues de que se regresa)"
//
// A garment comes back dirty. The studio needs its turnaround before the next customer can
// collect it, so two rentals of the same garment cannot touch: there has to be a gap of at
// least the turnaround between the end of one and the start of the next.
//
// Reported by the client with BOTH ends named, and they are the same rule seen from either
// side. Reserving a week that starts the day another rental ends is "no days after the
// return"; reserving a week that ends the day another rental starts is "no days before the
// booking". So the rule is written once, symmetrically: every booking OCCUPIES its rental
// days plus the turnaround that follows them, and two occupied windows may not overlap.
//
// ── WHY THIS IS NOT ALREADY TRUE ────────────────────────────────────────────
// It was supposed to be. An availability exception covering `[bookingEnd, bookingEnd + n)`
// is written when a booking is accepted (api-util/availabilityBuffer.js), and both the
// picker and Sharetribe's own availability then refuse those days for free.
//
// On Dev, that exception does not exist. Verified against the real marketplace: two garments
// rented and accepted on 2026-08-14 have NO buffer exception on their calendars, while the
// exception written by the RETURN path - which runs server-side, inside the request - is
// there on the same listings. Driving the endpoint in-process against those very
// transactions produces the correct window and creates it successfully, so the arithmetic
// and the Integration API write are both fine. What is missing is the trigger: it is fired
// from the browser after the provider's accept resolves (TransactionPage.duck.js), and its
// failures are logged and swallowed by design.
//
// The measurable consequence, on the client's own data: a booking for 17-24 Aug was accepted
// at 20:49, and eleven minutes later the same garment was booked again starting the 24th -
// zero cleaning days in between, on a studio with a two-day turnaround.
//
// This is the third time the same class of failure has been reported, and the lesson is the
// one `metadata.readyAt` already taught: a rule enforced ONLY by a best-effort calendar write
// is a rule that can silently not exist. So the gap is now also enforced where it cannot fail
// quietly - at the moment of booking, computed from data that is always there - and the
// picker is fed the same computation so it never offers a day checkout will refuse.
//
// ── WHY IT READS TRANSACTIONS AND NOT BOOKINGS ──────────────────────────────
// A booking whose garment has ALREADY come back is not covered by this rule: the studio took
// custody, said how many days it needed, and `metadata.readyAt` holds the real window from
// the real return date (api-util/listingCustody.js). Projecting `bookingEnd + turnaround` on
// top of it would double-block a garment that is already washed and back on the rack -
// exactly the case of a rental returned early.
//
// So this covers only bookings whose return has NOT happened yet, which is a fact about the
// TRANSACTION's state, not about the booking. `readyAt` takes over the moment the studio
// confirms the return; between them the whole timeline is covered, once each.

/**
 * Transaction states whose cleaning is still ahead of them.
 *
 * Everything from the moment a booking exists up to (but not including) `returned`, which is
 * where `metadata.readyAt` takes over. `pending-payment` is included deliberately: Sharetribe
 * has already created the booking and is already holding those days on the calendar, so the
 * turnaround after them has to be held too - otherwise a checkout in progress and a checkout
 * a minute later can agree on a gap that neither of them leaves.
 *
 * Note this is NOT `ACTIVE_STATES` from the process module. That list means "a real garment
 * is committed to a real booking" and deliberately starts at `accepted` and runs through
 * `cleaning`; this one starts earlier and stops sooner, because it answers a different
 * question - "are these days still going to need a wash after them".
 */
const STATES_AWAITING_CLEANING = [
  STATES.PENDING_PAYMENT,
  STATES.PREAUTHORIZED,
  STATES.ACCEPTED,
  STATES.READY_FOR_PICKUP,
  STATES.PICKED_UP,
  STATES.OVERDUE,
];

/**
 * Normalise a booking's dates to whole days in the listing's zone.
 *
 * Day granularity, for the same reason every other rule in api-util/bookingRules.js works in
 * whole days: the comparison is between a rental period and a day count a human typed, and
 * comparing raw instants would make the answer depend on the hour.
 */
const toDayRange = ({ start, end }, timeZone) => {
  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }
  return {
    start: startOfDayInTimeZone(startDate, timeZone),
    end: startOfDayInTimeZone(endDate, timeZone),
  };
};

/**
 * How many whole days of turnaround to hold after a rental.
 *
 * Clamped rather than rejected, matching `MAX_INITIAL_CLEANING_DAYS`: this runs on the
 * checkout path, where throwing is a lost sale, and a studio that fat-fingers 4000 must not
 * be able to take a garment off the market for a decade.
 *
 * @param {*} turnaroundDays
 * @returns {number} 0 when there is no usable number, which makes every function here a no-op
 */
const resolveGapDays = turnaroundDays => {
  const parsed = Number(turnaroundDays);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.min(Math.ceil(parsed), MAX_INITIAL_CLEANING_DAYS);
};

/**
 * The days a booking occupies: its rental days PLUS the turnaround after them.
 *
 * Half-open `[start, end)`, matching Sharetribe's convention for bookings and availability
 * exceptions alike, so a window that ends exactly where another starts does NOT overlap.
 *
 * @param {{start: Date|string, end: Date|string}} booking
 * @param {number} gapDays
 * @param {string} [timeZone]
 * @returns {{start: Date, end: Date}|null}
 */
const occupiedWindow = (booking, gapDays, timeZone) => {
  const range = toDayRange(booking || {}, timeZone);
  if (!range) {
    return null;
  }
  return {
    start: range.start,
    end: gapDays > 0 ? startOfDayInTimeZone(range.end, timeZone, gapDays) : range.end,
  };
};

const overlaps = (a, b) =>
  !!a && !!b && a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();

/**
 * Pull the bookings that still need a wash out of a transactions query response.
 *
 * @param {Object} params
 * @param {Array<Object>} params.transactions - `response.data.data`
 * @param {Array<Object>} [params.included] - `response.data.included` (must contain bookings)
 * @param {string} [params.excludeTransactionId] - the transaction being transitioned, which
 *   must not be compared against itself
 * @returns {Array<{start: Date, end: Date, transactionId: string}>}
 */
const collectBookingsAwaitingCleaning = ({
  transactions = [],
  included = [],
  excludeTransactionId,
}) =>
  transactions.reduce((collected, transaction) => {
    const transactionId = transaction?.id?.uuid;
    if (excludeTransactionId && transactionId === excludeTransactionId) {
      return collected;
    }

    const state = stateFromLastTransition(transaction?.attributes?.lastTransition);
    if (!STATES_AWAITING_CLEANING.includes(state)) {
      return collected;
    }

    const bookingId = transaction?.relationships?.booking?.data?.id?.uuid;
    const booking = bookingId
      ? included.find(entity => entity.type === 'booking' && entity.id?.uuid === bookingId)
      : null;
    const start = booking?.attributes?.start;
    const end = booking?.attributes?.end;
    if (!start || !end) {
      return collected;
    }

    return collected.concat({ start: new Date(start), end: new Date(end), transactionId });
  }, []);

/**
 * Transaction states that mean this garment was rented, and the rental finished.
 *
 *   > "Quiza podriamos contabilizar las transacciones exitosas para ese listing y mostrar
 *   >  este dato, de lo contrario lo omitimos"
 *
 * A COMPLETED rental, not an accepted one: the count sits under the title next to the rating,
 * where it reads as "this many people have actually worn this and given it back". A booking
 * that was accepted and then cancelled is not that, and neither is one still out.
 *
 * `delivered` is the state a rental reaches when the studio marks the garment available again;
 * the review states are the same rental with a review attached, and a garment must not lose a
 * rental from its count because somebody wrote about it.
 */
const COMPLETED_RENTAL_STATES = [
  STATES.DELIVERED,
  STATES.REVIEWED,
  STATES.REVIEWED_BY_CUSTOMER,
  STATES.REVIEWED_BY_PROVIDER,
];

/**
 * How many rentals of this garment have run their course.
 *
 * Counted from the transactions query the cleaning-gap rule already makes, so it costs
 * nothing extra - which is the whole reason it lives in this module rather than in an
 * endpoint of its own.
 *
 * @param {Array<Object>} transactions - `response.data.data`
 * @returns {number}
 */
const countCompletedRentals = (transactions = []) =>
  transactions.filter(transaction =>
    COMPLETED_RENTAL_STATES.includes(
      stateFromLastTransition(transaction?.attributes?.lastTransition)
    )
  ).length;

/**
 * The day ranges that cannot be a rental START, because a garment is being washed then.
 *
 * This is the picker's half of the rule: `[bookingEnd, bookingEnd + turnaround)` for every
 * booking still awaiting its wash. The picker ALREADY refuses a start date whose own window -
 * rental days plus turnaround - is not free (BookingRentalPeriodForm `isWindowAvailableFn`),
 * which covers the days BEFORE another booking. What it cannot see is the turnaround owed by
 * a booking that has not been returned yet, because nothing on the calendar says so.
 *
 * Returned as ranges rather than as a single floor date because there can be several: a
 * garment booked for August and again for October owes a wash after each.
 *
 * @param {Object} params
 * @param {Array<{start: Date, end: Date}>} params.bookings
 * @param {number} params.turnaroundDays
 * @param {string} [params.timeZone]
 * @returns {Array<{start: Date, end: Date}>} chronological, may be empty
 */
const computeCleaningGaps = ({ bookings = [], turnaroundDays, timeZone }) => {
  const gapDays = resolveGapDays(turnaroundDays);
  if (gapDays === 0) {
    return [];
  }

  return bookings
    .map(booking => {
      const range = toDayRange(booking || {}, timeZone);
      return range
        ? { start: range.end, end: startOfDayInTimeZone(range.end, timeZone, gapDays) }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
};

const gapConflictError = ({ conflict, turnaroundDays }) => {
  const message =
    `This garment needs ${turnaroundDays} day(s) of cleaning between rentals, and those ` +
    `dates fall inside the window reserved for one. The next rental can start from ` +
    `${conflict.end.toISOString().slice(0, 10)}.`;
  const error = new Error(message);
  error.status = 400;
  error.statusText = message;
  // Its own code, distinct from 'booking-before-cleaning-ready'. That one means "this garment
  // is in a wash RIGHT NOW"; this one means "another rental has already claimed the wash
  // around those days". A customer told the wrong one is told to wait for the wrong thing.
  error.data = {
    code: 'booking-inside-cleaning-gap',
    turnaroundDays,
    conflictStart: conflict.start.toISOString(),
    conflictEnd: conflict.end.toISOString(),
  };
  return error;
};

/**
 * Throw when a requested booking leaves no room for a cleaning either side of it.
 *
 * A no-op when there is no turnaround to hold, when there are no other bookings, or when the
 * requested dates are missing or unparseable - the line-item builder already reports that
 * last fault with a message about the actual problem.
 *
 * @param {Object} params
 * @param {Date|string} params.bookingStart
 * @param {Date|string} params.bookingEnd - exclusive, matching the API
 * @param {Array<{start: Date, end: Date}>} params.bookings - other bookings on this listing
 *   that are still awaiting their wash
 * @param {number} params.turnaroundDays
 * @param {string} [params.timeZone]
 * @throws {Error} 400 with data.code 'booking-inside-cleaning-gap'
 */
const assertCleaningGap = ({
  bookingStart,
  bookingEnd,
  bookings = [],
  turnaroundDays,
  timeZone,
}) => {
  const gapDays = resolveGapDays(turnaroundDays);
  if (gapDays === 0 || bookings.length === 0) {
    return;
  }

  const requested = occupiedWindow({ start: bookingStart, end: bookingEnd }, gapDays, timeZone);
  if (!requested || requested.end.getTime() <= requested.start.getTime()) {
    return;
  }

  const conflict = bookings
    .map(booking => occupiedWindow(booking, gapDays, timeZone))
    .filter(Boolean)
    .find(window => overlaps(requested, window));

  if (conflict) {
    throw gapConflictError({ conflict, turnaroundDays: gapDays });
  }
};

module.exports = {
  STATES_AWAITING_CLEANING,
  COMPLETED_RENTAL_STATES,
  countCompletedRentals,
  resolveGapDays,
  occupiedWindow,
  collectBookingsAwaitingCleaning,
  computeCleaningGaps,
  assertCleaningGap,
};
