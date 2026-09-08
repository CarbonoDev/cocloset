import { bookingWeeksBetween, weeksFromDays } from './rentalWeeks';

// eslint-disable-next-line import/no-commonjs
const server = require('../../server/api-util/rentalWeeks');

/**
 * WHY THIS FILE EXISTS
 *
 *   > "en el correo que se recibe como customer 'Your booking request was accepted', aun se ve
 *   >  x n days, cuando debe ser por 1 o 2 semanas" (Jonathan, 2026-09-08)
 *
 * The week count is now written by the SERVER, at initiate, and read by the CLIENT in the
 * order breakdown on screen. Two copies of "what counts as a whole number of weeks", and the
 * failure they produce is the one the client has been reporting for days: a mail and a screen
 * describing the same rental differently. Nobody would notice which of the two was wrong.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 8, 20); // Sun 20 Sep 2026 - the real transaction's start

const CASES = [
  ['exactly one week', 7],
  ['exactly two weeks', 14],
  ['four weeks', 28],
  ['a day short of a week', 6],
  ['a day over a week', 8],
  ['ten days', 10],
  ['a single day', 1],
];

describe('the client and server week counts agree', () => {
  it.each(CASES)('%s', (_label, days) => {
    const start = new Date(START);
    const end = new Date(START + days * MS_PER_DAY);

    expect(bookingWeeksBetween(start, end)).toBe(server.bookingWeeksBetween(start, end));
    expect(weeksFromDays(days)).toBe(server.weeksFromDays(days));
  });

  it('agree on the booking that was reported as wrong', () => {
    // Sun 20 Sep - Sun 27 Sep, exclusive end: one week, and the mail said "7 days".
    expect(server.bookingWeeksBetween(new Date(START), new Date(START + 7 * MS_PER_DAY))).toBe(1);
  });

  it('agree there is no week count for a rental that is not a round number of them', () => {
    // Absent rather than rounded. The breakdown falls back to days, which is still true -
    // "3 weeks" for a 20-day rental would not be.
    [null, undefined, 0].forEach(bad => {
      expect(bookingWeeksBetween(bad, bad)).toBe(server.bookingWeeksBetween(bad, bad));
    });

    const start = new Date(START);
    expect(bookingWeeksBetween(start, start)).toBe(server.bookingWeeksBetween(start, start));
    // End before start is not a rental at all.
    const before = new Date(START - MS_PER_DAY);
    expect(bookingWeeksBetween(start, before)).toBe(server.bookingWeeksBetween(start, before));
  });

  it('agree on ISO strings, which is what crosses the wire', () => {
    // The server reads `bookingStart`/`bookingEnd` off a request body, so they may arrive as
    // strings rather than Dates. A helper that only handled Dates would return null there and
    // the email would print days with nothing to explain it.
    const start = new Date(START).toISOString();
    const end = new Date(START + 14 * MS_PER_DAY).toISOString();

    expect(server.bookingWeeksBetween(start, end)).toBe(2);
    expect(bookingWeeksBetween(start, end)).toBe(server.bookingWeeksBetween(start, end));
  });
});
