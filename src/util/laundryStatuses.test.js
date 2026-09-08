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
  canHandBackToOwner,
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

  // ------------------------------------------------------------------------
  // Quality inspection, removed from the workflow on 2026-09-03.
  //
  //   > "Hay que remover Quality inspection" (Jonathan)
  //
  // The TRANSITION is still in the process - taking it out of the EDN needs a
  // push, and would strand whatever is sitting in that phase at that moment. So
  // what these pin is the shape of the removal: nothing can enter the phase,
  // and anything already in it can still get out.
  // ------------------------------------------------------------------------
  describe('quality inspection is no longer part of the workflow', () => {
    it('is not a phase a garment can be moved into', () => {
      expect(CLEANING_PHASES).not.toContain('quality-inspection');
      expect(LAUNDRY_ACTION_STATUSES).not.toContain('quality-inspection');
    });

    it('is never the next action from any state', () => {
      const everyNextStatus = ['accepted', 'ready-for-pickup', 'picked-up', 'overdue', 'returned']
        .map(state => laundryActionsFor(row({ state })))
        .concat(
          CLEANING_PHASES.map(cleaningPhase =>
            laundryActionsFor(row({ state: 'cleaning', cleaningPhase }))
          )
        )
        .flat()
        .map(action => action.status);

      expect(everyNextStatus).not.toContain('quality-inspection');
    });

    it('still lets a garment already in it reach the rack', () => {
      const [action] = laundryActionsFor(
        row({ state: 'cleaning', cleaningPhase: 'quality-inspection' })
      );
      expect(action.status).toBe('available-for-booking');
    });
  });

  describe('laundryActionsFor', () => {
    it.each([
      // `accepted` is not in this table any more: it is the one state whose next action
      // depends on where the garment is, and it has its own tests below.
      ['ready-for-pickup', null, 'picked-up'],
      ['picked-up', null, 'returned'],
      ['overdue', null, 'returned'],
      ['returned', null, 'pending-cleaning'],
      ['cleaning', 'pending-cleaning', 'cleaning-in-progress'],
      ['cleaning', 'cleaning-in-progress', 'available-for-booking'],
      // Quality inspection is gone from the workflow (2026-09-03), but the
      // transition still exists and a transaction can be sitting in it right
      // now. It has to have a way out, or the garment never returns to the rack.
      ['cleaning', 'quality-inspection', 'available-for-booking'],
    ])('from state %s (phase %s) offers %s', (state, cleaningPhase, expected) => {
      const actions = laundryActionsFor(row({ state, cleaningPhase, onLaundry: true }));
      expect(actions).toHaveLength(1);
      expect(actions[0].status).toBe(expected);
      expect(actions[0].labelKey).toBe(`LaundryOpsPage.action.${expected}`);
    });

    // -------------------------------------------------------------------------
    //   > "cuando el provider va a entregar una prenda a la laundry, la laundry debe ingresar
    //   >  un ticket y luego iniciar el proceso de lavado, actualmente su acción es ingresar el
    //   >  ticket y luego se marca como ready para el renter (...) esto solo sucede si
    //   >  onLaundry es false" (Jonathan, 2026-09-08)
    //
    // Reception and "ready" were one action, so typing a ticket told the renter the garment
    // was collectable - before it had been washed.
    // -------------------------------------------------------------------------
    it('receives the garment first when it is still with its owner', () => {
      const actions = laundryActionsFor(row({ state: 'accepted', onLaundry: false }));

      expect(actions[0].status).toBe('garment-received');
      // The code is asked for on the way IN, which is when the garment is on the counter
      // about to go onto a shelf.
      expect(actions[0].needsLaundryCode).toBe(true);
    });

    it('treats a missing flag as "not here", so the wash is never skipped', () => {
      // The dangerous direction: guessing that a garment is already on the rack would mark it
      // ready without anybody having washed it.
      expect(laundryActionsFor(row({ state: 'accepted' }))[0].status).toBe('garment-received');
    });

    it('goes straight to marking a garment ready when the studio already has it', () => {
      const actions = laundryActionsFor(row({ state: 'accepted', onLaundry: true }));

      expect(actions[0].status).toBe('ready-for-pickup');
      // Nothing to receive, so nothing to name - it already carries this studio's code.
      expect(actions[0].needsLaundryCode).toBe(false);
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

    //   > "1. Confirm return, donde solo se cambia de estado y una vez hecho esto, se debe
    //   >  preguntar a la laundry los días que necesita para el lavado" (Jonathan, 2026-09-03)
    it('asks for the cleaning days when the wash starts, not when the garment arrives', () => {
      //   > "luego de ahi viene otro paso con un unico button 'Mark cleaning in progress', en
      //   >  ese paso es cuando se pregunta el número de días de lavado" (Jonathan, 2026-09-08)
      //
      // Confirming the return is one thing: the garment is back. "Process for Cleaning" is the
      // second: it joins the queue. The estimate belongs to the third, which is the studio
      // saying the work has started - a garment can sit in a queue for a day, and those are
      // not days of work.
      expect(
        laundryActionsFor(row({ state: 'cleaning', cleaningPhase: 'pending-cleaning' }))[0]
          .needsCleaningDays
      ).toBe(true);

      ['picked-up', 'overdue', 'returned'].forEach(state => {
        expect(laundryActionsFor(row({ state }))[0].needsCleaningDays).toBeFalsy();
      });
    });

    it("still asks about damage at the return, where the garment is in someone's hands", () => {
      // The two questions were separate constants for exactly this reason: the report is
      // about the garment ARRIVING, the days are about the work STARTING. Moving one must
      // not drag the other along.
      ['picked-up', 'overdue'].forEach(state => {
        expect(laundryActionsFor(row({ state }))[0].needsDamageReport).toBe(true);
      });
      expect(laundryActionsFor(row({ state: 'returned' }))[0].needsDamageReport).toBe(false);
    });

    it('asks for the ticket again when processing for cleaning', () => {
      //   > "que ingrese nuevamente el ticket, por si debe cambiarlo, el valor por default
      //   >  debe ser el ticket anterior, pero debe solicitarlo siempre"
      //
      // A garment coming back from a rental often does not go back on the shelf it left.
      expect(laundryActionsFor(row({ state: 'returned' }))[0].needsLaundryCode).toBe(true);
      // ...and still at reception, which is where it first gets one.
      expect(laundryActionsFor(row({ state: 'accepted' }))[0].needsLaundryCode).toBe(true);
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

  // ---------------------------------------------------------------------------
  //   > "si la transacción aparece como cancelada tambien puedo devolver la prenda"
  //   >   (Jonathan, 2026-09-07)
  //
  // The predicate used to be "has no status at all", so a garment was releasable only if it
  // had never been booked. Every one of the first three cases below was a studio holding a
  // garment with no way to give it back.
  // ---------------------------------------------------------------------------
  describe('canHandBackToOwner', () => {
    it('lets a cancelled rental release the garment', () => {
      expect(canHandBackToOwner(row({ onLaundry: true, state: 'canceled' }))).toBe(true);
    });

    it('lets a finished one release it too', () => {
      expect(canHandBackToOwner(row({ onLaundry: true, state: 'delivered' }))).toBe(true);
      expect(canHandBackToOwner(row({ onLaundry: true, state: 'reviewed' }))).toBe(true);
      expect(canHandBackToOwner(row({ onLaundry: true, state: 'declined' }))).toBe(true);
    });

    it('still releases a garment that was never booked', () => {
      expect(canHandBackToOwner(row({ onLaundry: true, state: null }))).toBe(true);
    });

    it('refuses while a rental is still holding it', () => {
      // The server answers 409 for each of these; the button simply must not be there. The
      // list is ACTIVE_STATES from the process module - see CUSTODY_ACTIVE_STATES.
      ['accepted', 'ready-for-pickup', 'picked-up', 'overdue', 'returned', 'cleaning'].forEach(
        state => {
          expect(canHandBackToOwner(row({ onLaundry: true, state }))).toBe(false);
        }
      );
    });

    it('refuses for a garment the studio is not holding', () => {
      expect(canHandBackToOwner(row({ onLaundry: false, state: 'canceled' }))).toBe(false);
      expect(canHandBackToOwner(row({ state: 'canceled' }))).toBe(false);
      expect(canHandBackToOwner(undefined)).toBe(false);
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
