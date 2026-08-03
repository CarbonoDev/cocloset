/**
 * Same hard requirement as the TransactionPage sibling: an unrecognised
 * process falls through to `return {}`, which the InboxPage renders as a row
 * with no status label at all.
 */
import messages from '../../translations/en.json';
import { getProcess } from '../../transactions/transaction';

import { getStateData } from './InboxPage.stateData';

const process = getProcess('cocloset-booking');
const { transitions } = process;

const transaction = lastTransition => ({
  id: { uuid: 'tx-1' },
  attributes: { processName: 'cocloset-booking', lastTransition },
});

const stateDataFor = (lastTransition, transactionRole) =>
  getStateData({ transaction: transaction(lastTransition), transactionRole });

const TRANSITION_PER_STATE = {
  inquiry: transitions.INQUIRE,
  'pending-payment': transitions.REQUEST_PAYMENT,
  'payment-expired': transitions.EXPIRE_PAYMENT,
  preauthorized: transitions.CONFIRM_PAYMENT,
  accepted: transitions.ACCEPT,
  declined: transitions.DECLINE,
  expired: transitions.EXPIRE,
  'ready-for-pickup': transitions.LAUNDRY_MARK_READY,
  'picked-up': transitions.LAUNDRY_CONFIRM_PICKUP,
  overdue: transitions.MARK_OVERDUE,
  returned: transitions.LAUNDRY_CONFIRM_RETURN,
  cleaning: transitions.LAUNDRY_MARK_PENDING_CLEANING,
  canceled: transitions.CANCEL,
  delivered: transitions.LAUNDRY_MARK_AVAILABLE,
  'reviewed-by-customer': transitions.REVIEW_1_BY_CUSTOMER,
  'reviewed-by-provider': transitions.REVIEW_1_BY_PROVIDER,
  reviewed: transitions.EXPIRE_REVIEW_PERIOD,
};

const ROLES = ['customer', 'provider'];

describe('InboxPage state data for cocloset-booking', () => {
  it('covers every state in the process graph', () => {
    const graphStates = Object.keys(process.graph.states).filter(s => s !== 'initial');
    expect(Object.keys(TRANSITION_PER_STATE).sort()).toEqual(graphStates.sort());
  });

  it.each(
    Object.entries(TRANSITION_PER_STATE).flatMap(([state, transition]) =>
      ROLES.map(role => [state, role, transition])
    )
  )('resolves %s for the %s', (state, role, transition) => {
    const stateData = stateDataFor(transition, role);
    expect(stateData).not.toEqual({});
    expect(stateData.processName).toBe('cocloset-booking');
    expect(stateData.processState).toBe(state);
  });

  it('has an en.json status label for every state', () => {
    const missing = Object.keys(TRANSITION_PER_STATE).filter(
      state => !messages[`InboxPage.cocloset-booking.${state}.status`]
    );
    expect(missing).toEqual([]);
  });

  it('flags the customer, and only the customer, during the states they have to act on', () => {
    // The laundry drives most of the chain and has no inbox, so `actionNeeded`
    // must not light up rows nobody can do anything about.
    const customerActs = ['ready-for-pickup', 'overdue'];
    customerActs.forEach(state => {
      expect(stateDataFor(TRANSITION_PER_STATE[state], 'customer').actionNeeded).toBe(true);
      expect(stateDataFor(TRANSITION_PER_STATE[state], 'provider').actionNeeded).toBeFalsy();
    });

    ['accepted', 'picked-up', 'returned', 'cleaning'].forEach(state => {
      ROLES.forEach(role => {
        expect(stateDataFor(TRANSITION_PER_STATE[state], role).actionNeeded).toBeFalsy();
      });
    });
  });

  it('marks only the truly terminal states as final', () => {
    ['canceled', 'declined', 'expired', 'reviewed'].forEach(state => {
      expect(stateDataFor(TRANSITION_PER_STATE[state], 'customer').isFinal).toBe(true);
    });
    // `delivered` opens the review window, so it is not final.
    expect(stateDataFor(TRANSITION_PER_STATE.delivered, 'customer').isFinal).toBeFalsy();
    ['ready-for-pickup', 'picked-up', 'overdue', 'returned', 'cleaning'].forEach(state => {
      expect(stateDataFor(TRANSITION_PER_STATE[state], 'customer').isFinal).toBeFalsy();
    });
  });

  it('keeps the provider sale notification at preauthorized', () => {
    expect(stateDataFor(transitions.CONFIRM_PAYMENT, 'provider')).toMatchObject({
      actionNeeded: true,
      isSaleNotification: true,
    });
  });
});
