const {
  ABSOLUTE_MINIMUM_DAYS,
  HARDCODED_MAX_MINIMUM_DAYS,
  MAX_INITIAL_CLEANING_DAYS,
  resolveMaxMinimumBookingDays,
  resolveMinimumBookingDays,
  assertMinimumBookingDays,
  resolveInitialCleaningBlockDays,
  earliestBookingStart,
  assertInitialCleaningLeadTime,
} = require('./bookingRules');

// This module is the ONLY thing standing between a posted booking and a charge
// that ignores the owner's minimum: the calendar's refusal is UX, and Sharetribe
// does not model booking length at all. So every test here asserts a denial as
// well as an acceptance - a rule that only ever says yes is indistinguishable
// from no rule.

// `unitType` uses a sentinel rather than a default parameter so a test can say
// "this listing has NO unitType" - a default would silently turn that case back
// into 'day' and the test would assert the opposite of its own name.
const NO_UNIT_TYPE = Symbol('no unitType');
const listing = ({ unitType = 'day', minimumBookingDays } = {}) => ({
  id: { uuid: 'listing-1' },
  type: 'listing',
  attributes: {
    publicData: {
      ...(unitType === NO_UNIT_TYPE ? {} : { unitType }),
      ...(minimumBookingDays === undefined ? {} : { minimumBookingDays }),
    },
  },
});

// Day bookings carry an EXCLUSIVE end date: a 1-day rental is D -> D+1.
const day = n => new Date(Date.UTC(2026, 7, n));
const booking = days => ({ bookingStart: day(10), bookingEnd: day(10 + days) });

const ORIGINAL_ENV = process.env.REACT_APP_MAX_MINIMUM_BOOKING_DAYS;
afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.REACT_APP_MAX_MINIMUM_BOOKING_DAYS;
  } else {
    process.env.REACT_APP_MAX_MINIMUM_BOOKING_DAYS = ORIGINAL_ENV;
  }
});

describe('resolveMaxMinimumBookingDays', () => {
  it('defaults to 30 when unset', () => {
    delete process.env.REACT_APP_MAX_MINIMUM_BOOKING_DAYS;
    expect(resolveMaxMinimumBookingDays()).toBe(HARDCODED_MAX_MINIMUM_DAYS);
    expect(HARDCODED_MAX_MINIMUM_DAYS).toBe(30);
  });

  it('reads the env bound', () => {
    process.env.REACT_APP_MAX_MINIMUM_BOOKING_DAYS = '7';
    expect(resolveMaxMinimumBookingDays()).toBe(7);
  });

  it.each([['abc'], [''], ['0'], ['-5'], ['3.5']])(
    'falls back to the default for the unusable value %p',
    value => {
      process.env.REACT_APP_MAX_MINIMUM_BOOKING_DAYS = value;
      expect(resolveMaxMinimumBookingDays()).toBe(HARDCODED_MAX_MINIMUM_DAYS);
    }
  );
});

describe('resolveMinimumBookingDays', () => {
  it('treats an absent value as no minimum', () => {
    expect(resolveMinimumBookingDays({})).toBe(ABSOLUTE_MINIMUM_DAYS);
    expect(resolveMinimumBookingDays(undefined)).toBe(ABSOLUTE_MINIMUM_DAYS);
  });

  it('reads a configured value', () => {
    expect(resolveMinimumBookingDays({ minimumBookingDays: 3 })).toBe(3);
  });

  it('accepts a numeric string, since extended data is loosely typed', () => {
    expect(resolveMinimumBookingDays({ minimumBookingDays: '4' })).toBe(4);
  });

  // A malformed stored value must not take a listing off the market: this runs on
  // the checkout path, where a throw is a lost sale.
  it.each([[null], ['abc'], [{}], [[]], [0], [-3], [NaN]])(
    'degrades the unusable value %p to no minimum instead of throwing',
    value => {
      expect(resolveMinimumBookingDays({ minimumBookingDays: value })).toBe(ABSOLUTE_MINIMUM_DAYS);
    }
  );

  // Both spellings of the same malformed value must behave identically. An
  // earlier version used Number.parseInt, which truncated the STRING '2.5' to 2
  // while rejecting the NUMBER 2.5 - so the same bad input priced differently
  // depending on how extended data happened to round-trip it.
  it.each([[2.5], ['2.5'], ['5 days'], ['3abc'], ['  ']])(
    'rounds nothing: the fractional or trailing-garbage value %p is not a minimum',
    value => {
      expect(resolveMinimumBookingDays({ minimumBookingDays: value })).toBe(ABSOLUTE_MINIMUM_DAYS);
    }
  );

  // publicData is owner-writable, so this number is whatever its owner typed
  // into an API call - not necessarily whatever the wizard would have allowed.
  it('clamps a value above the marketplace bound', () => {
    process.env.REACT_APP_MAX_MINIMUM_BOOKING_DAYS = '30';
    expect(resolveMinimumBookingDays({ minimumBookingDays: 4000 })).toBe(30);
  });
});

describe('assertMinimumBookingDays', () => {
  it('rejects a booking shorter than the minimum', () => {
    expect(() =>
      assertMinimumBookingDays({ listing: listing({ minimumBookingDays: 3 }), ...booking(2) })
    ).toThrow(/minimum of 3 days/);
  });

  it('accepts a booking of exactly the minimum - the boundary is inclusive', () => {
    expect(() =>
      assertMinimumBookingDays({ listing: listing({ minimumBookingDays: 3 }), ...booking(3) })
    ).not.toThrow();
  });

  it('accepts a longer booking', () => {
    expect(() =>
      assertMinimumBookingDays({ listing: listing({ minimumBookingDays: 3 }), ...booking(10) })
    ).not.toThrow();
  });

  it('carries a machine-readable code so the browser can translate the refusal', () => {
    try {
      assertMinimumBookingDays({ listing: listing({ minimumBookingDays: 5 }), ...booking(1) });
      throw new Error('expected a rejection');
    } catch (e) {
      expect(e.status).toBe(400);
      expect(e.data).toEqual({
        code: 'booking-below-minimum-days',
        minimumBookingDays: 5,
        requestedDays: 1,
      });
    }
  });

  it('does nothing when the listing sets no minimum', () => {
    expect(() => assertMinimumBookingDays({ listing: listing(), ...booking(1) })).not.toThrow();
  });

  // The field and the rule are both expressed in days. Applying it to an hourly
  // listing would be comparing two different units.
  it.each([['hour'], ['night'], ['fixed'], ['item'], [NO_UNIT_TYPE]])(
    'ignores a listing whose unitType is %p',
    unitType => {
      expect(() =>
        assertMinimumBookingDays({
          listing: listing({ unitType, minimumBookingDays: 5 }),
          ...booking(1),
        })
      ).not.toThrow();
    }
  );

  // These are somebody else's complaints, and relabelling them as "too short"
  // would send the customer to fix the wrong thing.
  it('stays silent on missing dates - the line-item builder reports that fault', () => {
    expect(() =>
      assertMinimumBookingDays({ listing: listing({ minimumBookingDays: 3 }) })
    ).not.toThrow();
  });

  it('stays silent on a reversed range', () => {
    expect(() =>
      assertMinimumBookingDays({
        listing: listing({ minimumBookingDays: 3 }),
        bookingStart: day(20),
        bookingEnd: day(10),
      })
    ).not.toThrow();
  });

  it('accepts ISO strings as well as Date objects', () => {
    expect(() =>
      assertMinimumBookingDays({
        listing: listing({ minimumBookingDays: 3 }),
        bookingStart: day(10).toISOString(),
        bookingEnd: day(11).toISOString(),
      })
    ).toThrow(/minimum of 3 days/);
  });

  it('honours a clamped minimum rather than the raw stored value', () => {
    process.env.REACT_APP_MAX_MINIMUM_BOOKING_DAYS = '5';
    // Stored 900, clamped to 5: a 6-day booking must be accepted.
    expect(() =>
      assertMinimumBookingDays({ listing: listing({ minimumBookingDays: 900 }), ...booking(6) })
    ).not.toThrow();
    expect(() =>
      assertMinimumBookingDays({ listing: listing({ minimumBookingDays: 900 }), ...booking(4) })
    ).toThrow(/minimum of 5 days/);
  });
});

// ---------------------------------------------------------------------------
// THE INITIAL CLEANING LEAD TIME
//
//   > "Al hacer booking, el calendario muestra el siguiente día como disponible,
//   >  pero no esta considerando los tiempos de lavado inicial, esto debe aplicar
//   >  solo para la primera vez en esa prenda, si la prenda aun no esta en el
//   >  laundry, si la prenda ya esta en laundry entonces si debe aparecer
//   >  disponible al siguiente día"
//
// Two failure directions, and both matter:
//   * too lenient - a customer books a garment that is still in its owner's
//     wardrobe, and nobody can hand it over on the day;
//   * too strict - the rule keeps applying after the garment has arrived, or eats
//     a day at the boundary, and an owner quietly loses availability with nothing
//     in the UI to explain it.
// So the boundary is asserted in both directions, and `onLaundry === true` is
// asserted to change NOTHING.
// ---------------------------------------------------------------------------

// `now` is pinned. A rule about "today" that reads the clock is a test that passes
// until it is run at 23:59 UTC.
const NOW = new Date('2026-08-10T09:30:00.000Z');

const cleaningListing = ({ initialCleaningDays, onLaundry, timeZone = 'Etc/UTC' } = {}) => ({
  id: { uuid: 'listing-1' },
  type: 'listing',
  attributes: {
    publicData: { unitType: 'day' },
    availabilityPlan: { type: 'availability-plan/time', timezone: timeZone },
    metadata: {
      ...(initialCleaningDays === undefined ? {} : { initialCleaningDays }),
      ...(onLaundry === undefined ? {} : { onLaundry }),
    },
  },
});

describe('resolveInitialCleaningBlockDays', () => {
  it('reads a stored day count', () => {
    expect(resolveInitialCleaningBlockDays({ initialCleaningDays: 3 })).toBe(3);
  });

  it('accepts a numeric string, since extended data is loosely typed', () => {
    expect(resolveInitialCleaningBlockDays({ initialCleaningDays: '3' })).toBe(3);
  });

  // The client's second sentence, and the entire reason this rule is first-time-only.
  it('returns null once the garment is AT the laundry, whatever the stored days say', () => {
    expect(resolveInitialCleaningBlockDays({ initialCleaningDays: 5, onLaundry: true })).toBeNull();
  });

  it('still applies while the garment is with its owner', () => {
    expect(resolveInitialCleaningBlockDays({ initialCleaningDays: 5, onLaundry: false })).toBe(5);
    expect(resolveInitialCleaningBlockDays({ initialCleaningDays: 5 })).toBe(5);
  });

  // Only a real boolean is custody. `if (onLaundry)` would switch the rule off for
  // any truthy junk - the same trap evaluateLaundryAssignment documents.
  it.each([['the string "true"', 'true'], ['1', 1], ['an object', {}], ['null', null]])(
    'does not treat %s as "at the laundry"',
    (_label, onLaundry) => {
      expect(resolveInitialCleaningBlockDays({ initialCleaningDays: 4, onLaundry })).toBe(4);
    }
  );

  // No migration exists and none is needed: per the client, "en producción
  // iniciaremos limpio". A listing assigned before this field existed simply has no
  // block, which is exactly the pre-change behaviour.
  it('treats an ABSENT field as no block', () => {
    expect(resolveInitialCleaningBlockDays({})).toBeNull();
    expect(resolveInitialCleaningBlockDays(undefined)).toBeNull();
    expect(resolveInitialCleaningBlockDays({ onLaundry: false })).toBeNull();
  });

  // A malformed value must not be able to take a listing off the market: this runs
  // on the checkout path, and "unbookable forever, no error anywhere" is the worst
  // outcome available.
  it.each([[null], [0], [-3], [2.5], ['2.5'], ['abc'], ['5 days'], [{}], [[]], [NaN], [true]])(
    'treats the unusable value %p as no block',
    initialCleaningDays => {
      expect(resolveInitialCleaningBlockDays({ initialCleaningDays })).toBeNull();
    }
  );

  it('clamps an absurd value instead of blocking the listing for a decade', () => {
    // The stored number is server-written, but it DERIVES from a figure a laundry
    // types into its own profile.
    expect(resolveInitialCleaningBlockDays({ initialCleaningDays: 4000 })).toBe(
      MAX_INITIAL_CLEANING_DAYS
    );
    expect(MAX_INITIAL_CLEANING_DAYS).toBe(365);
  });
});

describe('earliestBookingStart', () => {
  it('is start of day in the listing time zone plus n days, not now + n*24h', () => {
    // 09:30 UTC on the 10th. A 2-day lead time means the 12th at 00:00, not the 12th
    // at 09:30 - the hour the customer happens to be shopping must not move the floor.
    expect(
      earliestBookingStart({ initialCleaningDays: 2, timeZone: 'Etc/UTC', now: NOW }).toISOString()
    ).toBe('2026-08-12T00:00:00.000Z');
  });

  it('counts days in the listing time zone, not UTC', () => {
    // 09:30 UTC on the 10th is 03:30 on the 10th in Mexico City, so +2 days is the
    // 12th LOCAL there - which is 06:00 UTC.
    expect(
      earliestBookingStart({
        initialCleaningDays: 2,
        timeZone: 'America/Mexico_City',
        now: NOW,
      }).toISOString()
    ).toBe('2026-08-12T06:00:00.000Z');
  });

  it('does not lose a day in a zone that changes DST at midnight', () => {
    // Atlantic/Azores has no 00:00 going into the 30th of March. A naive
    // startOf('day').add(1, 'day').startOf('day') lands back on the 29th there.
    expect(
      earliestBookingStart({
        initialCleaningDays: 1,
        timeZone: 'Atlantic/Azores',
        now: new Date('2026-03-29T12:00:00.000Z'),
      }).toISOString()
    ).toBe('2026-03-30T00:00:00.000Z');
  });

  it('falls back to UTC for a missing or unknown time zone', () => {
    // The server's own TZ is an accident of deployment and must never decide this.
    expect(earliestBookingStart({ initialCleaningDays: 1, now: NOW }).toISOString()).toBe(
      '2026-08-11T00:00:00.000Z'
    );
    expect(
      earliestBookingStart({
        initialCleaningDays: 1,
        timeZone: 'Not/AZone',
        now: NOW,
      }).toISOString()
    ).toBe('2026-08-11T00:00:00.000Z');
  });
});

describe('assertInitialCleaningLeadTime', () => {
  const assertAt = (listingEntity, isoDay) =>
    assertInitialCleaningLeadTime({
      listing: listingEntity,
      bookingStart: new Date(`${isoDay}T00:00:00.000Z`),
      now: NOW,
    });

  // NOW is the 10th, so a 3-day turnaround makes the 13th the first bookable day.
  it('REFUSES tomorrow - the bug this exists to fix', () => {
    expect(() => assertAt(cleaningListing({ initialCleaningDays: 3 }), '2026-08-11')).toThrow(
      /initial cleaning/i
    );
  });

  it('refuses the last day inside the window', () => {
    expect(() => assertAt(cleaningListing({ initialCleaningDays: 3 }), '2026-08-12')).toThrow();
  });

  it('refuses today, and any date in the past', () => {
    expect(() => assertAt(cleaningListing({ initialCleaningDays: 3 }), '2026-08-10')).toThrow();
    expect(() => assertAt(cleaningListing({ initialCleaningDays: 3 }), '2026-08-01')).toThrow();
  });

  // THE BOUNDARY. `initialCleaningDays` counts days of cleaning, so day + n is the
  // first day the garment is READY, not the last day it is not. Off by one here
  // costs the owner a day on every new garment and reads as a broken calendar.
  it('ALLOWS a booking starting exactly on the boundary day', () => {
    expect(() => assertAt(cleaningListing({ initialCleaningDays: 3 }), '2026-08-13')).not.toThrow();
  });

  it('allows a booking well after the window', () => {
    expect(() => assertAt(cleaningListing({ initialCleaningDays: 3 }), '2026-09-01')).not.toThrow();
  });

  it('allows tomorrow for a 1-day turnaround, which is the tightest boundary', () => {
    expect(() => assertAt(cleaningListing({ initialCleaningDays: 1 }), '2026-08-11')).not.toThrow();
    expect(() => assertAt(cleaningListing({ initialCleaningDays: 1 }), '2026-08-10')).toThrow();
  });

  // The client's own carve-out, and the half of this rule easiest to break by
  // accident: everything above must stop applying the moment a studio has the garment.
  it('changes NOTHING when onLaundry === true', () => {
    const atLaundry = cleaningListing({ initialCleaningDays: 30, onLaundry: true });
    ['2026-08-10', '2026-08-11', '2026-08-12', '2026-09-01'].forEach(isoDay => {
      expect(() => assertAt(atLaundry, isoDay)).not.toThrow();
    });
  });

  it('does nothing for a listing with no stored turnaround', () => {
    expect(() => assertAt(cleaningListing(), '2026-08-11')).not.toThrow();
    expect(() => assertAt(cleaningListing({ onLaundry: false }), '2026-08-11')).not.toThrow();
  });

  it.each([[2.5], ['abc'], [0], [-1], [{}]])(
    'does nothing for the malformed stored value %p',
    initialCleaningDays => {
      expect(() => assertAt(cleaningListing({ initialCleaningDays }), '2026-08-11')).not.toThrow();
    }
  );

  it('carries its OWN machine-readable code, distinct from the too-short refusal', () => {
    try {
      assertAt(cleaningListing({ initialCleaningDays: 3 }), '2026-08-11');
      throw new Error('expected a rejection');
    } catch (e) {
      expect(e.status).toBe(400);
      expect(e.data).toEqual({
        code: 'booking-before-initial-cleaning',
        initialCleaningDays: 3,
        earliestBookingStart: '2026-08-13T00:00:00.000Z',
      });
    }
  });

  it('compares whole days, so a few hours of drift cannot flip the answer', () => {
    // The boundary day, requested late in that day and in its small hours. Both are
    // the same DAY and must both be allowed.
    const boundaryListing = cleaningListing({ initialCleaningDays: 3 });
    expect(() =>
      assertInitialCleaningLeadTime({
        listing: boundaryListing,
        bookingStart: new Date('2026-08-13T23:59:00.000Z'),
        now: NOW,
      })
    ).not.toThrow();
    // ...and the hour NOW happens to be must not matter either.
    expect(() =>
      assertInitialCleaningLeadTime({
        listing: boundaryListing,
        bookingStart: new Date('2026-08-13T00:00:00.000Z'),
        now: new Date('2026-08-10T23:59:00.000Z'),
      })
    ).not.toThrow();
  });

  it('resolves the boundary in the listing time zone', () => {
    // Mexico City is UTC-6 in August, so midnight on the 13th LOCAL is 06:00 UTC and
    // 2026-08-13T00:00Z is still the 12th there. The same instant that a UTC listing
    // accepts must therefore be refused here.
    const tzListing = cleaningListing({ initialCleaningDays: 3, timeZone: 'America/Mexico_City' });
    expect(() =>
      assertInitialCleaningLeadTime({
        listing: tzListing,
        bookingStart: new Date('2026-08-13T00:00:00.000Z'),
        now: NOW,
      })
    ).toThrow();
    expect(() =>
      assertInitialCleaningLeadTime({
        listing: tzListing,
        bookingStart: new Date('2026-08-13T06:00:00.000Z'),
        now: NOW,
      })
    ).not.toThrow();
  });

  it('accepts an ISO string bookingStart as well as a Date', () => {
    expect(() =>
      assertInitialCleaningLeadTime({
        listing: cleaningListing({ initialCleaningDays: 3 }),
        bookingStart: '2026-08-11T00:00:00.000Z',
        now: NOW,
      })
    ).toThrow(/initial cleaning/i);
  });

  // Somebody else's complaint. Relabelling it would tell the customer to wait a few
  // days for what is actually a missing parameter.
  it('stays silent on a missing or unparseable bookingStart', () => {
    const silentListing = cleaningListing({ initialCleaningDays: 3 });
    expect(() => assertInitialCleaningLeadTime({ listing: silentListing, now: NOW })).not.toThrow();
    expect(() =>
      assertInitialCleaningLeadTime({ listing: silentListing, bookingStart: 'nope', now: NOW })
    ).not.toThrow();
  });

  // Unlike the minimum-length rule, this one is NOT restricted to day-unit listings:
  // it is a fact about where the garment physically is, not a comparison of two day
  // counts.
  it('applies regardless of unitType', () => {
    const hourly = cleaningListing({ initialCleaningDays: 3 });
    hourly.attributes.publicData.unitType = 'hour';
    expect(() => assertAt(hourly, '2026-08-11')).toThrow();
  });

  it('does not fall over on a listing with no availabilityPlan', () => {
    const noPlan = cleaningListing({ initialCleaningDays: 3 });
    delete noPlan.attributes.availabilityPlan;
    expect(() => assertAt(noPlan, '2026-08-11')).toThrow();
    expect(() => assertAt(noPlan, '2026-08-13')).not.toThrow();
  });
});
