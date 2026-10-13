import fs from 'fs';
import path from 'path';

import { createUser, createTransaction, createListing, createTxTransition } from '../util/testData';
import {
  TX_TRANSITION_ACTOR_CUSTOMER,
  TX_TRANSITION_ACTOR_PROVIDER,
  TX_TRANSITION_ACTOR_OPERATOR,
  TX_TRANSITION_ACTOR_SYSTEM,
  COCLOSET_BOOKING_PROCESS_NAME,
  getProcess,
  getSupportedProcessesInfo,
  isBookingProcess,
  isBookingProcessAlias,
  resolveLatestProcessName,
} from './transaction';
import {
  graph,
  states,
  transitions,
  isCompleted,
  isCustomerReview,
  isPrivileged,
  isProviderReview,
  isRefunded,
  isRelevantPastTransition,
  statesNeedingProviderAttention,
} from './transactionProcessCoclosetBooking';

const EDN_PATH = path.resolve(
  __dirname,
  '../../ext/transaction-processes/cocloset-booking/process.edn'
);

/**
 * A deliberately small EDN reader.
 *
 * It does not parse EDN. It strips ;; comments, slices out the :transitions
 * vector, and pulls :name / :from / :to out of each transition map. That is
 * enough to assert that the JS graph in this directory and the EDN pushed by
 * flex-cli describe the same edges, which is the only thing that can silently
 * drift between the two files.
 *
 * Full EDN validation is done by `flex-cli process --path .`; see
 * "Runbook - Process Migration (flex-cli)".
 */
const readEdnTransitions = () => {
  const raw = fs.readFileSync(EDN_PATH, 'utf8');
  const withoutComments = raw
    .split('\n')
    .map(line => line.replace(/;;.*$/, ''))
    .join('\n');

  const start = withoutComments.indexOf(':transitions');
  const end = withoutComments.indexOf('\n :notifications');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const section = withoutComments.slice(start, end);
  const chunks = section.split('{:name :transition/').slice(1);

  return chunks.map(chunk => {
    const name = chunk.match(/^([a-z0-9-]+)/)[1];
    const from = chunk.match(/:from :state\/([a-z0-9-]+)/);
    const to = chunk.match(/:to :state\/([a-z0-9-]+)/);
    const actions = (chunk.match(/:name :action\/[a-z0-9-]+/g) || []).map(a =>
      a.replace(':name :action/', '')
    );
    return {
      transition: `transition/${name}`,
      from: from ? from[1] : 'initial',
      to: to[1],
      actions,
    };
  });
};

// The stock template already spells the cancelled state 'canceled' in JS and
// :state/cancelled in EDN. The JS state *values* are only used for translation
// keys and never sent to the API, so this is a naming alias, not drift.
const EDN_STATE_TO_JS_STATE = { cancelled: states.CANCELED };
const toJsState = ednState => EDN_STATE_TO_JS_STATE[ednState] || ednState;

describe('cocloset-booking is wired into the process registry', () => {
  it('getProcess resolves the process by name', () => {
    const process = getProcess(COCLOSET_BOOKING_PROCESS_NAME);
    expect(process.graph.id).toEqual('cocloset-booking/release-1');
    expect(process.transitions).toBe(transitions);
  });

  it('exposes the cocloset-booking/release-1 alias', () => {
    const info = getSupportedProcessesInfo().find(p => p.name === COCLOSET_BOOKING_PROCESS_NAME);
    expect(info).toBeDefined();
    expect(info.alias).toEqual('cocloset-booking/release-1');
    expect(info.unitTypes).toContain('day');
  });

  it('resolveLatestProcessName does not fold it into default-booking', () => {
    expect(resolveLatestProcessName(COCLOSET_BOOKING_PROCESS_NAME)).toEqual(
      COCLOSET_BOOKING_PROCESS_NAME
    );
  });

  it('counts as a booking process, by name and by alias', () => {
    expect(isBookingProcess(COCLOSET_BOOKING_PROCESS_NAME)).toEqual(true);
    expect(isBookingProcessAlias('cocloset-booking/release-1')).toEqual(true);
  });
});

describe('the JS graph matches ext/transaction-processes/cocloset-booking/process.edn', () => {
  const ednTransitions = readEdnTransitions();

  it('reads a plausible number of transitions out of the EDN', () => {
    // 2026-09-21: +4 for the initial-cleaning split (laundry-receive-from-provider,
    // laundry-mark-ready-from-initial-cleaning, cancel-from-initial-cleaning,
    // auto-complete-from-initial-cleaning), -5 for the removed provider-review diamond
    // (review-1/-2-by-provider, review-2-by-customer, expire-customer/-provider-review-period).
    expect(ednTransitions.length).toEqual(37);
  });

  it('declares exactly the transitions the EDN declares', () => {
    const fromEdn = ednTransitions.map(t => t.transition).sort();
    const fromJs = Object.values(transitions).sort();
    expect(fromJs).toEqual(fromEdn);
  });

  it('has the same edges as the EDN', () => {
    const jsEdges = [];
    Object.entries(graph.states).forEach(([stateName, stateDesc]) => {
      Object.entries(stateDesc.on || {}).forEach(([transition, to]) => {
        jsEdges.push(`${stateName} --${transition}--> ${to}`);
      });
    });

    const ednEdges = ednTransitions.map(
      t => `${toJsState(t.from)} --${t.transition}--> ${toJsState(t.to)}`
    );

    expect(jsEdges.sort()).toEqual(ednEdges.sort());
  });

  it('names every EDN state in the states map', () => {
    const ednStates = new Set();
    ednTransitions.forEach(t => {
      ednStates.add(toJsState(t.from));
      ednStates.add(toJsState(t.to));
    });
    const jsStates = new Set(Object.values(states));
    ednStates.forEach(s => expect(jsStates.has(s)).toEqual(true));
  });
});

describe('cocloset-booking graph shape', () => {
  const process = getProcess(COCLOSET_BOOKING_PROCESS_NAME);

  it('routes accept into the laundry chain, not straight to delivered', () => {
    expect(process.getStateAfterTransition(transitions.ACCEPT)).toEqual(states.ACCEPTED);
    expect(process.getStateAfterTransition(transitions.LAUNDRY_MARK_READY)).toEqual(
      states.READY_FOR_PICKUP
    );
  });

  it('walks the happy path accepted -> ready -> picked up -> returned -> cleaning -> delivered', () => {
    expect(process.getStateAfterTransition(transitions.LAUNDRY_MARK_READY)).toEqual(
      states.READY_FOR_PICKUP
    );
    expect(process.getStateAfterTransition(transitions.LAUNDRY_CONFIRM_PICKUP)).toEqual(
      states.PICKED_UP
    );
    expect(process.getStateAfterTransition(transitions.LAUNDRY_CONFIRM_RETURN)).toEqual(
      states.RETURNED
    );
    expect(process.getStateAfterTransition(transitions.LAUNDRY_MARK_PENDING_CLEANING)).toEqual(
      states.CLEANING
    );
    expect(process.getStateAfterTransition(transitions.LAUNDRY_MARK_AVAILABLE)).toEqual(
      states.DELIVERED
    );
  });

  it('walks the late path picked up -> overdue -> returned', () => {
    expect(process.getStateAfterTransition(transitions.MARK_OVERDUE)).toEqual(states.OVERDUE);
    expect(process.getStateAfterTransition(transitions.LAUNDRY_CONFIRM_RETURN_LATE)).toEqual(
      states.RETURNED
    );
  });

  it('keeps the two cleaning sub-phases as self-transitions', () => {
    const cleaningEdges = graph.states[states.CLEANING].on;
    expect(cleaningEdges[transitions.LAUNDRY_START_CLEANING]).toEqual(states.CLEANING);
    expect(cleaningEdges[transitions.LAUNDRY_START_QUALITY_INSPECTION]).toEqual(states.CLEANING);
  });

  it('gives every laundry state an automatic exit to delivered', () => {
    const backstops = {
      [states.INITIAL_CLEANING]: transitions.AUTO_COMPLETE_FROM_INITIAL_CLEANING,
      [states.READY_FOR_PICKUP]: transitions.AUTO_COMPLETE_FROM_READY,
      [states.PICKED_UP]: transitions.AUTO_COMPLETE_FROM_PICKED_UP,
      [states.OVERDUE]: transitions.AUTO_COMPLETE_FROM_OVERDUE,
      [states.RETURNED]: transitions.AUTO_COMPLETE_FROM_RETURNED,
      [states.CLEANING]: transitions.AUTO_COMPLETE_FROM_CLEANING,
    };
    Object.entries(backstops).forEach(([state, transition]) => {
      expect(graph.states[state].on[transition]).toEqual(states.DELIVERED);
    });
  });

  it('has no laundry state without an outgoing edge', () => {
    [
      states.ACCEPTED,
      states.INITIAL_CLEANING,
      states.READY_FOR_PICKUP,
      states.PICKED_UP,
      states.OVERDUE,
      states.RETURNED,
      states.CLEANING,
    ].forEach(state => {
      expect(Object.keys(graph.states[state].on).length).toBeGreaterThan(0);
    });
  });

  it('leaves reviewed reachable only from delivered, with no diamond any more (2026-09-21)', () => {
    // There used to be a two-sided diamond (reviewed-by-customer / reviewed-by-provider)
    // between delivered and reviewed. The provider can no longer review at all, so
    // review-1-by-customer now goes straight to REVIEWED, alongside expire-review-period -
    // exactly the two edges DELIVERED already has (see the "walks... to delivered" tests).
    expect(process.getTransitionsToStates([states.REVIEWED]).sort()).toEqual(
      [transitions.REVIEW_1_BY_CUSTOMER, transitions.EXPIRE_REVIEW_PERIOD].sort()
    );
  });

  it('lists all nine ways of reaching delivered', () => {
    expect(process.getTransitionsToStates([states.DELIVERED]).sort()).toEqual(
      [
        transitions.COMPLETE,
        transitions.OPERATOR_COMPLETE,
        transitions.LAUNDRY_MARK_AVAILABLE,
        transitions.AUTO_COMPLETE_FROM_INITIAL_CLEANING,
        transitions.AUTO_COMPLETE_FROM_READY,
        transitions.AUTO_COMPLETE_FROM_PICKED_UP,
        transitions.AUTO_COMPLETE_FROM_OVERDUE,
        transitions.AUTO_COMPLETE_FROM_RETURNED,
        transitions.AUTO_COMPLETE_FROM_CLEANING,
      ].sort()
    );
  });
});

// Sharetribe has no post-payout refund action, so the position of
// :action/stripe-create-payout is what decides which rescues are possible.
// These assertions are the safety property of the whole process: they are
// read straight out of the EDN, so they fail if the payout ever moves without
// the cancel topology moving with it.
describe('cocloset-booking payout and cancel topology', () => {
  const ednTransitions = readEdnTransitions();
  const carrying = action =>
    ednTransitions
      .filter(t => t.actions.includes(action))
      .map(t => t.transition)
      .sort();

  it('fires stripe-create-payout on exactly the transitions that end a rental', () => {
    expect(carrying('stripe-create-payout')).toEqual(
      [
        transitions.COMPLETE,
        transitions.OPERATOR_COMPLETE,
        transitions.AUTO_COMPLETE_FROM_INITIAL_CLEANING,
        transitions.AUTO_COMPLETE_FROM_READY,
        transitions.AUTO_COMPLETE_FROM_PICKED_UP,
        transitions.AUTO_COMPLETE_FROM_OVERDUE,
        // Payout is on the way OUT of 'returned', not on the way in: that is
        // what leaves a window for a damage report to be refunded.
        transitions.LAUNDRY_MARK_PENDING_CLEANING,
        transitions.AUTO_COMPLETE_FROM_RETURNED,
      ].sort()
    );
  });

  it('never pays out on a return transition, so damage can still be refunded', () => {
    [transitions.LAUNDRY_CONFIRM_RETURN, transitions.LAUNDRY_CONFIRM_RETURN_LATE].forEach(name => {
      const t = ednTransitions.find(e => e.transition === name);
      expect(t.actions).toEqual(['privileged-update-metadata']);
    });
  });

  it('refunds on exactly the declines, expiries and cancels', () => {
    expect(carrying('stripe-refund-payment')).toEqual(
      [
        transitions.EXPIRE_PAYMENT,
        transitions.DECLINE,
        transitions.OPERATOR_DECLINE,
        transitions.EXPIRE,
        transitions.CANCEL,
        transitions.CANCEL_FROM_INITIAL_CLEANING,
        transitions.CANCEL_FROM_READY_FOR_PICKUP,
        transitions.CANCEL_FROM_PICKED_UP,
        transitions.CANCEL_FROM_OVERDUE,
        transitions.CANCEL_FROM_RETURNED,
      ].sort()
    );
  });

  it('never refunds and pays out in the same transition', () => {
    ednTransitions.forEach(t => {
      expect(
        t.actions.includes('stripe-refund-payment') && t.actions.includes('stripe-create-payout')
      ).toEqual(false);
    });
  });

  it('pays the owner exactly once on every path from initial to delivered', () => {
    const paysOut = new Set(carrying('stripe-create-payout'));
    const paths = [];

    const walk = (state, seen, payouts) => {
      if (state === states.DELIVERED) {
        paths.push(payouts);
        return;
      }
      Object.entries(graph.states[state]?.on || {}).forEach(([transition, next]) => {
        if (seen.has(next)) {
          // Self-transitions and already-visited states cannot add a payout
          // that a simple path does not already account for.
          return;
        }
        walk(next, new Set([...seen, next]), payouts + (paysOut.has(transition) ? 1 : 0));
      });
    };
    walk(states.INITIAL, new Set([states.INITIAL]), 0);

    expect(paths.length).toBeGreaterThan(0);
    paths.forEach(count => expect(count).toEqual(1));
  });

  it('offers an operator cancel from every state that has not been paid out yet', () => {
    const cancelFrom = {
      [states.ACCEPTED]: transitions.CANCEL,
      [states.INITIAL_CLEANING]: transitions.CANCEL_FROM_INITIAL_CLEANING,
      [states.READY_FOR_PICKUP]: transitions.CANCEL_FROM_READY_FOR_PICKUP,
      [states.PICKED_UP]: transitions.CANCEL_FROM_PICKED_UP,
      [states.OVERDUE]: transitions.CANCEL_FROM_OVERDUE,
      [states.RETURNED]: transitions.CANCEL_FROM_RETURNED,
    };
    Object.entries(cancelFrom).forEach(([state, transition]) => {
      expect(graph.states[state].on[transition]).toEqual(states.CANCELED);
    });
  });

  it('offers no cancel from cleaning, where a refund is not expressible', () => {
    const cleaningEdges = Object.values(graph.states[states.CLEANING].on);
    expect(cleaningEdges).not.toContain(states.CANCELED);
  });
});

describe('cocloset-booking predicates', () => {
  it('isPrivileged covers only the two payment transitions', () => {
    expect(isPrivileged(transitions.REQUEST_PAYMENT)).toEqual(true);
    expect(isPrivileged(transitions.REQUEST_PAYMENT_AFTER_INQUIRY)).toEqual(true);
    // Laundry transitions are operator transitions, never client-invoked.
    expect(isPrivileged(transitions.LAUNDRY_MARK_READY)).toEqual(false);
    expect(isPrivileged(transitions.LAUNDRY_CONFIRM_RETURN)).toEqual(false);
  });

  it('isCompleted covers every transition into delivered plus the one-sided review exit', () => {
    [
      transitions.COMPLETE,
      transitions.OPERATOR_COMPLETE,
      transitions.LAUNDRY_MARK_AVAILABLE,
      transitions.AUTO_COMPLETE_FROM_INITIAL_CLEANING,
      transitions.AUTO_COMPLETE_FROM_READY,
      transitions.AUTO_COMPLETE_FROM_PICKED_UP,
      transitions.AUTO_COMPLETE_FROM_OVERDUE,
      transitions.AUTO_COMPLETE_FROM_RETURNED,
      transitions.AUTO_COMPLETE_FROM_CLEANING,
      transitions.REVIEW_1_BY_CUSTOMER,
      transitions.EXPIRE_REVIEW_PERIOD,
    ].forEach(t => expect(isCompleted(t)).toEqual(true));

    [
      transitions.LAUNDRY_CONFIRM_RETURN,
      transitions.LAUNDRY_MARK_PENDING_CLEANING,
      transitions.MARK_OVERDUE,
      transitions.CANCEL,
    ].forEach(t => expect(isCompleted(t)).toEqual(false));
  });

  it('isRefunded covers exactly the transitions carrying stripe-refund-payment', () => {
    [
      transitions.EXPIRE_PAYMENT,
      transitions.EXPIRE,
      transitions.CANCEL,
      transitions.CANCEL_FROM_INITIAL_CLEANING,
      transitions.CANCEL_FROM_READY_FOR_PICKUP,
      transitions.CANCEL_FROM_PICKED_UP,
      transitions.CANCEL_FROM_OVERDUE,
      transitions.CANCEL_FROM_RETURNED,
      transitions.DECLINE,
      transitions.OPERATOR_DECLINE,
    ].forEach(t => expect(isRefunded(t)).toEqual(true));

    [transitions.LAUNDRY_CONFIRM_RETURN, transitions.COMPLETE].forEach(t =>
      expect(isRefunded(t)).toEqual(false)
    );
  });

  it('isRefunded and isCompleted never both hold', () => {
    Object.values(transitions).forEach(t => {
      expect(isRefunded(t) && isCompleted(t)).toEqual(false);
    });
  });

  it('isRelevantPastTransition shows the whole laundry timeline', () => {
    [
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
    ].forEach(t => expect(isRelevantPastTransition(t)).toEqual(true));

    // Same exclusions as the stock booking process.
    [
      transitions.REQUEST_PAYMENT,
      transitions.INQUIRE,
      transitions.EXPIRE_PAYMENT,
      transitions.EXPIRE_REVIEW_PERIOD,
    ].forEach(t => expect(isRelevantPastTransition(t)).toEqual(false));
  });

  it('isCustomerReview is the only reviewer left; isProviderReview always false (2026-09-21)', () => {
    // Unlike default-booking's still-bidirectional diamond, the provider can no longer review
    // the customer at all here - see the EDN's :transition/review-1-by-customer comment.
    expect(isCustomerReview(transitions.REVIEW_1_BY_CUSTOMER)).toEqual(true);
    expect(isCustomerReview(transitions.EXPIRE_REVIEW_PERIOD)).toEqual(false);
    expect(isProviderReview(transitions.REVIEW_1_BY_CUSTOMER)).toEqual(false);
    expect(isProviderReview(undefined)).toEqual(false);
  });

  it('only preauthorized needs the garment owner to act', () => {
    // The laundry states need the laundry's attention, and the laundry is not
    // a party to the transaction.
    expect(statesNeedingProviderAttention).toEqual([states.PREAUTHORIZED]);
  });
});

describe('cocloset-booking state resolution from a transaction entity', () => {
  const process = getProcess(COCLOSET_BOOKING_PROCESS_NAME);

  const tr = (transition, by) =>
    createTxTransition({
      createdAt: new Date(Date.UTC(2026, 7, 1, 8, 10)),
      by,
      transition,
    });

  const history = [
    tr(transitions.REQUEST_PAYMENT, TX_TRANSITION_ACTOR_CUSTOMER),
    tr(transitions.CONFIRM_PAYMENT, TX_TRANSITION_ACTOR_CUSTOMER),
    tr(transitions.ACCEPT, TX_TRANSITION_ACTOR_PROVIDER),
    tr(transitions.LAUNDRY_MARK_READY, TX_TRANSITION_ACTOR_OPERATOR),
    tr(transitions.LAUNDRY_CONFIRM_PICKUP, TX_TRANSITION_ACTOR_OPERATOR),
    tr(transitions.LAUNDRY_CONFIRM_RETURN, TX_TRANSITION_ACTOR_OPERATOR),
  ];

  const txAtState = (lastTransition, txTransitions) =>
    createTransaction({
      lastTransition,
      customer: createUser('user1'),
      provider: createUser('user2'),
      listing: createListing('Garment'),
      transitions: txTransitions,
    });

  it('reads the current state from lastTransition', () => {
    expect(
      process.getState(txAtState(transitions.LAUNDRY_MARK_READY, history.slice(0, 4)))
    ).toEqual(states.READY_FOR_PICKUP);
    expect(process.getState(txAtState(transitions.LAUNDRY_CONFIRM_RETURN, history))).toEqual(
      states.RETURNED
    );
    expect(
      process.getState(
        txAtState(transitions.MARK_OVERDUE, [
          ...history.slice(0, 5),
          tr(transitions.MARK_OVERDUE, TX_TRANSITION_ACTOR_SYSTEM),
        ])
      )
    ).toEqual(states.OVERDUE);
  });

  it('hasPassedState works across the laundry chain', () => {
    const tx = txAtState(transitions.LAUNDRY_CONFIRM_RETURN, history);
    expect(process.hasPassedState(states.ACCEPTED, tx)).toEqual(true);
    expect(process.hasPassedState(states.READY_FOR_PICKUP, tx)).toEqual(true);
    expect(process.hasPassedState(states.PICKED_UP, tx)).toEqual(true);
    expect(process.hasPassedState(states.RETURNED, tx)).toEqual(true);
    expect(process.hasPassedState(states.CLEANING, tx)).toEqual(false);
    expect(process.hasPassedState(states.DELIVERED, tx)).toEqual(false);
  });
});

describe('cocloset-booking owner notifications', () => {
  // The notifications the process attaches to a given transition, read out of
  // the :notifications section of the EDN.
  // Every :notifications entry attached to a transition, as
  // { name, role, template }. Comments are stripped first so a `:on :...`
  // written in prose (this section has a lot of prose) cannot be read as data.
  //
  // The split is a regex rather than the literal '{:name :notification/'
  // because the EDN is machine-formatted at 80 columns, and a long enough
  // :notification name gets wrapped onto its own line ("{:name\n
  // :notification/review-period-start-customer-auto-complete-from-picked-up,").
  // A literal split silently dropped every wrapped entry, so the helper saw
  // fewer notifications than the process actually declares.
  const notificationEntriesOn = transition => {
    const raw = fs.readFileSync(EDN_PATH, 'utf8');
    const withoutComments = raw
      .split('\n')
      .map(line => line.replace(/;;.*$/, ''))
      .join('\n');
    const section = withoutComments.slice(withoutComments.indexOf('\n :notifications'));
    return section
      .split(/\{:name\s+:notification\//)
      .slice(1)
      .filter(chunk => chunk.includes(`:on :${transition},`))
      .map(chunk => ({
        name: chunk.match(/^\s*([a-z0-9-]+)/)[1],
        role: chunk.match(/:to :actor\.role\/([a-z]+)/)[1],
        template: chunk.match(/:template :([a-z0-9-]+)/)[1],
      }));
  };

  const notificationsOn = transition => notificationEntriesOn(transition).map(e => e.name);

  const notificationRolesOn = transition => notificationEntriesOn(transition).map(e => e.role);

  const templatesByRoleOn = transition =>
    notificationEntriesOn(transition).reduce(
      (acc, entry) => ({ ...acc, [entry.role]: entry.template }),
      {}
    );

  it('sends nothing to the owner for the laundry-internal cleaning sub-phases', () => {
    // "Quita los avisos que no le corresponden al vendedor" (Jonathan,
    // 2026-08-01). The transitions stay - they are the audited timestamps -
    // but the owner has nothing to act on, so no mail.
    expect(notificationsOn(transitions.LAUNDRY_START_CLEANING)).toEqual([]);
    expect(notificationsOn(transitions.LAUNDRY_START_QUALITY_INSPECTION)).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // The review reminder (Jonathan, 2026-09-02: "un reminder al customer si no
  // ha hecho su review en 3 dias despues de haber devuelto la prenda").
  //
  // Sharetribe schedules a notification against ONE transition, so "three days
  // after the review window opens" is one entry per way of reaching
  // :state/delivered - the same shape as the review-period mails above, and
  // the same failure mode: a way in that nobody added an entry for is a renter
  // who is never reminded.
  // -----------------------------------------------------------------------
  describe('the renter is reminded to review, three days in', () => {
    const process = getProcess(COCLOSET_BOOKING_PROCESS_NAME);
    const ednText = () => fs.readFileSync(EDN_PATH, 'utf8');

    const reminderOn = transition =>
      notificationEntriesOn(transition).filter(e => e.template === 'booking-review-reminder');

    it('covers every way of reaching delivered, not a list of our own', () => {
      process.getTransitionsToStates([states.DELIVERED]).forEach(transition => {
        const reminders = reminderOn(transition);
        expect(reminders.length).toEqual(1);
        expect(reminders[0].role).toEqual('customer');
      });
    });

    it('is never scheduled where the renter cannot review yet', () => {
      // The literal reading of "three days after they returned the garment".
      // At :state/returned there is no review transition to point at.
      expect(reminderOn(transitions.LAUNDRY_CONFIRM_RETURN)).toEqual([]);
      expect(reminderOn(transitions.LAUNDRY_CONFIRM_RETURN_LATE)).toEqual([]);
      expect(reminderOn(transitions.LAUNDRY_MARK_PENDING_CLEANING)).toEqual([]);
    });

    it('is never sent to the owner', () => {
      const toProvider = ednText()
        .split(/\{:name\s+:notification\//)
        .slice(1)
        .filter(chunk => chunk.includes(':template :booking-review-reminder'))
        .filter(chunk => chunk.includes(':to :actor.role/provider'));

      expect(toProvider).toEqual([]);
    });

    it('lands inside the review window it is reminding about', () => {
      // The window is seven days from :state/delivered
      // (:transition/expire-review-period), and the reminder is keyed off the
      // same timepoint - so a reminder that arrives after the window closed
      // can only happen if these two periods drift apart.
      const reminderChunks = ednText()
        .split(/\{:name\s+:notification\//)
        .slice(1)
        .filter(chunk => chunk.includes(':template :booking-review-reminder'));

      expect(reminderChunks.length).toBeGreaterThan(0);
      reminderChunks.forEach(chunk => {
        expect(chunk).toContain(':time/first-entered-state :state/delivered');
        expect(chunk).toContain(':fn/period ["P3D"]');
      });
      expect(ednText()).toContain(':name :transition/expire-review-period');
      expect(ednText()).toMatch(/expire-review-period[\s\S]*?:fn\/period \["P7D"\]/);
    });
  });

  it('tells the owner about the money on the transition that moves it', () => {
    expect(notificationsOn(transitions.LAUNDRY_MARK_PENDING_CLEANING)).toContain(
      'booking-money-paid-on-cleaning-start'
    );
    expect(notificationsOn(transitions.AUTO_COMPLETE_FROM_RETURNED)).toContain(
      'booking-money-paid-auto-complete-from-returned'
    );
    // ...and not on the return transitions, which no longer pay out.
    expect(notificationsOn(transitions.LAUNDRY_CONFIRM_RETURN)).toEqual([
      'booking-return-completed',
      'booking-return-completed-to-customer',
    ]);
    expect(notificationsOn(transitions.LAUNDRY_CONFIRM_RETURN_LATE)).toEqual([
      'booking-return-completed-late',
      'booking-return-completed-late-to-customer',
    ]);
  });

  // "Sobre los daños, avisa a los dos" (Jonathan, 2026-08-10). The damage flag
  // is written BY these two transitions, so the notification that carries it has
  // to hang off them - and it has to reach both roles, which takes two entries
  // per transition because :to is single-valued.
  it('tells BOTH parties when the laundry has checked a garment back in', () => {
    [transitions.LAUNDRY_CONFIRM_RETURN, transitions.LAUNDRY_CONFIRM_RETURN_LATE].forEach(
      transition => {
        const roles = notificationRolesOn(transition);
        expect(roles).toContain('provider');
        expect(roles).toContain('customer');
      }
    );
  });

  it('gives the two roles different templates, so their copy can differ', () => {
    // Sharing one template would compile and send, but the owner ("your asset
    // is damaged, your payout has not moved") and the renter ("a report was
    // filed, this is not a charge") need different words, and :template cannot
    // be varied per recipient once shared.
    const templates = templatesByRoleOn(transitions.LAUNDRY_CONFIRM_RETURN);
    expect(templates.provider).toEqual('booking-return-completed');
    expect(templates.customer).toEqual('booking-return-completed-customer');
    expect(templates.provider).not.toEqual(templates.customer);
  });

  // -----------------------------------------------------------------------
  // Cancellation.
  //
  // All five cancels used to notify NOBODY: a full refund to the customer and
  // a lost payout for the owner, in silence, including on the damage
  // write-off path. `:on` and `:to` are both single-valued, so "tell both
  // parties on all five" is exactly ten entries - there is no shorter
  // spelling, and a missing one is a silent refund all over again.
  // -----------------------------------------------------------------------
  const CANCEL_TRANSITIONS = [
    transitions.CANCEL,
    transitions.CANCEL_FROM_INITIAL_CLEANING,
    transitions.CANCEL_FROM_READY_FOR_PICKUP,
    transitions.CANCEL_FROM_PICKED_UP,
    transitions.CANCEL_FROM_OVERDUE,
    transitions.CANCEL_FROM_RETURNED,
  ];

  it('covers every cancel transition the process has, not a list of our own', () => {
    // If a sixth cancel is ever added, this fails rather than leaving the new
    // one silently unnotified.
    const ednCancels = readEdnTransitions()
      .filter(t => toJsState(t.to) === states.CANCELED)
      .map(t => t.transition);
    expect(ednCancels.slice().sort()).toEqual(CANCEL_TRANSITIONS.slice().sort());
  });

  it.each(CANCEL_TRANSITIONS)('notifies exactly two parties on %s', transition => {
    expect(notificationEntriesOn(transition)).toHaveLength(2);
  });

  it.each(CANCEL_TRANSITIONS)('notifies one customer and one provider on %s', transition => {
    expect(
      notificationRolesOn(transition)
        .slice()
        .sort()
    ).toEqual(['customer', 'provider']);
  });

  it('uses one template per role across all five, not one per transition', () => {
    // The five are identical in money terms (customer refunded in full,
    // provider paid nothing), so the substance does not vary by transition and
    // ten templates would be ~5x the Console translation work for the same
    // words. The two ROLES do not share, because one is getting money back and
    // the other is not being paid.
    CANCEL_TRANSITIONS.forEach(transition => {
      expect(templatesByRoleOn(transition)).toEqual({
        customer: 'booking-cancelled',
        provider: 'booking-cancelled-owner',
      });
    });
  });

  it('gives every one of the twelve entries its own name', () => {
    // Six cancel transitions x two roles each = twelve (2026-09-21 added
    // cancel-from-initial-cleaning as the sixth).
    const names = CANCEL_TRANSITIONS.flatMap(notificationsOn);
    expect(names).toHaveLength(12);
    expect(new Set(names).size).toEqual(12);
  });
});

describe('cocloset-booking email templates', () => {
  const TEMPLATES_DIR = path.resolve(
    __dirname,
    '../../ext/transaction-processes/cocloset-booking/templates'
  );

  const referencedTemplates = () => {
    const raw = fs.readFileSync(EDN_PATH, 'utf8');
    const matches = raw.match(/:template :[a-z0-9-]+/g) || [];
    return [...new Set(matches.map(m => m.replace(':template :', '')))];
  };

  it('has a subject and an html file for every template the process references', () => {
    const referenced = referencedTemplates();

    // The regex is the only thing standing between this test and passing
    // vacuously, so name a few templates it must have found - including the
    // two cancellation ones, which are referenced from ten entries each
    // sharing a template and would be the first casualty of a parser change.
    expect(referenced).toContain('booking-cancelled');
    expect(referenced).toContain('booking-cancelled-owner');
    expect(referenced.length).toBeGreaterThan(20);

    referenced.forEach(name => {
      expect(fs.existsSync(path.join(TEMPLATES_DIR, name, `${name}-subject.txt`))).toEqual(true);
      expect(fs.existsSync(path.join(TEMPLATES_DIR, name, `${name}-html.html`))).toEqual(true);
    });
  });

  it('has no orphan template directories', () => {
    const referenced = new Set(referencedTemplates());
    fs.readdirSync(TEMPLATES_DIR).forEach(dir => {
      expect(referenced.has(dir)).toEqual(true);
    });
  });

  // -------------------------------------------------------------------------
  // ext/transaction-processes/cocloset-booking/email-texts.en.json
  //
  // The English that ships in these templates, extracted as one file the
  // operator can paste into Console's `content/email-texts.json` (Jonathan,
  // 2026-09-02). It is generated, so its only real risk is going stale: a key
  // reworded in a template and not here would send the operator a value that
  // no longer matches the mail. Hence a test rather than a comment.
  // -------------------------------------------------------------------------
  describe('email-texts.en.json', () => {
    const EMAIL_TEXTS_PATH = path.resolve(
      __dirname,
      '../../ext/transaction-processes/cocloset-booking/email-texts.en.json'
    );

    // Every `{{t "Key" "default"}}` pair across every template, keyed by key.
    const defaultsInTemplates = () => {
      const found = {};
      const conflicts = [];
      fs.readdirSync(TEMPLATES_DIR)
        .sort()
        .forEach(name => {
          ['subject.txt', 'html.html'].forEach(part => {
            const source = read(name, part);
            const re = /\{\{t "([A-Za-z.]+)" "((?:[^"\\]|\\.)*)"/g;
            let match;
            while ((match = re.exec(source)) !== null) {
              const [, key, value] = match;
              if (found[key] !== undefined && found[key] !== value) {
                conflicts.push(`${key} in ${name}`);
              }
              found[key] = value;
            }
          });
        });
      return { found, conflicts };
    };

    it('holds exactly the keys and defaults the templates use', () => {
      const { found } = defaultsInTemplates();
      const file = JSON.parse(fs.readFileSync(EMAIL_TEXTS_PATH, 'utf8'));

      expect(Object.keys(found).length).toBeGreaterThan(150);
      expect(file).toEqual(found);
    });

    it('gives a shared key one default across every template that uses it', () => {
      // `TransactionEmails.*` keys appear in all 26 templates. Two different
      // defaults for one key means Console can only ever match one of them,
      // and the file above cannot represent both.
      const { conflicts } = defaultsInTemplates();
      expect(conflicts).toEqual([]);
    });

    it('is sorted, so a regeneration diffs as the strings that changed', () => {
      const file = JSON.parse(fs.readFileSync(EMAIL_TEXTS_PATH, 'utf8'));
      expect(Object.keys(file)).toEqual([...Object.keys(file)].sort());
    });
  });

  // -------------------------------------------------------------------------
  // The damage branch.
  //
  // These are textual assertions rather than rendered output: Sharetribe
  // renders these templates on their side and `handlebars` is deliberately not
  // a dependency of this repo (AGENTS.md: ask before adding a library). So
  // instead of grepping - which would pass on a template that mentioned damage
  // in only one branch - the {{#if}} block is split on its own {{else}} and
  // each side is asserted separately. That is what makes "both directions" a
  // real assertion here.
  // -------------------------------------------------------------------------
  const read = (name, part) =>
    fs.readFileSync(path.join(TEMPLATES_DIR, name, `${name}-${part}`), 'utf8');

  // Split EVERY {{#if <cond>}} block in the source and return the two arms
  // concatenated across all of them, so an assertion covers the whole template
  // rather than whichever block happens to come first. (These templates branch
  // twice on the damage flag: once for the <h1>, once for the body.)
  //
  // Nesting-aware: the damaged arm contains an inner {{#if ...note}}, and a
  // naive indexOf('{{/if}}') would cut that arm off at the inner close and
  // silently assert almost nothing.
  const splitIfBlock = (source, cond) => {
    const open = `{{#if ${cond}}}`;
    const tokenRe = /\{\{#if [^}]*\}\}|\{\{else\}\}|\{\{\/if\}\}/g;
    const arms = { whenDamaged: '', whenClean: '' };
    let found = false;
    let from = 0;

    for (;;) {
      const start = source.indexOf(open, from);
      if (start === -1) {
        break;
      }
      found = true;
      const bodyStart = start + open.length;
      tokenRe.lastIndex = bodyStart;
      let depth = 1;
      let elseAt = -1;
      let match;
      while ((match = tokenRe.exec(source)) !== null) {
        if (match[0].startsWith('{{#if')) {
          depth += 1;
        } else if (match[0] === '{{/if}}') {
          depth -= 1;
          if (depth === 0) {
            arms.whenDamaged +=
              '\n' + source.slice(bodyStart, elseAt === -1 ? match.index : elseAt);
            if (elseAt !== -1) {
              arms.whenClean += '\n' + source.slice(elseAt + '{{else}}'.length, match.index);
            }
            break;
          }
        } else if (match[0] === '{{else}}' && depth === 1) {
          elseAt = match.index;
        }
      }
      if (!match) {
        // Unbalanced {{#if}} - a broken template, not a passing test.
        return null;
      }
      from = tokenRe.lastIndex;
    }

    return found ? arms : null;
  };

  describe.each([
    ['booking-return-completed', 'BookingReturnCompleted', 'transaction.metadata', 'metadata'],
    [
      'booking-return-completed-customer',
      'BookingReturnCompletedCustomer',
      'transaction.metadata',
      'metadata',
    ],
  ])('%s branches on the damage flag', (template, keyPrefix, subjectPath, bodyPath) => {
    it('has a different subject in each direction', () => {
      const arms = splitIfBlock(
        read(template, 'subject.txt'),
        `${subjectPath}.damageReported.flag`
      );

      expect(arms).not.toBeNull();
      expect(arms.whenDamaged).toContain(`${keyPrefix}.SubjectDamage`);
      expect(arms.whenClean).toContain(`${keyPrefix}.Subject"`);
      // The whole point: the two arms are not the same sentence.
      expect(arms.whenDamaged).not.toEqual(arms.whenClean);
      expect(arms.whenClean).not.toContain('Damage');
    });

    it('names the damage and prints the laundry note, in the damaged direction only', () => {
      const arms = splitIfBlock(read(template, 'html.html'), `${bodyPath}.damageReported.flag`);

      expect(arms).not.toBeNull();
      // The note itself has to reach the reader, not just the fact of a flag.
      expect(arms.whenDamaged).toContain(`${bodyPath}.damageReported.note`);
      expect(arms.whenDamaged).toContain(`${keyPrefix}.DamageNoteLabel`);
      expect(arms.whenDamaged).toContain(`${keyPrefix}.DamageNextSteps`);
      // An empty note must not render a blank box with no explanation.
      expect(arms.whenDamaged).toContain(`${keyPrefix}.DamageNoteMissing`);

      // ...and none of that leaks into the undamaged email, which is the half
      // of "both directions" that a grep-based test would miss.
      expect(arms.whenClean).toContain(`${keyPrefix}.Content"`);
      expect(arms.whenClean).not.toContain('damageReported.note');
      expect(arms.whenClean).not.toContain('DamageNoteLabel');
      expect(arms.whenClean).not.toContain('DamageNextSteps');
    });

    it('routes every string through {{t}} with the right key prefix', () => {
      const html = read(template, 'html.html');

      expect(html).toContain('{{set-translations (asset "content/email-texts.json")}}');
      // Every new key belongs to this template's own namespace. (Shared
      // TransactionEmails.* keys are pre-existing and deliberately excluded.)
      const keys = (html.match(/\{\{t "([A-Za-z.]+)"/g) || []).map(m =>
        m.replace(/\{\{t "/, '').replace(/"$/, '')
      );
      expect(keys.length).toBeGreaterThan(0);
      keys
        .filter(key => !key.startsWith('TransactionEmails.'))
        .forEach(key => {
          expect(key.startsWith(`${keyPrefix}.`)).toEqual(true);
        });
    });
  });

  // -----------------------------------------------------------------------
  // The payout claim.
  //
  // `booking-return-completed` told the owner "Your payout for this rental has
  // been released." on a transition that carries NO :action/stripe-create-payout
  // - payout moved to :transition/laundry-mark-pending-cleaning, one step later.
  // The key was RETIRED rather than reworded: `{{t}}` resolves from the hosted
  // Console asset content/email-texts.json, so editing the inline default here
  // would leave a Console entry for the old key still asserting the falsehood.
  // A new key cannot be overridden by a value nobody has written yet.
  // -----------------------------------------------------------------------
  it('does not tell the owner their payout has moved before it has', () => {
    const html = read('booking-return-completed', 'html.html');

    expect(html).not.toContain('BookingReturnCompleted.Payout"');
    expect(html).not.toMatch(/payout[^"]*has been released/i);
    expect(html).toContain('BookingReturnCompleted.PayoutPending');
    expect(html).toMatch(/has not been released yet/i);
  });

  it('claims a payout only in templates whose transition actually pays out', () => {
    // The generalisation of the bug above, across every template: if a template
    // says the money has moved, every transition it is sent on must carry
    // :action/stripe-create-payout.
    const raw = fs.readFileSync(EDN_PATH, 'utf8');
    const withoutComments = raw
      .split('\n')
      .map(line => line.replace(/;;.*$/, ''))
      .join('\n');

    const payoutTransitions = new Set(
      (withoutComments.split('{:name :transition/').slice(1) || [])
        .filter(chunk => chunk.includes(':action/stripe-create-payout'))
        .map(chunk => chunk.match(/^([a-z0-9-]+)/)[1])
    );

    const notifications = withoutComments
      .slice(withoutComments.indexOf('\n :notifications'))
      .split('{:name :notification/')
      .slice(1)
      .map(chunk => ({
        on: chunk.match(/:on :transition\/([a-z0-9-]+)/)[1],
        template: chunk.match(/:template :([a-z0-9-]+)/)[1],
      }));

    // "The money is already yours", as opposed to "you will be paid" (a
    // forecast, legitimate anywhere) or "has NOT been released yet" (the
    // corrected copy, which must not read as a claim - hence matching the
    // auxiliary and participle adjacently rather than a loose `payout.*released`).
    const claimsPaidAlready = name => {
      const source = read(name, 'html.html') + read(name, 'subject.txt');
      return /(have|has) been (paid|released)/i.test(source);
    };

    const wrong = notifications
      .filter(n => claimsPaidAlready(n.template))
      .filter(n => !payoutTransitions.has(n.on));

    expect(wrong).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // The two cancellation templates.
  //
  // One template per role serves all five cancel transitions, so every
  // sentence in them has to be true whether the garment was never collected,
  // is still with the customer, is possibly lost, or is back at the laundry.
  // These assertions are what stops a later edit from making the copy
  // specific to whichever situation the editor had in mind.
  // -----------------------------------------------------------------------
  // The inline English defaults only - `{{t "Key" "default" args}}` - with the
  // markup, style attributes and handlebars paths stripped out. Assertions
  // about WORDING have to run on the words, not on the file: the file is 95%
  // inline CSS, so a sentence-level check against the raw source degenerates
  // into one enormous "sentence" that matches almost anything.
  const copyOf = name => {
    const source = read(name, 'html.html') + '\n' + read(name, 'subject.txt');
    return (source.match(/\{\{t "[A-Za-z.]+" "(?:[^"\\]|\\.)*"/g) || [])
      .map(m => m.replace(/^\{\{t "[A-Za-z.]+" "/, '').replace(/"$/, ''))
      .join(' ');
  };

  describe.each([
    ['booking-cancelled', 'BookingCancelled'],
    ['booking-cancelled-owner', 'BookingCancelledOwner'],
  ])('%s is safe for all five cancel transitions', (template, keyPrefix) => {
    const source = () => read(template, 'html.html') + read(template, 'subject.txt');

    it('routes every string through {{t}} with the right key prefix', () => {
      const html = read(template, 'html.html');

      expect(html).toContain('{{set-translations (asset "content/email-texts.json")}}');
      expect(read(template, 'subject.txt')).toContain(
        '{{set-translations (asset "content/email-texts.json")}}'
      );

      const keys = (html.match(/\{\{t "([A-Za-z.]+)"/g) || []).map(m =>
        m.replace(/\{\{t "/, '').replace(/"$/, '')
      );
      expect(keys.length).toBeGreaterThan(0);
      keys
        .filter(key => !key.startsWith('TransactionEmails.'))
        .forEach(key => {
          expect(key.startsWith(`${keyPrefix}.`)).toEqual(true);
        });
    });

    it('leaves no prose outside a {{t}} call', () => {
      // The check the key-prefix test above cannot make: a hardcoded English
      // sentence has no key to inspect, so it passes that test silently and
      // then ships untranslatable - Console can never override it.
      //
      // Strip handlebars expressions, comments and tags, and what is left is
      // text a reader sees that did NOT come from {{t}}. That is not empty for
      // any template in this process - the accessible fallback link prints its
      // own href as visible text, which reduces to "/order//" once the
      // handlebars are gone - so the assertion is "no two adjacent words",
      // i.e. no sentence, rather than "nothing at all".
      const leftover = read(template, 'html.html')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\{\{[\s\S]*?\}\}/g, '')
        .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;|&amp;/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      expect(leftover).not.toMatch(/[A-Za-z]{2,}\s+[A-Za-z]{2,}/);
    });

    it('never asserts where the garment physically is', () => {
      // The one fact that genuinely differs across the five. Each of these
      // would be false on at least one of them.
      [
        /back at the laundry/i,
        /returned to the laundry/i,
        /still have the garment/i,
        /never collected/i,
        /has been lost/i,
        /back in your wardrobe/i,
        /available to rent again/i,
      ].forEach(claim => expect(source()).not.toMatch(claim));
    });

    it('says nothing about damage in either direction', () => {
      // cancel-from-returned may follow a damage report; the other four do
      // not. One template cannot claim it, and must not deny it either.
      expect(source()).not.toMatch(/damage/i);
      expect(source()).not.toMatch(/no fault/i);
    });

    it('does not explain or attribute the cancellation', () => {
      expect(source()).not.toMatch(/because you/i);
      expect(source()).not.toMatch(/your fault/i);
      expect(source()).not.toMatch(/late return/i);
    });
  });

  it('tells the customer, without hedging, that they have their money back', () => {
    const copy = copyOf('booking-cancelled');
    expect(read('booking-cancelled', 'html.html')).toContain('BookingCancelled.Content');
    expect(copy).toMatch(/refunded in full/i);
    // "will be refunded" would be a forecast. :action/stripe-refund-payment
    // runs on the transition that sends this mail, so it is already done.
    expect(copy).not.toMatch(/will be refunded/i);
    // And it never says a payout to anyone happened or will.
    expect(copy).not.toMatch(/payout/i);
  });

  it('tells the owner plainly that there is no payout, without sounding like one', () => {
    const html = read('booking-cancelled-owner', 'html.html');
    const subject = read('booking-cancelled-owner', 'subject.txt');
    const copy = copyOf('booking-cancelled-owner');

    // Straightforward, in the body AND the subject: a vague email about a
    // cancellation, when money is involved, is worse than none.
    expect(html).toContain('BookingCancelledOwner.NoPayout');
    expect(copy).toMatch(/no payout for this rental/i);
    expect(subject).toMatch(/no payout/i);

    // ...and it must not read as a payout confirmation to the general guard
    // above ('claims a payout only in templates whose transition actually pays
    // out'), which matches an auxiliary+participle pair adjacently. The cancel
    // transitions carry :action/stripe-refund-payment, never
    // :action/stripe-create-payout, so a match here is a false claim.
    expect(html + subject).not.toMatch(/(have|has) been (paid|released)/i);

    // Every sentence in the copy that mentions a payout negates it. A bare
    // "your payout for this rental" sentence is exactly the misreading this
    // template has to avoid, and it would slip past the regex above.
    const payoutSentences = copy.split(/(?<=[.!?])\s+/).filter(s => /payout/i.test(s));
    expect(payoutSentences.length).toBeGreaterThan(1);
    payoutSentences.forEach(sentence => expect(sentence).toMatch(/\b(no|not|never)\b/i));
  });

  // -----------------------------------------------------------------------
  // Ready for pickup.
  //
  // The client dictated this email's shape (Jonathan, 2026-09-02): subject
  // "Ready for pickup: Your <listing> rental", a first-name greeting, one
  // sentence naming the studio, then the two steps and a CTA that says the QR
  // is behind it. The assertions below are about the parts that can silently
  // break - the two data paths (`customer.first-name`, the studio name off the
  // listing's publicData) and the fallback arm - not about the wording.
  // -----------------------------------------------------------------------
  describe('booking-ready-for-pickup follows the format the client asked for', () => {
    const html = () => read('booking-ready-for-pickup', 'html.html');

    it('leads with the listing name in the subject and the heading', () => {
      const subject = read('booking-ready-for-pickup', 'subject.txt');

      expect(subject).toContain('BookingReadyForPickup.Subject');
      expect(subject).toMatch(/Ready for pickup: Your \{listingTitle\} rental/);
      expect(subject).toContain('listingTitle=transaction.listing.title');
      expect(html()).toMatch(
        /BookingReadyForPickup\.Title" "Ready for pickup: Your \{listingTitle\}/
      );
    });

    it('greets the renter by first name, not by display name', () => {
      // `display-name` is the abbreviated public name ("Jonathan O"), which is
      // not what "Hi [First Name]" asks for. Both are available on the
      // customer, so the wrong one would render perfectly well.
      expect(html()).toContain('firstName=customer.first-name');
      expect(html()).toContain('BookingReadyForPickup.Greeting');
      expect(html()).not.toContain('customer.display-name');
    });

    it('names the studio, and still reads if the listing has no name for it', () => {
      // Arm names come from the damage-branch helper; here the split is on the
      // studio name, so they read as with-studio / without-studio.
      const { whenDamaged: withStudio, whenClean: withoutStudio } = splitIfBlock(
        html(),
        'listing.public-data.assignedLaundryName'
      );

      // `assignedLaundryName` is server-written onto the listing when a laundry
      // is assigned (server/api-util/laundryAssignment.js) and is null when the
      // studio has neither a studio name nor a display name. Unbranched, that
      // renders "ready for pickup at ." to the renter.
      expect(withStudio).toContain('laundryName=listing.public-data.assignedLaundryName');
      expect(withStudio).toContain('BookingReadyForPickup.Content"');

      expect(withoutStudio).toContain('BookingReadyForPickup.ContentNoLaundry');
      // The fallback arm must not carry a placeholder it is never given.
      expect(withoutStudio).not.toContain('{laundryName}');
    });

    // THE TWO BULLETS BECAME ONE PARAGRAPH (`3fdcdc9db`, 2026-09-29): "head to the studio
    // during business hours" + "show your QR at the counter" are now a single instruction
    // that sends the renter to the order page for the code. The bullets' three keys
    // (StepVisit / StepVisitNoLaundry / StepQr) are gone from the template AND from
    // email-texts.en.json, so the branch above no longer splits on them either.
    it('gives one pickup instruction and a CTA that says the QR is behind it', () => {
      const copy = copyOf('booking-ready-for-pickup');

      expect(html()).toContain('BookingReadyForPickup.StepsTitle');
      expect(html()).toContain('BookingReadyForPickup.StepPickupInstructions');
      expect(copy).toMatch(/How to pick it up:/);
      expect(copy).toMatch(/click View Order Details to reveal your QR code/i);
      // The QR lives on the order page (HandoverQrMaybe), which is where the
      // button goes - so the button is allowed to promise it.
      expect(html()).toMatch(/BookingReadyForPickup\.Cta" "View Order Details & QR Code"/);
    });

    // The retired bullets must not come back by halves: a key left in the template with no
    // entry in email-texts.en.json renders Console's absence as the raw default, and a key
    // left in the json with no template is copy nobody can reach. The keys-and-defaults test
    // above catches both directions in general; this names the three that were just removed,
    // because a revert of the commented-out block would otherwise look harmless.
    it('no longer carries the bullet-list keys, in the template or in the texts file', () => {
      ['StepVisit', 'StepVisitNoLaundry', 'StepQr'].forEach(suffix => {
        expect(html()).not.toContain(`BookingReadyForPickup.${suffix}"`);
      });
    });

    // Handlebars does not know what an HTML comment is: `{{t ...}}` inside `<!-- -->` is still
    // evaluated, and the result is still delivered - so commenting copy out ships it to the
    // renter as a hidden comment rather than removing it. The bullets spent a week in exactly
    // that state (`3fdcdc9db` commented them rather than deleting).
    it('ships no copy inside an HTML comment', () => {
      const comments = html().match(/<!--[\s\S]*?-->/g) || [];

      comments.forEach(comment => expect(comment).not.toContain('{{'));
    });

    it('routes every string through {{t}} with its own key prefix', () => {
      const keys = (html().match(/\{\{t "([A-Za-z.]+)"/g) || []).map(m =>
        m.replace(/\{\{t "/, '').replace(/"$/, '')
      );

      expect(keys.length).toBeGreaterThan(0);
      keys
        .filter(key => !key.startsWith('TransactionEmails.'))
        .forEach(key => expect(key.startsWith('BookingReadyForPickup.')).toEqual(true));
    });
  });

  // -----------------------------------------------------------------------
  // The return receipt to the renter.
  //
  // Same client-dictated shape as ready-for-pickup (Jonathan, 2026-09-02), but
  // this template already branched on the damage flag, and the new copy - "your
  // return is officially complete", a review invitation, "we can't wait to see
  // what you rent next" - is only true on the undamaged side. What these
  // assertions protect is that separation.
  // -----------------------------------------------------------------------
  describe('booking-return-completed-customer invites a review, on the clean side only', () => {
    const armsOf = () =>
      splitIfBlock(
        read('booking-return-completed-customer', 'html.html'),
        'metadata.damageReported.flag'
      );

    it('greets the renter by first name, before either branch', () => {
      const html = read('booking-return-completed-customer', 'html.html');
      const { whenDamaged, whenClean } = armsOf();

      expect(html).toContain('BookingReturnCompletedCustomer.Greeting');
      expect(html).toContain('firstName=customer.first-name');
      // Outside the branch, so a damage report is not the one email that opens
      // without a name.
      expect(whenDamaged).not.toContain('Greeting');
      expect(whenClean).not.toContain('Greeting');
    });

    it('names the studio that took the garment in, with a fallback', () => {
      const { whenClean } = armsOf();

      expect(whenClean).toContain('laundryName=listing.public-data.assignedLaundryName');
      expect(whenClean).toContain('BookingReturnCompletedCustomer.ContentNoLaundry');
      expect(copyOf('booking-return-completed-customer')).toMatch(/safely dropped off/i);
    });

    it('keeps the closing warmth off the damage report', () => {
      const { whenDamaged, whenClean } = armsOf();

      // "We can't wait to see what you rent next!" under a damage report is
      // the tone failure this guards.
      expect(whenClean).toContain('BookingReturnCompletedCustomer.Closing');
      expect(whenDamaged).not.toContain('BookingReturnCompletedCustomer.Closing');
    });

    it('does not invite a review here, because the form does not exist yet', () => {
      // Jonathan chose option (a) on 2026-09-02: this mail fires at
      // :state/returned, and review-1-by-customer only opens at
      // :state/delivered. It promises the invitation instead of faking it.
      const html = read('booking-return-completed-customer', 'html.html');

      expect(html).not.toContain('CtaReview');
      expect(html).not.toMatch(/Leave a Review/i);
      expect(html).toContain('BookingReturnCompletedCustomer.Cta" "View order details"');
      expect(armsOf().whenClean).toContain('BookingReturnCompletedCustomer.ReviewLater');
    });

    it('says CoCloset covers significant damage, on the damaged side', () => {
      const { whenDamaged, whenClean } = armsOf();

      expect(whenDamaged).toContain('BookingReturnCompletedCustomer.CoclosetUpdate');
      expect(copyOf('booking-return-completed-customer')).toMatch(/CoCloset covers the cost/);
      // A renter whose return was clean has no condition note to reassure
      // them about.
      expect(whenClean).not.toContain('CoclosetUpdate');
    });
  });

  // -----------------------------------------------------------------------
  // Where the review invitation actually lives.
  //
  // booking-review-by-customer-wanted fires on every transition into
  // :state/delivered - the moment the review form appears on the order page -
  // so the client's review copy belongs here, not on the return receipt.
  //
  // NEW KEYS, NOT REWORDED ONES. `BookingReviewByCustomerWanted.Title`,
  // `.Content` and `.Cta` already exist in Console, and Console overrides the
  // inline default. Rewording them in the repo would have changed nothing that
  // a renter reads. The same reasoning that retired
  // `BookingReturnCompleted.Payout`.
  // -----------------------------------------------------------------------
  describe('booking-review-by-customer-wanted carries the review prompts', () => {
    const html = () => read('booking-review-by-customer-wanted', 'html.html');

    it("asks the client's two questions, by first name", () => {
      const copy = copyOf('booking-review-by-customer-wanted');

      expect(html()).toContain('firstName=customer.first-name');
      expect(copy).toMatch(/How did everything go\?/);
      expect(copy).toMatch(/How true to size was/i);
      expect(html()).toContain('providerDisplayName=provider.display-name');
    });

    it('uses keys Console does not already override', () => {
      // If this fails, the copy below is dead text: Console wins.
      ['Heading', 'Greeting', 'Intro', 'ReviewFit', 'ReviewLender', 'CtaReview'].forEach(key =>
        expect(html()).toContain(`BookingReviewByCustomerWanted.${key}`)
      );
      expect(html()).not.toContain('BookingReviewByCustomerWanted.Title"');
      expect(html()).not.toContain('BookingReviewByCustomerWanted.Content"');
      expect(html()).not.toContain('BookingReviewByCustomerWanted.Cta"');
    });
  });

  // -----------------------------------------------------------------------
  // The pickup reminder (Jonathan, 2026-09-02).
  // -----------------------------------------------------------------------
  it('booking-pickup-reminder names the studio and the start date', () => {
    const html = read('booking-pickup-reminder', 'html.html');
    const copy = copyOf('booking-pickup-reminder');

    expect(html).toContain('firstName=customer.first-name');
    expect(copy).toMatch(/Make room in your closet!/);
    expect(copy).toMatch(/rental starts tomorrow on/i);
    // Same null-studio fallback as the other two studio-naming templates.
    expect(html).toContain('laundryName=listing.public-data.assignedLaundryName');
    expect(html).toContain('BookingPickupReminder.ContentNoLaundry');
  });

  it('booking-return-completed tells the owner CoCloset covers the damage', () => {
    const arms = splitIfBlock(
      read('booking-return-completed', 'html.html'),
      'metadata.damageReported.flag'
    );

    expect(read('booking-return-completed', 'html.html')).toContain(
      'BookingReturnCompleted.CoclosetUpdate'
    );
    expect(copyOf('booking-return-completed')).toMatch(/CoCloset covers the cost/);
    expect(arms.whenClean).not.toContain('CoclosetUpdate');
  });

  // -----------------------------------------------------------------------
  // The handover QR, in the mail itself (Jonathan, 2026-09-02).
  //
  // `<img src="{{marketplace.url}}/api/transaction-qr?id=...">`. That endpoint
  // renders PNG bytes and takes no authentication by design (server/api/
  // transaction-qr.js: it encodes the handover URL for an id the caller already
  // supplied, so there is nothing for an auth check to protect) - which is what
  // makes it renderable from a mail client at all.
  //
  // WHICH TEMPLATES, AND WHY NOT ALL OF THEM. The QR belongs in the mails that
  // send the renter to a counter, and only while the code is still live: the
  // customer's window is accepted -> ready-for-pickup -> picked-up -> overdue
  // (HANDOVER_QR_CUSTOMER_VISIBLE_STATES). A code printed in the owner's mail,
  // or in one that arrives after the garment is back, is at best noise.
  // -----------------------------------------------------------------------
  describe('the QR is in the mails that send the renter to a counter', () => {
    const QR_TEMPLATES = [
      'booking-ready-for-pickup',
      'booking-pickup-reminder',
      'booking-return-reminder',
      'booking-return-due-today',
      'booking-late-return',
    ];

    const hasQr = name => read(name, 'html.html').includes('/api/transaction-qr?id=');

    // Every :notifications entry that sends a given template, as { role }.
    // Comments are stripped first - this section is mostly prose, and a
    // `:template :...` written inside it would otherwise read as data.
    const notificationEntriesForTemplate = template => {
      const withoutComments = fs
        .readFileSync(EDN_PATH, 'utf8')
        .split('\n')
        .map(line => line.replace(/;;.*$/, ''))
        .join('\n');

      return withoutComments
        .slice(withoutComments.indexOf('\n :notifications'))
        .split(/\{:name\s+:notification\//)
        .slice(1)
        .filter(chunk => chunk.includes(`:template :${template}}`))
        .map(chunk => ({ role: chunk.match(/:to :actor\.role\/([a-z]+)/)[1] }));
    };

    it.each(QR_TEMPLATES)('%s renders the code', name => {
      const html = read(name, 'html.html');

      expect(hasQr(name)).toEqual(true);
      // The id has to be url-encoded like every other use of it in these
      // templates, and the image needs an alt - a QR is a picture of a string,
      // so an empty alt tells a screen reader nothing at all.
      expect(html).toContain('/api/transaction-qr?id={{url-encode id}}');
      expect(html).toContain('TransactionEmails.HandoverQrAlt');
      // Mail clients block remote images by default, so the code cannot be the
      // only way through: the reference is printed as text underneath.
      expect(html).toContain('TransactionEmails.HandoverQrFallback');
    });

    it('is in no other template', () => {
      const others = fs.readdirSync(TEMPLATES_DIR).filter(name => !QR_TEMPLATES.includes(name));

      expect(others.filter(hasQr)).toEqual([]);
    });

    it('goes only to the customer, and only while the code is still live', () => {
      // The states those four mails are sent in, read off the process rather
      // than asserted from memory.
      QR_TEMPLATES.forEach(template => {
        const entries = notificationEntriesForTemplate(template);
        expect(entries.length).toBeGreaterThan(0);
        entries.forEach(entry => expect(entry.role).toEqual('customer'));
      });
    });
  });

  // -----------------------------------------------------------------------
  // The sign-off (Jonathan, 2026-09-02: "puedes agregar esto a todos los
  // correos?"). Every template in this process ends the same way, so the test
  // is over the whole directory rather than over a list - a template added
  // later without it is the failure this catches.
  // -----------------------------------------------------------------------
  describe('every template signs off as the marketplace team', () => {
    const templates = () => fs.readdirSync(TEMPLATES_DIR);

    it('covers every template, with the shared key so Console edits it once', () => {
      expect(templates().length).toBeGreaterThan(20);

      templates().forEach(name => {
        const html = read(name, 'html.html');
        expect(html).toContain('{{t "TransactionEmails.SignOff" "Warmly,"}}');
        expect(html).toContain('TransactionEmails.SignOffTeam');
        expect(html).toContain('marketplaceName=marketplace.name}}');
      });
    });

    it('signs off after the body and before the unsubscribe footer', () => {
      templates().forEach(name => {
        const html = read(name, 'html.html');
        const signOff = html.indexOf('TransactionEmails.SignOff"');
        const cta = html.lastIndexOf('/order/{{url-encode id}}/');
        const footer = html.indexOf('TransactionEmails.MembershipParagraph');

        expect(signOff).toBeGreaterThan(cta);
        expect(signOff).toBeLessThan(footer);
      });
    });

    it('reads the marketplace name outside the {{#with transaction}} block', () => {
      // `marketplace` is a root-level key. Inside `{{#with transaction}}` the
      // lookup depends on Handlebars' deprecated parent-scope fallback; after
      // {{/with}} it does not. Same reason the footer sits where it does.
      templates().forEach(name => {
        const html = read(name, 'html.html');
        expect(html.indexOf('TransactionEmails.SignOff"')).toBeGreaterThan(
          html.lastIndexOf('{{/with}}')
        );
      });
    });
  });
});
