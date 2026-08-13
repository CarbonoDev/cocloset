import { states } from '../transactions/transactionProcessCoclosetBooking';
import {
  HANDOVER_COUNTERPARTY_CUSTOMER,
  HANDOVER_COUNTERPARTY_PROVIDER,
  handoverStepFor,
  isViewerTheCounterparty,
} from './handoverSteps';
import en from '../translations/en.json';

// eslint-disable-next-line import/no-commonjs
const { handoverStepFor: serverHandoverStepFor } = require('../../server/api-util/handoverSteps');
// eslint-disable-next-line import/no-commonjs
const { LAUNDRY_STATUSES } = require('../../server/api-util/coclosetBookingProcess');

/**
 * WHY THIS FILE EXISTS
 *
 * The scan page NAMES the next step (client) and the confirm endpoint FIRES it (server), and
 * the two resolve it from separate copies of the same table. A disagreement means a page that
 * says "confirm collection" and a button that files a return — at a counter, with a customer
 * standing there.
 *
 * It also checks the two things a step table can be internally consistent about and still
 * wrong: that every `status` it emits is one the confirm endpoint actually accepts, and that
 * every message key the page will ask for exists.
 */

const ALL_STATES = Object.values(states);

describe('the client and server handover step tables agree', () => {
  it('resolve the same step for every state in the process', () => {
    ALL_STATES.forEach(state => {
      const client = handoverStepFor(state);
      const server = serverHandoverStepFor(state);

      expect(`${state} -> ${JSON.stringify(client)}`).toBe(`${state} -> ${JSON.stringify(server)}`);
    });
  });

  it('agree there is no step for an unknown or missing state', () => {
    [undefined, null, '', 'not-a-state'].forEach(state => {
      expect(handoverStepFor(state)).toBeNull();
      expect(serverHandoverStepFor(state)).toBeNull();
    });
  });
});

describe('the step table names counter events only', () => {
  it('covers exactly the four states where somebody is at the counter', () => {
    // Restated as a set so widening it (to a cleaning sub-phase, say) is a deliberate edit.
    // The cleaning phases are studio-internal: offering a "confirm" there would advance an
    // internal step with nobody handing anything over.
    const withStep = ALL_STATES.filter(state => !!handoverStepFor(state));

    expect(withStep.sort()).toEqual(
      ['accepted', 'overdue', 'picked-up', 'ready-for-pickup'].sort()
    );
  });

  it('sends the garment IN from the owner, OUT to the renter, and IN again', () => {
    expect(handoverStepFor(states.ACCEPTED).counterparty).toBe(HANDOVER_COUNTERPARTY_PROVIDER);
    expect(handoverStepFor(states.READY_FOR_PICKUP).counterparty).toBe(
      HANDOVER_COUNTERPARTY_CUSTOMER
    );
    expect(handoverStepFor(states.PICKED_UP).counterparty).toBe(HANDOVER_COUNTERPARTY_CUSTOMER);
    expect(handoverStepFor(states.OVERDUE).counterparty).toBe(HANDOVER_COUNTERPARTY_CUSTOMER);
  });

  it('treats a late return as the same event, flagged', () => {
    // The process splits it in two only because the EDN's `:from` is single-valued. If these
    // ever produced different `status` values the late path would file the wrong transition.
    expect(handoverStepFor(states.OVERDUE).status).toBe(handoverStepFor(states.PICKED_UP).status);
    expect(handoverStepFor(states.OVERDUE).isLate).toBe(true);
    expect(!!handoverStepFor(states.PICKED_UP).isLate).toBe(false);
  });
});

describe('every step drives a status the confirm endpoint accepts', () => {
  it('emits only known laundry statuses', () => {
    // The page posts `step.status` to POST /api/laundry-transaction-status. A status this
    // table invented would 400 at the counter, after the operator had already handed the
    // garment over.
    ALL_STATES.map(handoverStepFor)
      .filter(Boolean)
      .forEach(step => {
        expect(LAUNDRY_STATUSES).toContain(step.status);
      });
  });
});

describe('every message the page will ask for exists', () => {
  // fakeIntl renders a missing key as the key itself, so a typo here is invisible in a
  // component test - it renders "HandoverPage.step.accepted.confirm" and the assertion for a
  // button passes. Checking the catalogue directly is the only place that catches it.
  const SUFFIXES = ['title', 'laundry', 'confirm', 'yourTurn', 'waiting'];

  it.each(ALL_STATES.filter(state => !!handoverStepFor(state)))(
    'has every message for the %s step',
    state => {
      SUFFIXES.forEach(suffix => {
        expect(en[`HandoverPage.step.${state}.${suffix}`]).toBeDefined();
      });
    }
  );
});

describe('the page can name every status and every role it may be handed', () => {
  //   > "si soy un actor, debo poder ver la información completa del status actual"
  //
  // The page renders `HandoverPage.status.<processState>` for whatever state the endpoint
  // reports, and `HandoverPage.role.<viewerRole>` for whichever of the three roles the
  // reader is. A state with no message renders the raw key at the customer - and fakeIntl
  // makes that invisible in a component test, since it renders the key either way.
  it.each(ALL_STATES)('has a status message for %s', state => {
    expect(en[`HandoverPage.status.${state}`]).toBeDefined();
  });

  it.each([['customer'], ['provider'], ['laundry']])('has a role message for %s', role => {
    expect(en[`HandoverPage.role.${role}`]).toBeDefined();
  });
});

describe('isViewerTheCounterparty', () => {
  it('is true only for the party the studio is actually dealing with', () => {
    const collection = handoverStepFor(states.READY_FOR_PICKUP);

    expect(isViewerTheCounterparty(collection, 'customer')).toBe(true);
    expect(isViewerTheCounterparty(collection, 'provider')).toBe(false);
    // The laundry is never the counterparty - it is the counter.
    expect(isViewerTheCounterparty(collection, 'laundry')).toBe(false);
  });

  it('is false rather than throwing without a step or a role', () => {
    expect(isViewerTheCounterparty(null, 'customer')).toBe(false);
    expect(isViewerTheCounterparty(handoverStepFor(states.ACCEPTED), null)).toBe(false);
  });
});
