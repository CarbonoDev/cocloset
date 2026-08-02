// Pure helpers for the laundry-triggered "granular sub-phase" state tracked
// in `transaction.metadata.laundryStatus` (see design doc §8/§9).
//
// IMPORTANT: this is metadata layered on top of the real Sharetribe
// transaction process, not a real process state. The underlying transaction
// stays in whatever real state it's actually in (`accepted` for the whole
// rental+cleaning cycle) - this just tracks the granular sub-phase for
// display on the laundry ops dashboard. See
// server/api/laundry-transaction-status.js for how this is used.

// Ordered sequence of laundry status values, matching design doc §9's
// "customer step -> laundry granular state" mapping table exactly, in order.
const LAUNDRY_STATUSES = [
  'ready-for-pickup',
  'picked-up',
  'returned',
  'pending-cleaning',
  'cleaning-in-progress',
  'quality-inspection',
  'available-for-booking',
];

/**
 * Is `newStatus` a legal next step from `currentStatus`?
 *
 * Legal moves:
 *   - `currentStatus` is null/undefined (nothing set yet) and `newStatus` is
 *     the FIRST status in the sequence ('ready-for-pickup') - i.e. setting
 *     the initial status.
 *   - `newStatus` is the same as `currentStatus` (idempotent retry - e.g. a
 *     flaky QR scan retried by the laundry app).
 *   - `newStatus` is the immediate next status after `currentStatus` in
 *     LAUNDRY_STATUSES.
 *
 * Anything else (skip-ahead, backward move, unknown status string) is
 * illegal.
 *
 * @param {string|null|undefined} currentStatus - the transaction's current
 *   `metadata.laundryStatus`, or null/undefined if none has been set yet.
 * @param {string} newStatus - the requested next status.
 * @returns {boolean}
 */
const isLegalNextLaundryStatus = (currentStatus, newStatus) => {
  const newIndex = LAUNDRY_STATUSES.indexOf(newStatus);
  if (newIndex === -1) {
    // Unknown status string.
    return false;
  }

  if (currentStatus == null) {
    // Nothing set yet - only the first status in the sequence is legal.
    return newIndex === 0;
  }

  const currentIndex = LAUNDRY_STATUSES.indexOf(currentStatus);
  if (currentIndex === -1) {
    // Current value isn't a recognized status (shouldn't normally happen -
    // treat as unrecoverable via this simple check rather than guessing).
    return false;
  }

  // Same status (idempotent retry), or exactly the next one.
  return newIndex === currentIndex || newIndex === currentIndex + 1;
};

module.exports = {
  LAUNDRY_STATUSES,
  isLegalNextLaundryStatus,
};
