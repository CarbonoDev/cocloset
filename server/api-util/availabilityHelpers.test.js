const {
  HARDCODED_DEFAULT_BUFFER_DAYS,
  subtractBlockedRanges,
  findBookableOverlaps,
  computeBufferDays,
  addDays,
  floorToUtcDay,
  ceilToUtcDay,
  computeAvailabilityBufferWindow,
  resolveTurnaroundDays,
} = require('./availabilityHelpers');

describe('computeBufferDays()', () => {
  // The input is DAYS. It used to be hours divided by 24 here; the unit moved to days
  // end to end, so these are the same windows stated in the unit the studio types.
  // THE WHOLE TURNAROUND GOES AFTER THE BOOKING. It used to be split down the middle, on
  // the reasoning that the before-half covered collecting the garment from its owner. A
  // Cocloset garment lives at the studio, so there is nothing to arrange before a booking -
  // and cleaning happens after the garment comes BACK, so every day spent on the before-side
  // was a day NOT blocked on the side that needs it. The client reported exactly that: the
  // garment became bookable again before it had been cleaned.
  it('puts the whole turnaround after the booking, never before it', () => {
    expect(computeBufferDays(2)).toEqual({
      totalBufferDays: 2,
      bufferBeforeDays: 0,
      bufferAfterDays: 2,
    });
    expect(computeBufferDays(3)).toEqual({
      totalBufferDays: 3,
      bufferBeforeDays: 0,
      bufferAfterDays: 3,
    });
  });

  it('rounds a fractional day UP (never under-blocks)', () => {
    // Only an env var or a hand-written profile can produce a fraction; the form takes
    // integers.
    expect(computeBufferDays(1.1)).toEqual({
      totalBufferDays: 2,
      bufferBeforeDays: 0,
      bufferAfterDays: 2,
    });
  });

  // The case that used to vanish entirely: a 1-day turnaround split as 0 before / 1 after
  // was the ONLY value that happened to be right. Restated here as the general rule.
  it('blocks a one-day turnaround for the full day after the booking', () => {
    expect(computeBufferDays(1)).toEqual({
      totalBufferDays: 1,
      bufferBeforeDays: 0,
      bufferAfterDays: 1,
    });
  });

  it('handles a single-day turnaround as one buffer day, all after', () => {
    expect(computeBufferDays(1)).toEqual({
      totalBufferDays: 1,
      bufferBeforeDays: 0,
      bufferAfterDays: 1,
    });
  });

  it('rounds a sub-one-day turnaround up to a whole day', () => {
    // 0.5 days -> 1 day total. A day-granular calendar cannot express less.
    expect(computeBufferDays(0.5)).toEqual({
      totalBufferDays: 1,
      bufferBeforeDays: 0,
      bufferAfterDays: 1,
    });
  });

  it('handles a large turnaround (e.g. a week)', () => {
    expect(computeBufferDays(7)).toEqual({
      totalBufferDays: 7,
      bufferBeforeDays: 0,
      bufferAfterDays: 7,
    });
  });

  it('does NOT treat its input as hours', () => {
    // The regression guard for the rename: 48 means 48 DAYS now. If anything divides by
    // 24 again, this returns 2 and a studio's calendar is blocked for a tenth of the
    // time it asked for.
    expect(computeBufferDays(48).totalBufferDays).toBe(48);
  });

  it('throws on non-positive or non-finite input rather than silently blocking nothing', () => {
    expect(() => computeBufferDays(0)).toThrow();
    expect(() => computeBufferDays(-10)).toThrow();
    expect(() => computeBufferDays(NaN)).toThrow();
    expect(() => computeBufferDays(undefined)).toThrow();
  });
});

describe('addDays()', () => {
  it('adds whole days using UTC day boundaries', () => {
    const date = new Date('2026-08-10T00:00:00.000Z');
    expect(addDays(date, 2).toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });

  it('subtracts days when given a negative count', () => {
    const date = new Date('2026-08-10T00:00:00.000Z');
    expect(addDays(date, -3).toISOString()).toBe('2026-08-07T00:00:00.000Z');
  });

  it('rolls over month boundaries correctly', () => {
    const date = new Date('2026-08-31T00:00:00.000Z');
    expect(addDays(date, 1).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('rolls over year boundaries correctly', () => {
    const date = new Date('2026-12-31T00:00:00.000Z');
    expect(addDays(date, 1).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('does not mutate the input date', () => {
    const date = new Date('2026-08-10T00:00:00.000Z');
    addDays(date, 5);
    expect(date.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });
});

describe('floorToUtcDay() / ceilToUtcDay()', () => {
  it('floors a mid-day timestamp to that UTC midnight', () => {
    expect(floorToUtcDay(new Date('2026-08-08T14:37:12.345Z')).toISOString()).toBe(
      '2026-08-08T00:00:00.000Z'
    );
  });

  it('leaves a timestamp already at UTC midnight alone, both ways', () => {
    // The reason ceilToUtcDay is a ceiling rather than floor + 1: rounding an
    // exact boundary up would over-block a full day every time a turnaround
    // divides cleanly.
    const midnight = new Date('2026-08-08T00:00:00.000Z');
    expect(floorToUtcDay(midnight).toISOString()).toBe('2026-08-08T00:00:00.000Z');
    expect(ceilToUtcDay(midnight).toISOString()).toBe('2026-08-08T00:00:00.000Z');
  });

  it('ceils a mid-day timestamp to the NEXT UTC midnight', () => {
    expect(ceilToUtcDay(new Date('2026-08-08T00:00:00.001Z')).toISOString()).toBe(
      '2026-08-09T00:00:00.000Z'
    );
    expect(ceilToUtcDay(new Date('2026-08-08T23:59:59.999Z')).toISOString()).toBe(
      '2026-08-09T00:00:00.000Z'
    );
  });

  it('does not shift across a local DST boundary', () => {
    // Europe/Madrid springs forward on 2026-03-29. Using local date fields here
    // would move the boundary by an hour and mis-snap the window.
    expect(floorToUtcDay(new Date('2026-03-29T00:30:00.000Z')).toISOString()).toBe(
      '2026-03-29T00:00:00.000Z'
    );
    expect(ceilToUtcDay(new Date('2026-03-29T00:30:00.000Z')).toISOString()).toBe(
      '2026-03-30T00:00:00.000Z'
    );
  });
});

describe('computeAvailabilityBufferWindow()', () => {
  it('blocks the rental dates plus the whole turnaround after them', () => {
    const bookingStart = new Date('2026-08-10T00:00:00.000Z');
    const bookingEnd = new Date('2026-08-13T00:00:00.000Z'); // 3-day rental, exclusive end

    const result = computeAvailabilityBufferWindow(bookingStart, bookingEnd, 2);

    expect(result).toEqual({
      // The window opens ON the rental, not before it: the garment is already at the studio.
      start: new Date('2026-08-10T00:00:00.000Z'),
      end: new Date('2026-08-15T00:00:00.000Z'), // 2 cleaning days after the rental ends
      bufferBeforeDays: 0,
      bufferAfterDays: 2,
      totalBufferDays: 2,
    });
  });

  // THE REGRESSION THE CLIENT REPORTED. A 4-day turnaround used to block 2 days before the
  // rental and 2 after, so the garment came back on the market two days before it had been
  // cleaned. Every day on the before-side was a day missing from the side that needs it.
  it('gives the full turnaround to the after-side, not half of it', () => {
    const bookingStart = new Date('2026-08-10T00:00:00.000Z');
    const bookingEnd = new Date('2026-08-13T00:00:00.000Z');

    const result = computeAvailabilityBufferWindow(bookingStart, bookingEnd, 4);

    expect(result.bufferBeforeDays).toBe(0);
    expect(result.bufferAfterDays).toBe(4);
    expect(result.start).toEqual(bookingStart);
    expect(result.end).toEqual(new Date('2026-08-17T00:00:00.000Z'));
  });

  // The window the buffer blocks must be the window the booking calendar reserved before it
  // offered the start date, or the calendar promises one thing and the block does another.
  // See src/components/OrderPanel/BookingRentalPeriodForm.js `isWindowAvailableFn`.
  it('blocks exactly the window the booking calendar requires to be free', () => {
    const bookingStart = new Date('2026-08-10T00:00:00.000Z');
    const periodDays = 7;
    const cleaningDays = 3;
    const bookingEnd = new Date('2026-08-17T00:00:00.000Z'); // start + 7

    const result = computeAvailabilityBufferWindow(bookingStart, bookingEnd, cleaningDays);
    const calendarWindowEnd = new Date(
      bookingStart.getTime() + (periodDays + cleaningDays) * 24 * 60 * 60 * 1000
    );

    expect(result.start).toEqual(bookingStart);
    expect(result.end).toEqual(calendarWindowEnd);
  });

  it('handles a single-day rental with a one-day turnaround', () => {
    const bookingStart = new Date('2026-08-10T00:00:00.000Z');
    const bookingEnd = new Date('2026-08-11T00:00:00.000Z');

    const result = computeAvailabilityBufferWindow(bookingStart, bookingEnd, 1);

    expect(result.bufferBeforeDays).toBe(0);
    expect(result.bufferAfterDays).toBe(1);
    expect(result.start).toEqual(bookingStart); // no before-buffer, window starts at rental start
    expect(result.end).toEqual(new Date('2026-08-12T00:00:00.000Z'));
  });

  it('throws on invalid dates instead of silently producing NaN dates', () => {
    expect(() => computeAvailabilityBufferWindow(new Date('invalid'), new Date(), 2)).toThrow();
    expect(() => computeAvailabilityBufferWindow(new Date(), new Date('invalid'), 2)).toThrow();
    expect(() => computeAvailabilityBufferWindow(null, new Date(), 2)).toThrow();
  });
});

describe('resolveTurnaroundDays()', () => {
  it('prefers the laundry-set turnaround days when present and valid', () => {
    expect(resolveTurnaroundDays(3, '2')).toBe(3);
  });

  it('falls back to the env default when the laundry has not set turnaround', () => {
    expect(resolveTurnaroundDays(undefined, '4')).toBe(4);
    expect(resolveTurnaroundDays(null, '4')).toBe(4);
  });

  it('falls back to the hardcoded default when neither is set', () => {
    expect(resolveTurnaroundDays(undefined, undefined)).toBe(HARDCODED_DEFAULT_BUFFER_DAYS);
  });

  it('defaults to 2 days, which is what the old 48-hour default worked out to', () => {
    // The unit changed; the behaviour deliberately did not.
    expect(HARDCODED_DEFAULT_BUFFER_DAYS).toBe(2);
  });

  it('falls back to the hardcoded default when the env value is not a usable number', () => {
    expect(resolveTurnaroundDays(undefined, 'not-a-number')).toBe(HARDCODED_DEFAULT_BUFFER_DAYS);
    expect(resolveTurnaroundDays(undefined, '0')).toBe(HARDCODED_DEFAULT_BUFFER_DAYS);
    expect(resolveTurnaroundDays(undefined, '-5')).toBe(HARDCODED_DEFAULT_BUFFER_DAYS);
  });

  it('ignores an invalid laundry turnaround value and falls through the chain', () => {
    expect(resolveTurnaroundDays(0, '4')).toBe(4);
    expect(resolveTurnaroundDays(-1, undefined)).toBe(HARDCODED_DEFAULT_BUFFER_DAYS);
    expect(resolveTurnaroundDays(NaN, undefined)).toBe(HARDCODED_DEFAULT_BUFFER_DAYS);
  });
});

describe('subtractBlockedRanges()', () => {
  const d = iso => new Date(iso);
  // Compact assertion helper: compare as ISO strings so failures are readable.
  const iso = ranges => ranges.map(r => [r.start.toISOString(), r.end.toISOString()]);

  const window = { start: d('2026-03-10T00:00:00.000Z'), end: d('2026-03-20T00:00:00.000Z') };

  it('returns the whole window when nothing is blocked yet', () => {
    expect(iso(subtractBlockedRanges(window, []))).toEqual([
      ['2026-03-10T00:00:00.000Z', '2026-03-20T00:00:00.000Z'],
    ]);
  });

  it('treats a missing/garbage existing list as "nothing blocked"', () => {
    expect(iso(subtractBlockedRanges(window, undefined))).toHaveLength(1);
    expect(iso(subtractBlockedRanges(window, null))).toHaveLength(1);
  });

  it('returns nothing when an existing exception fully covers the window', () => {
    const existing = [{ start: d('2026-03-01T00:00:00.000Z'), end: d('2026-04-01T00:00:00.000Z') }];
    expect(subtractBlockedRanges(window, existing)).toEqual([]);
  });

  it('returns nothing when an existing exception matches the window exactly', () => {
    expect(subtractBlockedRanges(window, [{ ...window }])).toEqual([]);
  });

  // The multi-segment case: an owner-blocked week in the middle of the buffer.
  it('splits the window into two segments around a block in the middle', () => {
    const existing = [{ start: d('2026-03-13T00:00:00.000Z'), end: d('2026-03-16T00:00:00.000Z') }];
    expect(iso(subtractBlockedRanges(window, existing))).toEqual([
      ['2026-03-10T00:00:00.000Z', '2026-03-13T00:00:00.000Z'],
      ['2026-03-16T00:00:00.000Z', '2026-03-20T00:00:00.000Z'],
    ]);
  });

  it('trims the leading edge when an existing block overlaps the start', () => {
    const existing = [{ start: d('2026-03-05T00:00:00.000Z'), end: d('2026-03-12T00:00:00.000Z') }];
    expect(iso(subtractBlockedRanges(window, existing))).toEqual([
      ['2026-03-12T00:00:00.000Z', '2026-03-20T00:00:00.000Z'],
    ]);
  });

  it('trims the trailing edge when an existing block overlaps the end', () => {
    const existing = [{ start: d('2026-03-18T00:00:00.000Z'), end: d('2026-03-25T00:00:00.000Z') }];
    expect(iso(subtractBlockedRanges(window, existing))).toEqual([
      ['2026-03-10T00:00:00.000Z', '2026-03-18T00:00:00.000Z'],
    ]);
  });

  it('handles several disjoint blocks, producing several segments', () => {
    const existing = [
      { start: d('2026-03-12T00:00:00.000Z'), end: d('2026-03-13T00:00:00.000Z') },
      { start: d('2026-03-16T00:00:00.000Z'), end: d('2026-03-17T00:00:00.000Z') },
    ];
    expect(iso(subtractBlockedRanges(window, existing))).toEqual([
      ['2026-03-10T00:00:00.000Z', '2026-03-12T00:00:00.000Z'],
      ['2026-03-13T00:00:00.000Z', '2026-03-16T00:00:00.000Z'],
      ['2026-03-17T00:00:00.000Z', '2026-03-20T00:00:00.000Z'],
    ]);
  });

  it('is order-independent (unsorted input gives the same segments)', () => {
    const existing = [
      { start: d('2026-03-16T00:00:00.000Z'), end: d('2026-03-17T00:00:00.000Z') },
      { start: d('2026-03-12T00:00:00.000Z'), end: d('2026-03-13T00:00:00.000Z') },
    ];
    expect(iso(subtractBlockedRanges(window, existing))).toEqual([
      ['2026-03-10T00:00:00.000Z', '2026-03-12T00:00:00.000Z'],
      ['2026-03-13T00:00:00.000Z', '2026-03-16T00:00:00.000Z'],
      ['2026-03-17T00:00:00.000Z', '2026-03-20T00:00:00.000Z'],
    ]);
  });

  it('merges overlapping existing blocks rather than double-counting them', () => {
    const existing = [
      { start: d('2026-03-12T00:00:00.000Z'), end: d('2026-03-15T00:00:00.000Z') },
      { start: d('2026-03-14T00:00:00.000Z'), end: d('2026-03-17T00:00:00.000Z') },
    ];
    expect(iso(subtractBlockedRanges(window, existing))).toEqual([
      ['2026-03-10T00:00:00.000Z', '2026-03-12T00:00:00.000Z'],
      ['2026-03-17T00:00:00.000Z', '2026-03-20T00:00:00.000Z'],
    ]);
  });

  it('merges touching blocks without emitting a zero-length gap', () => {
    // [12,14) and [14,16) are contiguous: the gap between them is empty and
    // must not be emitted (a zero-length exception would be rejected).
    const existing = [
      { start: d('2026-03-12T00:00:00.000Z'), end: d('2026-03-14T00:00:00.000Z') },
      { start: d('2026-03-14T00:00:00.000Z'), end: d('2026-03-16T00:00:00.000Z') },
    ];
    expect(iso(subtractBlockedRanges(window, existing))).toEqual([
      ['2026-03-10T00:00:00.000Z', '2026-03-12T00:00:00.000Z'],
      ['2026-03-16T00:00:00.000Z', '2026-03-20T00:00:00.000Z'],
    ]);
  });

  it('ignores blocks that merely abut the window (half-open ranges do not overlap)', () => {
    const existing = [
      { start: d('2026-03-01T00:00:00.000Z'), end: d('2026-03-10T00:00:00.000Z') },
      { start: d('2026-03-20T00:00:00.000Z'), end: d('2026-03-25T00:00:00.000Z') },
    ];
    expect(iso(subtractBlockedRanges(window, existing))).toEqual([
      ['2026-03-10T00:00:00.000Z', '2026-03-20T00:00:00.000Z'],
    ]);
  });

  it('ignores blocks entirely outside the window', () => {
    const existing = [
      { start: d('2026-01-01T00:00:00.000Z'), end: d('2026-01-05T00:00:00.000Z') },
      { start: d('2026-06-01T00:00:00.000Z'), end: d('2026-06-05T00:00:00.000Z') },
    ];
    expect(iso(subtractBlockedRanges(window, existing))).toEqual([
      ['2026-03-10T00:00:00.000Z', '2026-03-20T00:00:00.000Z'],
    ]);
  });

  it('accepts ISO strings as well as Dates (the API returns strings)', () => {
    const existing = [{ start: '2026-03-13T00:00:00.000Z', end: '2026-03-16T00:00:00.000Z' }];
    expect(iso(subtractBlockedRanges(window, existing))).toEqual([
      ['2026-03-10T00:00:00.000Z', '2026-03-13T00:00:00.000Z'],
      ['2026-03-16T00:00:00.000Z', '2026-03-20T00:00:00.000Z'],
    ]);
  });

  it('skips malformed or zero-length existing entries instead of throwing', () => {
    const existing = [
      { start: 'not-a-date', end: d('2026-03-16T00:00:00.000Z') },
      { start: d('2026-03-14T00:00:00.000Z'), end: d('2026-03-14T00:00:00.000Z') },
      null,
      {},
    ];
    expect(iso(subtractBlockedRanges(window, existing))).toEqual([
      ['2026-03-10T00:00:00.000Z', '2026-03-20T00:00:00.000Z'],
    ]);
  });

  it('preserves sub-day precision (windows are not silently rounded to days)', () => {
    const w = { start: d('2026-03-10T09:30:00.000Z'), end: d('2026-03-11T09:30:00.000Z') };
    const existing = [{ start: d('2026-03-10T12:00:00.000Z'), end: d('2026-03-10T18:00:00.000Z') }];
    expect(iso(subtractBlockedRanges(w, existing))).toEqual([
      ['2026-03-10T09:30:00.000Z', '2026-03-10T12:00:00.000Z'],
      ['2026-03-10T18:00:00.000Z', '2026-03-11T09:30:00.000Z'],
    ]);
  });

  it('throws on an invalid or inverted desired range', () => {
    expect(() => subtractBlockedRanges({ start: 'x', end: 'y' }, [])).toThrow(
      /valid start and end dates/
    );
    expect(() =>
      subtractBlockedRanges({ start: d('2026-03-20T00:00:00.000Z'), end: window.start }, [])
    ).toThrow(/end must be after start/);
    expect(() => subtractBlockedRanges({ start: window.start, end: window.start }, [])).toThrow(
      /end must be after start/
    );
  });
});

describe('findBookableOverlaps()', () => {
  const d = iso => new Date(iso);
  const window = { start: d('2026-03-10T00:00:00.000Z'), end: d('2026-03-20T00:00:00.000Z') };

  it('finds an overlapping exception that leaves the listing bookable', () => {
    const existing = [
      {
        id: 'blocking',
        start: d('2026-03-11T00:00:00.000Z'),
        end: d('2026-03-12T00:00:00.000Z'),
        seats: 0,
      },
      {
        id: 'bookable',
        start: d('2026-03-13T00:00:00.000Z'),
        end: d('2026-03-14T00:00:00.000Z'),
        seats: 3,
      },
    ];
    expect(findBookableOverlaps(window, existing).map(e => e.id)).toEqual(['bookable']);
  });

  it('ignores seats>0 exceptions outside the window', () => {
    const existing = [
      {
        id: 'far-away',
        start: d('2026-05-01T00:00:00.000Z'),
        end: d('2026-05-02T00:00:00.000Z'),
        seats: 5,
      },
    ];
    expect(findBookableOverlaps(window, existing)).toEqual([]);
  });

  it('returns an empty list when everything overlapping is seats: 0', () => {
    const existing = [
      { start: d('2026-03-11T00:00:00.000Z'), end: d('2026-03-15T00:00:00.000Z'), seats: 0 },
    ];
    expect(findBookableOverlaps(window, existing)).toEqual([]);
  });

  it('tolerates a missing existing list', () => {
    expect(findBookableOverlaps(window, undefined)).toEqual([]);
  });
});
