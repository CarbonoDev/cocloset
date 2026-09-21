const { STATES } = require('./coclosetBookingProcess');
const { takesLaundryCode } = require('./laundryCode');

// WHAT THE STUDIO DOES NEXT - server mirror of `laundryActionsFor` in
// src/util/laundryStatuses.js.
//
//   > "el handover tiene que funcionar igual que en la pestaña orders de laundry"
//   >   (Jonathan, 2026-09-08)
//
// The ops table has always derived the studio's next action from the transaction's real
// state. The scan page did not: it read a table of COUNTER EVENTS - who is standing in front
// of you - and then hand-picked which boxes to show from that. So the two screens asked
// different questions about the same garment, and the phone asked one the endpoint does not
// read at all: the cleaning days, at the return step, which are only consumed when the wash
// actually starts.
//
// Duplicated here rather than imported for the reason documented at the top of
// coclosetBookingProcess.js - the server is plain CommonJS with no Babel step and cannot
// require an ESM module out of `src/`. The two copies are held together by
// src/util/laundryActionsAgreement.test.js.
//
// NOT THE SAME QUESTION AS handoverSteps.js, and both still exist. That module answers "who
// is at the counter", which is what the customer and the owner are told; this one answers
// "which button does the studio get". They coincide for the three counter events and diverge
// for the cleaning phases, which are studio-internal work with nobody handing anything over.

/**
 * The next status the laundry may advance this transaction to.
 *
 * @param {Object} params
 * @param {string} [params.state] - a `cocloset-booking` state name
 * @param {string} [params.cleaningPhase] - `transaction.metadata.cleaningPhase`
 * @param {boolean} [params.onLaundry] - is the garment already on the studio's rack?
 * @returns {string|null} null when there is nothing for the laundry to do
 */
const laundryNextStatus = ({ state, cleaningPhase, onLaundry } = {}) => {
  switch (state) {
    // Two counters, one state - see handoverSteps.js. A garment still with its owner has to
    // be taken in and washed; one already on the rack is ready now.
    case STATES.ACCEPTED:
      return onLaundry === true ? 'ready-for-pickup' : 'garment-received';
    // The garment just finished its first wash (2026-09-21) - the only way out is the same
    // "mark ready" button as the onLaundry-already-true case above. See laundryActionsFor's
    // matching case in src/util/laundryStatuses.js.
    case STATES.INITIAL_CLEANING:
      return 'ready-for-pickup';
    case STATES.READY_FOR_PICKUP:
      return 'picked-up';
    // Both mean "out with the customer"; the endpoint picks laundry-confirm-return vs
    // -return-late from the real state.
    case STATES.PICKED_UP:
    case STATES.OVERDUE:
      return 'returned';
    case STATES.RETURNED:
      return 'pending-cleaning';
    case STATES.CLEANING:
      switch (cleaningPhase) {
        // Quality inspection is gone from the workflow, but a transaction already parked in
        // it must still have a way out or the garment never returns to the rack.
        case 'cleaning-in-progress':
        case 'quality-inspection':
          return 'available-for-booking';
        case 'pending-cleaning':
        default:
          return 'cleaning-in-progress';
      }
    default:
      // delivered / canceled / anything before accept: nothing for the laundry to do.
      return null;
  }
};

/**
 * The next action, with what the studio has to be asked for at it.
 *
 * The flags are the whole point of sending this to the client rather than letting the page
 * work it out: which step takes a code, which takes the days, which pays out. Each of them is
 * a fact about what the WRITE will read, so the screen that asks and the endpoint that reads
 * cannot drift apart.
 *
 * @param {Object} params - as laundryNextStatus
 * @returns {Object|null} {status, needsDamageReport, needsCleaningDays, needsLaundryCode,
 *   firesPayout}, or null when there is nothing to do
 */
const laundryActionFor = params => {
  const status = laundryNextStatus(params);
  if (!status) {
    return null;
  }
  return {
    status,
    // The garment is in somebody's hands at this step, which is when damage is found.
    needsDamageReport: status === 'returned',
    // The moment the work starts, not the moment the garment joins the queue
    // (Jonathan, 2026-09-08). Read at `transition/laundry-start-cleaning`.
    needsCleaningDays: status === 'cleaning-in-progress',
    needsLaundryCode: takesLaundryCode(status),
    // The owner is paid on entering `cleaning`, and Sharetribe has no post-payout refund, so
    // this is the last step at which a damaged garment can still be cancelled with one.
    firesPayout: status === 'pending-cleaning',
  };
};

module.exports = {
  laundryNextStatus,
  laundryActionFor,
};
