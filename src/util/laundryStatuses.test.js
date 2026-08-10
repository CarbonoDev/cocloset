/**
 * Tests for the client half of the laundry ops vocabulary.
 *
 * This file replaces a drift guard that reached across into `server/` and
 * asserted two hand-maintained status arrays were deep-equal. That guard is
 * gone with the arrays: the laundry chain is real `cocloset-booking`
 * transitions now, and the process EDN is the source of truth. What is worth
 * testing here is the part that is genuinely ours - turning a row into a
 * status badge, and deciding which action is legal from which state.
 */
import {
  LAUNDRY_STATES,
  CLEANING_PHASES,
  LAUNDRY_ACTION_STATUSES,
  DAMAGE_REPORT_STATUS,
  CLEANING_DAYS_STATUS,
  PAYOUT_ACTION_STATUS,
  opsStatus,
  laundryActionsFor,
  statusLabelKey,
  isOverdue,
  wasReturnedLate,
} from './laundryStatuses';

const row = (overrides = {}) => ({
  id: 'tx:1',
  rowType: 'transaction',
  transactionId: '1',
  state: null,
  cleaningPhase: null,
  readinessStatus: null,
  returnedLate: false,
  ...overrides,
});

describe('laundryStatuses', () => {
  describe('opsStatus', () => {
    it('is the process state outside cleaning', () => {
      expect(opsStatus(row({ state: 'ready-for-pickup' }))).toBe('ready-for-pickup');
      expect(opsStatus(row({ state: 'overdue' }))).toBe('overdue');
      expect(opsStatus(row({ state: 'delivered' }))).toBe('delivered');
    });

    it('is the cleaning sub-phase inside cleaning', () => {
      CLEANING_PHASES.forEach(phase => {
        expect(opsStatus(row({ state: 'cleaning', cleaningPhase: phase }))).toBe(phase);
      });
    });

    it('degrades to the first cleaning phase rather than rendering a blank badge', () => {
      expect(opsStatus(row({ state: 'cleaning', cleaningPhase: null }))).toBe('pending-cleaning');
    });

    it('is null for a row with no transaction state', () => {
      expect(opsStatus(row())).toBeNull();
      expect(opsStatus(null)).toBeNull();
    });
  });

  describe('laundryActionsFor', () => {
    it.each([
      ['accepted', null, 'ready-for-pickup'],
      ['ready-for-pickup', null, 'picked-up'],
      ['picked-up', null, 'returned'],
      ['overdue', null, 'returned'],
      ['returned', null, 'pending-cleaning'],
      ['cleaning', 'pending-cleaning', 'cleaning-in-progress'],
      ['cleaning', 'cleaning-in-progress', 'quality-inspection'],
      ['cleaning', 'quality-inspection', 'available-for-booking'],
    ])('from state %s (phase %s) offers %s', (state, cleaningPhase, expected) => {
      const actions = laundryActionsFor(row({ state, cleaningPhase }));
      expect(actions).toHaveLength(1);
      expect(actions[0].status).toBe(expected);
      expect(actions[0].labelKey).toBe(`LaundryOpsPage.action.${expected}`);
    });

    it('offers the same step from picked-up and from overdue - the server picks the transition', () => {
      // laundry-confirm-return vs laundry-confirm-return-late is decided
      // server-side from the real state; the client must not try to guess.
      expect(laundryActionsFor(row({ state: 'picked-up' }))[0].status).toBe('returned');
      expect(laundryActionsFor(row({ state: 'overdue' }))[0].status).toBe('returned');
    });

    it('offers nothing once the chain is over, or before it starts', () => {
      ['delivered', 'canceled', 'preauthorized', 'inquiry'].forEach(state => {
        expect(laundryActionsFor(row({ state }))).toEqual([]);
      });
    });

    it('offers nothing for an inventory-only row', () => {
      expect(laundryActionsFor(row({ rowType: 'listing', state: null }))).toEqual([]);
      // Even if a listing row somehow carried a state, it has no transaction
      // to transition.
      expect(laundryActionsFor(row({ rowType: 'listing', state: 'accepted' }))).toEqual([]);
    });

    it('only ever proposes statuses the endpoint accepts', () => {
      [...LAUNDRY_STATES, 'canceled', 'inquiry', null].forEach(state => {
        [null, ...CLEANING_PHASES].forEach(cleaningPhase => {
          laundryActionsFor(row({ state, cleaningPhase })).forEach(action => {
            expect(LAUNDRY_ACTION_STATUSES).toContain(action.status);
          });
        });
      });
    });

    it('flags the damage-report step and the payout step, and only those', () => {
      const damageSteps = [];
      const payoutSteps = [];
      [...LAUNDRY_STATES].forEach(state => {
        [null, ...CLEANING_PHASES].forEach(cleaningPhase => {
          laundryActionsFor(row({ state, cleaningPhase })).forEach(a => {
            if (a.needsDamageReport) damageSteps.push(a.status);
            if (a.firesPayout) payoutSteps.push(a.status);
          });
        });
      });
      expect(new Set(damageSteps)).toEqual(new Set([DAMAGE_REPORT_STATUS]));
      expect(new Set(payoutSteps)).toEqual(new Set([PAYOUT_ACTION_STATUS]));
    });

    it('asks for the cleaning-days estimate only at the return step', () => {
      // The one moment somebody is holding the garment and can say how long it
      // will take. Anywhere else the number is a guess, and it drives
      // listing.metadata.readyAt and the availability block - so an extra step
      // offering the field would let a stale forecast overwrite a real one.
      const cleaningDaysSteps = [];
      [...LAUNDRY_STATES].forEach(state => {
        [null, ...CLEANING_PHASES].forEach(cleaningPhase => {
          laundryActionsFor(row({ state, cleaningPhase })).forEach(a => {
            if (a.needsCleaningDays) cleaningDaysSteps.push(a.status);
          });
        });
      });
      expect(new Set(cleaningDaysSteps)).toEqual(new Set([CLEANING_DAYS_STATUS]));
    });

    it('offers the cleaning-days field from both picked-up and overdue', () => {
      // The two states a garment can come back from. A late return needs the
      // estimate at least as much as an on-time one.
      expect(laundryActionsFor(row({ state: 'picked-up' }))[0].needsCleaningDays).toBe(true);
      expect(laundryActionsFor(row({ state: 'overdue' }))[0].needsCleaningDays).toBe(true);
    });

    it('keeps "confirm return" and "start cleaning" as two separate steps', () => {
      // The interval between them is the only window in which an operator can
      // still cancel with a refund after a damage report. Collapsing them into
      // one action would destroy it silently, so assert the shape explicitly.
      const atPickedUp = laundryActionsFor(row({ state: 'picked-up' }));
      expect(atPickedUp.map(a => a.status)).toEqual(['returned']);
      expect(atPickedUp[0].firesPayout).toBe(false);

      const atReturned = laundryActionsFor(row({ state: 'returned' }));
      expect(atReturned.map(a => a.status)).toEqual(['pending-cleaning']);
      expect(atReturned[0].firesPayout).toBe(true);
    });
  });

  describe('statusLabelKey', () => {
    it('prefers the transaction status', () => {
      expect(statusLabelKey(row({ state: 'picked-up', readinessStatus: 'stored' }))).toBe(
        'LaundryOpsPage.status.picked-up'
      );
    });

    it('uses the cleaning sub-phase inside cleaning', () => {
      expect(statusLabelKey(row({ state: 'cleaning', cleaningPhase: 'quality-inspection' }))).toBe(
        'LaundryOpsPage.status.quality-inspection'
      );
    });

    it('falls back to the listing readiness status', () => {
      expect(statusLabelKey(row({ state: null, readinessStatus: 'incoming' }))).toBe(
        'LaundryOpsPage.readiness.incoming'
      );
    });

    it('returns null when the row has no status at all', () => {
      expect(statusLabelKey({})).toBeNull();
      expect(statusLabelKey(null)).toBeNull();
    });
  });

  describe('lateness', () => {
    it('isOverdue reads the process state, not a metadata flag', () => {
      expect(isOverdue(row({ state: 'overdue' }))).toBe(true);
      expect(isOverdue(row({ state: 'picked-up' }))).toBe(false);
    });

    it('wasReturnedLate survives the move out of overdue', () => {
      const returnedLate = row({ state: 'returned', returnedLate: true });
      expect(isOverdue(returnedLate)).toBe(false);
      expect(wasReturnedLate(returnedLate)).toBe(true);
    });
  });
});
