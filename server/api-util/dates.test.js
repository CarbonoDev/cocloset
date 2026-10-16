const { nightsBetween, daysBetween, getBookingOverdueDays } = require('./dates');

describe('nightsBetween()', () => {
  it('should fail if end date is before start date', () => {
    const start = new Date(2017, 0, 2);
    const end = new Date(2017, 0, 1);
    expect(() => nightsBetween(start, end)).toThrow('End date cannot be before start date');
  });
  it('should handle equal start and end dates', () => {
    const d = new Date(2017, 0, 1);
    expect(nightsBetween(d, d)).toEqual(0);
  });
  it('should calculate night count for a single night', () => {
    const start = new Date(2017, 0, 1);
    const end = new Date(2017, 0, 2);
    expect(nightsBetween(start, end)).toEqual(1);
  });
  it('should calculate night count', () => {
    const start = new Date(2017, 0, 1);
    const end = new Date(2017, 0, 3);
    expect(nightsBetween(start, end)).toEqual(2);
  });
});

describe('daysBetween()', () => {
  it('should fail if end date is before start date', () => {
    const start = new Date(2017, 0, 2);
    const end = new Date(2017, 0, 1);
    expect(() => daysBetween(start, end)).toThrow('End date cannot be before start date');
  });
  it('should handle equal start and end dates', () => {
    const d = new Date(2017, 0, 1);
    expect(daysBetween(d, d)).toEqual(0);
  });
  it('should calculate night count for a single day', () => {
    const start = new Date(2017, 0, 1);
    const end = new Date(2017, 0, 2);
    expect(daysBetween(start, end)).toEqual(1);
  });
  it('should calculate day count', () => {
    const start = new Date(2017, 0, 1);
    const end = new Date(2017, 0, 3);
    expect(daysBetween(start, end)).toEqual(2);
  });
});

// NEW (2026-10-15), for the provider's late-return email's day count
// (:notification/booking-return-completed-late -> :booking-return-completed-late-owner) - see
// server/api/laundry-transaction-status.js, which writes this into metadata.daysLate at the
// moment the laundry confirms a late return.
describe('getBookingOverdueDays()', () => {
  it('returns 0 for a missing bookingEnd', () => {
    expect(getBookingOverdueDays(undefined)).toEqual(0);
    expect(getBookingOverdueDays(null)).toEqual(0);
    expect(getBookingOverdueDays('')).toEqual(0);
  });

  it('returns 0 when the booking is not yet overdue', () => {
    const farFuture = new Date();
    farFuture.setUTCDate(farFuture.getUTCDate() + 30);
    expect(getBookingOverdueDays(farFuture.toISOString())).toEqual(0);
  });

  it('returns 0 on the exclusive end date itself (the last real day, not yet overdue)', () => {
    // bookingEnd is EXCLUSIVE - the real last day of the booking is the day before it - so a
    // bookingEnd of "today" means the booking's last real day was yesterday, and today is the
    // first overdue day, not a non-overdue one. Pin this down with a bookingEnd far enough in
    // the future that "overdue as of right now" is unambiguous either way, then move it to
    // exactly one day past where overdue starts.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    // bookingEnd = today + 1 day means the last real day is today - not overdue yet.
    const notOverdueYet = new Date(today);
    notOverdueYet.setUTCDate(notOverdueYet.getUTCDate() + 1);
    expect(getBookingOverdueDays(notOverdueYet.toISOString())).toEqual(0);
  });

  it('counts whole days overdue, truncated, past the exclusive end date', () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    // bookingEnd = today - 2 days means the last real day was 3 days ago.
    const threeDaysLate = new Date(today);
    threeDaysLate.setUTCDate(threeDaysLate.getUTCDate() - 2);
    expect(getBookingOverdueDays(threeDaysLate.toISOString())).toEqual(3);
  });
});
