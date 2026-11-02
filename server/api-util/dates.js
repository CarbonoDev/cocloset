const moment = require('moment');

/** Helper functions for handling dates
 * These helper functions are copied from src/util/dates.js
 */

/**
 * Calculate the number of nights between the given dates.
 *
 * This uses moment#diff and, therefore, it just checks,
 * if there are 1000x60x60x24 milliseconds between date objects.
 *
 * Note: This should not be used for checking if the local date has
 *       changed between "2021-04-07 23:00" and "2021-04-08 05:00".
 *
 * @param {Date} startDate start of the time period
 * @param {Date} endDate end of the time period
 *
 * @throws Will throw if the end date is before the start date
 * @returns {Number} number of nights between the given dates
 */
exports.nightsBetween = (startDate, endDate) => {
  const nights = moment(endDate).diff(startDate, 'days');
  if (nights < 0) {
    throw new Error('End date cannot be before start date');
  }
  return nights;
};

/**
 * Calculate the number of days between the given dates.
 *
 * This uses moment#diff and, therefore, it just checks,
 * if there are 1000x60x60x24 milliseconds between date objects.
 *
 * Note: This should not be used for checking if the local date has
 *       changed between "2021-04-07 23:00" and "2021-04-08 05:00".
 *
 * @param {Date} startDate start of the time period
 * @param {Date} endDate end of the time period. NOTE: with daily
 * bookings, it is expected that this date is the exclusive end date,
 * i.e. the last day of the booking is the previous date of this end
 * date.
 *
 * @throws Will throw if the end date is before the start date
 * @returns {Number} number of days between the given dates
 */
exports.daysBetween = (startDate, endDate) => {
  const days = moment(endDate).diff(startDate, 'days');
  if (days < 0) {
    throw new Error('End date cannot be before start date');
  }
  return days;
};

/**
 * How many whole days overdue a booking is, as of right now.
 *
 * LITERAL MIRROR of `getBookingOverdueDays` in src/util/dates.js - same UTC-midnight
 * normalisation, same `bookingEnd` exclusivity (the real last day is the day before it), same
 * Math.floor truncation. Needed server-side (2026-10-15) so `transition/laundry-confirm-return-late`
 * can write `metadata.daysLate` at the moment the laundry confirms a late return - see
 * server/api/laundry-transaction-status.js. The server cannot import the client file directly
 * (no Babel step - see the header of server/api-util/coclosetBookingProcess.js for the same
 * constraint on a different pair of files), so this is a second, deliberately identical copy
 * rather than a shared import. Kept in step with src/util/dates.js by
 * src/util/getBookingOverdueDaysAgreement.test.js.
 *
 * @param {string|Date} [bookingEnd] - `booking.attributes.end` (exclusive)
 * @returns {number} 0 when there is no usable date, or when it is not yet overdue
 */
exports.getBookingOverdueDays = bookingEnd => {
  if (!bookingEnd) return 0;

  const endDate = new Date(bookingEnd);

  // bookingEnd is exclusive, so the real last day is the one before it.
  endDate.setUTCDate(endDate.getUTCDate() - 1);

  const today = new Date();

  endDate.setUTCHours(0, 0, 0, 0);
  today.setUTCHours(0, 0, 0, 0);

  const differenceInMs = today.getTime() - endDate.getTime();

  if (differenceInMs <= 0) {
    return 0;
  }

  return Math.floor(differenceInMs / (1000 * 60 * 60 * 24));
};
