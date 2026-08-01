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
    return {
      transition: `transition/${name}`,
      from: from ? from[1] : 'initial',
      to: to[1],
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
    expect(ednTransitions.length).toEqual(36);
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
      states.READY_FOR_PICKUP,
      states.PICKED_UP,
      states.OVERDUE,
      states.RETURNED,
      states.CLEANING,
    ].forEach(state => {
      expect(Object.keys(graph.states[state].on).length).toBeGreaterThan(0);
    });
  });

  it('leaves the review diamond reachable only from delivered', () => {
    expect(process.getTransitionsToStates([states.REVIEWED_BY_CUSTOMER])).toEqual([
      transitions.REVIEW_1_BY_CUSTOMER,
    ]);
    expect(process.getTransitionsToStates([states.REVIEWED_BY_PROVIDER])).toEqual([
      transitions.REVIEW_1_BY_PROVIDER,
    ]);
  });

  it('lists all eight ways of reaching delivered', () => {
    expect(process.getTransitionsToStates([states.DELIVERED]).sort()).toEqual(
      [
        transitions.COMPLETE,
        transitions.OPERATOR_COMPLETE,
        transitions.LAUNDRY_MARK_AVAILABLE,
        transitions.AUTO_COMPLETE_FROM_READY,
        transitions.AUTO_COMPLETE_FROM_PICKED_UP,
        transitions.AUTO_COMPLETE_FROM_OVERDUE,
        transitions.AUTO_COMPLETE_FROM_RETURNED,
        transitions.AUTO_COMPLETE_FROM_CLEANING,
      ].sort()
    );
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

  it('isCompleted covers every transition into delivered plus the review diamond', () => {
    [
      transitions.COMPLETE,
      transitions.OPERATOR_COMPLETE,
      transitions.LAUNDRY_MARK_AVAILABLE,
      transitions.AUTO_COMPLETE_FROM_READY,
      transitions.AUTO_COMPLETE_FROM_PICKED_UP,
      transitions.AUTO_COMPLETE_FROM_OVERDUE,
      transitions.AUTO_COMPLETE_FROM_RETURNED,
      transitions.AUTO_COMPLETE_FROM_CLEANING,
      transitions.REVIEW_1_BY_CUSTOMER,
      transitions.REVIEW_2_BY_PROVIDER,
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
      transitions.CANCEL_FROM_READY_FOR_PICKUP,
      transitions.CANCEL_FROM_PICKED_UP,
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
      transitions.LAUNDRY_MARK_READY,
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

  it('isCustomerReview / isProviderReview are unchanged from default-booking', () => {
    expect(isCustomerReview(transitions.REVIEW_1_BY_CUSTOMER)).toEqual(true);
    expect(isCustomerReview(transitions.REVIEW_2_BY_CUSTOMER)).toEqual(true);
    expect(isCustomerReview(transitions.REVIEW_1_BY_PROVIDER)).toEqual(false);
    expect(isProviderReview(transitions.REVIEW_1_BY_PROVIDER)).toEqual(true);
    expect(isProviderReview(transitions.REVIEW_2_BY_PROVIDER)).toEqual(true);
    expect(isProviderReview(transitions.REVIEW_1_BY_CUSTOMER)).toEqual(false);
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
    referencedTemplates().forEach(name => {
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
});
