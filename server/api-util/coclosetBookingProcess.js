// Server-side mirror of the `cocloset-booking` transaction process.
//
// SOURCE OF TRUTH: ext/transaction-processes/cocloset-booking/process.edn.
// The client mirror is src/transactions/transactionProcessCoclosetBooking.js.
//
// WHY A THIRD COPY EXISTS
// The server cannot import the client mirror: it runs as plain CommonJS via
// `node server/index.js` with no Babel step, so it cannot `require()` an ESM
// module out of `src/`, and webpack's ModuleScopePlugin blocks the reverse
// direction. The two previous laundry modules had a Jest drift guard between
// them; that guard is gone deliberately (the EDN is now the source of truth
// and the vocabulary is derived from it, not from a hand-maintained list), so
// this file names the EDN explicitly and is kept deliberately mechanical:
// every entry below is a literal transcription of a `:name`/`:to` pair.
//
// WHAT THE SERVER ACTUALLY NEEDS THIS FOR
//   1. Deriving a transaction's current state from `attributes.lastTransition`
//      (the Marketplace/Integration API never sends a state name).
//   2. Choosing which transition to fire for a laundry-requested status,
//      including the two-way `returned` branch (see LAUNDRY_STATUS_TRANSITIONS).
//   3. Narrowing `transactions.query` with the native `lastTransitions` filter.
//
// It deliberately does NOT re-implement legality checking. Sharetribe enforces
// transition ordering server-side; see server/api/laundry-transaction-status.js.

const COCLOSET_BOOKING_PROCESS_NAME = 'cocloset-booking';

// ---------------------------------------------------------------------------
// States
//
// Spelled to match src/transactions/transactionProcessCoclosetBooking.js's
// `states` export, NOT the EDN. The EDN writes `:state/cancelled` (two l's,
// as does stock default-booking) while every JS mirror in this template writes
// 'canceled'. State names never cross the API boundary - only transitions do -
// so the JS spelling is the one both ends of our own wire format must agree
// on.
// ---------------------------------------------------------------------------

const STATES = {
  INQUIRY: 'inquiry',
  PENDING_PAYMENT: 'pending-payment',
  PAYMENT_EXPIRED: 'payment-expired',
  PREAUTHORIZED: 'preauthorized',
  DECLINED: 'declined',
  ACCEPTED: 'accepted',
  READY_FOR_PICKUP: 'ready-for-pickup',
  PICKED_UP: 'picked-up',
  OVERDUE: 'overdue',
  RETURNED: 'returned',
  CLEANING: 'cleaning',
  EXPIRED: 'expired',
  CANCELED: 'canceled',
  DELIVERED: 'delivered',
  REVIEWED: 'reviewed',
  REVIEWED_BY_CUSTOMER: 'reviewed-by-customer',
  REVIEWED_BY_PROVIDER: 'reviewed-by-provider',
};

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

const TRANSITIONS = {
  INQUIRE: 'transition/inquire',
  REQUEST_PAYMENT: 'transition/request-payment',
  REQUEST_PAYMENT_AFTER_INQUIRY: 'transition/request-payment-after-inquiry',
  EXPIRE_PAYMENT: 'transition/expire-payment',
  CONFIRM_PAYMENT: 'transition/confirm-payment',
  ACCEPT: 'transition/accept',
  OPERATOR_ACCEPT: 'transition/operator-accept',
  DECLINE: 'transition/decline',
  OPERATOR_DECLINE: 'transition/operator-decline',
  EXPIRE: 'transition/expire',

  LAUNDRY_MARK_READY: 'transition/laundry-mark-ready',
  LAUNDRY_CONFIRM_PICKUP: 'transition/laundry-confirm-pickup',
  LAUNDRY_CONFIRM_RETURN: 'transition/laundry-confirm-return',
  LAUNDRY_CONFIRM_RETURN_LATE: 'transition/laundry-confirm-return-late',
  LAUNDRY_MARK_PENDING_CLEANING: 'transition/laundry-mark-pending-cleaning',
  LAUNDRY_START_CLEANING: 'transition/laundry-start-cleaning',
  LAUNDRY_START_QUALITY_INSPECTION: 'transition/laundry-start-quality-inspection',
  LAUNDRY_MARK_AVAILABLE: 'transition/laundry-mark-available',
  MARK_OVERDUE: 'transition/mark-overdue',

  AUTO_COMPLETE_FROM_READY: 'transition/auto-complete-from-ready',
  AUTO_COMPLETE_FROM_PICKED_UP: 'transition/auto-complete-from-picked-up',
  AUTO_COMPLETE_FROM_OVERDUE: 'transition/auto-complete-from-overdue',
  AUTO_COMPLETE_FROM_RETURNED: 'transition/auto-complete-from-returned',
  AUTO_COMPLETE_FROM_CLEANING: 'transition/auto-complete-from-cleaning',

  CANCEL: 'transition/cancel',
  CANCEL_FROM_READY_FOR_PICKUP: 'transition/cancel-from-ready-for-pickup',
  CANCEL_FROM_PICKED_UP: 'transition/cancel-from-picked-up',
  CANCEL_FROM_OVERDUE: 'transition/cancel-from-overdue',
  CANCEL_FROM_RETURNED: 'transition/cancel-from-returned',

  COMPLETE: 'transition/complete',
  OPERATOR_COMPLETE: 'transition/operator-complete',

  REVIEW_1_BY_PROVIDER: 'transition/review-1-by-provider',
  REVIEW_2_BY_PROVIDER: 'transition/review-2-by-provider',
  REVIEW_1_BY_CUSTOMER: 'transition/review-1-by-customer',
  REVIEW_2_BY_CUSTOMER: 'transition/review-2-by-customer',
  EXPIRE_CUSTOMER_REVIEW_PERIOD: 'transition/expire-customer-review-period',
  EXPIRE_PROVIDER_REVIEW_PERIOD: 'transition/expire-provider-review-period',
  EXPIRE_REVIEW_PERIOD: 'transition/expire-review-period',
};

// Every transition's `:to` state, transcribed from the EDN. This is the whole
// reason the file exists: the API only ever hands us `lastTransition`.
const TRANSITION_TO_STATE = {
  [TRANSITIONS.INQUIRE]: STATES.INQUIRY,
  [TRANSITIONS.REQUEST_PAYMENT]: STATES.PENDING_PAYMENT,
  [TRANSITIONS.REQUEST_PAYMENT_AFTER_INQUIRY]: STATES.PENDING_PAYMENT,
  [TRANSITIONS.EXPIRE_PAYMENT]: STATES.PAYMENT_EXPIRED,
  [TRANSITIONS.CONFIRM_PAYMENT]: STATES.PREAUTHORIZED,
  [TRANSITIONS.ACCEPT]: STATES.ACCEPTED,
  [TRANSITIONS.OPERATOR_ACCEPT]: STATES.ACCEPTED,
  [TRANSITIONS.DECLINE]: STATES.DECLINED,
  [TRANSITIONS.OPERATOR_DECLINE]: STATES.DECLINED,
  [TRANSITIONS.EXPIRE]: STATES.EXPIRED,

  [TRANSITIONS.LAUNDRY_MARK_READY]: STATES.READY_FOR_PICKUP,
  [TRANSITIONS.LAUNDRY_CONFIRM_PICKUP]: STATES.PICKED_UP,
  [TRANSITIONS.LAUNDRY_CONFIRM_RETURN]: STATES.RETURNED,
  [TRANSITIONS.LAUNDRY_CONFIRM_RETURN_LATE]: STATES.RETURNED,
  // All three cleaning sub-phases land in the same state; the sub-phase itself
  // is `metadata.cleaningPhase`, not a state.
  [TRANSITIONS.LAUNDRY_MARK_PENDING_CLEANING]: STATES.CLEANING,
  [TRANSITIONS.LAUNDRY_START_CLEANING]: STATES.CLEANING,
  [TRANSITIONS.LAUNDRY_START_QUALITY_INSPECTION]: STATES.CLEANING,
  [TRANSITIONS.LAUNDRY_MARK_AVAILABLE]: STATES.DELIVERED,
  [TRANSITIONS.MARK_OVERDUE]: STATES.OVERDUE,

  [TRANSITIONS.AUTO_COMPLETE_FROM_READY]: STATES.DELIVERED,
  [TRANSITIONS.AUTO_COMPLETE_FROM_PICKED_UP]: STATES.DELIVERED,
  [TRANSITIONS.AUTO_COMPLETE_FROM_OVERDUE]: STATES.DELIVERED,
  [TRANSITIONS.AUTO_COMPLETE_FROM_RETURNED]: STATES.DELIVERED,
  [TRANSITIONS.AUTO_COMPLETE_FROM_CLEANING]: STATES.DELIVERED,

  [TRANSITIONS.CANCEL]: STATES.CANCELED,
  [TRANSITIONS.CANCEL_FROM_READY_FOR_PICKUP]: STATES.CANCELED,
  [TRANSITIONS.CANCEL_FROM_PICKED_UP]: STATES.CANCELED,
  [TRANSITIONS.CANCEL_FROM_OVERDUE]: STATES.CANCELED,
  [TRANSITIONS.CANCEL_FROM_RETURNED]: STATES.CANCELED,

  [TRANSITIONS.COMPLETE]: STATES.DELIVERED,
  [TRANSITIONS.OPERATOR_COMPLETE]: STATES.DELIVERED,

  [TRANSITIONS.REVIEW_1_BY_PROVIDER]: STATES.REVIEWED_BY_PROVIDER,
  [TRANSITIONS.REVIEW_2_BY_PROVIDER]: STATES.REVIEWED,
  [TRANSITIONS.REVIEW_1_BY_CUSTOMER]: STATES.REVIEWED_BY_CUSTOMER,
  [TRANSITIONS.REVIEW_2_BY_CUSTOMER]: STATES.REVIEWED,
  [TRANSITIONS.EXPIRE_CUSTOMER_REVIEW_PERIOD]: STATES.REVIEWED,
  [TRANSITIONS.EXPIRE_PROVIDER_REVIEW_PERIOD]: STATES.REVIEWED,
  [TRANSITIONS.EXPIRE_REVIEW_PERIOD]: STATES.REVIEWED,
};

/**
 * The transaction's current process state, derived from its last transition.
 *
 * @param {string} [lastTransition] - `transaction.attributes.lastTransition`
 * @returns {string|null} state name, or null for an unknown/absent transition
 */
const stateFromLastTransition = lastTransition =>
  (lastTransition && TRANSITION_TO_STATE[lastTransition]) || null;

// ---------------------------------------------------------------------------
// The ops-facing status vocabulary
// ---------------------------------------------------------------------------
//
// The laundry ops dashboard POSTs a *status* (the step it wants the garment to
// reach), not a transition name. That indirection is deliberate and is exactly
// what the `returned` entry below exists for: `:from` is single-valued in the
// EDN, so "the garment came back" is two different transitions depending on
// whether it came back on time (:state/picked-up) or late (:state/overdue).
// The client cannot be trusted to know which - its row may be stale - so the
// endpoint reads the transaction's real current state and picks.
//
// Every other status maps 1:1. `cleaningPhase` is the metadata each cleaning
// transition writes, and doubles as the sub-phase the ops UI displays.

const LAUNDRY_STATUS_TRANSITIONS = {
  'ready-for-pickup': { transition: TRANSITIONS.LAUNDRY_MARK_READY },
  'picked-up': { transition: TRANSITIONS.LAUNDRY_CONFIRM_PICKUP },
  returned: {
    // The two-way branch. `fallback` is used when the current state is
    // anything else (e.g. the transaction moved under us): fire the on-time
    // transition and let Sharetribe reject it, rather than guessing.
    byState: {
      [STATES.PICKED_UP]: TRANSITIONS.LAUNDRY_CONFIRM_RETURN,
      [STATES.OVERDUE]: TRANSITIONS.LAUNDRY_CONFIRM_RETURN_LATE,
    },
    fallback: TRANSITIONS.LAUNDRY_CONFIRM_RETURN,
  },
  'pending-cleaning': {
    transition: TRANSITIONS.LAUNDRY_MARK_PENDING_CLEANING,
    cleaningPhase: 'pending-cleaning',
  },
  'cleaning-in-progress': {
    transition: TRANSITIONS.LAUNDRY_START_CLEANING,
    cleaningPhase: 'cleaning-in-progress',
  },
  'quality-inspection': {
    transition: TRANSITIONS.LAUNDRY_START_QUALITY_INSPECTION,
    cleaningPhase: 'quality-inspection',
  },
  'available-for-booking': { transition: TRANSITIONS.LAUNDRY_MARK_AVAILABLE },
};

const LAUNDRY_STATUSES = Object.keys(LAUNDRY_STATUS_TRANSITIONS);

// The status at which a damage report may be attached (design doc §10). Both
// return transitions accept it.
const DAMAGE_REPORT_STATUS = 'returned';

/**
 * Resolve the transition to fire for a laundry-requested status.
 *
 * @param {string} status - one of LAUNDRY_STATUSES
 * @param {string|null} currentState - from stateFromLastTransition()
 * @returns {{transition: string, cleaningPhase?: string}|null} null for an
 *   unknown status
 */
const transitionForStatus = (status, currentState) => {
  const entry = LAUNDRY_STATUS_TRANSITIONS[status];
  if (!entry) {
    return null;
  }
  if (entry.byState) {
    return { transition: entry.byState[currentState] || entry.fallback };
  }
  return { transition: entry.transition, cleaningPhase: entry.cleaningPhase };
};

// ---------------------------------------------------------------------------
// Query narrowing
// ---------------------------------------------------------------------------
//
// `transactions.query` supports `lastTransitions` as a NATIVE filter - unlike
// `pub_*`/`meta_*`, which silently no-op without a search schema. Verified
// against the real Dev Integration API: the parameter is accepted (HTTP 200)
// and does filter.
//
// CAVEAT, also verified: an unrecognised transition name in this list is NOT
// rejected - it just matches nothing. So this filter fails CLOSED (rows
// silently disappear) where `pub_*` fails open. A typo here is a missing row,
// not an error, which is why every entry is a TRANSITIONS constant rather than
// a literal.
//
// These are the transitions that put a transaction somewhere the laundry can
// see or act on it: accepted onwards, through the custody chain, to the
// terminal states its ops screens still list ("Completed", cancellations).
// Everything before `accept` (inquiry, pending payment, preauthorized) is
// noise on a studio worklist - no garment has been committed to yet.
const OPS_LAST_TRANSITIONS = [
  TRANSITIONS.ACCEPT,
  TRANSITIONS.OPERATOR_ACCEPT,
  TRANSITIONS.LAUNDRY_MARK_READY,
  TRANSITIONS.LAUNDRY_CONFIRM_PICKUP,
  TRANSITIONS.LAUNDRY_CONFIRM_RETURN,
  TRANSITIONS.LAUNDRY_CONFIRM_RETURN_LATE,
  TRANSITIONS.LAUNDRY_MARK_PENDING_CLEANING,
  TRANSITIONS.LAUNDRY_START_CLEANING,
  TRANSITIONS.LAUNDRY_START_QUALITY_INSPECTION,
  TRANSITIONS.LAUNDRY_MARK_AVAILABLE,
  TRANSITIONS.MARK_OVERDUE,
  TRANSITIONS.AUTO_COMPLETE_FROM_READY,
  TRANSITIONS.AUTO_COMPLETE_FROM_PICKED_UP,
  TRANSITIONS.AUTO_COMPLETE_FROM_OVERDUE,
  TRANSITIONS.AUTO_COMPLETE_FROM_RETURNED,
  TRANSITIONS.AUTO_COMPLETE_FROM_CLEANING,
  TRANSITIONS.COMPLETE,
  TRANSITIONS.OPERATOR_COMPLETE,
  TRANSITIONS.CANCEL,
  TRANSITIONS.CANCEL_FROM_READY_FOR_PICKUP,
  TRANSITIONS.CANCEL_FROM_PICKED_UP,
  TRANSITIONS.CANCEL_FROM_OVERDUE,
  TRANSITIONS.CANCEL_FROM_RETURNED,
  // A completed rental keeps showing on the "Completed" tab while the two
  // parties review each other, so the review states are in scope too.
  TRANSITIONS.REVIEW_1_BY_PROVIDER,
  TRANSITIONS.REVIEW_2_BY_PROVIDER,
  TRANSITIONS.REVIEW_1_BY_CUSTOMER,
  TRANSITIONS.REVIEW_2_BY_CUSTOMER,
  TRANSITIONS.EXPIRE_CUSTOMER_REVIEW_PERIOD,
  TRANSITIONS.EXPIRE_PROVIDER_REVIEW_PERIOD,
  TRANSITIONS.EXPIRE_REVIEW_PERIOD,
];

// The accept transitions, shared verbatim with default-booking (cocloset-booking
// is a fork and did not rename them). create-availability-buffer.js keys off
// these.
const ACCEPT_TRANSITIONS = [TRANSITIONS.ACCEPT, TRANSITIONS.OPERATOR_ACCEPT];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

// Sharetribe's answer to a transition that isn't legal from the transaction's
// current state. Verified against the real Dev Integration API by firing
// `transition/laundry-mark-ready` at an inquiry-stage transaction: HTTP 409,
// `errors[0].code === 'transaction-invalid-transition'`, nothing written.
// `transition-not-allowed` is included because the API reference has used that
// name for the same condition; matching both costs nothing and a mismatch here
// would turn a clean 409 into an opaque 500.
const INVALID_TRANSITION_CODES = ['transaction-invalid-transition', 'transition-not-allowed'];

/**
 * Is this SDK error Sharetribe refusing an illegal transition (as opposed to a
 * 404, an auth failure, or a network error)?
 *
 * @param {*} error - a rejected sharetribe-flex-integration-sdk error
 * @returns {boolean}
 */
const isInvalidTransitionError = error => {
  const errors = error?.data?.errors;
  if (!Array.isArray(errors)) {
    return false;
  }
  return errors.some(e => INVALID_TRANSITION_CODES.includes(e?.code));
};

module.exports = {
  COCLOSET_BOOKING_PROCESS_NAME,
  STATES,
  TRANSITIONS,
  TRANSITION_TO_STATE,
  stateFromLastTransition,
  LAUNDRY_STATUS_TRANSITIONS,
  LAUNDRY_STATUSES,
  DAMAGE_REPORT_STATUS,
  transitionForStatus,
  OPS_LAST_TRANSITIONS,
  ACCEPT_TRANSITIONS,
  INVALID_TRANSITION_CODES,
  isInvalidTransitionError,
};
