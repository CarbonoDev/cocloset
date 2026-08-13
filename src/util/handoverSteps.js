import { states } from '../transactions/transactionProcessCoclosetBooking';

/**
 * THE HANDOVER STEP: what happens next at the laundry counter, and with whom.
 *
 *   > "asegurate de que al escanear el qr se procese el siguiente paso, si le corresponde a
 *   >  customer o si le corresponde a provider, al escanear debe llevar al paso siguiente con
 *   >  un button para confirmar y avanzar"
 *
 * A `cocloset-booking` rental passes across the laundry counter three times, and each time
 * the studio is facing a DIFFERENT person:
 *
 *   accepted         → the PROVIDER brings the garment in
 *   ready-for-pickup → the CUSTOMER collects it
 *   picked-up        → the CUSTOMER brings it back
 *   overdue          → the CUSTOMER brings it back, late
 *
 * This module answers "which of those is next" from the transaction's state alone, so the
 * scan landing page, the customer's own screen and the ops row cannot end up telling three
 * different stories about the same rental.
 *
 * WHY IT IS KEYED ON STATE AND NOT ON A STORED FLAG. The state machine already records
 * every handover: entering `ready-for-pickup` means the garment arrived, entering
 * `picked-up` means it left with the customer, entering `returned` means it came back. A
 * `metadata.nextStep` would be a second source of truth that could disagree with the first,
 * which is the same argument that keeps `metadata.qrUsed` from existing (see
 * server/api-util/handoverQr.js).
 *
 * WHAT THIS MODULE DOES NOT DECIDE. It does not say who is allowed to CONFIRM the step -
 * that is authorization, it lives on the server (server/api-util/laundryAuth.js), and the
 * answer is always "the laundry assigned to this garment". The counterparty below is who the
 * studio is handing to or taking from, not who may press the button.
 */

/** The party the laundry deals with at this step. */
export const HANDOVER_COUNTERPARTY_PROVIDER = 'provider';
export const HANDOVER_COUNTERPARTY_CUSTOMER = 'customer';

/** What is physically happening. */
export const HANDOVER_DIRECTION_IN = 'in'; // the garment arrives at the studio
export const HANDOVER_DIRECTION_OUT = 'out'; // the garment leaves the studio

/**
 * The steps, keyed by the process state they are next in.
 *
 * `status` is the value `POST /api/laundry-transaction-status` expects - the same vocabulary
 * `laundryActionsFor` already speaks, so the scan page and the ops table drive the exact same
 * endpoint with the exact same argument. A second vocabulary here would be a second thing to
 * keep in sync with the process.
 *
 * Only the three COUNTER events are listed. The cleaning sub-phases are studio-internal work
 * with nobody standing at the counter, so they are not handover steps and scanning during
 * them yields null - the page then says "nothing to hand over right now" instead of offering
 * a button that would advance an internal phase by accident.
 */
const STEPS = {
  [states.ACCEPTED]: {
    state: states.ACCEPTED,
    status: 'ready-for-pickup',
    counterparty: HANDOVER_COUNTERPARTY_PROVIDER,
    direction: HANDOVER_DIRECTION_IN,
  },
  [states.READY_FOR_PICKUP]: {
    state: states.READY_FOR_PICKUP,
    status: 'picked-up',
    counterparty: HANDOVER_COUNTERPARTY_CUSTOMER,
    direction: HANDOVER_DIRECTION_OUT,
  },
  [states.PICKED_UP]: {
    state: states.PICKED_UP,
    status: 'returned',
    counterparty: HANDOVER_COUNTERPARTY_CUSTOMER,
    direction: HANDOVER_DIRECTION_IN,
  },
  // The same physical event as the one above. The process splits it in two only because the
  // EDN's `:from` is single-valued and a late return sits in `overdue`; the server picks
  // `laundry-confirm-return` vs `-return-late` from the real state, so both map to the same
  // `status` here. `isLate` is what the page uses to say so out loud.
  [states.OVERDUE]: {
    state: states.OVERDUE,
    status: 'returned',
    counterparty: HANDOVER_COUNTERPARTY_CUSTOMER,
    direction: HANDOVER_DIRECTION_IN,
    isLate: true,
  },
};

/**
 * The next handover step for a transaction in this state.
 *
 * @param {string} [processState] - a `cocloset-booking` state name
 * @returns {Object|null} the step, or null when nothing is due at the counter
 */
export const handoverStepFor = processState => STEPS[processState] || null;

/**
 * Translation key for the heading of a step.
 *
 * Built from the state rather than from the counterparty so that the four steps can each
 * have their own sentence - "bring the garment in" and "collect the garment" are not the
 * same instruction with a word swapped.
 *
 * @param {Object} step - from `handoverStepFor`
 * @param {string} suffix - e.g. 'title', 'instruction'
 * @returns {string}
 */
export const handoverStepMessageId = (step, suffix) => `HandoverPage.step.${step.state}.${suffix}`;

/**
 * Is this viewer the counterparty of this step?
 *
 * Used to decide whether the page tells the viewer "it is your turn" or "we are waiting on
 * someone else". Never used to decide whether the confirm button appears - that is the
 * laundry's, always.
 *
 * @param {Object} [step] - from `handoverStepFor`
 * @param {'customer'|'provider'|'laundry'|null} [viewerRole]
 * @returns {boolean}
 */
export const isViewerTheCounterparty = (step, viewerRole) =>
  !!step && !!viewerRole && step.counterparty === viewerRole;
