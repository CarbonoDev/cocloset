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
  // First-time drop-off's own "in cleaning" state (2026-09-21). See
  // TRANSITIONS.LAUNDRY_RECEIVE_FROM_PROVIDER below.
  INITIAL_CLEANING: 'initial-cleaning',
  READY_FOR_PICKUP: 'ready-for-pickup',
  PICKED_UP: 'picked-up',
  OVERDUE: 'overdue',
  RETURNED: 'returned',
  CLEANING: 'cleaning',
  EXPIRED: 'expired',
  CANCELED: 'canceled',
  DELIVERED: 'delivered',
  REVIEWED: 'reviewed',
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

  // Fired by laundry-receive-garment.js (2026-09-21) instead of that endpoint's former
  // metadata-only write - see the comment on :transition/laundry-receive-from-provider in the
  // EDN for why. ONLY on the "not already at the studio" path (onLaundry was false).
  LAUNDRY_RECEIVE_FROM_PROVIDER: 'transition/laundry-receive-from-provider',
  // ONE STEP, TWO NAMES: "mark ready" from ACCEPTED (garment was already at the studio) and
  // from INITIAL_CLEANING (garment just finished its first wash) reach the same outcome, but
  // the EDN's `:from` is single-valued - same reason LAUNDRY_CONFIRM_RETURN/-_LATE exist.
  // transitionForStatus() below picks between them from the transaction's real current state.
  LAUNDRY_MARK_READY: 'transition/laundry-mark-ready',
  LAUNDRY_MARK_READY_FROM_INITIAL_CLEANING: 'transition/laundry-mark-ready-from-initial-cleaning',
  LAUNDRY_CONFIRM_PICKUP: 'transition/laundry-confirm-pickup',
  LAUNDRY_CONFIRM_RETURN: 'transition/laundry-confirm-return',
  LAUNDRY_CONFIRM_RETURN_LATE: 'transition/laundry-confirm-return-late',
  LAUNDRY_MARK_PENDING_CLEANING: 'transition/laundry-mark-pending-cleaning',
  LAUNDRY_START_CLEANING: 'transition/laundry-start-cleaning',
  LAUNDRY_START_QUALITY_INSPECTION: 'transition/laundry-start-quality-inspection',
  LAUNDRY_MARK_AVAILABLE: 'transition/laundry-mark-available',
  MARK_OVERDUE: 'transition/mark-overdue',

  AUTO_COMPLETE_FROM_INITIAL_CLEANING: 'transition/auto-complete-from-initial-cleaning',
  AUTO_COMPLETE_FROM_READY: 'transition/auto-complete-from-ready',
  AUTO_COMPLETE_FROM_PICKED_UP: 'transition/auto-complete-from-picked-up',
  AUTO_COMPLETE_FROM_OVERDUE: 'transition/auto-complete-from-overdue',
  AUTO_COMPLETE_FROM_RETURNED: 'transition/auto-complete-from-returned',
  AUTO_COMPLETE_FROM_CLEANING: 'transition/auto-complete-from-cleaning',

  CANCEL: 'transition/cancel',
  CANCEL_FROM_INITIAL_CLEANING: 'transition/cancel-from-initial-cleaning',
  CANCEL_FROM_READY_FOR_PICKUP: 'transition/cancel-from-ready-for-pickup',
  CANCEL_FROM_PICKED_UP: 'transition/cancel-from-picked-up',
  CANCEL_FROM_OVERDUE: 'transition/cancel-from-overdue',
  CANCEL_FROM_RETURNED: 'transition/cancel-from-returned',

  COMPLETE: 'transition/complete',
  OPERATOR_COMPLETE: 'transition/operator-complete',

  // ONE-SIDED REVIEWS (2026-09-21): the provider can no longer review the customer at all -
  // see the EDN's :transition/review-1-by-customer comment for the removed transitions.
  REVIEW_1_BY_CUSTOMER: 'transition/review-1-by-customer',
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

  [TRANSITIONS.LAUNDRY_RECEIVE_FROM_PROVIDER]: STATES.INITIAL_CLEANING,
  [TRANSITIONS.LAUNDRY_MARK_READY]: STATES.READY_FOR_PICKUP,
  [TRANSITIONS.LAUNDRY_MARK_READY_FROM_INITIAL_CLEANING]: STATES.READY_FOR_PICKUP,
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

  [TRANSITIONS.AUTO_COMPLETE_FROM_INITIAL_CLEANING]: STATES.DELIVERED,
  [TRANSITIONS.AUTO_COMPLETE_FROM_READY]: STATES.DELIVERED,
  [TRANSITIONS.AUTO_COMPLETE_FROM_PICKED_UP]: STATES.DELIVERED,
  [TRANSITIONS.AUTO_COMPLETE_FROM_OVERDUE]: STATES.DELIVERED,
  [TRANSITIONS.AUTO_COMPLETE_FROM_RETURNED]: STATES.DELIVERED,
  [TRANSITIONS.AUTO_COMPLETE_FROM_CLEANING]: STATES.DELIVERED,

  [TRANSITIONS.CANCEL]: STATES.CANCELED,
  [TRANSITIONS.CANCEL_FROM_INITIAL_CLEANING]: STATES.CANCELED,
  [TRANSITIONS.CANCEL_FROM_READY_FOR_PICKUP]: STATES.CANCELED,
  [TRANSITIONS.CANCEL_FROM_PICKED_UP]: STATES.CANCELED,
  [TRANSITIONS.CANCEL_FROM_OVERDUE]: STATES.CANCELED,
  [TRANSITIONS.CANCEL_FROM_RETURNED]: STATES.CANCELED,

  [TRANSITIONS.COMPLETE]: STATES.DELIVERED,
  [TRANSITIONS.OPERATOR_COMPLETE]: STATES.DELIVERED,

  [TRANSITIONS.REVIEW_1_BY_CUSTOMER]: STATES.REVIEWED,
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

/**
 * Is this listing sold through the `cocloset-booking` process?
 *
 * A listing's process is `publicData.transactionProcessAlias`, e.g.
 * 'cocloset-booking/release-1' - the alias carries a release suffix, so the
 * comparison is on the part before the '/'. Needed by the endpoints that create
 * a reservation (initiate-privileged.js / transition-privileged.js): those are
 * shared by every process in the template (booking, purchase, inquiry,
 * negotiation), and Cocloset-specific work must not run for the others.
 *
 * @param {Object} [listing] - a listing API entity
 * @returns {boolean}
 */
const isCoclosetBookingListing = listing => {
  const alias = listing?.attributes?.publicData?.transactionProcessAlias;
  return typeof alias === 'string' && alias.split('/')[0] === COCLOSET_BOOKING_PROCESS_NAME;
};

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
  // A SECOND TWO-WAY BRANCH (2026-09-21), for the same reason as `returned` below:
  // LAUNDRY_MARK_READY only accepts ACCEPTED and LAUNDRY_MARK_READY_FROM_INITIAL_CLEANING only
  // accepts INITIAL_CLEANING. The ops row is still just "mark ready" either way; the server
  // reads the transaction's real state to pick.
  'ready-for-pickup': {
    byState: {
      [STATES.ACCEPTED]: TRANSITIONS.LAUNDRY_MARK_READY,
      [STATES.INITIAL_CLEANING]: TRANSITIONS.LAUNDRY_MARK_READY_FROM_INITIAL_CLEANING,
    },
    fallback: TRANSITIONS.LAUNDRY_MARK_READY,
  },
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
  TRANSITIONS.LAUNDRY_RECEIVE_FROM_PROVIDER,
  TRANSITIONS.LAUNDRY_MARK_READY,
  TRANSITIONS.LAUNDRY_MARK_READY_FROM_INITIAL_CLEANING,
  TRANSITIONS.LAUNDRY_CONFIRM_PICKUP,
  TRANSITIONS.LAUNDRY_CONFIRM_RETURN,
  TRANSITIONS.LAUNDRY_CONFIRM_RETURN_LATE,
  TRANSITIONS.LAUNDRY_MARK_PENDING_CLEANING,
  TRANSITIONS.LAUNDRY_START_CLEANING,
  TRANSITIONS.LAUNDRY_START_QUALITY_INSPECTION,
  TRANSITIONS.LAUNDRY_MARK_AVAILABLE,
  TRANSITIONS.MARK_OVERDUE,
  TRANSITIONS.AUTO_COMPLETE_FROM_INITIAL_CLEANING,
  TRANSITIONS.AUTO_COMPLETE_FROM_READY,
  TRANSITIONS.AUTO_COMPLETE_FROM_PICKED_UP,
  TRANSITIONS.AUTO_COMPLETE_FROM_OVERDUE,
  TRANSITIONS.AUTO_COMPLETE_FROM_RETURNED,
  TRANSITIONS.AUTO_COMPLETE_FROM_CLEANING,
  TRANSITIONS.COMPLETE,
  TRANSITIONS.OPERATOR_COMPLETE,
  TRANSITIONS.CANCEL,
  TRANSITIONS.CANCEL_FROM_INITIAL_CLEANING,
  TRANSITIONS.CANCEL_FROM_READY_FOR_PICKUP,
  TRANSITIONS.CANCEL_FROM_PICKED_UP,
  TRANSITIONS.CANCEL_FROM_OVERDUE,
  TRANSITIONS.CANCEL_FROM_RETURNED,
  // A completed rental keeps showing on the "Completed" tab while the customer's review
  // window is still open (2026-09-21: one-sided now, so just these two).
  TRANSITIONS.REVIEW_1_BY_CUSTOMER,
  TRANSITIONS.EXPIRE_REVIEW_PERIOD,
];

// The accept transitions, shared verbatim with default-booking (cocloset-booking
// is a fork and did not rename them). create-availability-buffer.js keys off
// these.
const ACCEPT_TRANSITIONS = [TRANSITIONS.ACCEPT, TRANSITIONS.OPERATOR_ACCEPT];

// ---------------------------------------------------------------------------
// "Active transaction"
// ---------------------------------------------------------------------------
//
// THE DEFINITION: a transaction is ACTIVE when it has been accepted and has not
// yet reached a terminal state. Concretely, the seven states below - everything
// from `accept` up to (but not including) the states nothing can leave:
//
//   accepted, initial-cleaning, ready-for-pickup, picked-up, overdue, returned, cleaning
//
// Read off the EDN, that is exactly "someone has committed a real garment to a
// real booking, and the booking is not finished". Its complement, deliberately:
//
//   * inquiry / pending-payment / payment-expired / preauthorized - PRE-accept.
//     No garment is committed; a provider has not agreed to anything. Treating
//     an inquiry as active would freeze a listing on the strength of a stranger
//     asking a question, and every transaction in Dev is at `inquire`.
//   * declined / expired - the booking never happened.
//   * delivered / reviewed - the rental is over. A review is bookkeeping
//     between the customer and the process; it does not hold a garment.
//   * canceled - over, by definition.
//
// WHERE IT IS USED, AND WHICH WAY IT FAILS
// server/api-util/listingCustody.js gates the custody/assignment writes on
// "this listing has no active transaction". That check must fail CLOSED: a
// transaction we cannot see is a transaction we must assume exists.
//
// That matters here because `lastTransitions` (the native, genuinely-working
// transactions.query filter) fails closed in the OPPOSITE sense: an unrecognised
// transition name is not rejected, it just matches nothing (verified against Dev
// - see OPS_LAST_TRANSITIONS above). So a typo in this list would make an active
// transaction INVISIBLE and would let a garment be reassigned mid-rental. Which
// is why the list is DERIVED from TRANSITION_TO_STATE rather than typed out: a
// transition can only be omitted by being absent from the transcription above,
// where it would already be breaking stateFromLastTransition().
const ACTIVE_STATES = [
  STATES.ACCEPTED,
  STATES.INITIAL_CLEANING,
  STATES.READY_FOR_PICKUP,
  STATES.PICKED_UP,
  STATES.OVERDUE,
  STATES.RETURNED,
  STATES.CLEANING,
];

// Every transition whose `:to` is one of ACTIVE_STATES, for narrowing
// `transactions.query({ lastTransitions })`. Derived, never hand-listed.
const ACTIVE_LAST_TRANSITIONS = Object.keys(TRANSITION_TO_STATE).filter(transition =>
  ACTIVE_STATES.includes(TRANSITION_TO_STATE[transition])
);

/**
 * Is a transaction in one of the ACTIVE_STATES, judged from its last transition?
 *
 * @param {string} [lastTransition] - `transaction.attributes.lastTransition`
 * @returns {boolean} false for an unknown/absent transition
 */
const isActiveLastTransition = lastTransition =>
  ACTIVE_STATES.includes(stateFromLastTransition(lastTransition));

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
  isCoclosetBookingListing,
  LAUNDRY_STATUS_TRANSITIONS,
  LAUNDRY_STATUSES,
  DAMAGE_REPORT_STATUS,
  transitionForStatus,
  OPS_LAST_TRANSITIONS,
  ACCEPT_TRANSITIONS,
  ACTIVE_STATES,
  ACTIVE_LAST_TRANSITIONS,
  isActiveLastTransition,
  INVALID_TRANSITION_CODES,
  isInvalidTransitionError,
};
