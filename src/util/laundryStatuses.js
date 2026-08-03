/**
 * The laundry ops vocabulary: process states, cleaning sub-phases, and the
 * actions a laundry may take from each.
 *
 * WHAT CHANGED, AND WHY THERE IS NO LONGER A DRIFT TEST
 *
 * This file used to be a hand-maintained mirror of a server-side
 * `LAUNDRY_STATUSES` list, guarded by a Jest test that required the server
 * module across the `src/` boundary and asserted the two arrays were
 * deep-equal. Both the server list and that guard are gone.
 *
 * The reason is not that drift stopped mattering - it is that the thing worth
 * agreeing with is no longer a list we invented. The laundry chain is now real
 * transitions on the `cocloset-booking` process
 * (ext/transaction-processes/cocloset-booking/process.edn), Sharetribe
 * enforces the ordering server-side, and a transition this file offers that
 * the process does not allow comes back as a 409 rather than as a silently
 * wrong metadata write. The EDN is the source of truth; a test asserting that
 * two of our own copies match each other only ever proved they were equally
 * wrong.
 *
 * What this file is now: the CLIENT half of that vocabulary - how to turn a
 * row from /api/laundry-orders into something an operator can read, and which
 * buttons are legal to show. Its server counterpart is
 * server/api-util/coclosetBookingProcess.js.
 */

/**
 * Process states a garment passes through, in operational order.
 *
 * Order is load-bearing for `sortRows`: things needing action float to the
 * top of the ops table. These are the state names from
 * src/transactions/transactionProcessCoclosetBooking.js.
 */
export const LAUNDRY_STATES = [
  'accepted',
  'ready-for-pickup',
  'picked-up',
  'overdue',
  'returned',
  'cleaning',
  'delivered',
];

/**
 * The three cleaning sub-phases, in order.
 *
 * These are `transaction.metadata.cleaningPhase` values, not states: all three
 * cleaning transitions leave the transaction in `cleaning`, and the sub-phase
 * is what distinguishes them. They exist as separate transitions so each is
 * timestamped and audited.
 */
export const CLEANING_PHASES = ['pending-cleaning', 'cleaning-in-progress', 'quality-inspection'];

// Listing readiness - the garment's physical state, independent of any
// booking (design doc §8). Unchanged: this is a listing lifecycle, not a
// transaction one, and has nothing to do with the process.
export const READINESS_STATUSES = ['incoming', 'stored', 'available'];

/**
 * The wire vocabulary POSTed to /api/laundry-transaction-status.
 *
 * The client sends a *status* (the step to advance to) rather than a
 * transition name, because "the garment came back" is two different
 * transitions - `laundry-confirm-return` from `picked-up`,
 * `laundry-confirm-return-late` from `overdue` - and only the server can
 * safely decide which, from the transaction's real current state. See
 * server/api-util/coclosetBookingProcess.js.
 */
export const LAUNDRY_ACTION_STATUSES = [
  'ready-for-pickup',
  'picked-up',
  'returned',
  'pending-cleaning',
  'cleaning-in-progress',
  'quality-inspection',
  'available-for-booking',
];

// The step at which the laundry may attach a damage report (design doc §10).
// Both return transitions accept one.
export const DAMAGE_REPORT_STATUS = 'returned';

// The action that fires the owner's payout. Called out separately because the
// UI has to warn about it: it is the point of no return for a refund.
export const PAYOUT_ACTION_STATUS = 'pending-cleaning';

/**
 * The single display status for a row: its state, or - while it is in
 * `cleaning` - which of the three sub-phases it is in.
 *
 * @param {Object} row - a row from the /api/laundry-orders response
 * @returns {string|null}
 */
export const opsStatus = row => {
  const state = row?.state;
  if (!state) {
    return null;
  }
  if (state === 'cleaning') {
    // A transaction that just entered `cleaning` always has cleaningPhase set
    // by the same transition, but degrade rather than render a blank badge.
    return row.cleaningPhase || 'pending-cleaning';
  }
  return state;
};

/**
 * Actions the laundry may take on a row, given the state the process is
 * actually in.
 *
 * Only ever returns moves that are legal from the current state, so the UI
 * never offers a button Sharetribe will answer 409 for.
 *
 * PRODUCT CONSTRAINT - DO NOT COLLAPSE THESE INTO ONE BUTTON:
 * `returned` ("confirm return") and `pending-cleaning` ("start cleaning") are
 * two separate actions on purpose. The payout fires on the second one, so the
 * interval between them is the ONLY window in which an operator can cancel
 * with a refund after the laundry has physically inspected a garment and
 * reported damage (transition/cancel-from-returned). Chaining them destroys
 * that window silently - the process cannot enforce a minimum dwell time in
 * `returned`, so this UI is what makes the window real.
 *
 * @param {Object} row - a row from the /api/laundry-orders response
 * @returns {Array<{status: string, labelKey: string, needsDamageReport: boolean,
 *   firesPayout: boolean}>}
 */
export const laundryActionsFor = row => {
  // Inventory-only rows (§8's listings with no transaction) have no process
  // state to advance; they move via the readiness endpoint instead.
  if (row?.rowType !== 'transaction') {
    return [];
  }

  const nextStatus = (() => {
    switch (row.state) {
      case 'accepted':
        return 'ready-for-pickup';
      case 'ready-for-pickup':
        return 'picked-up';
      // Both of these mean "the garment is out with the customer"; the server
      // picks laundry-confirm-return vs -return-late from the real state.
      case 'picked-up':
      case 'overdue':
        return 'returned';
      case 'returned':
        return 'pending-cleaning';
      case 'cleaning':
        switch (row.cleaningPhase) {
          case 'cleaning-in-progress':
            return 'quality-inspection';
          case 'quality-inspection':
            return 'available-for-booking';
          case 'pending-cleaning':
          default:
            return 'cleaning-in-progress';
        }
      default:
        // delivered / canceled / anything before accept: nothing for the
        // laundry to do.
        return null;
    }
  })();

  if (!nextStatus) {
    return [];
  }

  return [
    {
      status: nextStatus,
      labelKey: `LaundryOpsPage.action.${nextStatus}`,
      needsDamageReport: nextStatus === DAMAGE_REPORT_STATUS,
      firesPayout: nextStatus === PAYOUT_ACTION_STATUS,
    },
  ];
};

/**
 * Translation key for a status badge on an ops row.
 *
 * A row shows its transaction status when it has one, and falls back to the
 * listing's readiness status otherwise - that fallback is exactly the §8 union
 * the Orders table renders (mockup 08.jpg mixes "Picked up" with "Incoming
 * garment"/"Stored" in one STATUS column).
 *
 * @param {Object} row - a row from the /api/laundry-orders response
 * @returns {string|null} translation key, or null when the row has no status
 */
export const statusLabelKey = row => {
  const status = opsStatus(row);
  if (status) {
    return `LaundryOpsPage.status.${status}`;
  }
  if (row?.readinessStatus) {
    return `LaundryOpsPage.readiness.${row.readinessStatus}`;
  }
  return null;
};

/**
 * Is this garment currently late?
 *
 * `overdue` is a real process state now, entered automatically by
 * transition/mark-overdue at booking end + 1 day. It replaces the
 * `metadata.lateReturn` flag we used to maintain by hand.
 *
 * @param {Object} row
 * @returns {boolean}
 */
export const isOverdue = row => row?.state === 'overdue';

/**
 * Did this garment come back late?
 *
 * Distinct from `isOverdue`: a late garment leaves `overdue` for `returned`
 * the moment it is scanned in, so `isOverdue` stops being true exactly when
 * the problem is resolved. The transition that resolved it still records that
 * it was late, and the ops screens keep flagging the row.
 *
 * @param {Object} row
 * @returns {boolean}
 */
export const wasReturnedLate = row => row?.returnedLate === true;
