import { earliestBookableDate } from './BookingDatesForm';

// eslint-disable-next-line import/no-commonjs
const { earliestBookingStart } = require('../../../../server/api-util/bookingRules');

// A CROSS-LAYER test, deliberately reaching into server/ from a client suite.
//
// The initial-cleaning rule is computed twice: once in the browser to decide the
// calendar's earliest selectable day, and once on the server to decide whether a
// posted booking is admissible. Both implementations are necessary - the client
// one cannot be trusted and the server one cannot render a calendar - but if they
// ever disagree by a single day, the product breaks in the most confusing way
// available: the calendar offers a date, the customer picks it, fills in payment
// details, and checkout refuses it with no way to tell what was wrong.
//
// Neither module's own unit tests can catch that. They pass independently while
// disagreeing. Only comparing them can, so this compares them.
//
// The two implementations differ in kind, not just in code: the client uses the
// template's `getStartOf` (moment-timezone via src/util/dates) and the server uses
// its own `startOfDayInTimeZone`. That is exactly why the agreement is worth
// asserting rather than assuming - a shared helper would make this test
// tautological, but there isn't one (src/ is ESM and transpiled, server/ is plain
// CommonJS run by node directly, and the repo documents that they cannot import
// each other).
describe('the calendar floor and the server gate agree on the earliest bookable day', () => {
  const NOW = new Date('2026-08-10T15:00:00Z');
  const TZ = 'Europe/Madrid';

  it.each([[1], [2], [3], [5], [7], [14], [30]])(
    'agree for %i initial cleaning days',
    cleaningDays => {
      const client = earliestBookableDate(cleaningDays, TZ, NOW);
      const server = earliestBookingStart({
        initialCleaningDays: cleaningDays,
        timeZone: TZ,
        now: NOW,
      });
      expect(client.toISOString()).toBe(server.toISOString());
    }
  );

  // Adding days across a DST transition is where two independent date
  // implementations are most likely to part company - one lands on 23:00 the
  // previous day, the other on 00:00 the intended day.
  it('agree across a spring-forward (Europe/Madrid, 2026-03-29)', () => {
    const now = new Date('2026-03-27T15:00:00Z');
    const client = earliestBookableDate(3, TZ, now);
    const server = earliestBookingStart({ initialCleaningDays: 3, timeZone: TZ, now });
    expect(client.toISOString()).toBe(server.toISOString());
    // And it really is the local midnight of 30 March, not 29 March 23:00.
    expect(server.toISOString()).toBe('2026-03-29T22:00:00.000Z');
  });

  it('agree across an autumn fall-back (Europe/Madrid, 2026-10-25)', () => {
    const now = new Date('2026-10-23T15:00:00Z');
    const client = earliestBookableDate(3, TZ, now);
    const server = earliestBookingStart({ initialCleaningDays: 3, timeZone: TZ, now });
    expect(client.toISOString()).toBe(server.toISOString());
  });

  // A garment with no block must put the floor at the start of today, which is
  // upstream's own behaviour - so the feature is invisible when it does not apply.
  it('agree that no block leaves the floor at the start of today', () => {
    const client = earliestBookableDate(null, TZ, NOW);
    const startOfToday = earliestBookingStart({
      initialCleaningDays: 0,
      timeZone: TZ,
      now: NOW,
    });
    expect(client.toISOString()).toBe(startOfToday.toISOString());
  });
});
