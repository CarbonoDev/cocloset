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
  //
  // LAUNDRY_RECEIVE_FROM_PROVIDER gives the FIRST-TIME drop-off its own real
  // state (2026-09-21):
  //
  //   > "cuando laundry ingrese el ticket para iniciar el lavado, entre a un status de IN
  //   >  CLEANING, en ambas direcciones, es decir, cuando el provider lleve la prenda por
  //   >  primera vez" (Jonathan, 2026-09-21)
  //
  // It replaces server/api/laundry-receive-garment.js's former metadata-only write, which
  // deliberately fired no transition to avoid a process push. Now that a push is happening
  // anyway (bundled with the review-flow change below), the garment being physically received
  // gets INITIAL_CLEANING instead of staying invisible inside ACCEPTED.
  //
  // ONLY on the "not already at the studio" path - server/api/laundry-receive-garment.js only
  // ever calls this when the listing's onLaundry was false. A garment that starts a rental
  // already on the studio's rack (onLaundry true, already cleaned from a previous cycle) skips
  // this and goes straight from ACCEPTED to READY_FOR_PICKUP via LAUNDRY_MARK_READY below,
  // unchanged from before this change.
  LAUNDRY_RECEIVE_FROM_PROVIDER: 'transition/laundry-receive-from-provider',
  // Every other laundry-managed limbo state has a cancel and a payout-carrying auto-complete
  // backstop (see PAYOUT_TRANSITIONS below and the EDN's own "every pre-payout state has an
  // operator cancel" invariant) - INITIAL_CLEANING needs both for the same reason: it is
  // pre-payout, and the laundry might never mark it ready.
  CANCEL_FROM_INITIAL_CLEANING: 'transition/cancel-from-initial-cleaning',
  // THE CUSTOMER-INITIATED partial-refund door (2026-10-13), a SECOND way out of
  // INITIAL_CLEANING alongside CANCEL_FROM_INITIAL_CLEANING above (the operator's full-refund
  // override - unchanged). Fired server-side, by our own server, only after it has
  // independently verified the caller and already settled a direct Stripe refund for
  // total-minus-cleaning-fee - see the EDN's own comment on this transition for the full
  // argument (Sharetribe's refund actions are always 100%-or-nothing, so this one carries
  // neither calculate-full-refund nor stripe-refund-payment). Never dispatched through the
  // generic transition thunk - see TransactionPage.duck.js's partialRefundCancelThunk.
  PARTIAL_REFUND_CANCEL_FROM_INITIAL_CLEANING: 'transition/partial-refund-cancel-from-initial-cleaning',
  AUTO_COMPLETE_FROM_INITIAL_CLEANING: 'transition/auto-complete-from-initial-cleaning',
  // ONE STEP, TWO NAMES. "Mark ready" from a garment already at the studio (ACCEPTED) and
  // "mark ready" from a garment that just finished its first wash (INITIAL_CLEANING) are the
  // same operator action reaching the same READY_FOR_PICKUP outcome, but the EDN's `:from` is
  // single-valued - same reason LAUNDRY_CONFIRM_RETURN/-_LATE are two names for "the garment
  // came back". server/api-util/coclosetBookingProcess.js's transitionForStatus() picks
  // between them from the transaction's real current state.
  LAUNDRY_MARK_READY: 'transition/laundry-mark-ready',
  LAUNDRY_MARK_READY_FROM_INITIAL_CLEANING: 'transition/laundry-mark-ready-from-initial-cleaning',
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
  // NEW (2026-10-15), alongside ACCEPTED_ON_LAUNDRY itself - the admin manual override,
  // mirroring CANCEL. See the state-split comment on ACCEPTED_ON_LAUNDRY below.
  CANCEL_FROM_ACCEPTED_ON_LAUNDRY: 'transition/cancel-from-accepted-on-laundry',
  // THE CUSTOMER'S OWN DOOR (2026-10-13), 'accepted' only. Full refund, same actions as
  // CANCEL above - see the EDN's :transition/customer-cancel comment for why this is the
  // only state with a customer-actor cancel: every later laundry state still needs an
  // operator and a partial-refund design that does not exist yet.
  CUSTOMER_CANCEL: 'transition/customer-cancel',
  // NEW (2026-10-15), alongside ACCEPTED_ON_LAUNDRY itself. Without this, splitting ACCEPTED
  // would have silently removed the customer's self-cancel for the
  // still-on-laundry-awaiting-ready scenario - see the EDN's own comment on this transition,
  // and the state-split comment on ACCEPTED_ON_LAUNDRY below, for the full argument (this was
  // PR #107's scenario 2).
  CUSTOMER_CANCEL_FROM_ACCEPTED_ON_LAUNDRY: 'transition/customer-cancel-from-accepted-on-laundry',
  CANCEL_FROM_READY_FOR_PICKUP: 'transition/cancel-from-ready-for-pickup',
  CANCEL_FROM_PICKED_UP: 'transition/cancel-from-picked-up',
  CANCEL_FROM_OVERDUE: 'transition/cancel-from-overdue',
  CANCEL_FROM_RETURNED: 'transition/cancel-from-returned',
  // THE ACTUAL NEW FEATURE (2026-10-15): "si el provider no lleva la prenda a la laundry para
  // la fecha de reserva, se cancela la transacción y se le hace el refund completo al
  // customer" - full refund, cancelled automatically at exactly booking-start, for a provider
  // who never dropped the garment off. Reachable only from ACCEPTED (the manual path) -
  // see the state-split comment on ACCEPTED_ON_LAUNDRY below for why that is now a real
  // guarantee rather than a hope, and the EDN's own comment on this transition for the rest of
  // the reasoning.
  CANCEL_FOR_MISSED_DROPOFF: 'transition/cancel-for-missed-dropoff',

  // The backend will mark the transaction completed.
  // Reachable only from 'accepted', i.e. the laundry never prepared the garment.
  COMPLETE: 'transition/complete',
  OPERATOR_COMPLETE: 'transition/operator-complete',
  // NEW (2026-10-15), alongside ACCEPTED_ON_LAUNDRY itself - mirrors OPERATOR_COMPLETE.
  OPERATOR_COMPLETE_FROM_ACCEPTED_ON_LAUNDRY: 'transition/operator-complete-from-accepted-on-laundry',
  // NEW (2026-10-15), alongside ACCEPTED_ON_LAUNDRY itself - the catastrophe backstop for "the
  // laundry never marked it ready". Same P30D period as AUTO_COMPLETE_FROM_READY; see the
  // EDN's own comment on this transition.
  AUTO_COMPLETE_FROM_ACCEPTED_ON_LAUNDRY: 'transition/auto-complete-from-accepted-on-laundry',

  // ONE-SIDED REVIEWS (2026-09-21).
  //
  //   > "puedes eliminar el flujo en el que el provider haga review del customer, de manera
  //   >  que si el customer hace un review, se publica el review y ahi finaliza la
  //   >  transaccion" (Jonathan, 2026-09-21)
  //
  // The provider can no longer review the customer at all: REVIEW_1_BY_PROVIDER,
  // REVIEW_2_BY_PROVIDER, REVIEW_2_BY_CUSTOMER, EXPIRE_CUSTOMER_REVIEW_PERIOD and
  // EXPIRE_PROVIDER_REVIEW_PERIOD (all only reachable through a provider review) are gone.
  // REVIEW_1_BY_CUSTOMER now publishes and ends the transaction in the same step, since the
  // customer is the only reviewer left.
  REVIEW_1_BY_CUSTOMER: 'transition/review-1-by-customer',
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
  // THE AUTO-ACCEPT / ALREADY-ON-LAUNDRY STATE (2026-10-15).
  //
  //   > "si el provider no lleva la prenda a la laundry para la fecha de reserva, se cancela
  //   >  la transacción (...) asegúrate de que solo es cuando la prenda NO esté en laundry"
  //
  // Before this split, BOTH ACCEPT (provider manually accepts, a drop-off is still owed) and
  // OPERATOR_ACCEPT (system auto-accepts because the garment is already on a laundry's rack -
  // see server/api/auto-accept-booking.js) landed in the same ACCEPTED state. A transition can
  // only ask "what state is this transaction in now", never "which prior transition got it
  // here", so a generic auto-cancel scheduled off ACCEPTED could not tell those two paths
  // apart - and the client's rule above requires that it must. Splitting the destination state
  // is the only EDN-native way to make that a structural guarantee: ACCEPTED is now reachable
  // ONLY via ACCEPT, and ACCEPTED_ON_LAUNDRY ONLY via OPERATOR_ACCEPT, so
  // CANCEL_FOR_MISSED_DROPOFF (which stays `:from ACCEPTED`) can never fire for a booking that
  // never needed a drop-off in the first place.
  //
  // Gets its own mirrors of every backstop and cancel ACCEPTED already had -
  // OPERATOR_COMPLETE_FROM_ACCEPTED_ON_LAUNDRY, AUTO_COMPLETE_FROM_ACCEPTED_ON_LAUNDRY,
  // CANCEL_FROM_ACCEPTED_ON_LAUNDRY, CUSTOMER_CANCEL_FROM_ACCEPTED_ON_LAUNDRY - so the split
  // closes no door that was open before it (see each transition's own comment above).
  ACCEPTED_ON_LAUNDRY: 'accepted-on-laundry',
  // The first-time drop-off's own "in cleaning" state (2026-09-21) - see
  // LAUNDRY_RECEIVE_FROM_PROVIDER above. The return leg's equivalent moment already has one
  // (CLEANING); this is the same idea for the leg that used to have none.
  INITIAL_CLEANING: 'initial-cleaning',
  READY_FOR_PICKUP: 'ready-for-pickup',
  PICKED_UP: 'picked-up',
  OVERDUE: 'overdue',
  RETURNED: 'returned',
  CLEANING: 'cleaning',
  EXPIRED: 'expired',
  CANCELED: 'canceled',
  DELIVERED: 'delivered',
  // REVIEWED_BY_CUSTOMER and REVIEWED_BY_PROVIDER are gone (2026-09-21): with only one
  // reviewer left, REVIEW_1_BY_CUSTOMER goes straight from DELIVERED to REVIEWED.
  REVIEWED: 'reviewed',
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
        // :to CHANGED (2026-10-15) from states.ACCEPTED to states.ACCEPTED_ON_LAUNDRY - see
        // the state-split comment on states.ACCEPTED_ON_LAUNDRY above.
        [transitions.OPERATOR_ACCEPT]: states.ACCEPTED_ON_LAUNDRY,
      },
    },

    [states.DECLINED]: {},
    [states.EXPIRED]: {},
    [states.ACCEPTED]: {
      on: {
        // Garment coming from its owner for the first time: it gets a wash first.
        [transitions.LAUNDRY_RECEIVE_FROM_PROVIDER]: states.INITIAL_CLEANING,
        [transitions.CANCEL]: states.CANCELED,
        [transitions.CUSTOMER_CANCEL]: states.CANCELED,
        // NEW (2026-10-15): the auto-cancel for a missed drop-off, safe here only because this
        // state is now reachable solely via ACCEPT - see the state-split comment on
        // states.ACCEPTED_ON_LAUNDRY above.
        [transitions.CANCEL_FOR_MISSED_DROPOFF]: states.CANCELED,
        [transitions.COMPLETE]: states.DELIVERED,
        [transitions.OPERATOR_COMPLETE]: states.DELIVERED,
      },
    },

    // THE AUTO-ACCEPT / ALREADY-ON-LAUNDRY STATE (2026-10-15) - see states.ACCEPTED_ON_LAUNDRY's
    // own comment above. LAUNDRY_MARK_READY's :from moved here from ACCEPTED (it was already
    // exclusively this path's transition in practice), and the rest mirror ACCEPTED's own
    // backstops/cancels under their "-from-accepted-on-laundry" names.
    [states.ACCEPTED_ON_LAUNDRY]: {
      on: {
        [transitions.LAUNDRY_MARK_READY]: states.READY_FOR_PICKUP,
        [transitions.OPERATOR_COMPLETE_FROM_ACCEPTED_ON_LAUNDRY]: states.DELIVERED,
        [transitions.AUTO_COMPLETE_FROM_ACCEPTED_ON_LAUNDRY]: states.DELIVERED,
        [transitions.CANCEL_FROM_ACCEPTED_ON_LAUNDRY]: states.CANCELED,
        [transitions.CUSTOMER_CANCEL_FROM_ACCEPTED_ON_LAUNDRY]: states.CANCELED,
      },
    },

    // First-time drop-off's "in cleaning" moment (2026-09-21) - see
    // LAUNDRY_RECEIVE_FROM_PROVIDER above.
    [states.INITIAL_CLEANING]: {
      on: {
        [transitions.LAUNDRY_MARK_READY_FROM_INITIAL_CLEANING]: states.READY_FOR_PICKUP,
        [transitions.CANCEL_FROM_INITIAL_CLEANING]: states.CANCELED,
        [transitions.PARTIAL_REFUND_CANCEL_FROM_INITIAL_CLEANING]: states.CANCELED,
        [transitions.AUTO_COMPLETE_FROM_INITIAL_CLEANING]: states.DELIVERED,
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
    // Only one exit left (2026-09-21): REVIEW_1_BY_CUSTOMER now publishes and lands on REVIEWED
    // directly, since there is no provider review to wait for any more.
    [states.DELIVERED]: {
      on: {
        [transitions.EXPIRE_REVIEW_PERIOD]: states.REVIEWED,
        [transitions.REVIEW_1_BY_CUSTOMER]: states.REVIEWED,
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
    transitions.CANCEL_FROM_ACCEPTED_ON_LAUNDRY,
    transitions.CUSTOMER_CANCEL,
    transitions.CUSTOMER_CANCEL_FROM_ACCEPTED_ON_LAUNDRY,
    transitions.CANCEL_FOR_MISSED_DROPOFF,
    transitions.CANCEL_FROM_INITIAL_CLEANING,
    transitions.PARTIAL_REFUND_CANCEL_FROM_INITIAL_CLEANING,
    transitions.CANCEL_FROM_READY_FOR_PICKUP,
    transitions.CANCEL_FROM_PICKED_UP,
    transitions.CANCEL_FROM_OVERDUE,
    transitions.CANCEL_FROM_RETURNED,
    transitions.COMPLETE,
    transitions.OPERATOR_COMPLETE,
    transitions.OPERATOR_COMPLETE_FROM_ACCEPTED_ON_LAUNDRY,
    transitions.CONFIRM_PAYMENT,
    transitions.DECLINE,
    transitions.OPERATOR_DECLINE,
    transitions.EXPIRE,
    // The laundry custody chain is the customer-facing timeline, so every
    // step of it belongs in the activity feed.
    transitions.LAUNDRY_RECEIVE_FROM_PROVIDER,
    transitions.LAUNDRY_MARK_READY,
    transitions.LAUNDRY_MARK_READY_FROM_INITIAL_CLEANING,
    transitions.LAUNDRY_CONFIRM_PICKUP,
    transitions.LAUNDRY_CONFIRM_RETURN,
    transitions.LAUNDRY_CONFIRM_RETURN_LATE,
    transitions.LAUNDRY_MARK_PENDING_CLEANING,
    transitions.LAUNDRY_START_CLEANING,
    transitions.LAUNDRY_START_QUALITY_INSPECTION,
    transitions.LAUNDRY_MARK_AVAILABLE,
    transitions.MARK_OVERDUE,
    // The backstops move money and end the rental, so they are shown too.
    transitions.AUTO_COMPLETE_FROM_INITIAL_CLEANING,
    transitions.AUTO_COMPLETE_FROM_ACCEPTED_ON_LAUNDRY,
    transitions.AUTO_COMPLETE_FROM_READY,
    transitions.AUTO_COMPLETE_FROM_PICKED_UP,
    transitions.AUTO_COMPLETE_FROM_OVERDUE,
    transitions.AUTO_COMPLETE_FROM_RETURNED,
    transitions.AUTO_COMPLETE_FROM_CLEANING,
    transitions.REVIEW_1_BY_CUSTOMER,
  ].includes(transition);
};

// Processes might be different on how reviews are handled.
// Default processes use two-sided diamond shape, where either party can make the review first
export const isCustomerReview = transition => {
  return [transitions.REVIEW_1_BY_CUSTOMER].includes(transition);
};

// ONE-SIDED REVIEWS (2026-09-21): the provider can no longer review the customer at all, so
// this always returns false. Kept (rather than deleted) because ActivityFeed.js calls
// `process.isProviderReview` generically across every process module.
export const isProviderReview = () => false;

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
    transitions.AUTO_COMPLETE_FROM_INITIAL_CLEANING,
    transitions.AUTO_COMPLETE_FROM_ACCEPTED_ON_LAUNDRY,
    transitions.AUTO_COMPLETE_FROM_READY,
    transitions.AUTO_COMPLETE_FROM_PICKED_UP,
    transitions.AUTO_COMPLETE_FROM_OVERDUE,
    transitions.AUTO_COMPLETE_FROM_RETURNED,
    transitions.AUTO_COMPLETE_FROM_CLEANING,
    transitions.COMPLETE,
    transitions.OPERATOR_COMPLETE,
    transitions.OPERATOR_COMPLETE_FROM_ACCEPTED_ON_LAUNDRY,
    transitions.REVIEW_1_BY_CUSTOMER,
    transitions.EXPIRE_REVIEW_PERIOD,
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
    transitions.CANCEL_FROM_ACCEPTED_ON_LAUNDRY,
    transitions.CUSTOMER_CANCEL,
    transitions.CUSTOMER_CANCEL_FROM_ACCEPTED_ON_LAUNDRY,
    transitions.CANCEL_FOR_MISSED_DROPOFF,
    transitions.CANCEL_FROM_INITIAL_CLEANING,
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

/**
 * THE TRANSITIONS THAT PAY THE OWNER.
 *
 * Every transition in the EDN carrying `:action/stripe-create-payout`, transcribed. Read off
 * `ext/transaction-processes/cocloset-booking/process.edn` rather than guessed, and it must be
 * re-read whenever that file changes - a payout added there and not here would quietly go
 * uncounted.
 *
 * ── WHY TRANSITIONS AND NOT STATES ─────────────────────────────────────────
 * "Completed" could be read off the current state: money has moved by the time a rental is in
 * `cleaning` or `delivered`. But a state is where a rental IS, and payout is something that
 * HAPPENED. The two come apart the moment the graph grows a path that reaches those states
 * another way, or one that leaves them - and the failure would be silent, because a wrong total
 * still looks like a total.
 *
 * The transition history is the record of what actually occurred, and the API already returns it
 * (`fields.transaction` asks for `transitions`), so asking the honest question costs nothing.
 *
 * Note the earliest one: payout fires when the studio opens the cleaning ticket, NOT when the
 * rental is finally marked delivered. That is deliberate - see the note on
 * `transition/laundry-mark-pending-cleaning` in the EDN - and it means an owner's money is
 * theirs while the garment is still in the wash. Earnings must say so.
 */
export const PAYOUT_TRANSITIONS = [
  transitions.LAUNDRY_MARK_PENDING_CLEANING,
  transitions.AUTO_COMPLETE_FROM_INITIAL_CLEANING,
  transitions.AUTO_COMPLETE_FROM_ACCEPTED_ON_LAUNDRY,
  transitions.AUTO_COMPLETE_FROM_READY,
  transitions.AUTO_COMPLETE_FROM_PICKED_UP,
  transitions.AUTO_COMPLETE_FROM_OVERDUE,
  transitions.AUTO_COMPLETE_FROM_RETURNED,
  transitions.COMPLETE,
  transitions.OPERATOR_COMPLETE,
  transitions.OPERATOR_COMPLETE_FROM_ACCEPTED_ON_LAUNDRY,
];

/**
 * Has this transaction paid the owner yet?
 *
 * @param {Array<Object>} [txTransitions] - `transaction.attributes.transitions`
 * @returns {boolean}
 */
export const hasPaidOut = (txTransitions = []) =>
  (Array.isArray(txTransitions) ? txTransitions : []).some(t =>
    PAYOUT_TRANSITIONS.includes(t?.transition)
  );

// WHO SEES THE QR, AND FROM WHEN. The two parties differ, deliberately.
//
// The PROVIDER's floor is PREAUTHORIZED - the moment payment is confirmed. Nothing about a
// booking they have not answered yet makes the code harmful to them; they are the one being
// asked to decide, and the code is part of what they are deciding about.
//
// The CUSTOMER's floor is ACCEPTED:
//
//   > "Cuando se renta, a partir de ese momento aparece el QR, puedes ocultarlo a menos que el
//   >  provider acepte o que se autoacepte la transacción? El provider si puede ver el QR"
//
// This REVERSES an earlier instruction, which is worth stating plainly rather than quietly
// overwriting. The customer floor used to be PREAUTHORIZED, at the client's request ("el QR
// debe mostrarse al cliente desde que se confirma el pago..."), on the reasoning that a code
// for a booking that might still be declined should be explained rather than hidden. The
// client has now decided the other way: a code the customer might carry to a counter for a
// rental that never happened is worse than waiting a beat for it. That is a product call, and
// it is theirs.
//
// "que acepte o que se autoacepte" needs no branch. Auto-accept is a transition INTO
// ACCEPTED, exactly like a manual accept - the two paths differ in who triggered them, not in
// where they land - so a rule keyed on the state covers both without knowing which happened.
//
// INITIAL_CLEANING belongs in this list too (2026-09-21): it sits BETWEEN accept and the first
// handover, on the leg where the garment goes to the studio for its first wash before the
// renter ever collects it. The code does not change while it is there - leaving it out would
// make the customer's own code vanish the moment the studio received the garment and reappear
// at READY_FOR_PICKUP, for no reason a renter could see.
//
// ACCEPTED_ON_LAUNDRY belongs here too (2026-10-15), for exactly the same reason, and missing
// it would be a real regression rather than a new gap: before the 2026-10-15 state split, the
// auto-accept path landed in ACCEPTED itself, so this list already covered it. Now that
// OPERATOR_ACCEPT lands in ACCEPTED_ON_LAUNDRY instead (see that state's own comment in the
// `states` export above), leaving it out of this list would make the customer's QR vanish for
// every auto-accepted booking the moment it is accepted - the opposite of "que acepte o que se
// autoacepte la transacción" below, which is the quote this list exists to satisfy.
const HANDOVER_QR_STATES_AFTER_ACCEPT = [
  states.ACCEPTED,
  states.ACCEPTED_ON_LAUNDRY,
  states.INITIAL_CLEANING,
  states.READY_FOR_PICKUP,
  states.PICKED_UP,
  states.OVERDUE,
];

export const HANDOVER_QR_CUSTOMER_VISIBLE_STATES = [
  states.ACCEPTED_ON_LAUNDRY,
  states.INITIAL_CLEANING,
  states.READY_FOR_PICKUP,
  states.PICKED_UP,
  states.OVERDUE,
];

// THE OWNER'S RULE, NARROWED TWICE (Jonathan, 2026-09-03).
//
//   > "El QR no debe poder verse hasta que el provider apruebe la transacción, esto aplica
//   >  solo si la prenda no esta en una laundry, a su vez, si los pasos siguientes aplican
//   >  para el customer, el provider no debe ver el QR"
//
// FLOOR. The owner used to see the code from PREAUTHORIZED, on the reasoning that the code is
// part of what they are being asked to decide about. It is not: what an unanswered booking
// needs from them is an answer. So the floor is ACCEPTED - their own approval.
//
// The exception is the whole point of the sentence. If the garment is ALREADY at a studio,
// there is nothing for the owner to do with a code and nothing their approval gates: the
// handover it describes is between the studio and the renter either way. Hiding it there
// would be hiding a code from the one party who might be asked to read it out over the phone,
// for a reason that does not apply. So PREAUTHORIZED stays visible in that case only.
//
// CEILING. Once the transaction reaches READY_FOR_PICKUP the remaining handovers are the
// RENTER's - collect it, bring it back - and the owner is not at the counter for either. A
// code on their screen then is an identifier for someone else's errand.
//
// ── NARROWED AGAIN, AND RESHAPED (Jonathan, 2026-09-08) ─────────────────────
//
//   > "puedes mostrar el QR al provider solo bajo estas condiciones? 1. Yo como provider
//   >  tengo la prenda en mi poder (onLaundry = false) y debo ir a entregarla a la lavanderia.
//   >  2. La prenda ya regresó a la lavandería, ya terminó el proceso de limpieza y puedo ir a
//   >  recogerla. 3. Una transacción fue cancelada y puedo recoger nuevamente la prenda"
//
// The owner's window is not one range with an exception any more. It is TWO ERRANDS, and
// which one is next is a question about the garment, not about the process:
//
//   * DROP OFF - the owner is holding the garment and has to take it in. Only while the
//     rental is live and only while the garment is genuinely with them.
//   * COLLECT  - the garment is at the studio and the rental is over, so the owner may come
//     and take it home. "Over" is the wash having finished (DELIVERED, and the review states
//     that follow it) or the booking having been called off (CANCELED).
//
// Between those two the owner has no errand at all: the studio has the garment and the next
// person at the counter is the renter. That is the stretch the client was looking at when
// they reported being shown "wait for the studio" copy for a code they had nothing to do with.
//
// A state on NEITHER list is a state where the owner sees nothing - which is now the default
// rather than something each state has to be excluded from.
export const HANDOVER_QR_PROVIDER_DROP_OFF_STATES = [states.ACCEPTED];

export const HANDOVER_QR_PROVIDER_COLLECT_STATES = [
  states.DELIVERED,
  // The wash is finished at DELIVERED and the garment does not move again on its own; REVIEWED
  // is bookkeeping between the customer and the process that happens afterwards. An owner who
  // has not been to collect yet still needs the code on the day they go.
  states.REVIEWED,
  states.CANCELED,
];

// Kept for readers that ask "which live state does the owner act in". Both lists are exported
// because the answer is now genuinely two-sided.
export const HANDOVER_QR_PROVIDER_VISIBLE_STATES = HANDOVER_QR_PROVIDER_DROP_OFF_STATES;

// Kept as the union of everything either party can ever see, for callers that only ask "could
// this state ever show a code" - not as a role's rule. It is no longer anyone's own list.
export const HANDOVER_QR_VISIBLE_STATES = [
  states.PREAUTHORIZED,
  ...HANDOVER_QR_STATES_AFTER_ACCEPT,
];

/**
 * Should the handover QR be shown for a transaction in this state?
 *
 * DEFAULTS TO THE PROVIDER'S RULE when no role is given, and that is now the NARROWER of the
 * two - it used to be the wider one. Both defaults err the same way on purpose: a caller that
 * does not say who is looking, or does not know where the garment is, hides the code rather
 * than showing it to someone who should not have it yet.
 *
 * @param {string} [state] - a cocloset-booking state name
 * @param {Object} [options]
 * @param {boolean} [options.isCustomer] - is the viewer the customer?
 * @param {boolean} [options.isAtLaundry] - is the garment already in a studio's custody?
 *   Only widens the OWNER's window, and only over PREAUTHORIZED.
 * @returns {boolean}
 */
export const isHandoverQrVisibleState = (
  state,
  { isCustomer = false, isAtLaundry = false } = {}
) => {
  if (isCustomer) {
    return HANDOVER_QR_CUSTOMER_VISIBLE_STATES.includes(state);
  }
  // WHICH ERRAND THE OWNER HAS, if any. `isAtLaundry` is not a widening flag any more: it
  // selects between two disjoint lists, because "take it in" and "come and get it" are
  // opposite errands and the garment can only be in one place.
  //
  // Defaults to false, so a caller that does not know where the garment is offers the
  // drop-off code rather than a collection code for a garment that may not be there - the
  // error that wastes a walk to the studio rather than one that sends somebody to a counter
  // with nothing to hand over.
  return isAtLaundry
    ? HANDOVER_QR_PROVIDER_COLLECT_STATES.includes(state)
    : HANDOVER_QR_PROVIDER_DROP_OFF_STATES.includes(state);
};

// The laundry states need the laundry's attention, not the garment owner's,
// and the laundry is not a party to the transaction in the Sharetribe sense.
// So this stays as it is in default-booking: the owner only has to act while
// a booking request is waiting to be accepted or declined.
export const statesNeedingProviderAttention = [states.PREAUTHORIZED];
