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
 * The cleaning sub-phases, in order.
 *
 * These are `transaction.metadata.cleaningPhase` values, not states: the
 * cleaning transitions all leave the transaction in `cleaning`, and the
 * sub-phase is what distinguishes them. They exist as separate transitions so
 * each is timestamped and audited.
 *
 * QUALITY INSPECTION IS GONE FROM THE WORKFLOW (Jonathan, 2026-09-03: "hay que
 * remover Quality inspection"). The TRANSITION still exists in the process:
 * removing it from the EDN needs a `flex-cli process push`, and would strand
 * any transaction sitting in that phase at the moment of the push. So this list
 * is what stops a studio ever being offered it - nothing new can enter the
 * phase - while `laundryActionsFor` still knows how to get an existing one out.
 */
export const CLEANING_PHASES = ['pending-cleaning', 'cleaning-in-progress'];

// Listing readiness - the garment's physical state, independent of any
// booking (design doc §8). Unchanged: this is a listing lifecycle, not a
// transaction one, and has nothing to do with the process.
export const READINESS_STATUSES = ['incoming', 'stored', 'available'];

/**
 * Is the garment physically in a studio's custody right now?
 *
 * `incoming` is the owner still on their way with it - the studio is expecting the garment,
 * not holding it. `stored` and `available` are both "it is on our rack"; they differ in
 * whether it can be booked, which is not what this question asks.
 *
 * Used by the handover QR rules (Jonathan, 2026-09-03: the owner's code is gated on their own
 * approval "solo si la prenda no esta en una laundry"), so a missing or unknown value has to
 * mean NOT at the studio: that is the answer that hides the code rather than leaking it.
 *
 * @param {string} [readinessStatus] - `listing.metadata.readinessStatus`
 * @returns {boolean}
 */
export const isGarmentAtLaundry = readinessStatus =>
  ['stored', 'available'].includes(readinessStatus);

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
  'available-for-booking',
];

// The step at which the laundry may attach a damage report (design doc §10).
// Both return transitions accept one.
export const DAMAGE_REPORT_STATUS = 'returned';

// The step at which the laundry says how long cleaning will take.
//
//   > "se divide en dos pasos: 1. Confirm return, donde solo se cambia de estado y una vez
//   >  hecho esto, se debe preguntar a la laundry los días que necesita para el lavado (...)
//   >  el botón para completar este form será Process for Cleaning" (Jonathan, 2026-09-03)
//
// MOVED OFF THE RETURN. Confirming the return is now one thing only: the garment is back.
// The questions that belong to the WASH are asked at the next step, which is where the studio
// actually starts working on it - and it puts the cleaning-days answer AFTER the damage
// report rather than beside it, which matters: a studio that has just found a stain has a
// different answer about how long it needs, and the old form asked both in one breath.
//
// The damage report deliberately did NOT move. It is about the garment arriving; this is
// about the work starting. They were separate constants for exactly this reason.
//
// The field is OPTIONAL. Sending nothing means "use the turnaround I configured", which is
// resolved server-side from the laundry's per-category settings - the client neither knows
// nor guesses it.
export const CLEANING_DAYS_STATUS = 'pending-cleaning';

// The steps at which the studio names the garment on its own shelving.
//
//   > "cuando laundry recibe la prenda desde el provider, debe aparecer un input
//   >  para que laundry pueda ingresar un código interno para esa prenda"
//
// TWO STEPS NOW, NOT ONE. Reception is still where a garment first gets a code; "Process for
// Cleaning" asks again - "que ingrese nuevamente el ticket, por si debe cambiarlo, el valor
// por default debe ser el ticket anterior, pero debe solicitarlo siempre" - because a garment
// coming back from a rental often does not go back on the shelf it left. The box is prefilled
// with the current code, so the common case is confirming rather than retyping.
//
// MUST match `takesLaundryCode` in server/api-util/laundryCode.js - the server decides
// whether the code is read at all, and a client that offers the box at a step the server
// ignores would take an operator's input and drop it silently. That is exactly what the ops
// table did once already: the handover page asked, this one did not, so the same reception
// done from a desk lost the code with nothing on screen to say so.
export const LAUNDRY_CODE_STATUSES = ['ready-for-pickup', 'pending-cleaning'];

export const takesLaundryCode = status => LAUNDRY_CODE_STATUSES.includes(status);

// Mirrors MAX_CODE_LENGTH in server/api-util/laundryCode.js, which is the authority and will
// reject anything longer. Held here so both screens that ask for a code cap it the same way -
// the handover page carried a bare `40`, and a second literal in the ops table would have been
// the third copy of one number.
export const MAX_LAUNDRY_CODE_LENGTH = 40;

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
 *   needsCleaningDays: boolean, needsLaundryCode: boolean, firesPayout: boolean}>}
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
          // Cleaning is now the last thing that happens to the garment before
          // it goes back into inventory. A transaction ALREADY parked in
          // quality inspection still has to be able to leave it, which is why
          // that case remains: dropping it would strand a garment nobody could
          // return to the rack.
          case 'cleaning-in-progress':
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
      needsCleaningDays: nextStatus === CLEANING_DAYS_STATUS,
      needsLaundryCode: takesLaundryCode(nextStatus),
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
