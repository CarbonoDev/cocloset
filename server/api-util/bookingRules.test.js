const {
  MAX_INITIAL_CLEANING_DAYS,
  resolveInitialCleaningBlockDays,
  earliestBookingStart,
  assertInitialCleaningLeadTime,
} = require('./bookingRules');

// This module is the ONLY thing standing between a posted booking and a charge that
// ignores the garment's initial cleaning lead time: the calendar's refusal is UX, and
// Sharetribe does not model it at all. So every test here asserts a denial as well as an
// acceptance - a rule that only ever says yes is indistinguishable from no rule.

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

  // The LIVE value, resolved from the laundry's current profile at request time (see
  // api-util/liveInitialCleaning.js). The stored `metadata.initialCleaningDays` is only a
  // snapshot from the day the laundry was assigned, and the client asked for the studio's
  // current turnaround to be honoured on garments already assigned to it.
  describe('the live turnaround takes precedence over the stored snapshot', () => {
    it('uses the live value when there is one', () => {
      expect(resolveInitialCleaningBlockDays({ initialCleaningDays: 2 }, 5)).toBe(5);
    });

    it('uses the live value even when it is SHORTER than the snapshot', () => {
      // A studio that has got faster must free up the days it no longer needs, or the
      // owner loses availability the laundry is not asking for.
      expect(resolveInitialCleaningBlockDays({ initialCleaningDays: 7 }, 2)).toBe(2);
    });

    it('applies with no snapshot at all', () => {
      // Every listing assigned before `initialCleaningDays` existed has no snapshot. The
      // live lookup is what gives those a correct floor for the first time.
      expect(resolveInitialCleaningBlockDays({}, 3)).toBe(3);
    });

    it('clamps the live value too', () => {
      expect(resolveInitialCleaningBlockDays({ initialCleaningDays: 2 }, 4000)).toBe(
        MAX_INITIAL_CLEANING_DAYS
      );
    });

    // THE FAILURE DIRECTION THAT MATTERS. Null is what the resolver returns for a deleted
    // laundry, an Integration API outage, an unreadable profile. Falling back to "no
    // block" would let a transient read error open the gate on a garment that has never
    // left its owner's wardrobe. Stale is survivable; open is not.
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['0', 0],
      ['-1', -1],
      ['2.5', 2.5],
      ['garbage', 'nope'],
      ['an object', {}],
    ])(
      'falls back to the SNAPSHOT, not to "no block", when the live value is %s',
      (_label, live) => {
        expect(resolveInitialCleaningBlockDays({ initialCleaningDays: 4 }, live)).toBe(4);
      }
    );

    it('still means no block when neither the live value nor the snapshot is usable', () => {
      expect(resolveInitialCleaningBlockDays({}, null)).toBeNull();
      expect(resolveInitialCleaningBlockDays({ initialCleaningDays: 0 }, 0)).toBeNull();
    });

    // `onLaundry` is checked FIRST, before the live value is even looked at. It is the one
    // condition that retires this rule, and a live turnaround must not resurrect it: a
    // garment in the studio's hands is available tomorrow no matter how slow the studio is.
    it('is still switched off entirely by onLaundry === true', () => {
      expect(resolveInitialCleaningBlockDays({ onLaundry: true }, 9)).toBeNull();
      expect(
        resolveInitialCleaningBlockDays({ onLaundry: true, initialCleaningDays: 3 }, 9)
      ).toBeNull();
    });

    it('accepts a live value that arrives as a numeric string', () => {
      expect(resolveInitialCleaningBlockDays({ initialCleaningDays: 2 }, '5')).toBe(5);
    });
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

  // The gate reading the laundry's LIVE turnaround rather than only the snapshot. This is
  // what keeps it in step with the calendar, which now does the same - a gate on the stale
  // number would refuse a date the calendar had just offered.
  describe('with a live turnaround supplied', () => {
    const assertLive = (listingEntity, isoDay, liveInitialCleaningDays) =>
      assertInitialCleaningLeadTime({
        listing: listingEntity,
        bookingStart: new Date(`${isoDay}T00:00:00.000Z`),
        now: NOW,
        liveInitialCleaningDays,
      });

    it('refuses a day the SNAPSHOT would have allowed', () => {
      // Snapshot 1 day (floor = the 11th), studio now needs 5 (floor = the 15th).
      const listingEntity = cleaningListing({ initialCleaningDays: 1 });
      expect(() => assertLive(listingEntity, '2026-08-11', 5)).toThrow(/initial cleaning/i);
      expect(() => assertLive(listingEntity, '2026-08-15', 5)).not.toThrow();
    });

    it('allows a day the SNAPSHOT would have refused', () => {
      // Snapshot 7 days (floor = the 17th), studio now needs 2 (floor = the 12th).
      const listingEntity = cleaningListing({ initialCleaningDays: 7 });
      expect(() => assertLive(listingEntity, '2026-08-12', 2)).not.toThrow();
    });

    it('reports the live number in the error, not the stale one', () => {
      try {
        assertLive(cleaningListing({ initialCleaningDays: 1 }), '2026-08-11', 5);
        throw new Error('expected a rejection');
      } catch (e) {
        expect(e.data.initialCleaningDays).toBe(5);
        expect(e.data.earliestBookingStart).toBe('2026-08-15T00:00:00.000Z');
      }
    });

    it('falls back to the snapshot when the live resolution failed', () => {
      // null is what api-util/liveInitialCleaning.js returns for every failure it has.
      const listingEntity = cleaningListing({ initialCleaningDays: 3 });
      expect(() => assertLive(listingEntity, '2026-08-11', null)).toThrow(/initial cleaning/i);
      expect(() => assertLive(listingEntity, '2026-08-13', null)).not.toThrow();
    });

    it('is unchanged for every existing caller that passes no live value', () => {
      const listingEntity = cleaningListing({ initialCleaningDays: 3 });
      expect(() =>
        assertInitialCleaningLeadTime({
          listing: listingEntity,
          bookingStart: new Date('2026-08-11T00:00:00.000Z'),
          now: NOW,
        })
      ).toThrow(/initial cleaning/i);
    });

    it('still allows everything once the garment is at its laundry', () => {
      const atLaundry = cleaningListing({ initialCleaningDays: 3, onLaundry: true });
      expect(() => assertLive(atLaundry, '2026-08-10', 30)).not.toThrow();
    });
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
