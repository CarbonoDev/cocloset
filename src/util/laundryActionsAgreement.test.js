import { states } from '../transactions/transactionProcessCoclosetBooking';
import { CLEANING_PHASES, laundryActionsFor } from './laundryStatuses';
import en from '../translations/en.json';

// eslint-disable-next-line import/no-commonjs
const { laundryActionFor } = require('../../server/api-util/laundryActions');

/**
 * WHY THIS FILE EXISTS
 *
 *   > "el handover tiene que funcionar igual que en la pestaña orders de laundry"
 *   >   (Jonathan, 2026-09-08)
 *
 * There are now two screens a studio advances a garment from - the ops worklist, which reads
 * the client table, and the scan page, which renders whatever the endpoint resolved from the
 * server one. "Igual que en orders" is only true for as long as those two agree, and the way
 * they stop agreeing is the way they stopped agreeing before: somebody moves a question one
 * step and updates one copy. That is not a cosmetic difference - a box shown at a step the
 * write does not read is an operator's answer thrown away in silence, which is exactly what
 * the cleaning days were doing on the phone.
 */

const ALL_STATES = Object.values(states);

// Every (state, phase, custody) a transaction can actually be in. The cleaning phases only
// mean anything in `cleaning`, and `onLaundry` only changes the answer at `accepted` - but
// they are crossed exhaustively here rather than by hand, so a future dependency on either is
// covered without anybody remembering to add a case.
const SITUATIONS = ALL_STATES.flatMap(state =>
  [null, ...CLEANING_PHASES, 'quality-inspection'].flatMap(cleaningPhase =>
    [true, false, undefined].map(onLaundry => ({ state, cleaningPhase, onLaundry }))
  )
);

describe('the client and server action tables agree', () => {
  it('resolve the same action in every situation', () => {
    SITUATIONS.forEach(situation => {
      const client = laundryActionsFor({ rowType: 'transaction', ...situation })[0] || null;
      const server = laundryActionFor(situation);

      const label = JSON.stringify(situation);
      // Compared as strings so a mismatch names the situation instead of printing two
      // anonymous objects.
      // `labelKey` is the client's alone - the server sends the status and the page builds
      // the key from it - so it is dropped before comparing.
      const strip = action => (action ? { ...action, labelKey: undefined } : null);

      expect(`${label} -> ${JSON.stringify(strip(client))}`).toBe(
        `${label} -> ${JSON.stringify(strip(server))}`
      );
    });
  });

  it('agree there is nothing to do once the rental is over', () => {
    ['delivered', 'canceled', 'declined', 'expired', undefined].forEach(state => {
      expect(laundryActionsFor({ rowType: 'transaction', state })).toEqual([]);
      expect(laundryActionFor({ state })).toBeNull();
    });
  });
});

describe('both screens can name every action they may be given', () => {
  it('has a label for every status either table emits', () => {
    // fakeIntl renders a missing key as the key itself, so a typo is invisible in a component
    // test. The scan page prints these labels now too, not just the ops table.
    const statuses = new Set(
      SITUATIONS.map(s => laundryActionFor(s))
        .filter(Boolean)
        .map(action => action.status)
    );

    statuses.forEach(status => {
      // Indexed rather than `toHaveProperty`, whose path syntax would read the dots in the
      // key as nesting and look for `en.LaundryOpsPage.action`.
      expect(en[`LaundryOpsPage.action.${status}`]).toBeTruthy();
    });
  });
});

describe('the questions are asked exactly once each', () => {
  const actions = SITUATIONS.map(s => laundryActionFor(s)).filter(Boolean);
  const statusesWhere = flag => [...new Set(actions.filter(a => a[flag]).map(a => a.status))];

  it('asks for the damage report where the garment is in somebody hands', () => {
    expect(statusesWhere('needsDamageReport')).toEqual(['returned']);
  });

  it('asks for the wash days where the wash starts', () => {
    //   > "en ese paso es cuando se pregunta el número de días de lavado"
    //   >   (Jonathan, 2026-09-08)
    //
    // NOT at `returned`, and not at `pending-cleaning`. This is the assertion that would have
    // caught the phone asking at a step the endpoint reads nothing at.
    expect(statusesWhere('needsCleaningDays')).toEqual(['cleaning-in-progress']);
  });

  it('asks for the studio code on the way in, and again before the wash', () => {
    // A coat coming back from a rental rarely goes onto the shelf it left.
    expect(statusesWhere('needsLaundryCode').sort()).toEqual(
      ['garment-received', 'pending-cleaning'].sort()
    );
  });

  it('warns about the payout at the one step that fires it', () => {
    expect(statusesWhere('firesPayout')).toEqual(['pending-cleaning']);
  });
});
