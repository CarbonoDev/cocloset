import {
  MAX_INITIAL_CLEANING_DAYS,
  earliestBookableDate,
  resolveInitialCleaningDays,
} from './BookingDatesForm';

// eslint-disable-next-line import/no-commonjs
const {
  MAX_INITIAL_CLEANING_DAYS: SERVER_MAX_INITIAL_CLEANING_DAYS,
  earliestBookingStart,
  resolveInitialCleaningBlockDays,
} = require('../../../../server/api-util/bookingRules');

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
    // Now = 27 March. Cleaning runs 28, 29, 30; the garment is bookable from the 31st. And
    // it really is the local midnight of 31 March, not 30 March 23:00 - Madrid is UTC+2 by
    // then, so a naive 24h-at-a-time addition across the 29th would land an hour short.
    expect(server.toISOString()).toBe('2026-03-30T22:00:00.000Z');
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

// THE SECOND HALF OF THE SAME CLAIM.
//
// The arithmetic above only agrees on a NUMBER OF DAYS. It says nothing about the two
// sides picking the same number in the first place - and as of the live-turnaround change
// they no longer read the same field. The calendar takes the laundry's current turnaround
// (fetched at ListingPage load through /api/listing-initial-cleaning) and falls back to
// `metadata.initialCleaningDays`; the server gate takes the same live number, resolved
// server-side from the laundry's privateData, and falls back to the same snapshot.
//
// Two fallback chains implemented twice is exactly the shape of bug this file exists for.
// Each side's own unit tests pass while they disagree; only comparing them catches it. So
// the resolvers are compared directly, over the whole cross product of the inputs that can
// occur - and then composed with the day arithmetic, so what is asserted is the thing the
// customer actually experiences: the first day the calendar OFFERS is a day checkout
// ACCEPTS.
describe('the calendar and the server gate pick the same number of cleaning days', () => {
  const NOW = new Date('2026-08-10T15:00:00Z');
  const TZ = 'Europe/Madrid';

  // Snapshot values: absent, usable, malformed, absurd. Live values: absent (not fetched
  // yet, or the lookup failed), usable, malformed, absurd. Custody: the carve-out, plus
  // the bad-data shapes that must not be mistaken for it.
  const SNAPSHOTS = [undefined, null, 0, -1, 1, 3, 7, 2.5, 'soon', 4000];
  const LIVE = [undefined, null, 0, -1, 1, 2, 5, 1.5, 'nope', 4000];
  const CUSTODY = [undefined, false, true, 'true', 1];

  const cases = [];
  SNAPSHOTS.forEach(snapshot => {
    LIVE.forEach(live => {
      CUSTODY.forEach(onLaundry => {
        cases.push([snapshot, live, onLaundry]);
      });
    });
  });

  const metadataFor = (snapshot, onLaundry) => ({
    ...(snapshot === undefined ? {} : { initialCleaningDays: snapshot }),
    ...(onLaundry === undefined ? {} : { onLaundry }),
  });

  // Looped inside one `it` rather than spread over `it.each`: 500 combinations is the right
  // amount of coverage and the wrong number of test names. The label carries the inputs, so
  // a failure still says which combination broke.
  it('resolve to the same block for every combination of inputs', () => {
    cases.forEach(([snapshot, live, onLaundry]) => {
      const label = `snapshot=${String(snapshot)} live=${String(live)} onLaundry=${String(
        onLaundry
      )}`;
      const client = resolveInitialCleaningDays(snapshot, onLaundry, live);
      const server = resolveInitialCleaningBlockDays(metadataFor(snapshot, onLaundry), live);
      expect(`${label} -> ${client}`).toBe(`${label} -> ${server}`);
    });
  });

  // End to end: resolve, then date. This is the claim in the form the customer meets it -
  // the first day the calendar offers is a day checkout accepts.
  it('put the calendar floor on the same day for every combination of inputs', () => {
    cases.forEach(([snapshot, live, onLaundry]) => {
      const label = `snapshot=${String(snapshot)} live=${String(live)} onLaundry=${String(
        onLaundry
      )}`;
      const clientFloor = earliestBookableDate(
        resolveInitialCleaningDays(snapshot, onLaundry, live),
        TZ,
        NOW
      );
      const serverBlock = resolveInitialCleaningBlockDays(metadataFor(snapshot, onLaundry), live);
      const serverFloor = earliestBookingStart({
        initialCleaningDays: serverBlock || 0,
        timeZone: TZ,
        now: NOW,
      });
      expect(`${label} -> ${clientFloor.toISOString()}`).toBe(
        `${label} -> ${serverFloor.toISOString()}`
      );
    });
  });

  // The precedence itself, stated once rather than only inferred from the table above.
  it('both prefer the live value over the snapshot', () => {
    expect(resolveInitialCleaningDays(7, false, 2)).toBe(2);
    expect(resolveInitialCleaningBlockDays({ initialCleaningDays: 7 }, 2)).toBe(2);
  });

  // The direction that must never invert. A failed live lookup arrives as null on both
  // sides, and both must fall back to the snapshot - not to "no block". If only one of
  // them did, an Integration API blip would make the calendar and checkout disagree by the
  // whole turnaround.
  it('both fall back to the snapshot rather than to "no block"', () => {
    expect(resolveInitialCleaningDays(3, false, null)).toBe(3);
    expect(resolveInitialCleaningBlockDays({ initialCleaningDays: 3 }, null)).toBe(3);
  });

  // Duplicated constant, checked rather than trusted: src/ and server/ cannot import each
  // other (ESM/transpiled versus plain CommonJS), so the clamp exists twice. If they
  // diverged, a laundry with an absurd turnaround would give the calendar one floor and the
  // gate another - and only for the listings nobody looks at until they break.
  it('clamp an absurd turnaround at the same bound', () => {
    expect(MAX_INITIAL_CLEANING_DAYS).toBe(SERVER_MAX_INITIAL_CLEANING_DAYS);
    expect(resolveInitialCleaningDays(undefined, false, 4000)).toBe(MAX_INITIAL_CLEANING_DAYS);
    expect(resolveInitialCleaningBlockDays({}, 4000)).toBe(SERVER_MAX_INITIAL_CLEANING_DAYS);
  });
});
