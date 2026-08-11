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
    expect(ednTransitions.length).toEqual(38);
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

describe('cocloset-booking owner notifications', () => {
  // The notifications the process attaches to a given transition, read out of
  // the :notifications section of the EDN.
  // Every :notifications entry attached to a transition, as
  // { name, role, template }. Comments are stripped first so a `:on :...`
  // written in prose (this section has a lot of prose) cannot be read as data.
  const notificationEntriesOn = transition => {
    const raw = fs.readFileSync(EDN_PATH, 'utf8');
    const withoutComments = raw
      .split('\n')
      .map(line => line.replace(/;;.*$/, ''))
      .join('\n');
    const section = withoutComments.slice(withoutComments.indexOf('\n :notifications'));
    return section
      .split('{:name :notification/')
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
});
