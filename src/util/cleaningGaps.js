import { getStartOf } from './dates';

/**
 * THE PICKER'S HALF OF THE CLEANING-GAP RULE.
 *
 *   > "Sigue sin respetarse el buffer de dias de limpieza (Revisa los dias antes del booking
 *   >  y despues de que se regresa)"
 *
 * Two rentals of the same garment cannot touch: the studio needs its turnaround in between.
 * The picker already refuses a start date whose own window - the rental days PLUS the
 * turnaround after them - is not free (BookingRentalPeriodForm `isWindowAvailableFn`), and
 * that is what covers the days BEFORE another booking.
 *
 * What it cannot see is the other side. A booking that ends on the 24th owes a wash from the
 * 24th, but nothing on the calendar says so until the accept-time availability exception is
 * written - and that write is fired from a browser and swallows its failures, so on Dev it
 * simply had not happened. The 24th looked free, and a second rental started on it.
 *
 * So the server sends the ranges outright (`/api/listing-initial-cleaning` ->
 * `cleaningGaps`), computed from the bookings whose return has not happened yet. This module
 * is only the comparison. The authoritative copy of the rule is the server gate in
 * server/api-util/cleaningGaps.js - this exists so the calendar never OFFERS a day that gate
 * would refuse, which is the failure mode the agreement tests in this folder guard against.
 *
 * WHY THE SERVER SENDS RANGES RATHER THAN THE BROWSER DERIVING THEM. Availability reaches the
 * browser as time slots, which merge bookings and exceptions into one "free/not free" answer.
 * Deriving the gaps from those would double-block the one case `metadata.readyAt` already
 * covers precisely: a garment returned early, whose cleaning exception ends exactly on the
 * first bookable day. Only the transaction knows the difference, and only the server can read
 * it.
 */

/**
 * Is this day inside a range another rental's cleaning has already claimed?
 *
 * Half-open `[start, end)`, matching the API's convention for bookings and exceptions and the
 * server's own comparison: a day exactly at a gap's end is the first day the garment is free
 * again, and treating it as blocked would cost the owner a day after every rental.
 *
 * A null/absent `cleaningGaps` means "not known" - the page load failed, or has not finished -
 * and blocks nothing. That is the deliberate direction to be wrong in here: the server gate
 * still refuses the booking, so the cost is a date that looks bookable and is then declined
 * with a reason, rather than a listing whose whole calendar goes dark on a failed fetch.
 *
 * @param {Date} day - a midnight in the listing's time zone
 * @param {Array<{start: Date, end: Date}>} [cleaningGaps]
 * @param {string} [timeZone]
 * @returns {boolean}
 */
export const isDayInCleaningGap = (day, cleaningGaps, timeZone) => {
  if (!Array.isArray(cleaningGaps) || cleaningGaps.length === 0 || !(day instanceof Date)) {
    return false;
  }

  const dayStart = getStartOf(day, 'day', timeZone).getTime();

  return cleaningGaps.some(gap => {
    const start = gap?.start instanceof Date ? gap.start : new Date(gap?.start);
    const end = gap?.end instanceof Date ? gap.end : new Date(gap?.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return false;
    }
    return dayStart >= start.getTime() && dayStart < end.getTime();
  });
};

/**
 * Does a rental window run through a range another rental's cleaning has claimed?
 *
 * The window is `[start, start + windowDays)` - the rental days plus the turnaround the picker
 * already adds. Checked as a whole rather than only at its first day, because a 14-day rental
 * booked before a gap must not run INTO one either.
 *
 * @param {Date} startDay - a midnight in the listing's time zone
 * @param {number} windowDays
 * @param {Array<{start: Date, end: Date}>} [cleaningGaps]
 * @param {string} [timeZone]
 * @returns {boolean}
 */
export const windowOverlapsCleaningGap = (startDay, windowDays, cleaningGaps, timeZone) => {
  if (!Array.isArray(cleaningGaps) || cleaningGaps.length === 0) {
    return false;
  }
  if (!(startDay instanceof Date) || !(windowDays > 0)) {
    return false;
  }

  const start = getStartOf(startDay, 'day', timeZone);
  const end = getStartOf(start, 'day', timeZone, windowDays, 'days');

  return cleaningGaps.some(gap => {
    const gapStart = gap?.start instanceof Date ? gap.start : new Date(gap?.start);
    const gapEnd = gap?.end instanceof Date ? gap.end : new Date(gap?.end);
    if (Number.isNaN(gapStart.getTime()) || Number.isNaN(gapEnd.getTime())) {
      return false;
    }
    return start.getTime() < gapEnd.getTime() && gapStart.getTime() < end.getTime();
  });
};
