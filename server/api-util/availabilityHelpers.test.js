const {
  HARDCODED_DEFAULT_BUFFER_HOURS,
  computeBufferDays,
  addDays,
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
