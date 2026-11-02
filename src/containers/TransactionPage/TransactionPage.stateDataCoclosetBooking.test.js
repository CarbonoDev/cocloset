/**
 * `getStateData` returns `{}` for a process it does not recognise, and
 * `stateDataShape` marks `processName`/`processState` as required - so the
 * cheapest way for this wiring to break is silently, with a blank transaction
 * page and a PropTypes warning. These tests walk every state the
 * cocloset-booking graph can reach and assert it resolves, plus check that the
 * translation keys each resolved state asks for actually exist.
 */
import messages from '../../translations/en.json';
import { getProcess } from '../../transactions/transaction';

import { getStateData } from './TransactionPage.stateData';

const process = getProcess('cocloset-booking');
const { transitions } = process;

const intlStub = {
  formatMessage: ({ id }) => id,
};

const transaction = lastTransition => ({
  id: { uuid: 'tx-1' },
  attributes: { processName: 'cocloset-booking', lastTransition },
  customer: { id: { uuid: 'customer-1' } },
  provider: { id: { uuid: 'provider-1' }, attributes: { banned: false } },
});

const stateDataFor = (lastTransition, transactionRole, extra = {}) =>
  getStateData(
    {
      transaction: transaction(lastTransition),
      transactionRole,
      intl: intlStub,
      transitionInProgress: null,
      transitionError: null,
      onTransition: () => null,
      sendReviewInProgress: false,
      sendReviewError: null,
      onOpenReviewModal: () => null,
      nextTransitions: [],
      onOpenPartialRefundCancelModal: () => null,
      partialRefundCancelInProgress: false,
      partialRefundCancelError: null,
      ...extra,
    },
    process
  );

// One transition into each state the graph can reach, so the sweep below is
// derived from the process rather than from a hand-written list.
const TRANSITION_PER_STATE = {
  inquiry: transitions.INQUIRE,
  'pending-payment': transitions.REQUEST_PAYMENT,
  'payment-expired': transitions.EXPIRE_PAYMENT,
  preauthorized: transitions.CONFIRM_PAYMENT,
  accepted: transitions.ACCEPT,
  // NEW (2026-10-15): the auto-accept/already-on-laundry state split.
  'accepted-on-laundry': transitions.OPERATOR_ACCEPT,
  declined: transitions.DECLINE,
  expired: transitions.EXPIRE,
  'initial-cleaning': transitions.LAUNDRY_RECEIVE_FROM_PROVIDER,
  'ready-for-pickup': transitions.LAUNDRY_MARK_READY,
  'picked-up': transitions.LAUNDRY_CONFIRM_PICKUP,
  overdue: transitions.MARK_OVERDUE,
  returned: transitions.LAUNDRY_CONFIRM_RETURN,
  cleaning: transitions.LAUNDRY_MARK_PENDING_CLEANING,
  canceled: transitions.CANCEL,
  delivered: transitions.LAUNDRY_MARK_AVAILABLE,
  reviewed: transitions.EXPIRE_REVIEW_PERIOD,
};

const ROLES = ['customer', 'provider'];

describe('TransactionPage state data for cocloset-booking', () => {
  it('covers every state in the process graph', () => {
    // Guards against the graph gaining a state that this file never sweeps.
    const graphStates = Object.keys(process.graph.states).filter(s => s !== 'initial');
    expect(Object.keys(TRANSITION_PER_STATE).sort()).toEqual(graphStates.sort());
  });

  it.each(
    Object.entries(TRANSITION_PER_STATE).flatMap(([state, transition]) =>
      ROLES.map(role => [state, role, transition])
    )
  )('resolves %s for the %s', (state, role, transition) => {
    const stateData = stateDataFor(transition, role);

    // The failure mode this exists to catch: an unrecognised process falls
    // through to `return {}`.
    expect(stateData).not.toEqual({});
    expect(stateData.processName).toBe('cocloset-booking');
    expect(stateData.processState).toBe(state);
  });

  it('has an en.json title for every state and role', () => {
    const missing = [];
    Object.entries(TRANSITION_PER_STATE).forEach(([state, transition]) => {
      ROLES.forEach(role => {
        const { processState } = stateDataFor(transition, role);
        const key = `TransactionPage.cocloset-booking.${role}.${processState}.title`;
        if (!messages[key]) {
          missing.push(key);
        }
      });
    });
    expect(missing).toEqual([]);
  });

  it('has an en.json extraInfo wherever a state asks to show one', () => {
    const missing = [];
    Object.entries(TRANSITION_PER_STATE).forEach(([state, transition]) => {
      ROLES.forEach(role => {
        const stateData = stateDataFor(transition, role);
        if (stateData.showExtraInfo) {
          const key = `TransactionPage.cocloset-booking.${role}.${stateData.processState}.extraInfo`;
          if (!messages[key]) {
            missing.push(key);
          }
        }
      });
    });
    expect(missing).toEqual([]);
  });

  it('has an en.json ActivityFeed message for every state, including the ones a transition message overrides', () => {
    // ActivityFeed computes the state-keyed default EAGERLY, even when a
    // transition-keyed message wins - so a missing state key is a react-intl
    // error on every render, not dead weight.
    const feedStates = Object.keys(TRANSITION_PER_STATE).filter(
      // These are never rendered as feed entries by the stock component.
      s => !['inquiry', 'pending-payment', 'payment-expired'].includes(s)
    );
    const missing = feedStates.filter(
      s => !messages[`TransactionPage.ActivityFeed.cocloset-booking.${s}`]
    );
    expect(missing).toEqual([]);
  });

  it('has an en.json message for every transition-keyed ActivityFeed override', () => {
    const { transitionMessages } = stateDataFor(transitions.ACCEPT, 'customer');
    expect(transitionMessages.length).toBeGreaterThan(0);
    const missing = transitionMessages
      .filter(m => !messages[m.translationId])
      .map(m => m.translationId);
    expect(missing).toEqual([]);
  });

  it('distinguishes the two return transitions and the three cleaning sub-phases', () => {
    // The whole reason transition-keyed messages exist here: these five
    // transitions collapse into two states, and each needs its own wording
    // (late vs on-time; which cleaning sub-phase).
    const { transitionMessages } = stateDataFor(transitions.ACCEPT, 'customer');
    const covered = transitionMessages.map(m => m.transition);
    [
      transitions.LAUNDRY_CONFIRM_RETURN,
      transitions.LAUNDRY_CONFIRM_RETURN_LATE,
      transitions.LAUNDRY_MARK_PENDING_CLEANING,
      transitions.LAUNDRY_START_CLEANING,
      transitions.LAUNDRY_START_QUALITY_INSPECTION,
    ].forEach(t => expect(covered).toContain(t));

    const byTransition = new Map(transitionMessages.map(m => [m.transition, m.translationId]));
    const distinguishedIds = [
      transitions.LAUNDRY_CONFIRM_RETURN,
      transitions.LAUNDRY_CONFIRM_RETURN_LATE,
      transitions.LAUNDRY_MARK_PENDING_CLEANING,
      transitions.LAUNDRY_START_CLEANING,
      transitions.LAUNDRY_START_QUALITY_INSPECTION,
    ].map(t => byTransition.get(t));
    expect(new Set(distinguishedIds).size).toBe(distinguishedIds.length);
  });

  it('gives the two "mark ready" transitions the same message on purpose (2026-09-21)', () => {
    // Unlike the return/cleaning split above, these two are not distinguished: they are
    // literally the same user-facing event ("your garment is ready for pickup") reached from
    // two different starting states, purely because the EDN's `:from` is single-valued - see
    // LAUNDRY_MARK_READY's comment in transactionProcessCoclosetBooking.js. Sharing one message
    // is correct here, not an oversight.
    const { transitionMessages } = stateDataFor(transitions.ACCEPT, 'customer');
    const byTransition = new Map(transitionMessages.map(m => [m.transition, m.translationId]));
    expect(byTransition.get(transitions.LAUNDRY_MARK_READY)).toEqual(
      byTransition.get(transitions.LAUNDRY_MARK_READY_FROM_INITIAL_CLEANING)
    );
  });

  it('offers no action buttons during the laundry custody chain', () => {
    // Those steps are driven by the laundry through the ops dashboard, not by
    // either party of the transaction - EXCEPT initial-cleaning for the customer specifically
    // (2026-10-13), which is covered on its own just below: the one deliberate exception, the
    // customer's partial-refund self-cancel button.
    ['initial-cleaning', 'ready-for-pickup', 'picked-up', 'overdue', 'returned', 'cleaning'].forEach(state => {
      ROLES.forEach(role => {
        if (state === 'initial-cleaning' && role === 'customer') {
          return;
        }
        const stateData = stateDataFor(TRANSITION_PER_STATE[state], role);
        expect(stateData.showActionButtons).toBeFalsy();
      });
    });
  });

  describe('the customer partial-refund self-cancel button (initial-cleaning only)', () => {
    it('shows the button to the CUSTOMER at initial-cleaning, and nowhere else', () => {
      Object.entries(TRANSITION_PER_STATE).forEach(([state, transition]) => {
        const stateData = stateDataFor(transition, 'customer');
        if (state === 'initial-cleaning') {
          expect(stateData.showActionButtons).toBe(true);
          expect(stateData.primaryButtonProps).toBeDefined();
        } else {
          // Every other customer-visible state either has no button at all, or (accepted,
          // delivered) a DIFFERENT one - this transition's own button must not leak there.
          expect(stateData.primaryButtonProps?.onAction).not.toBe(
            stateDataFor(TRANSITION_PER_STATE['initial-cleaning'], 'customer').primaryButtonProps
              .onAction
          );
        }
      });
    });

    it('never shows the button to the PROVIDER, even at initial-cleaning', () => {
      const stateData = stateDataFor(TRANSITION_PER_STATE['initial-cleaning'], 'provider');
      expect(stateData.showActionButtons).toBeFalsy();
    });

    it('opens the confirm modal rather than firing anything on click', () => {
      const onOpenPartialRefundCancelModal = jest.fn();
      const stateData = stateDataFor(TRANSITION_PER_STATE['initial-cleaning'], 'customer', {
        onOpenPartialRefundCancelModal,
      });

      stateData.primaryButtonProps.onAction();
      expect(onOpenPartialRefundCancelModal).toHaveBeenCalledTimes(1);
    });

    it("reads inProgress/error from the thunk's own state, not the generic transition state", () => {
      const stateData = stateDataFor(TRANSITION_PER_STATE['initial-cleaning'], 'customer', {
        transitionInProgress: transitions.PARTIAL_REFUND_CANCEL_FROM_INITIAL_CLEANING,
        transitionError: new Error('a generic transition error, must be ignored here'),
        partialRefundCancelInProgress: true,
        partialRefundCancelError: null,
      });

      // inProgress comes from partialRefundCancelInProgress (true here), NOT from
      // transitionInProgress === transitionName (which would also be true, by construction,
      // proving this isn't an accidental pass).
      expect(stateData.primaryButtonProps.inProgress).toBe(true);
      expect(stateData.primaryButtonProps.error).toBeNull();
    });

    it('has an en.json button label and error message', () => {
      const stateData = stateDataFor(TRANSITION_PER_STATE['initial-cleaning'], 'customer');
      expect(messages[stateData.primaryButtonProps.buttonText]).toBeDefined();
      expect(messages[stateData.primaryButtonProps.errorText]).toBeDefined();
    });
  });

  it('still lets the provider accept or decline a request', () => {
    const stateData = stateDataFor(transitions.CONFIRM_PAYMENT, 'provider');
    expect(stateData.showActionButtons).toBe(true);
    expect(messages[stateData.primaryButtonProps.buttonText]).toBeDefined();
    expect(messages[stateData.secondaryButtonProps.buttonText]).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Customer self-cancel (2026-10-13). ACCEPTED is deliberately the only
  // state with a customer-facing cancel button - see the EDN's
  // :transition/customer-cancel comment and this file's own comment on the
  // [states.ACCEPTED, CUSTOMER] cond for why.
  // -------------------------------------------------------------------------
  describe('customer self-cancel button, accepted only', () => {
    it('shows a cancel action for the CUSTOMER at accepted, wired to open the confirm modal', () => {
      const onOpenCancelBookingModal = () => null;
      const stateData = stateDataFor(transitions.ACCEPT, 'customer', { onOpenCancelBookingModal });

      expect(stateData.showActionButtons).toBe(true);
      expect(stateData.primaryButtonProps).toBeDefined();
      // The button must OPEN THE CONFIRM MODAL, not transition immediately - this moves a
      // real refund and must survive one accidental click.
      expect(stateData.primaryButtonProps.onAction).toBe(onOpenCancelBookingModal);
      expect(messages[stateData.primaryButtonProps.buttonText]).toBeDefined();
    });

    // UPDATED (2026-10-15): operator-accept no longer lands in `accepted` - it lands in the
    // new `accepted-on-laundry` state (see the EDN's "THE STATE SPLIT" comment on
    // :transition/operator-accept), which has its OWN cancel transition and its own describe
    // block below. This test used to assert the two landed in the same state; that is exactly
    // the thing that changed.
    it('carries its own `transition` field so TransactionPage.js fires CUSTOMER_CANCEL, not a hardcoded wrong one', () => {
      const onOpenCancelBookingModal = () => null;
      const stateData = stateDataFor(transitions.ACCEPT, 'customer', { onOpenCancelBookingModal });

      expect(stateData.primaryButtonProps.transition).toEqual(transitions.CUSTOMER_CANCEL);
    });

    it('gives the PROVIDER no action button at accepted - the door is customer-only', () => {
      const stateData = stateDataFor(transitions.ACCEPT, 'provider', {
        onOpenCancelBookingModal: () => null,
      });

      expect(stateData.showActionButtons).toBeFalsy();
    });

    it('hides the button everywhere past accepted, for both roles - except the CUSTOMER at initial-cleaning, which has its own, separate partial-refund cancel door (see that describe block below)', () => {
      ['initial-cleaning', 'ready-for-pickup', 'picked-up', 'overdue', 'returned', 'cleaning'].forEach(
        state => {
          ROLES.forEach(role => {
            if (state === 'initial-cleaning' && role === 'customer') {
              return;
            }
            const stateData = stateDataFor(TRANSITION_PER_STATE[state], role, {
              onOpenCancelBookingModal: () => null,
            });
            expect(stateData.showActionButtons).toBeFalsy();
          });
        }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Customer self-cancel from accepted-on-laundry (2026-10-15) - the SAME door as the
  // accepted-only one above, reachable from the second state the state split created. See
  // the EDN's ":STATE/ACCEPTED-ON-LAUNDRY NEEDS THE SAME DOOR" comment for why omitting this
  // cond would have been a regression on the already-shipped feature above (PR #107's
  // scenario 2), not a new gap.
  // -------------------------------------------------------------------------
  describe('customer self-cancel button, accepted-on-laundry', () => {
    it('shows a cancel action for the CUSTOMER at accepted-on-laundry, wired to the right transition', () => {
      const onOpenCancelBookingModal = () => null;
      const stateData = stateDataFor(transitions.OPERATOR_ACCEPT, 'customer', {
        onOpenCancelBookingModal,
      });

      expect(stateData.processState).toEqual('accepted-on-laundry');
      expect(stateData.showActionButtons).toBe(true);
      expect(stateData.primaryButtonProps).toBeDefined();
      expect(stateData.primaryButtonProps.onAction).toBe(onOpenCancelBookingModal);
      expect(stateData.primaryButtonProps.transition).toEqual(
        transitions.CUSTOMER_CANCEL_FROM_ACCEPTED_ON_LAUNDRY
      );
      expect(messages[stateData.primaryButtonProps.buttonText]).toBeDefined();
    });

    it('is a DIFFERENT transition from the accepted-only door, so the right one gets fired', () => {
      expect(transitions.CUSTOMER_CANCEL_FROM_ACCEPTED_ON_LAUNDRY).not.toEqual(
        transitions.CUSTOMER_CANCEL
      );
    });

    it('gives the PROVIDER no action button at accepted-on-laundry either', () => {
      const stateData = stateDataFor(transitions.OPERATOR_ACCEPT, 'provider', {
        onOpenCancelBookingModal: () => null,
      });

      expect(stateData.showActionButtons).toBeFalsy();
    });
  });

  it('opens the review window at delivered, as default-booking does', () => {
    const stateData = stateDataFor(transitions.LAUNDRY_MARK_AVAILABLE, 'customer');
    expect(stateData.showReviewAsFirstLink).toBe(true);
    expect(stateData.showActionButtons).toBe(true);
  });
});
