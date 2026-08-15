import { isDayInCleaningGap, windowOverlapsCleaningGap } from './cleaningGaps';

// eslint-disable-next-line import/no-commonjs
const { assertCleaningGap, computeCleaningGaps } = require('../../server/api-util/cleaningGaps');

// A CROSS-LAYER test, deliberately reaching into server/ from a client suite - the same
// pattern as the agreement tests under components/OrderPanel/BookingDatesForm, and for the
// same reason.
//
// Two implementations of one rule have to agree: the SERVER refuses a booking whose window
// leaves no room for another rental's wash, and the PICKER must not offer a start date that
// gate would refuse. Each is self-consistent on its own; only comparing them catches a
// calendar that offers a date and a checkout that then declines the card.
//
// The day arithmetic genuinely differs in kind between the two - the client goes through the
// template's `getStartOf` (moment-timezone via util/dates), the server through its own
// `startOfDayInTimeZone` - and src/ and server/ cannot import each other (transpiled ESM
// versus plain CommonJS), so there is no shared helper making this tautological.

const day = iso => new Date(`${iso}T00:00:00.000Z`);
const UTC = 'Etc/UTC';

// The client's own Dev data, 2026-08-14: a 7-day rental 17-24 Aug at a studio with a two-day
// turnaround, followed eleven minutes later by a booking starting on the 24th.
const FIRST_RENTAL = { start: day('2026-08-17'), end: day('2026-08-24') };
const TURNAROUND = 2;
const GAPS = computeCleaningGaps({
  bookings: [FIRST_RENTAL],
  turnaroundDays: TURNAROUND,
  timeZone: UTC,
});

describe('isDayInCleaningGap', () => {
  it('blocks the days a rental owes its studio', () => {
    expect(isDayInCleaningGap(day('2026-08-24'), GAPS, UTC)).toBe(true);
    expect(isDayInCleaningGap(day('2026-08-25'), GAPS, UTC)).toBe(true);
  });

  it('leaves the first free day alone', () => {
    // Half-open. Off by one here costs the owner a day after every single rental.
    expect(isDayInCleaningGap(day('2026-08-26'), GAPS, UTC)).toBe(false);
  });

  it('blocks nothing when the gaps are unknown', () => {
    // null means the page load failed or has not finished. The server gate still refuses
    // the booking, so the cost is a date that is declined with a reason - not a listing
    // whose whole calendar goes dark on a failed fetch.
    [null, undefined, []].forEach(gaps => {
      expect(isDayInCleaningGap(day('2026-08-24'), gaps, UTC)).toBe(false);
    });
  });
});

describe('windowOverlapsCleaningGap', () => {
  it('blocks a rental that would run into a gap', () => {
    // Starts free on the 20th, but a 7-day rental plus turnaround runs through the 24th.
    expect(windowOverlapsCleaningGap(day('2026-08-20'), 9, GAPS, UTC)).toBe(true);
  });

  it('allows a window that ends exactly where a gap begins', () => {
    expect(windowOverlapsCleaningGap(day('2026-08-15'), 9, GAPS, UTC)).toBe(false);
  });
});

describe('the picker and the checkout gate agree, day for day', () => {
  // The whole point. For every start date in a two-month window, the picker's answer and
  // the server's answer must be the same - not merely both "reasonable".
  const PERIOD_DAYS = 7;
  const WINDOW_DAYS = PERIOD_DAYS + TURNAROUND;

  const serverRefuses = startDay => {
    try {
      assertCleaningGap({
        bookingStart: startDay,
        bookingEnd: new Date(startDay.getTime() + PERIOD_DAYS * 24 * 60 * 60 * 1000),
        bookings: [FIRST_RENTAL],
        turnaroundDays: TURNAROUND,
        timeZone: UTC,
      });
      return false;
    } catch (e) {
      return e.data?.code === 'booking-inside-cleaning-gap';
    }
  };

  // The picker's two checks. `isWindowAvailableFn` covers the days the BOOKING itself takes
  // (they are unavailable on the calendar, which this test cannot see), so the comparison
  // here is over the days that calendar shows as free - and it is exactly those the gap rule
  // exists for.
  const pickerRefuses = startDay =>
    windowOverlapsCleaningGap(startDay, WINDOW_DAYS, GAPS, UTC) ||
    // Standing in for the time-slot check: the rental days themselves are blocked on the
    // calendar, so the picker never offers a start inside another booking.
    (startDay.getTime() < FIRST_RENTAL.end.getTime() &&
      FIRST_RENTAL.start.getTime() < startDay.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const startDays = Array.from({ length: 60 }, (_, i) => {
    const d = new Date(FIRST_RENTAL.start.getTime());
    d.setUTCDate(d.getUTCDate() + i - 20);
    return d;
  });

  it.each(startDays.map(d => [d.toISOString().slice(0, 10), d]))(
    'agrees about %s',
    (_label, startDay) => {
      expect(pickerRefuses(startDay)).toBe(serverRefuses(startDay));
    }
  );
});
