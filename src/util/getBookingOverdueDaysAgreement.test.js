import { getBookingOverdueDays } from './dates';

// eslint-disable-next-line import/no-commonjs
const { getBookingOverdueDays: serverGetBookingOverdueDays } = require('../../server/api-util/dates');

/**
 * WHY THIS FILE EXISTS
 *
 * `LaundryOrderRow.js` shows the ops dashboard how many days a garment is overdue
 * (`getBookingOverdueDays` from this client file, feeding
 * `LaundryOpsPage.detail.laundryDeliveryOverdue`). As of 2026-10-15, the provider's own
 * late-return email also needs that number - "Si el customer regresa la prenda con retraso,
 * debe informar por correo al provider sobre el retraso" - but it has to be computed
 * SERVER-SIDE, at the moment the laundry confirms the late return, because Sharetribe's
 * notification templates have no arithmetic (see server/api/laundry-transaction-status.js's
 * own comment on `metadata.daysLate`). The server cannot import this file directly (no Babel
 * step - see the header of server/api-util/coclosetBookingProcess.js for the same constraint
 * on a different pair of files), so server/api-util/dates.js carries a second, deliberately
 * identical copy. If the two ever disagree, the ops dashboard and the provider's own email
 * would report two different "how late" numbers for the same booking - this test is what
 * catches that before it ships.
 */
describe('getBookingOverdueDays: the client and server copies agree', () => {
  const bookingEnds = [
    undefined,
    null,
    '',
    // Far in the future: not overdue.
    (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 30);
      return d.toISOString();
    })(),
    // Exactly at the boundary: bookingEnd is exclusive, so "tomorrow" means the real last day
    // is today - not overdue yet.
    (() => {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString();
    })(),
    // Several days overdue.
    (() => {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - 5);
      return d.toISOString();
    })(),
  ];

  it.each(bookingEnds)('agrees for bookingEnd = %s', bookingEnd => {
    expect(getBookingOverdueDays(bookingEnd)).toEqual(serverGetBookingOverdueDays(bookingEnd));
  });
});
