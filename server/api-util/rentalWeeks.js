// How many whole weeks a rental is - server mirror of src/util/rentalWeeks.js.
//
//   > "en el correo que se recibe como customer 'Your booking request was accepted', aun se
//   >  ve x n days, cuando debe ser por 1 o 2 semanas" (Jonathan, 2026-09-08)
//
// Sharetribe's template language has no arithmetic, so an email cannot divide a day count by
// seven. The number therefore has to travel with the transaction, in `protectedData`, and it
// is computed HERE - at the moment the booking is initiated, from the dates the API is about
// to store.
//
// IT USED TO BE COMPUTED IN THE BROWSER, in CheckoutPageWithPayment, from
// `pageData.orderData.bookingDates`. That is one form's idea of the booking, read back out of
// session storage, and a booking made through any other path - or through a form that fills a
// different shape - simply had no week count. The server's `bookingStart`/`bookingEnd` are the
// dates the booking is actually made from: there is no second shape and nothing to lose in
// transit.
//
// Duplicated rather than imported for the reason at the top of coclosetBookingProcess.js - the
// server is plain CommonJS with no Babel step and cannot require an ESM module out of `src/`.
// Held together with the client copy by src/util/rentalWeeksAgreement.test.js.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;

/**
 * @param {number} [days]
 * @returns {number|null} whole weeks, or null
 */
const weeksFromDays = days =>
  Number.isInteger(days) && days > 0 && days % DAYS_PER_WEEK === 0 ? days / DAYS_PER_WEEK : null;

/**
 * @param {Date|string|number} [start] - booking start
 * @param {Date|string|number} [end] - booking end, exclusive (as Sharetribe stores it)
 * @returns {number|null} whole weeks, or null - null when the rental is not a round number of
 *   weeks, which is meaningful: the breakdown then says days, which is still true.
 */
const bookingWeeksBetween = (start, end) => {
  if (!start || !end) {
    return null;
  }
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return null;
  }

  // Rounded rather than floored: a booking that crosses a DST boundary is 24h short or long in
  // wall-clock milliseconds, and a seven-day rental must not become six.
  const days = Math.round((endMs - startMs) / MS_PER_DAY);

  return weeksFromDays(days);
};

module.exports = {
  weeksFromDays,
  bookingWeeksBetween,
};
