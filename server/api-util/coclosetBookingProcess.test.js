const fs = require('fs');
const path = require('path');

const {
  STATES,
  TRANSITIONS,
  TRANSITION_TO_STATE,
  stateFromLastTransition,
  LAUNDRY_STATUSES,
  LAUNDRY_STATUS_TRANSITIONS,
  DAMAGE_REPORT_STATUS,
  transitionForStatus,
  OPS_LAST_TRANSITIONS,
  ACCEPT_TRANSITIONS,
  isInvalidTransitionError,
} = require('./coclosetBookingProcess');

const EDN_PATH = path.join(
  __dirname,
  '../../ext/transaction-processes/cocloset-booking/process.edn'
);

/**
 * Extract every `:name :transition/x ... :to :state/y` pair from the process
 * EDN.
 *
 * THIS IS THE DRIFT GUARD THAT REPLACES THE DELETED ONE.
 *
 * The old guard asserted that two hand-maintained arrays of our own invention
 * matched each other, which could only ever prove they were equally wrong.
 * This one checks the server mirror against the actual source of truth - the
 * EDN that gets pushed to Sharetribe. If someone adds a transition, renames a
 * state, or repoints a `:to`, this fails.
 *
 * Parsing is a regex rather than a real EDN reader on purpose: the template
 * has no EDN dependency and AGENTS.md says ask before adding one. The shape it
 * relies on is narrow and stable (a `:name`/`:to` pair per transition map), and
 * the assertions below check it actually found something rather than trusting
 * an empty match set.
 */
const parseTransitionsFromEdn = () => {
  const raw = fs.readFileSync(EDN_PATH, 'utf8');

  // Only the :transitions vector. The :notifications block also has :name and
  // :to keys, with entirely different values (:notification/*, :actor.role/*).
  const notificationsIndex = raw.indexOf('\n :notifications');
  const transitionsSection = notificationsIndex > -1 ? raw.slice(0, notificationsIndex) : raw;

  // Strip EDN line comments: they discuss states and transitions in prose
  // ("returned -> laundry-mark-pending-cleaning") and would otherwise be
  // parsed as declarations.
  const withoutComments = transitionsSection
    .split('\n')
    .map(line => line.replace(/;;.*$/, ''))
    .join('\n');

  const nameRe = /:name\s+:transition\/([a-z0-9-]+)/g;
  const matches = [...withoutComments.matchAll(nameRe)];

  return matches.map((match, i) => {
    const start = match.index;
    const end = i + 1 < matches.length ? matches[i + 1].index : withoutComments.length;
    const chunk = withoutComments.slice(start, end);
    const toMatch = chunk.match(/:to\s+:state\/([a-z0-9-]+)/);
    return { transition: `transition/${match[1]}`, to: toMatch ? toMatch[1] : null };
  });
};

// The EDN and the JS mirrors disagree on exactly one spelling, deliberately:
// the EDN writes `:state/cancelled` (as does stock default-booking) while
// every JS process mirror in this template writes 'canceled'. State names
// never cross the API boundary, so the JS spelling is the one our own wire
// format uses. Normalise rather than pretend they match.
const EDN_STATE_ALIASES = { cancelled: 'canceled' };
const normaliseEdnState = state => EDN_STATE_ALIASES[state] || state;

describe('coclosetBookingProcess', () => {
  const ednTransitions = parseTransitionsFromEdn();

  describe('drift guard against process.edn', () => {
    it('found a plausible set of transitions to check', () => {
      // If the regex silently matched nothing, every assertion below would
      // pass vacuously.
      expect(ednTransitions.length).toBeGreaterThan(30);
      expect(ednTransitions.every(t => t.to)).toBe(true);
      expect(ednTransitions.map(t => t.transition)).toContain(
        'transition/laundry-confirm-return-late'
      );
    });

    it('maps every EDN transition to the state the EDN says it leads to', () => {
      const mismatches = ednTransitions
        .filter(t => TRANSITION_TO_STATE[t.transition] !== normaliseEdnState(t.to))
        .map(t => `${t.transition}: edn=${t.to} mirror=${TRANSITION_TO_STATE[t.transition]}`);
      expect(mismatches).toEqual([]);
    });

    it('does not invent transitions the EDN does not have', () => {
      const ednNames = new Set(ednTransitions.map(t => t.transition));
      const extra = Object.keys(TRANSITION_TO_STATE).filter(t => !ednNames.has(t));
      expect(extra).toEqual([]);
    });

    it('has a TRANSITIONS constant for every EDN transition', () => {
      const declared = new Set(Object.values(TRANSITIONS));
      const missing = ednTransitions.map(t => t.transition).filter(t => !declared.has(t));
      expect(missing).toEqual([]);
    });

    it('every state it names is a real EDN target state', () => {
      const ednStates = new Set(ednTransitions.map(t => normaliseEdnState(t.to)));
      // `initial` is not a target of anything, so it is not in the EDN's `:to`
      // set and is not modelled here either.
      Object.values(STATES).forEach(state => {
        expect(ednStates.has(state)).toBe(true);
      });
    });

    it('every OPS_LAST_TRANSITIONS entry is real - the filter fails closed on typos', () => {
      // An unrecognised transition name is not rejected by transactions.query,
      // it just matches nothing (verified against the real Dev API). So a typo
      // here silently empties the ops dashboard rather than erroring.
      const ednNames = new Set(ednTransitions.map(t => t.transition));
      const bogus = OPS_LAST_TRANSITIONS.filter(t => !ednNames.has(t));
      expect(bogus).toEqual([]);
    });

    it('ACCEPT_TRANSITIONS are the transitions that actually reach `accepted`', () => {
      const reachesAccepted = ednTransitions
        .filter(t => normaliseEdnState(t.to) === STATES.ACCEPTED)
        .map(t => t.transition);
      expect(ACCEPT_TRANSITIONS.sort()).toEqual(reachesAccepted.sort());
    });
  });

  describe('stateFromLastTransition', () => {
    it('derives the laundry chain', () => {
      expect(stateFromLastTransition('transition/laundry-mark-ready')).toBe('ready-for-pickup');
      expect(stateFromLastTransition('transition/mark-overdue')).toBe('overdue');
      expect(stateFromLastTransition('transition/laundry-confirm-return')).toBe('returned');
      expect(stateFromLastTransition('transition/laundry-confirm-return-late')).toBe('returned');
      expect(stateFromLastTransition('transition/laundry-mark-available')).toBe('delivered');
    });

    it('puts all three cleaning sub-phases in one state', () => {
      [
        'transition/laundry-mark-pending-cleaning',
        'transition/laundry-start-cleaning',
        'transition/laundry-start-quality-inspection',
      ].forEach(t => expect(stateFromLastTransition(t)).toBe(STATES.CLEANING));
    });

    it('returns null rather than guessing for an unknown or absent transition', () => {
      expect(stateFromLastTransition('transition/not-a-thing')).toBeNull();
      expect(stateFromLastTransition(undefined)).toBeNull();
      expect(stateFromLastTransition(null)).toBeNull();
    });
  });

  describe('transitionForStatus', () => {
    it('maps each status onto a transition the EDN declares', () => {
      const ednNames = new Set(ednTransitions.map(t => t.transition));
      LAUNDRY_STATUSES.forEach(status => {
        const { transition } = transitionForStatus(status, null);
        expect(ednNames.has(transition)).toBe(true);
      });
    });

    it('branches `returned` on the current state', () => {
      expect(transitionForStatus('returned', STATES.PICKED_UP).transition).toBe(
        'transition/laundry-confirm-return'
      );
      expect(transitionForStatus('returned', STATES.OVERDUE).transition).toBe(
        'transition/laundry-confirm-return-late'
      );
    });

    it('picks a from-state that the EDN actually allows for each branch', () => {
      // The reason the branch exists at all: `:from` is single-valued, so the
      // two return transitions are not interchangeable.
      const raw = fs.readFileSync(EDN_PATH, 'utf8');
      expect(raw).toMatch(
        /:name :transition\/laundry-confirm-return,[\s\S]*?:from :state\/picked-up/
      );
      expect(raw).toMatch(
        /:name :transition\/laundry-confirm-return-late,[\s\S]*?:from :state\/overdue/
      );
    });

    it('falls back to the on-time transition from an unmodelled state', () => {
      expect(transitionForStatus('returned', 'accepted').transition).toBe(
        'transition/laundry-confirm-return'
      );
      expect(transitionForStatus('returned', null).transition).toBe(
        'transition/laundry-confirm-return'
      );
    });

    it('carries the cleaning phase only for the cleaning transitions', () => {
      expect(transitionForStatus('pending-cleaning', null).cleaningPhase).toBe('pending-cleaning');
      expect(transitionForStatus('cleaning-in-progress', null).cleaningPhase).toBe(
        'cleaning-in-progress'
      );
      expect(transitionForStatus('quality-inspection', null).cleaningPhase).toBe(
        'quality-inspection'
      );
      expect(transitionForStatus('ready-for-pickup', null).cleaningPhase).toBeUndefined();
      expect(transitionForStatus('returned', STATES.PICKED_UP).cleaningPhase).toBeUndefined();
    });

    it('returns null for an unknown status', () => {
      expect(transitionForStatus('teleported', null)).toBeNull();
    });

    it('names a damage-report status that is really in the vocabulary', () => {
      expect(LAUNDRY_STATUSES).toContain(DAMAGE_REPORT_STATUS);
      expect(LAUNDRY_STATUS_TRANSITIONS[DAMAGE_REPORT_STATUS].byState).toBeDefined();
    });
  });

  describe('isInvalidTransitionError', () => {
    it('recognises the code the real API returns', () => {
      // Verified against the Dev Integration API by firing
      // transition/laundry-mark-ready at an inquiry-stage transaction.
      expect(
        isInvalidTransitionError({
          status: 409,
          data: { errors: [{ code: 'transaction-invalid-transition' }] },
        })
      ).toBe(true);
    });

    it('also recognises the transition-not-allowed spelling', () => {
      expect(
        isInvalidTransitionError({ data: { errors: [{ code: 'transition-not-allowed' }] } })
      ).toBe(true);
    });

    it('does not claim unrelated failures', () => {
      expect(isInvalidTransitionError({ data: { errors: [{ code: 'not-found' }] } })).toBe(false);
      expect(isInvalidTransitionError(new Error('network down'))).toBe(false);
      expect(isInvalidTransitionError(undefined)).toBe(false);
      expect(isInvalidTransitionError({ data: {} })).toBe(false);
    });
  });
});
