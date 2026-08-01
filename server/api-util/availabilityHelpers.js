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

  const { totalBufferDays, bufferBeforeDays, bufferAfterDays } = computeBufferDays(
    turnaroundHours
  );

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

module.exports = {
  HOURS_IN_DAY,
  HARDCODED_DEFAULT_BUFFER_HOURS,
  computeBufferDays,
  addDays,
  computeAvailabilityBufferWindow,
  resolveTurnaroundHours,
};
