import { bookingWeeksBetween, weeksFromDays } from './rentalWeeks';

// The email breakdown prints "x 2 weeks" from this, and falls back to days when it is null.
// So the two things worth pinning are: it is right when it answers, and it declines to answer
// rather than rounding a rental into a week it is not.

describe('bookingWeeksBetween', () => {
  it.each([
    ['2026-09-01T00:00:00.000Z', '2026-09-08T00:00:00.000Z', 1],
    ['2026-09-01T00:00:00.000Z', '2026-09-15T00:00:00.000Z', 2],
    ['2026-09-01T00:00:00.000Z', '2026-09-29T00:00:00.000Z', 4],
  ])('reads %s to %s as %i week(s)', (start, end, expected) => {
    expect(bookingWeeksBetween(start, end)).toBe(expected);
  });

  it('declines anything that is not a whole number of weeks', () => {
    // "3 weeks" for a 20-day rental would be a lie in a price breakdown. Days are still true.
    expect(bookingWeeksBetween('2026-09-01T00:00:00.000Z', '2026-09-21T00:00:00.000Z')).toBeNull();
    expect(bookingWeeksBetween('2026-09-01T00:00:00.000Z', '2026-09-04T00:00:00.000Z')).toBeNull();
  });

  it('survives a daylight-saving boundary', () => {
    // Europe/Madrid goes back an hour on 2026-10-25, so this span is 7 days plus an hour in
    // wall-clock terms. Flooring would call it six days and print nothing at all.
    const start = new Date('2026-10-22T00:00:00+02:00');
    const end = new Date('2026-10-29T00:00:00+01:00');

    expect(bookingWeeksBetween(start, end)).toBe(1);
  });

  it('answers null for missing, malformed or backwards dates', () => {
    expect(bookingWeeksBetween(null, '2026-09-08T00:00:00.000Z')).toBeNull();
    expect(bookingWeeksBetween('2026-09-01T00:00:00.000Z', undefined)).toBeNull();
    expect(bookingWeeksBetween('not-a-date', '2026-09-08T00:00:00.000Z')).toBeNull();
    expect(bookingWeeksBetween('2026-09-08T00:00:00.000Z', '2026-09-01T00:00:00.000Z')).toBeNull();
    // Same instant is not a rental.
    expect(bookingWeeksBetween('2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')).toBeNull();
  });
});

describe('weeksFromDays', () => {
  //   > "en el checkout y otros sitios como transaction page (...) ahi aun aparece x n days,
  //   >  pero debe ser x n weeks" (Jonathan, 2026-09-07)
  //
  // Same rule as bookingWeeksBetween, asked of a day count the breakdown has already worked
  // out. Shared so the mail and the screen cannot disagree about what counts as a week.
  it.each([[7, 1], [14, 2], [28, 4]])('reads %i days as %i week(s)', (days, expected) => {
    expect(weeksFromDays(days)).toBe(expected);
  });

  it('declines anything that is not a whole number of weeks', () => {
    [1, 3, 10, 20].forEach(days => expect(weeksFromDays(days)).toBeNull());
  });

  it('declines nonsense rather than dividing it', () => {
    [0, -7, 7.5, null, undefined, '14'].forEach(days => expect(weeksFromDays(days)).toBeNull());
  });
});
