/**
 * Transaction process graph for Cocloset laundry-mediated bookings:
 *   - cocloset-booking
 *
 * This mirrors ext/transaction-processes/cocloset-booking/process.edn.
 * It is a fork of transactionProcessBooking.js (default-booking) with the
 * laundry custody chain inserted between 'accepted' and 'delivered'.
 *
 * Keep the two files in sync: the EDN is the source of truth, this file only
 * tells the client which transitions and states exist.
 */

/**
 * Transitions
 *
 * These strings must sync with values defined in Marketplace API,
 * since transaction objects given by API contain info about last transitions.
 * All the actions in API side happen in transitions,
 * so we need to understand what those strings mean.
 */

export const transitions = {
  // When a customer makes a booking to a listing, a transaction is
  // created with the initial request-payment transition.
  // At this transition a PaymentIntent is created by Marketplace API.
  // After this transition, the actual payment must be made on client-side directly to Stripe.
  REQUEST_PAYMENT: 'transition/request-payment',

  // A customer can also initiate a transaction with an inquiry, and
  // then transition that with a request.
  INQUIRE: 'transition/inquire',
  REQUEST_PAYMENT_AFTER_INQUIRY: 'transition/request-payment-after-inquiry',

  // Stripe SDK might need to ask 3D security from customer, in a separate front-end step.
  // Therefore we need to make another transition to Marketplace API,
  // to tell that the payment is confirmed.
  CONFIRM_PAYMENT: 'transition/confirm-payment',

  // If the payment is not confirmed in the time limit set in transaction process (by default 15min)
  // the transaction will expire automatically.
  EXPIRE_PAYMENT: 'transition/expire-payment',

  // When the provider accepts or declines a transaction from the
  // SalePage, it is transitioned with the accept or decline transition.
  ACCEPT: 'transition/accept',
  DECLINE: 'transition/decline',

  // The operator can accept or decline the offer on behalf of the provider
  OPERATOR_ACCEPT: 'transition/operator-accept',
  OPERATOR_DECLINE: 'transition/operator-decline',

  // The backend automatically expire the transaction.
  EXPIRE: 'transition/expire',

  // The laundry custody chain. Every one of these is an operator transition:
  // Sharetribe has no 'laundry' actor role, so they are fired server-side
  // through the Integration API after server/api-util/laundryAuth.js has
  // verified the caller is the laundry assigned to this transaction.
  LAUNDRY_MARK_READY: 'transition/laundry-mark-ready',
  LAUNDRY_CONFIRM_PICKUP: 'transition/laundry-confirm-pickup',
  LAUNDRY_CONFIRM_RETURN: 'transition/laundry-confirm-return',
  LAUNDRY_CONFIRM_RETURN_LATE: 'transition/laundry-confirm-return-late',

  // The three cleaning sub-phases. LAUNDRY_MARK_PENDING_CLEANING enters the
  // 'cleaning' state; the other two are self-transitions on it. All three
  // carry action/privileged-update-metadata, so each is timestamped and
  // audited in transaction.attributes.transitions.
  LAUNDRY_MARK_PENDING_CLEANING: 'transition/laundry-mark-pending-cleaning',
  LAUNDRY_START_CLEANING: 'transition/laundry-start-cleaning',
  LAUNDRY_START_QUALITY_INSPECTION: 'transition/laundry-start-quality-inspection',

  // Cleaning done, garment back in inventory. This is the normal "complete".
  LAUNDRY_MARK_AVAILABLE: 'transition/laundry-mark-available',

  // The backend flags a garment that was not returned by booking end + 1 day.
  MARK_OVERDUE: 'transition/mark-overdue',

  // Automatic backstops. They exist so that a laundry which stops scanning
  // can never withhold the owner's payout or strand a transaction.
  AUTO_COMPLETE_FROM_READY: 'transition/auto-complete-from-ready',
  AUTO_COMPLETE_FROM_PICKED_UP: 'transition/auto-complete-from-picked-up',
  AUTO_COMPLETE_FROM_OVERDUE: 'transition/auto-complete-from-overdue',
  AUTO_COMPLETE_FROM_RETURNED: 'transition/auto-complete-from-returned',
  AUTO_COMPLETE_FROM_CLEANING: 'transition/auto-complete-from-cleaning',

  // Admin can also cancel the transition. There is one cancel per state that
  // has not yet paid the owner out: payout fires on the way out of
  // 'returned' (into 'cleaning'), and Sharetribe has no post-payout refund
  // action, so 'cleaning' is the first state with no cancel.
  CANCEL: 'transition/cancel',
  CANCEL_FROM_READY_FOR_PICKUP: 'transition/cancel-from-ready-for-pickup',
  CANCEL_FROM_PICKED_UP: 'transition/cancel-from-picked-up',
  CANCEL_FROM_OVERDUE: 'transition/cancel-from-overdue',
  CANCEL_FROM_RETURNED: 'transition/cancel-from-returned',

  // The backend will mark the transaction completed.
  // Reachable only from 'accepted', i.e. the laundry never prepared the garment.
  COMPLETE: 'transition/complete',
  OPERATOR_COMPLETE: 'transition/operator-complete',

  // Reviews are given through transaction transitions. Review 1 can be
  // by provider or customer, and review 2 will be the other party of
  // the transaction.
  REVIEW_1_BY_PROVIDER: 'transition/review-1-by-provider',
  REVIEW_2_BY_PROVIDER: 'transition/review-2-by-provider',
  REVIEW_1_BY_CUSTOMER: 'transition/review-1-by-customer',
  REVIEW_2_BY_CUSTOMER: 'transition/review-2-by-customer',
  EXPIRE_CUSTOMER_REVIEW_PERIOD: 'transition/expire-customer-review-period',
  EXPIRE_PROVIDER_REVIEW_PERIOD: 'transition/expire-provider-review-period',
  EXPIRE_REVIEW_PERIOD: 'transition/expire-review-period',
};

/**
 * States
 *
 * These constants are only for making it clear how transitions work together.
 * You should not use these constants outside of this file.
 *
 * Note: these states are not in sync with states used transaction process definitions
 *       in Marketplace API. Only last transitions are passed along transaction object.
 */
export const states = {
  INITIAL: 'initial',
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

/**
 * Description of transaction process graph
 *
 * You should keep this in sync with transaction process defined in Marketplace API
 *
 * Note: we don't use yet any state machine library,
 *       but this description format is following Xstate (FSM library)
 *       https://xstate.js.org/docs/
 */
export const graph = {
  // id is defined only to support Xstate format.
  // However if you have multiple transaction processes defined,
  // it is best to keep them in sync with transaction process aliases.
  id: 'cocloset-booking/release-1',

  // This 'initial' state is a starting point for new transaction
  initial: states.INITIAL,

  // States
  states: {
    [states.INITIAL]: {
      on: {
        [transitions.INQUIRE]: states.INQUIRY,
        [transitions.REQUEST_PAYMENT]: states.PENDING_PAYMENT,
      },
    },
    [states.INQUIRY]: {
      on: {
        [transitions.REQUEST_PAYMENT_AFTER_INQUIRY]: states.PENDING_PAYMENT,
      },
    },

    [states.PENDING_PAYMENT]: {
      on: {
        [transitions.EXPIRE_PAYMENT]: states.PAYMENT_EXPIRED,
        [transitions.CONFIRM_PAYMENT]: states.PREAUTHORIZED,
      },
    },

    [states.PAYMENT_EXPIRED]: {},
    [states.PREAUTHORIZED]: {
      on: {
        [transitions.DECLINE]: states.DECLINED,
        [transitions.OPERATOR_DECLINE]: states.DECLINED,
        [transitions.EXPIRE]: states.EXPIRED,
        [transitions.ACCEPT]: states.ACCEPTED,
        [transitions.OPERATOR_ACCEPT]: states.ACCEPTED,
      },
    },

    [states.DECLINED]: {},
    [states.EXPIRED]: {},
    [states.ACCEPTED]: {
      on: {
        [transitions.LAUNDRY_MARK_READY]: states.READY_FOR_PICKUP,
        [transitions.CANCEL]: states.CANCELED,
        [transitions.COMPLETE]: states.DELIVERED,
        [transitions.OPERATOR_COMPLETE]: states.DELIVERED,
      },
    },

    [states.READY_FOR_PICKUP]: {
      on: {
        [transitions.LAUNDRY_CONFIRM_PICKUP]: states.PICKED_UP,
        [transitions.CANCEL_FROM_READY_FOR_PICKUP]: states.CANCELED,
        [transitions.AUTO_COMPLETE_FROM_READY]: states.DELIVERED,
      },
    },
    [states.PICKED_UP]: {
      on: {
        [transitions.LAUNDRY_CONFIRM_RETURN]: states.RETURNED,
        [transitions.MARK_OVERDUE]: states.OVERDUE,
        [transitions.CANCEL_FROM_PICKED_UP]: states.CANCELED,
        [transitions.AUTO_COMPLETE_FROM_PICKED_UP]: states.DELIVERED,
      },
    },
    [states.OVERDUE]: {
      on: {
        [transitions.LAUNDRY_CONFIRM_RETURN_LATE]: states.RETURNED,
        [transitions.CANCEL_FROM_OVERDUE]: states.CANCELED,
        [transitions.AUTO_COMPLETE_FROM_OVERDUE]: states.DELIVERED,
      },
    },
    [states.RETURNED]: {
      on: {
        [transitions.LAUNDRY_MARK_PENDING_CLEANING]: states.CLEANING,
        [transitions.CANCEL_FROM_RETURNED]: states.CANCELED,
        [transitions.AUTO_COMPLETE_FROM_RETURNED]: states.DELIVERED,
      },
    },
    // The two cleaning sub-phase transitions are self-transitions: they leave
    // the transaction in 'cleaning' and only advance metadata.cleaningPhase.
    // 'cleaning' has no cancel: the payout already fired on entering it.
    [states.CLEANING]: {
      on: {
        [transitions.LAUNDRY_START_CLEANING]: states.CLEANING,
        [transitions.LAUNDRY_START_QUALITY_INSPECTION]: states.CLEANING,
        [transitions.LAUNDRY_MARK_AVAILABLE]: states.DELIVERED,
        [transitions.AUTO_COMPLETE_FROM_CLEANING]: states.DELIVERED,
      },
    },

    [states.CANCELED]: {},
    [states.DELIVERED]: {
      on: {
        [transitions.EXPIRE_REVIEW_PERIOD]: states.REVIEWED,
        [transitions.REVIEW_1_BY_CUSTOMER]: states.REVIEWED_BY_CUSTOMER,
        [transitions.REVIEW_1_BY_PROVIDER]: states.REVIEWED_BY_PROVIDER,
      },
    },

    [states.REVIEWED_BY_CUSTOMER]: {
      on: {
        [transitions.REVIEW_2_BY_PROVIDER]: states.REVIEWED,
        [transitions.EXPIRE_PROVIDER_REVIEW_PERIOD]: states.REVIEWED,
      },
    },
    [states.REVIEWED_BY_PROVIDER]: {
      on: {
        [transitions.REVIEW_2_BY_CUSTOMER]: states.REVIEWED,
        [transitions.EXPIRE_CUSTOMER_REVIEW_PERIOD]: states.REVIEWED,
      },
    },
    [states.REVIEWED]: { type: 'final' },
  },
};

// Check if a transition is the kind that should be rendered
// when showing transition history (e.g. ActivityFeed)
// The first transition and most of the expiration transitions made by system are not relevant
export const isRelevantPastTransition = transition => {
  return [
    transitions.ACCEPT,
    transitions.OPERATOR_ACCEPT,
    transitions.CANCEL,
    transitions.CANCEL_FROM_READY_FOR_PICKUP,
    transitions.CANCEL_FROM_PICKED_UP,
    transitions.CANCEL_FROM_OVERDUE,
    transitions.CANCEL_FROM_RETURNED,
    transitions.COMPLETE,
    transitions.OPERATOR_COMPLETE,
    transitions.CONFIRM_PAYMENT,
    transitions.DECLINE,
    transitions.OPERATOR_DECLINE,
    transitions.EXPIRE,
    // The laundry custody chain is the customer-facing timeline, so every
    // step of it belongs in the activity feed.
    transitions.LAUNDRY_MARK_READY,
    transitions.LAUNDRY_CONFIRM_PICKUP,
    transitions.LAUNDRY_CONFIRM_RETURN,
    transitions.LAUNDRY_CONFIRM_RETURN_LATE,
    transitions.LAUNDRY_MARK_PENDING_CLEANING,
    transitions.LAUNDRY_START_CLEANING,
    transitions.LAUNDRY_START_QUALITY_INSPECTION,
    transitions.LAUNDRY_MARK_AVAILABLE,
    transitions.MARK_OVERDUE,
    // The backstops move money and end the rental, so they are shown too.
    transitions.AUTO_COMPLETE_FROM_READY,
    transitions.AUTO_COMPLETE_FROM_PICKED_UP,
    transitions.AUTO_COMPLETE_FROM_OVERDUE,
    transitions.AUTO_COMPLETE_FROM_RETURNED,
    transitions.AUTO_COMPLETE_FROM_CLEANING,
    transitions.REVIEW_1_BY_CUSTOMER,
    transitions.REVIEW_1_BY_PROVIDER,
    transitions.REVIEW_2_BY_CUSTOMER,
    transitions.REVIEW_2_BY_PROVIDER,
  ].includes(transition);
};

// Processes might be different on how reviews are handled.
// Default processes use two-sided diamond shape, where either party can make the review first
export const isCustomerReview = transition => {
  return [transitions.REVIEW_1_BY_CUSTOMER, transitions.REVIEW_2_BY_CUSTOMER].includes(transition);
};

// Processes might be different on how reviews are handled.
// Default processes use two-sided diamond shape, where either party can make the review first
export const isProviderReview = transition => {
  return [transitions.REVIEW_1_BY_PROVIDER, transitions.REVIEW_2_BY_PROVIDER].includes(transition);
};

// Check if the given transition is privileged.
//
// Privileged transitions need to be handled from a secure context,
// i.e. the backend. This helper is used to check if the transition
// should go through the local API endpoints, or if using JS SDK is
// enough.
//
// Note: the laundry transitions are NOT listed here. They are operator
// transitions, which are already a trusted context and are never invoked from
// the client SDK at all - they go through server/api/laundry-transaction-status.js
// and the Integration API.
export const isPrivileged = transition => {
  return [transitions.REQUEST_PAYMENT, transitions.REQUEST_PAYMENT_AFTER_INQUIRY].includes(
    transition
  );
};

// Check when transaction is completed (booking over)
export const isCompleted = transition => {
  const txCompletedTransitions = [
    transitions.LAUNDRY_MARK_AVAILABLE,
    transitions.AUTO_COMPLETE_FROM_READY,
    transitions.AUTO_COMPLETE_FROM_PICKED_UP,
    transitions.AUTO_COMPLETE_FROM_OVERDUE,
    transitions.AUTO_COMPLETE_FROM_RETURNED,
    transitions.AUTO_COMPLETE_FROM_CLEANING,
    transitions.COMPLETE,
    transitions.OPERATOR_COMPLETE,
    transitions.REVIEW_1_BY_CUSTOMER,
    transitions.REVIEW_1_BY_PROVIDER,
    transitions.REVIEW_2_BY_CUSTOMER,
    transitions.REVIEW_2_BY_PROVIDER,
    transitions.EXPIRE_REVIEW_PERIOD,
    transitions.EXPIRE_CUSTOMER_REVIEW_PERIOD,
    transitions.EXPIRE_PROVIDER_REVIEW_PERIOD,
  ];
  return txCompletedTransitions.includes(transition);
};

// Check when transaction is refunded (booking did not happen)
// In these transitions action/stripe-refund-payment is called
//
// Note: OPERATOR_DECLINE is included here even though the stock
// transactionProcessBooking.js omits it. It does carry
// action/stripe-refund-payment in the EDN, and this predicate drives the
// "Total refunded" label in OrderBreakdown.
export const isRefunded = transition => {
  const txRefundedTransitions = [
    transitions.EXPIRE_PAYMENT,
    transitions.EXPIRE,
    transitions.CANCEL,
    transitions.CANCEL_FROM_READY_FOR_PICKUP,
    transitions.CANCEL_FROM_PICKED_UP,
    transitions.CANCEL_FROM_OVERDUE,
    transitions.CANCEL_FROM_RETURNED,
    transitions.DECLINE,
    transitions.OPERATOR_DECLINE,
  ];
  return txRefundedTransitions.includes(transition);
};

// ---------------------------------------------------------------------------
// The handover QR
// ---------------------------------------------------------------------------
//
// Client mirror of HANDOVER_QR_VISIBLE_STATES in
// server/api-util/handoverQr.js, which carries the full reasoning. In short:
// ONE QR serves both handover events, so it is shown for as long as either is
// still ahead of the garment, and hidden once both are done.
//
// The two handover events are:
//   - laundry -> customer: LAUNDRY_CONFIRM_PICKUP, out of READY_FOR_PICKUP
//   - customer -> laundry: LAUNDRY_CONFIRM_RETURN (out of PICKED_UP) and
//     LAUNDRY_CONFIRM_RETURN_LATE (out of OVERDUE) - the same physical event,
//     split in two only because the EDN's `:from` is single-valued.
//
// So visibility ends at RETURNED, because the only ways into RETURNED are those
// two return transitions: being in RETURNED *is* the record that the second
// handover happened. That is why there is no `metadata.qrUsed` flag - the state
// machine already answers the question, and a duplicate flag could disagree
// with it.
export const HANDOVER_QR_TRANSITIONS = [
  transitions.LAUNDRY_CONFIRM_PICKUP,
  transitions.LAUNDRY_CONFIRM_RETURN,
  transitions.LAUNDRY_CONFIRM_RETURN_LATE,
];

export const HANDOVER_QR_VISIBLE_STATES = [
  states.ACCEPTED,
  states.READY_FOR_PICKUP,
  states.PICKED_UP,
  states.OVERDUE,
];

/**
 * Should the handover QR be shown for a transaction in this state?
 *
 * @param {string} [state] - a cocloset-booking state name
 * @returns {boolean}
 */
export const isHandoverQrVisibleState = state => HANDOVER_QR_VISIBLE_STATES.includes(state);

// The laundry states need the laundry's attention, not the garment owner's,
// and the laundry is not a party to the transaction in the Sharetribe sense.
// So this stays as it is in default-booking: the owner only has to act while
// a booking request is waiting to be accepted or declined.
export const statesNeedingProviderAttention = [states.PREAUTHORIZED];
