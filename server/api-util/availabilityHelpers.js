const HOURS_IN_DAY = 24;

// Hardcoded last-resort fallback if neither the laundry's own privateData
// turnaround setting nor the DEFAULT_LAUNDRY_BUFFER_HOURS env var is set.
// See create-availability-buffer.js for where this is actually consulted.
const HARDCODED_DEFAULT_BUFFER_HOURS = 48;

/**
 * Split a total laundry-turnaround time (in hours) into "buffer-before" and
 * "buffer-after" day counts, to block on either side of a booking's rental
 * dates while the garment is picked up / cleaned / returned.
 *
 * Rounding rule (Phase 1 - deliberately simple, not spec'd exactly by the
 * design doc §5/§13, this is a judgment call):
 *   - totalBufferDays = ceil(turnaroundHours / 24). We always round UP so we
 *     never under-block - it's fine to hold a listing unavailable for an
 *     extra few hours, it is NOT fine to let a new booking start before the
 *     laundry has actually finished cleaning.
 *   - The total is then split as evenly as possible between "before" and
 *     "after". On an odd total, the extra day is assigned to the AFTER side:
 *     the before-buffer only covers pickup logistics (laundry hasn't
 *     received the garment yet), while the after-buffer is when the actual
 *     cleaning work happens once the garment is back - that's the side more
 *     likely to need the extra day if turnaround doesn't divide evenly.
 *
 * @param {number} turnaroundHours - total laundry turnaround time, in hours.
 *   Must be a positive finite number; callers are responsible for resolving
 *   fallbacks (laundry privateData -> env var -> hardcoded default) before
 *   calling this function - it does not apply any fallback itself.
 * @returns {{ totalBufferDays: number, bufferBeforeDays: number, bufferAfterDays: number }}
 */
const computeBufferDays = turnaroundHours => {
  if (!Number.isFinite(turnaroundHours) || turnaroundHours <= 0) {
    throw new Error(
      `computeBufferDays: turnaroundHours must be a positive finite number, got: ${turnaroundHours}`
    );
  }

  const totalBufferDays = Math.ceil(turnaroundHours / HOURS_IN_DAY);
  const bufferBeforeDays = Math.floor(totalBufferDays / 2);
  const bufferAfterDays = totalBufferDays - bufferBeforeDays;

  return { totalBufferDays, bufferBeforeDays, bufferAfterDays };
};

// Add (or subtract, with a negative `days`) whole days to a Date, using UTC
// date fields. Sharetribe daily bookings/exceptions use UTC day boundaries,
// so operating in UTC avoids DST-related off-by-one-hour shifts that
// `setDate` (local time) could introduce.
const addDays = (date, days) => {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
};

// Midnight (UTC) of the day a Date falls in, and the next midnight at or after
// it. Availability exceptions are arbitrary time ranges, but a DAY-unit listing
// is unbookable for any day an exception touches - so snapping a window outwards
// to whole UTC days is what makes "blocked until the garment is ready" mean the
// same thing to the calendar as it does to a human.
//
// The buffer window computed at `accept` never needed this: its inputs are
// booking dates, which Sharetribe already stores on UTC day boundaries for daily
// bookings. The window computed at a REAL return does: its input is the moment
// the laundry pressed the button, which is 14:37 on a Tuesday.
const floorToUtcDay = date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

// Ceiling, not "floor + 1": a timestamp already exactly at midnight is its own
// day boundary, and rounding it up would over-block by a full day every time a
// turnaround lands cleanly.
const ceilToUtcDay = date => {
  const floored = floorToUtcDay(date);
  return floored.getTime() === date.getTime() ? floored : addDays(floored, 1);
};

/**
 * Compute the full availability-exception window (buffer-before + the
 * booking's own rental dates + buffer-after) for a booking, given the
 * assigned laundry's turnaround time.
 *
 * `bookingStart`/`bookingEnd` should be the transaction's actual booking
 * dates as returned by the API (bookingEnd is exclusive, matching
 * Sharetribe's own convention for both bookings and availability
 * exceptions - see EditListingAvailabilityPanel.js's `attributes.end` doc).
 *
 * @param {Date} bookingStart
 * @param {Date} bookingEnd
 * @param {number} turnaroundHours - see computeBufferDays for fallback rules (resolved by caller)
 * @returns {{ start: Date, end: Date, bufferBeforeDays: number, bufferAfterDays: number, totalBufferDays: number }}
 */
const computeAvailabilityBufferWindow = (bookingStart, bookingEnd, turnaroundHours) => {
  if (!(bookingStart instanceof Date) || Number.isNaN(bookingStart.getTime())) {
    throw new Error('computeAvailabilityBufferWindow: bookingStart must be a valid Date');
  }
  if (!(bookingEnd instanceof Date) || Number.isNaN(bookingEnd.getTime())) {
    throw new Error('computeAvailabilityBufferWindow: bookingEnd must be a valid Date');
  }

  const { totalBufferDays, bufferBeforeDays, bufferAfterDays } = computeBufferDays(turnaroundHours);

  const start = addDays(bookingStart, -bufferBeforeDays);
  const end = addDays(bookingEnd, bufferAfterDays);

  return { start, end, bufferBeforeDays, bufferAfterDays, totalBufferDays };
};

// Resolve the turnaround hours to use for a given laundry, applying the
// fallback chain documented in create-availability-buffer.js: laundry's own
// privateData setting -> DEFAULT_LAUNDRY_BUFFER_HOURS env var -> hardcoded
// default. Never throws - always returns a usable positive number.
const resolveTurnaroundHours = (laundryTurnaroundHours, envDefaultBufferHours) => {
  if (Number.isFinite(laundryTurnaroundHours) && laundryTurnaroundHours > 0) {
    return laundryTurnaroundHours;
  }

  const parsedEnvDefault = Number.parseFloat(envDefaultBufferHours);
  if (Number.isFinite(parsedEnvDefault) && parsedEnvDefault > 0) {
    return parsedEnvDefault;
  }

  return HARDCODED_DEFAULT_BUFFER_HOURS;
};

/**
 * Subtract already-blocked ranges from a desired range, returning the
 * sub-ranges that still need an availability exception created.
 *
 * WHY THIS IS NECESSARY: the Marketplace/Integration API **rejects
 * overlapping availability exceptions** with
 * `400 validation-invalid-value - "Availability exception range overlaps with
 * existing availability exceptions."` (verified against Dev). Design §13
 * explicitly wants garment owners to block weeks manually via the stock
 * EditListingAvailabilityPanel, and back-to-back bookings produce abutting
 * buffer windows — so overlap is the expected case, not the edge case.
 * Blindly calling `availabilityExceptions.create` on the whole window 400s,
 * and (before this fix) failed silently, leaving the listing double-bookable
 * during the exact window the buffer was supposed to protect.
 *
 * Ranges are half-open `[start, end)`, matching Sharetribe's convention for
 * both bookings and availability exceptions. Two ranges that merely *touch*
 * (`a.end === b.start`) do not overlap and are treated as contiguous cover.
 *
 * NOTE ON `seats`: existing exceptions are subtracted regardless of their
 * `seats` value, because the API's overlap rejection does not care about
 * seats either. An overlapping exception with `seats > 0` therefore leaves a
 * genuinely bookable hole inside the buffer window; the caller is responsible
 * for surfacing that (see create-availability-buffer.js, which reports it as
 * `unblockedOverlaps`). Silently creating nothing there would be the old bug
 * in a new shape.
 *
 * @param {{ start: Date, end: Date }} desired - the full buffer window
 * @param {Array<{ start: Date|string, end: Date|string, seats?: number }>} existing -
 *   exceptions already present on the listing (any seats value)
 * @returns {Array<{ start: Date, end: Date }>} zero or more sub-ranges to create,
 *   in chronological order. An empty array means the window is already covered.
 */
const subtractBlockedRanges = (desired, existing) => {
  const toMs = value => (value instanceof Date ? value.getTime() : new Date(value).getTime());

  const desiredStart = toMs(desired?.start);
  const desiredEnd = toMs(desired?.end);

  if (!Number.isFinite(desiredStart) || !Number.isFinite(desiredEnd)) {
    throw new Error('subtractBlockedRanges: desired range must have valid start and end dates');
  }
  if (desiredEnd <= desiredStart) {
    throw new Error('subtractBlockedRanges: desired range end must be after start');
  }

  // Clip every *overlapping* existing range to the desired window. Ranges that
  // only touch the window (end === desiredStart, or start === desiredEnd) are
  // not overlaps and are dropped here.
  const clipped = (Array.isArray(existing) ? existing : [])
    .map(range => ({ start: toMs(range?.start), end: toMs(range?.end) }))
    .filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .filter(r => r.start < desiredEnd && r.end > desiredStart)
    .map(r => ({ start: Math.max(r.start, desiredStart), end: Math.min(r.end, desiredEnd) }))
    .sort((a, b) => a.start - b.start);

  // Merge overlapping AND touching ranges, so a chain of adjacent exceptions
  // counts as one continuous block rather than producing zero-length gaps.
  const merged = clipped.reduce((acc, range) => {
    const last = acc[acc.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
      return acc;
    }
    return acc.concat({ ...range });
  }, []);

  // Walk the gaps between merged blocks.
  const gaps = [];
  let cursor = desiredStart;
  merged.forEach(block => {
    if (block.start > cursor) {
      gaps.push({ start: new Date(cursor), end: new Date(block.start) });
    }
    cursor = Math.max(cursor, block.end);
  });
  if (cursor < desiredEnd) {
    gaps.push({ start: new Date(cursor), end: new Date(desiredEnd) });
  }

  return gaps;
};

/**
 * Of the existing exceptions overlapping the desired window, which ones leave
 * the listing still bookable (`seats > 0`)?
 *
 * These are the dangerous case: the buffer window looks "already covered" to
 * subtractBlockedRanges (so nothing is created, correctly — creating would
 * 400) while the listing is in fact still bookable on those days. The caller
 * must log/report these rather than treat the window as protected.
 *
 * @param {{ start: Date, end: Date }} desired
 * @param {Array<{ start: Date|string, end: Date|string, seats?: number }>} existing
 * @returns {Array} the overlapping existing entries with seats > 0
 */
const findBookableOverlaps = (desired, existing) => {
  const toMs = value => (value instanceof Date ? value.getTime() : new Date(value).getTime());
  const desiredStart = toMs(desired?.start);
  const desiredEnd = toMs(desired?.end);

  return (Array.isArray(existing) ? existing : []).filter(range => {
    const start = toMs(range?.start);
    const end = toMs(range?.end);
    const overlaps =
      Number.isFinite(start) && Number.isFinite(end) && start < desiredEnd && end > desiredStart;
    return overlaps && typeof range?.seats === 'number' && range.seats > 0;
  });
};

module.exports = {
  HOURS_IN_DAY,
  HARDCODED_DEFAULT_BUFFER_HOURS,
  computeBufferDays,
  addDays,
  floorToUtcDay,
  ceilToUtcDay,
  computeAvailabilityBufferWindow,
  resolveTurnaroundHours,
  subtractBlockedRanges,
  findBookableOverlaps,
};
