import {
  TX_TRANSITION_ACTOR_CUSTOMER as CUSTOMER,
  TX_TRANSITION_ACTOR_PROVIDER as PROVIDER,
  CONDITIONAL_RESOLVER_WILDCARD,
  ConditionalResolver,
} from '../../transactions/transaction';

/**
 * State data for the `cocloset-booking` process on the TransactionPage.
 *
 * WHY THIS IS A SEPARATE FILE RATHER THAN A BRANCH IN THE BOOKING ONE
 * `getStateData` dispatches on process name and returns `{}` for anything it
 * does not recognise, while `stateDataShape` marks `processName` and
 * `processState` as required. So without this file every Cocloset booking
 * renders a transaction page with no title, no headings and a PropTypes
 * failure - it is a prerequisite, not a refinement. And it cannot reuse
 * TransactionPage.stateDataBooking.js, because the graphs genuinely differ:
 * `cocloset-booking` inserts five states between `accepted` and `delivered`.
 *
 * NEITHER PARTY ACTS DURING THE LAUNDRY CHAIN
 * `ready-for-pickup` / `picked-up` / `overdue` / `returned` / `cleaning` are
 * driven by the laundry through the ops dashboard and the Integration API, not
 * by the customer or the provider. So none of them gets an action button here;
 * they are informational states whose job is to tell each party where the
 * garment is. That matches `statesNeedingProviderAttention` in
 * src/transactions/transactionProcessCoclosetBooking.js, which deliberately
 * stayed at `[PREAUTHORIZED]`.
 *
 * @param {*} txInfo details about the transaction
 * @param {*} processInfo details about the process
 */
export const getStateDataForCoclosetBookingProcess = (txInfo, processInfo) => {
  const {
    transaction,
    transactionRole,
    nextTransitions,
    onOpenCancelBookingModal,
    onOpenPartialRefundCancelModal,
    partialRefundCancelInProgress,
    partialRefundCancelError,
  } = txInfo;
  const isProviderBanned = transaction?.provider?.attributes?.banned;
  const isCustomerBanned = transaction?.customer?.attributes?.banned;
  const _ = CONDITIONAL_RESOLVER_WILDCARD;

  const {
    processName,
    processState,
    states,
    transitions,
    actionButtonProps,
    leaveReviewProps,
  } = processInfo;

  // ActivityFeed messages default to being keyed on the state a transition
  // leads TO (`TransactionPage.ActivityFeed.<process>.<state>`). That is not
  // expressive enough for this process, for two reasons:
  //
  //   1. `laundry-confirm-return` and `laundry-confirm-return-late` both lead
  //      to `returned`, and the whole point of the second one is that the
  //      garment came back late - which the feed should say.
  //   2. The three cleaning sub-phases are self-transitions on `cleaning`, so
  //      a state-keyed message would print the same sentence three times.
  //
  // Naming follows the template's own convention for this
  // (TransactionPage.stateDataNegotiation.js): a `.transition.` segment, which
  // also keeps transition keys from colliding with state keys in the same
  // namespace.
  const transitionMessages = [
    {
      // The first-time drop-off's own "in cleaning" moment (2026-09-21) - see
      // transitions.LAUNDRY_RECEIVE_FROM_PROVIDER in transactionProcessCoclosetBooking.js.
      transition: transitions.LAUNDRY_RECEIVE_FROM_PROVIDER,
      translationId:
        'TransactionPage.ActivityFeed.cocloset-booking.transition.laundry-receive-from-provider',
    },
    {
      transition: transitions.LAUNDRY_MARK_READY,
      translationId: 'TransactionPage.ActivityFeed.cocloset-booking.transition.laundry-mark-ready',
    },
    {
      // Same outcome, same message as LAUNDRY_MARK_READY above - see that transition's comment
      // in transactionProcessCoclosetBooking.js for why "mark ready" has two names.
      transition: transitions.LAUNDRY_MARK_READY_FROM_INITIAL_CLEANING,
      translationId: 'TransactionPage.ActivityFeed.cocloset-booking.transition.laundry-mark-ready',
    },
    {
      transition: transitions.LAUNDRY_CONFIRM_PICKUP,
      translationId:
        'TransactionPage.ActivityFeed.cocloset-booking.transition.laundry-confirm-pickup',
    },
    {
      transition: transitions.LAUNDRY_CONFIRM_RETURN,
      translationId:
        'TransactionPage.ActivityFeed.cocloset-booking.transition.laundry-confirm-return',
    },
    {
      transition: transitions.LAUNDRY_CONFIRM_RETURN_LATE,
      translationId:
        'TransactionPage.ActivityFeed.cocloset-booking.transition.laundry-confirm-return-late',
    },
    {
      transition: transitions.LAUNDRY_MARK_PENDING_CLEANING,
      translationId:
        'TransactionPage.ActivityFeed.cocloset-booking.transition.laundry-mark-pending-cleaning',
    },
    {
      transition: transitions.LAUNDRY_START_CLEANING,
      translationId:
        'TransactionPage.ActivityFeed.cocloset-booking.transition.laundry-start-cleaning',
    },
    {
      transition: transitions.LAUNDRY_START_QUALITY_INSPECTION,
      translationId:
        'TransactionPage.ActivityFeed.cocloset-booking.transition.laundry-start-quality-inspection',
    },
    {
      transition: transitions.LAUNDRY_MARK_AVAILABLE,
      translationId:
        'TransactionPage.ActivityFeed.cocloset-booking.transition.laundry-mark-available',
    },
    {
      transition: transitions.MARK_OVERDUE,
      translationId: 'TransactionPage.ActivityFeed.cocloset-booking.transition.mark-overdue',
    },
  ];

  const shared = { processName, processState, transitionMessages };

  return (
    new ConditionalResolver([processState, transactionRole])
      .cond([states.INQUIRY, CUSTOMER], () => {
        const transitionNames = Array.isArray(nextTransitions)
          ? nextTransitions.map(t => t.attributes.name)
          : [];
        const requestAfterInquiry = transitions.REQUEST_PAYMENT_AFTER_INQUIRY;
        const hasCorrectNextTransition = transitionNames.includes(requestAfterInquiry);
        const showOrderPanel = !isProviderBanned && hasCorrectNextTransition;
        return { ...shared, showOrderPanel, showDetailCardHeadings: true };
      })
      .cond([states.INQUIRY, PROVIDER], () => {
        return { ...shared, showDetailCardHeadings: true };
      })
      .cond([states.PREAUTHORIZED, CUSTOMER], () => {
        return { ...shared, showDetailCardHeadings: true, showExtraInfo: true };
      })
      .cond([states.PREAUTHORIZED, PROVIDER], () => {
        const primary = isCustomerBanned ? null : actionButtonProps(transitions.ACCEPT, PROVIDER);
        const secondary = isCustomerBanned
          ? null
          : actionButtonProps(transitions.DECLINE, PROVIDER);
        return {
          ...shared,
          showDetailCardHeadings: true,
          showActionButtons: true,
          primaryButtonProps: primary,
          secondaryButtonProps: secondary,
        };
      })

      // ---- The laundry custody chain -------------------------------------
      // Informational for both parties. `showExtraInfo` is on for the customer
      // wherever the customer is the one who has to physically do something
      // (collect the garment, bring it back), so the page can carry a line of
      // guidance under the title.
      //
      // CUSTOMER SELF-CANCEL (2026-10-13): ACCEPTED is deliberately the only state with a
      // customer-facing cancel button. It covers BOTH scenarios the client asked for - the
      // provider has not yet dropped the garment off, or it was already at the laundry from a
      // previous cycle but the laundry has not yet run its ready-for-pickup prep - because
      // both collapse onto "nothing laundry-side has happened yet", which IS "still accepted"
      // (see the EDN's :transition/customer-cancel comment). Every later laundry state stays
      // operator-only pending a partial-refund design, so this cond must come BEFORE the
      // wildcard one below - ConditionalResolver takes the first match.
      //
      // `onAction` is overridden to OPEN A CONFIRMATION MODAL rather than transition
      // immediately (see actionButtonProps/getActionButtonPropsMaybe in TransactionPage.
      // stateData.js: `extra.onAction` replaces the default "transition now" behaviour). This
      // moves real money - a full refund - and must not fire on a single accidental click.
      // The real transition only fires from CancelBookingModal's onConfirm, in TransactionPage.js.
      .cond([states.ACCEPTED, CUSTOMER], () => {
        return {
          ...shared,
          showDetailCardHeadings: true,
          showActionButtons: true,
          primaryButtonProps: actionButtonProps(transitions.CUSTOMER_CANCEL, CUSTOMER, {
            onAction: onOpenCancelBookingModal,
            // Carried through so TransactionPage.js's CancelBookingModal fires the TRANSITION
            // THIS STATE actually needs, rather than a hardcoded one - see the sibling cond
            // below for why that matters now that there are two.
            transition: transitions.CUSTOMER_CANCEL,
          }),
        };
      })
      // NEW (2026-10-15), alongside states.ACCEPTED_ON_LAUNDRY itself. Wired to the NEW
      // customer-cancel-from-accepted-on-laundry transition (not CUSTOMER_CANCEL, which only
      // Sharetribe will accept from states.ACCEPTED) - see the EDN's own comment on that
      // transition for why omitting this cond would have been a silent regression on the
      // already-shipped self-cancel feature, not just a missing new one.
      //
      // MUST COME BEFORE the states.ACCEPTED_ON_LAUNDRY wildcard cond below - ConditionalResolver
      // takes the first match, same ordering requirement as the ACCEPTED/CUSTOMER cond above.
      .cond([states.ACCEPTED_ON_LAUNDRY, CUSTOMER], () => {
        return {
          ...shared,
          showDetailCardHeadings: true,
          showActionButtons: true,
          primaryButtonProps: actionButtonProps(
            transitions.CUSTOMER_CANCEL_FROM_ACCEPTED_ON_LAUNDRY,
            CUSTOMER,
            {
              onAction: onOpenCancelBookingModal,
              transition: transitions.CUSTOMER_CANCEL_FROM_ACCEPTED_ON_LAUNDRY,
            }
          ),
        };
      })
      .cond([states.ACCEPTED, _], () => {
        return { ...shared, showDetailCardHeadings: true };
      })
      // Informational wildcard for ACCEPTED_ON_LAUNDRY (provider, or any other role): nobody
      // but the laundry acts here, same shape as ACCEPTED's own wildcard above.
      .cond([states.ACCEPTED_ON_LAUNDRY, _], () => {
        return { ...shared, showDetailCardHeadings: true };
      })
      // CUSTOMER PARTIAL-REFUND SELF-CANCEL (2026-10-13). The garment has already reached the
      // laundry for its first wash, so unlike the ACCEPTED-state full-refund self-cancel
      // above, this one can only ever be a PARTIAL refund (total minus the cleaning fee) -
      // see server/api/customer-partial-refund-cancel.js and the EDN's own comment on
      // :transition/partial-refund-cancel-from-initial-cleaning for the full argument. This
      // cond MUST come before the wildcard INITIAL_CLEANING one below - ConditionalResolver
      // takes the first match - so the provider keeps falling through to the informational,
      // no-button branch.
      //
      // `onAction` opens a confirm modal (TransactionPage.js's onOpenPartialRefundCancelModal)
      // rather than firing anything immediately - this moves real money and must not fire on
      // a single accidental click, same reasoning as the ACCEPTED-state cancel. The real call
      // only fires from that modal's onConfirm, which dispatches partialRefundCancelThunk -
      // NOT the generic onTransition/makeTransitionThunk path, because this is a custom
      // multi-step server call, not a plain SDK transition dispatch. `inProgress`/`error` are
      // therefore read from this thunk's OWN state keys
      // (partialRefundCancelInProgress/-Error), not the generic transitionInProgress/
      // transitionError that `actionButtonProps` would otherwise wire in - a double-click
      // here could only ever be a retry of money-moving code.
      .cond([states.INITIAL_CLEANING, CUSTOMER], () => {
        return {
          ...shared,
          showDetailCardHeadings: true,
          showActionButtons: true,
          primaryButtonProps: actionButtonProps(
            transitions.PARTIAL_REFUND_CANCEL_FROM_INITIAL_CLEANING,
            CUSTOMER,
            {
              onAction: onOpenPartialRefundCancelModal,
              inProgress: partialRefundCancelInProgress,
              transitionError: partialRefundCancelError,
            }
          ),
        };
      })
      // The first-time drop-off's own "in cleaning" moment (2026-09-21). Same shape as
      // ACCEPTED/RETURNED/CLEANING: nobody but the laundry acts here. (PROVIDER falls through
      // to here too, since the cond above is CUSTOMER-only.)
      .cond([states.INITIAL_CLEANING, _], () => {
        return { ...shared, showDetailCardHeadings: true };
      })
      .cond([states.READY_FOR_PICKUP, CUSTOMER], () => {
        return { ...shared, showDetailCardHeadings: true, showExtraInfo: true };
      })
      .cond([states.READY_FOR_PICKUP, PROVIDER], () => {
        return { ...shared, showDetailCardHeadings: true };
      })
      .cond([states.PICKED_UP, CUSTOMER], () => {
        return { ...shared, showDetailCardHeadings: true, showExtraInfo: true };
      })
      .cond([states.PICKED_UP, PROVIDER], () => {
        return { ...shared, showDetailCardHeadings: true };
      })
      .cond([states.OVERDUE, CUSTOMER], () => {
        return { ...shared, showDetailCardHeadings: true, showExtraInfo: true };
      })
      .cond([states.OVERDUE, PROVIDER], () => {
        return { ...shared, showDetailCardHeadings: true };
      })
      .cond([states.RETURNED, _], () => {
        return { ...shared, showDetailCardHeadings: true };
      })
      .cond([states.CLEANING, _], () => {
        return { ...shared, showDetailCardHeadings: true };
      })

      // ---- Completion and reviews ----------------------------------------
      // Reaching `delivered` is what opens the review window, exactly as in
      // default-booking - it just happens later here, when cleaning finishes.
      //
      // CUSTOMER ONLY (2026-09-21): the provider can no longer review the customer at all -
      // see the EDN's :transition/review-1-by-customer comment. REVIEWED_BY_PROVIDER and
      // REVIEWED_BY_CUSTOMER are gone with it (nothing can reach them any more), so there is
      // no second review step to show either party.
      .cond([states.DELIVERED, CUSTOMER], () => {
        return {
          ...shared,
          showDetailCardHeadings: true,
          showReviewAsFirstLink: true,
          showActionButtons: true,
          primaryButtonProps: leaveReviewProps,
        };
      })
      .cond([states.DELIVERED, PROVIDER], () => {
        return { ...shared, showDetailCardHeadings: true };
      })
      .cond([states.REVIEWED, _], () => {
        return { ...shared, showDetailCardHeadings: true, showReviews: true };
      })
      .default(() => {
        // Default values for other states
        return { ...shared, showDetailCardHeadings: true };
      })
      .resolve()
  );
};
