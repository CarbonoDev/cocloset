const {
  ABSOLUTE_MINIMUM_DAYS,
  HARDCODED_MAX_MINIMUM_DAYS,
  resolveMaxMinimumBookingDays,
  resolveMinimumBookingDays,
  assertMinimumBookingDays,
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
