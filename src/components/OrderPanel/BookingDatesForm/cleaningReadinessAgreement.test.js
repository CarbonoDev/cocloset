import { earliestBookableStart, resolveReadyAt } from './BookingDatesForm';

// eslint-disable-next-line import/no-commonjs
const {
  assertCleaningReadiness,
  earliestStartAfterCleaning,
  resolveReadyAt: serverResolveReadyAt,
} = require('../../../../server/api-util/bookingRules');
// eslint-disable-next-line import/no-commonjs
const { computeReadiness } = require('../../../../server/api-util/listingCustody');

// A CROSS-LAYER test, deliberately reaching into server/ from a client suite. Sibling of
// initialCleaningAgreement.test.js, and it exists for the same reason and against a
// different rule.
//
//   > "al momento en que un laundry recibe la prenda, puede ingresar cuantos dias necesita
//   >  para la lavada, esto debe apartar dias para que la prenda vuelva a estar disponible
//   >  (...) la prenda debe estar disponible el 18, 4 días despues, no antes"
//
// THREE implementations of one date have to agree here, not two:
//
//   1. server/api-util/listingCustody.js  WRITES  `metadata.readyAt` at the return counter,
//      from the day count the operator typed;
//   2. src/.../BookingDatesForm.js        READS   it to floor the calendar;
//   3. server/api-util/bookingRules.js    READS   it to admit or refuse a posted booking.
//
// (1) against (2) is "the picker offers the day the studio said". (2) against (3) is the
// failure the sibling test guards: a calendar that offers a date and a checkout that then
// refuses the card. Each module's own unit tests pass while all three disagree, because
// each is self-consistent; only comparing them catches it.
//
// The day arithmetic genuinely differs in kind between the two sides - the client goes
// through the template's `getStartOf` (moment-timezone via src/util/dates), the server
// through its own `startOfDayInTimeZone` - which is what makes this worth asserting rather
// than assuming. src/ and server/ cannot import each other (transpiled ESM versus plain
// CommonJS), so there is no shared helper to make the comparison tautological.

const listingWith = (readyAt, timeZone) => ({
  id: { uuid: 'listing-1' },
  type: 'listing',
  attributes: {
    publicData: { unitType: 'day' },
    availabilityPlan: { type: 'availability-plan/time', timezone: timeZone },
    metadata: { onLaundry: true, readyAt },
  },
});

// Does the server admit a booking starting on this day? Expressed as a boolean so it can be
// compared against the client's floor over a whole range of days.
const serverAdmits = (listing, startDay) => {
  try {
    assertCleaningReadiness({ listing, bookingStart: startDay });
    return true;
  } catch (e) {
    return false;
  }
};

describe('the return counter, the calendar floor and the checkout gate name the same day', () => {
  // Two zones on opposite sides of UTC, so an implementation that quietly works in UTC
  // cannot pass both. Mexico City is the deployment's own zone and has no DST; Auckland is
  // ahead of UTC, which is the direction that hides a UTC bug from a Mexican tester.
  const ZONES = ['America/Mexico_City', 'Europe/Madrid', 'Pacific/Auckland', 'Etc/UTC'];
  const CLEANING_DAYS = [1, 2, 3, 4, 7, 14];

  // Late evening local time in Mexico City, which is the NEXT day in UTC. The instant that
  // used to shift the whole window by a day.
  const RETURNED_AT = new Date('2026-08-14T03:12:00.000Z');

  describe.each(ZONES)('in %s', timeZone => {
    it.each(CLEANING_DAYS)(
      'the calendar offers exactly the day the studio bought with %i cleaning days',
      cleaningDays => {
        const { readyAt } = computeReadiness({ returnedAt: RETURNED_AT, cleaningDays, timeZone });
        const listing = listingWith(readyAt.toISOString(), timeZone);

        // (1) vs (2): the picker's floor IS the readiness moment the counter wrote. Passing
        // no initial-cleaning days, which is the real case - `readyAt` only ever exists for
        // a garment that has been to a laundry, and that retires the first-cleaning rule.
        const floor = earliestBookableStart(null, readyAt.toISOString(), timeZone, RETURNED_AT);
        expect(floor.toISOString()).toBe(readyAt.toISOString());

        // (2) vs (3): the server admits the floor and refuses the day before it. Checked in
        // both directions - a gate that only ever says yes is indistinguishable from no gate.
        expect(serverAdmits(listing, floor)).toBe(true);
        expect(serverAdmits(listing, new Date(floor.getTime() - 12 * 3600 * 1000))).toBe(false);
      }
    );
  });

  it('agrees day for day across the whole blocked window and past its end', () => {
    // The exhaustive version: walk every day from the return to a week past readiness and
    // require the two sides to make the same call on each. An off-by-one in either direction
    // shows up here as a single mismatched day rather than as a passing suite.
    const timeZone = 'America/Mexico_City';
    const cleaningDays = 4;
    const { readyAt } = computeReadiness({ returnedAt: RETURNED_AT, cleaningDays, timeZone });
    const listing = listingWith(readyAt.toISOString(), timeZone);
    const floor = earliestBookableStart(null, readyAt.toISOString(), timeZone, RETURNED_AT);

    for (let offset = -1; offset <= 7 + cleaningDays; offset++) {
      const day = new Date(readyAt.getTime() + (offset - cleaningDays) * 24 * 3600 * 1000);
      const clientOffers = day.getTime() >= floor.getTime();
      expect(`${day.toISOString()} -> ${clientOffers}`).toBe(
        `${day.toISOString()} -> ${serverAdmits(listing, day)}`
      );
    }
  });

  it("is the client's worked example: back on the 13th, four days, bookable on the 18th", () => {
    // The numbers the client gave, end to end through all three modules rather than through
    // any one of them.
    const timeZone = 'America/Mexico_City';
    const returnedOnThe13th = new Date('2026-08-13T18:00:00.000Z'); // midday, Mexico City
    const { readyAt } = computeReadiness({
      returnedAt: returnedOnThe13th,
      cleaningDays: 4,
      timeZone,
    });
    const listing = listingWith(readyAt.toISOString(), timeZone);

    expect(readyAt.toISOString()).toBe('2026-08-18T06:00:00.000Z'); // the 18th, 00:00 local

    const dayInMexico = day => new Date(`${day}T06:00:00.000Z`);
    expect(serverAdmits(listing, dayInMexico('2026-08-17'))).toBe(false);
    expect(serverAdmits(listing, dayInMexico('2026-08-18'))).toBe(true);

    const floor = earliestBookableStart(null, readyAt.toISOString(), timeZone, returnedOnThe13th);
    expect(floor.toISOString()).toBe('2026-08-18T06:00:00.000Z');
  });
});

describe('both sides discard the same unusable values', () => {
  // A malformed `readyAt` must be treated as absent on BOTH sides. If only the server
  // discarded it the calendar would refuse days nothing was refusing; if only the client
  // did, the calendar would offer days checkout refuses. Either way the two must not
  // disagree about what counts as a value at all.
  it.each([[null], [undefined], [''], [0], ['not-a-date'], [{}], [[]]])(
    'treat %p as no readiness date',
    value => {
      expect(resolveReadyAt(value)).toBeNull();
      expect(serverResolveReadyAt({ readyAt: value })).toBeNull();
    }
  );

  it('accept an ISO string and a Date alike', () => {
    // listingCustody stores an ISO string, but the SDK would hand back a Date if the value
    // were ever written as a transit timestamp.
    const iso = '2026-08-18T06:00:00.000Z';
    expect(resolveReadyAt(iso).toISOString()).toBe(iso);
    expect(resolveReadyAt(new Date(iso)).toISOString()).toBe(iso);
    expect(serverResolveReadyAt({ readyAt: iso }).toISOString()).toBe(iso);
    expect(serverResolveReadyAt({ readyAt: new Date(iso) }).toISOString()).toBe(iso);
  });

  it('floor to the same day when handed a mid-day instant', () => {
    // Neither side should ever see one - `readyAt` is a midnight by construction - but a
    // value written before that was true still has to resolve to a whole day on both sides.
    const timeZone = 'America/Mexico_City';
    const midday = '2026-08-18T18:30:00.000Z';

    expect(earliestBookableStart(null, midday, timeZone, new Date(midday)).toISOString()).toBe(
      earliestStartAfterCleaning({ readyAt: midday, timeZone }).toISOString()
    );
  });
});
