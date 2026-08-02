/**
 * Client-side mirror of the laundry status vocabularies (design doc §8/§9).
 *
 * WHY THIS IS A COPY, AND WHY IT CAN'T DRIFT
 *
 * The authoritative definitions live server-side, because the server is what
 * actually enforces them:
 *   - `LAUNDRY_STATUSES`    -> `server/api-util/laundryStatusHelpers.js`
 *   - `READINESS_STATUSES`  -> `server/api/listing-readiness-status.js`
 *
 * The client cannot import those files. Two hard constraints make it
 * impossible rather than merely awkward:
 *   1. Webpack runs `ModuleScopePlugin(paths.appSrc)` (config/webpack.config.js),
 *      which rejects any import that resolves outside `src/`.
 *   2. The server runs as plain CommonJS via `node server/index.js` with no
 *      Babel step, so it cannot `require()` an ESM file out of `src/` either.
 *      The dependency can't simply be pointed the other way.
 *
 * So this is a deliberate, documented copy rather than a silent fork - and it
 * is guarded: `src/util/laundryStatuses.test.js` requires the server modules
 * directly (Jest has no module-scope restriction) and asserts both lists are
 * deep-equal to these. If anyone edits one side, that test fails.
 */

// Ordered sequence of transaction laundry sub-phases. Order is load-bearing:
// the server only accepts the same status again (idempotent retry) or exactly
// the next one, so the UI must offer exactly one "advance" target.
export const LAUNDRY_STATUSES = [
  'ready-for-pickup',
  'picked-up',
  'returned',
  'pending-cleaning',
  'cleaning-in-progress',
  'quality-inspection',
  'available-for-booking',
];

// Listing readiness - the garment's physical state, independent of any
// booking (design doc §8).
export const READINESS_STATUSES = ['incoming', 'stored', 'available'];

// The step at which the laundry may attach a damage report (design doc §10).
export const DAMAGE_REPORT_STATUS = 'returned';

/**
 * The single legal next laundry status after `currentStatus`.
 *
 * Mirrors `isLegalNextLaundryStatus` on the server: nothing set yet means the
 * only legal move is the first status in the sequence; otherwise it's the
 * immediate next one. Returns null when the sequence is already finished or
 * the current value isn't recognized - callers should hide the advance action
 * in that case rather than offering a jump the server will reject with a 409.
 *
 * @param {string|null|undefined} currentStatus
 * @returns {string|null}
 */
export const nextLaundryStatus = currentStatus => {
  if (currentStatus == null) {
    return LAUNDRY_STATUSES[0];
  }
  const index = LAUNDRY_STATUSES.indexOf(currentStatus);
  if (index === -1 || index === LAUNDRY_STATUSES.length - 1) {
    return null;
  }
  return LAUNDRY_STATUSES[index + 1];
};

/**
 * Translation key for a status badge on an ops row.
 *
 * A row shows its transaction laundry status when it has one, and falls back
 * to the listing's readiness status otherwise - that fallback is exactly the
 * §8 union the Orders table renders (mockup 08.jpg mixes "Picked up" with
 * "Incoming garment"/"Stored" in one STATUS column).
 *
 * @param {Object} row - a row from the /api/laundry-orders response
 * @returns {string|null} translation key, or null when the row has no status
 */
export const statusLabelKey = row => {
  if (row?.laundryStatus) {
    return `LaundryOpsPage.status.${row.laundryStatus}`;
  }
  if (row?.readinessStatus) {
    return `LaundryOpsPage.readiness.${row.readinessStatus}`;
  }
  return null;
};
