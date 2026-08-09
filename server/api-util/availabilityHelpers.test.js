const {
  HARDCODED_DEFAULT_BUFFER_HOURS,
  subtractBlockedRanges,
  findBookableOverlaps,
  computeBufferDays,
  addDays,
  floorToUtcDay,
  ceilToUtcDay,
  computeAvailabilityBufferWindow,
  resolveTurnaroundHours,
} = require('./availabilityHelpers');

describe('computeBufferDays()', () => {
  it('splits an evenly-divisible turnaround exactly in half', () => {
    // 48h = 2 days total -> 1 before, 1 after
    expect(computeBufferDays(48)).toEqual({
      totalBufferDays: 2,
      bufferBeforeDays: 1,
      bufferAfterDays: 1,
    });
  });

  it('rounds a partial day UP before splitting (never under-blocks)', () => {
    // 25h -> ceil(25/24) = 2 days total -> 1 before, 1 after
    expect(computeBufferDays(25)).toEqual({
      totalBufferDays: 2,
      bufferBeforeDays: 1,
      bufferAfterDays: 1,
    });
  });

  it('gives the extra day to the AFTER side on an odd total', () => {
    // 72h = 3 days total -> odd split: 1 before, 2 after
    expect(computeBufferDays(72)).toEqual({
      totalBufferDays: 3,
      bufferBeforeDays: 1,
      bufferAfterDays: 2,
    });
  });

  it('handles turnaround under 24h as a single buffer day, all after', () => {
    // 5h -> ceil(5/24) = 1 day total -> 0 before, 1 after
    expect(computeBufferDays(5)).toEqual({
      totalBufferDays: 1,
      bufferBeforeDays: 0,
      bufferAfterDays: 1,
    });
  });

  it('handles an exact single day with no remainder', () => {
    // 24h -> 1 day total -> 0 before, 1 after
    expect(computeBufferDays(24)).toEqual({
      totalBufferDays: 1,
      bufferBeforeDays: 0,
      bufferAfterDays: 1,
    });
  });

  it('handles a large turnaround (e.g. a week)', () => {
    // 168h = 7 days total -> 3 before, 4 after
    expect(computeBufferDays(168)).toEqual({
      totalBufferDays: 7,
      bufferBeforeDays: 3,
      bufferAfterDays: 4,
    });
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
  it('computes buffer-before + rental dates + buffer-after around a booking (48h turnaround)', () => {
    const bookingStart = new Date('2026-08-10T00:00:00.000Z');
    const bookingEnd = new Date('2026-08-13T00:00:00.000Z'); // 3-day rental, exclusive end

    const result = computeAvailabilityBufferWindow(bookingStart, bookingEnd, 48);

    expect(result).toEqual({
      start: new Date('2026-08-09T00:00:00.000Z'), // 1 day before
      end: new Date('2026-08-14T00:00:00.000Z'), // 1 day after
      bufferBeforeDays: 1,
      bufferAfterDays: 1,
      totalBufferDays: 2,
    });
  });

  it('matches the design doc "2 before / N rental / 2 after" shape at 96h turnaround', () => {
    const bookingStart = new Date('2026-08-10T00:00:00.000Z');
    const bookingEnd = new Date('2026-08-13T00:00:00.000Z');

    const result = computeAvailabilityBufferWindow(bookingStart, bookingEnd, 96);

    expect(result.bufferBeforeDays).toBe(2);
    expect(result.bufferAfterDays).toBe(2);
    expect(result.start).toEqual(new Date('2026-08-08T00:00:00.000Z'));
    expect(result.end).toEqual(new Date('2026-08-15T00:00:00.000Z'));
  });

  it('handles a single-day rental with a sub-24h turnaround', () => {
    const bookingStart = new Date('2026-08-10T00:00:00.000Z');
    const bookingEnd = new Date('2026-08-11T00:00:00.000Z');

    const result = computeAvailabilityBufferWindow(bookingStart, bookingEnd, 10);

    expect(result.bufferBeforeDays).toBe(0);
    expect(result.bufferAfterDays).toBe(1);
    expect(result.start).toEqual(bookingStart); // no before-buffer, window starts at rental start
    expect(result.end).toEqual(new Date('2026-08-12T00:00:00.000Z'));
  });

  it('throws on invalid dates instead of silently producing NaN dates', () => {
    expect(() => computeAvailabilityBufferWindow(new Date('invalid'), new Date(), 48)).toThrow();
    expect(() => computeAvailabilityBufferWindow(new Date(), new Date('invalid'), 48)).toThrow();
    expect(() => computeAvailabilityBufferWindow(null, new Date(), 48)).toThrow();
  });
});

describe('resolveTurnaroundHours()', () => {
  it('prefers the laundry-set turnaround hours when present and valid', () => {
    expect(resolveTurnaroundHours(36, '48')).toBe(36);
  });

  it('falls back to the env default when the laundry has not set turnaround', () => {
    expect(resolveTurnaroundHours(undefined, '72')).toBe(72);
    expect(resolveTurnaroundHours(null, '72')).toBe(72);
  });

  it('falls back to the hardcoded default when neither is set', () => {
    expect(resolveTurnaroundHours(undefined, undefined)).toBe(HARDCODED_DEFAULT_BUFFER_HOURS);
  });

  it('falls back to the hardcoded default when the env value is not a usable number', () => {
    expect(resolveTurnaroundHours(undefined, 'not-a-number')).toBe(HARDCODED_DEFAULT_BUFFER_HOURS);
    expect(resolveTurnaroundHours(undefined, '0')).toBe(HARDCODED_DEFAULT_BUFFER_HOURS);
    expect(resolveTurnaroundHours(undefined, '-5')).toBe(HARDCODED_DEFAULT_BUFFER_HOURS);
  });

  it('ignores an invalid laundry turnaround value and falls through the chain', () => {
    expect(resolveTurnaroundHours(0, '72')).toBe(72);
    expect(resolveTurnaroundHours(-1, undefined)).toBe(HARDCODED_DEFAULT_BUFFER_HOURS);
    expect(resolveTurnaroundHours(NaN, undefined)).toBe(HARDCODED_DEFAULT_BUFFER_HOURS);
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
