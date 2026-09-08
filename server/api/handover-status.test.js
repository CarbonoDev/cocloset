jest.mock('../api-util/sdk', () => ({
  getSdk: jest.fn(),
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

const { getSdk, handleError } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const handoverStatus = require('./handover-status');
const { limiter } = handoverStatus;

// WHY THIS FILE EXISTS
//
//   > "El qr solo debe poder leerse si eres laundry, si otro actor lo lee solo debe mostrarle
//   >  indicaciones"
//
// A handover QR is an IDENTIFIER, not a credential (see api-util/handoverQr.js): anyone who
// scans one, or who guesses a transaction id, arrives here. So the only thing standing
// between a stranger and someone else's rental is the role check below, and the only thing
// standing between a curious customer and the ability to advance the custody chain is
// `canConfirm`. Both are asserted in the denying direction as well as the allowing one - a
// check that only ever says yes is indistinguishable from no check.

const TX_ID = '6a74b530-a104-42b6-a586-b35efb5dee79';
const LISTING_ID = '11111111-1111-1111-1111-111111111111';
const LAUNDRY_ID = '22222222-2222-2222-2222-222222222222';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
const PROVIDER_ID = '44444444-4444-4444-4444-444444444444';
const STRANGER_ID = '55555555-5555-5555-5555-555555555555';

const mockRes = () => ({
  statusCode: null,
  body: null,
  headers: {},
  status: jest.fn(function(code) {
    this.statusCode = code;
    return this;
  }),
  set: jest.fn(function(key, value) {
    if (typeof key === 'string') {
      this.headers[key] = value;
    }
    return this;
  }),
  send: jest.fn(function(body) {
    this.body = body;
    return this;
  }),
  json: jest.fn(function(body) {
    this.body = body;
    return this;
  }),
  end: jest.fn().mockReturnThis(),
});

const currentUserEntity = (id, isLaundry = false, privateData = {}) => ({
  id: { uuid: id },
  type: 'currentUser',
  attributes: {
    profile: {
      metadata: isLaundry ? { isLaundry: true } : {},
      // The studio's own turnaround table. Readable through the ordinary Marketplace API
      // because it belongs to the caller, which is why pre-filling the box costs no extra
      // round trip.
      privateData,
    },
  },
});

const transactionEntity = lastTransition => ({
  id: { uuid: TX_ID },
  type: 'transaction',
  attributes: { lastTransition, metadata: { ticketCode: 'PIG-A3F91C' } },
  relationships: {
    listing: { data: { id: { uuid: LISTING_ID }, type: 'listing' } },
    customer: { data: { id: { uuid: CUSTOMER_ID }, type: 'user' } },
    provider: { data: { id: { uuid: PROVIDER_ID }, type: 'user' } },
  },
});

const listingEntity = (assignedLaundryId = LAUNDRY_ID, onLaundry = false) => ({
  id: { uuid: LISTING_ID },
  type: 'listing',
  attributes: {
    title: 'A silk frock',
    publicData: { categoryLevel1: 'dresses' },
    metadata: {
      ...(assignedLaundryId ? { assignedLaundryId } : {}),
      ...(onLaundry ? { onLaundry: true } : {}),
    },
  },
});

const setup = ({
  callerId = LAUNDRY_ID,
  isLaundry = true,
  lastTransition = 'transition/laundry-mark-ready',
  assignedLaundryId = LAUNDRY_ID,
  currentUserFails = false,
  laundryPrivateData = { turnaroundDays: 4 },
  onLaundry = false,
} = {}) => {
  const show = jest.fn(() =>
    currentUserFails
      ? Promise.reject(new Error('no session'))
      : Promise.resolve({
          data: { data: currentUserEntity(callerId, isLaundry, laundryPrivateData) },
        })
  );
  getSdk.mockReturnValue({ currentUser: { show } });

  const txShow = jest.fn(() =>
    Promise.resolve({
      data: {
        data: transactionEntity(lastTransition),
        included: [listingEntity(assignedLaundryId, onLaundry)],
      },
    })
  );
  getIntegrationSdk.mockReturnValue({ transactions: { show: txShow } });

  return { txShow };
};

const run = async (query = { transactionId: TX_ID }) => {
  const res = mockRes();
  await handoverStatus({ query, ip: '10.0.0.1' }, res);
  await new Promise(resolve => setImmediate(resolve));
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  limiter.reset?.();
  handleError.mockImplementation((res, e) => {
    res.status(e.status || 500).json(e.data || {});
    return res;
  });
});

describe('handover-status: who may read it', () => {
  it('answers the assigned laundry, and lets it confirm', () => {
    setup({ callerId: LAUNDRY_ID, isLaundry: true });

    return run().then(res => {
      expect(res.statusCode).toBe(200);
      expect(res.body.data.viewerRole).toBe('laundry');
      expect(res.body.data.canConfirm).toBe(true);
      expect(res.body.data.step.status).toBe('picked-up');
      expect(res.body.data.step.counterparty).toBe('customer');
    });
  });

  it('answers the customer, but never lets them confirm', () => {
    // The whole of the client's instruction: another actor gets instructions, not an action.
    setup({ callerId: CUSTOMER_ID, isLaundry: false });

    return run().then(res => {
      expect(res.statusCode).toBe(200);
      expect(res.body.data.viewerRole).toBe('customer');
      expect(res.body.data.canConfirm).toBe(false);
      // They still learn what is due - that is what the instructions are built from.
      expect(res.body.data.step.status).toBe('picked-up');
    });
  });

  it('answers the provider, but never lets them confirm', () => {
    setup({ callerId: PROVIDER_ID, isLaundry: false });

    return run().then(res => {
      expect(res.statusCode).toBe(200);
      expect(res.body.data.viewerRole).toBe('provider');
      expect(res.body.data.canConfirm).toBe(false);
    });
  });

  it('refuses a user who has nothing to do with the rental', () => {
    setup({ callerId: STRANGER_ID, isLaundry: false });

    return run().then(res => {
      expect(res.statusCode).toBe(403);
    });
  });

  it('refuses a laundry that is not the one assigned to this garment', () => {
    // A laundry flag is not authority over every garment in the marketplace.
    setup({ callerId: LAUNDRY_ID, isLaundry: true, assignedLaundryId: STRANGER_ID });

    return run().then(res => {
      expect(res.statusCode).toBe(403);
    });
  });

  it('refuses a user who claims to be a laundry but is not flagged', () => {
    // `metadata.isLaundry` is Integration-API-only, so it cannot be self-granted - but the
    // check has to actually be made.
    setup({ callerId: LAUNDRY_ID, isLaundry: false });

    return run().then(res => {
      expect(res.statusCode).toBe(403);
    });
  });

  it('refuses an anonymous caller', () => {
    setup({ currentUserFails: true });

    return run().then(res => {
      expect(res.statusCode).toBe(401);
    });
  });

  it('never reads the transaction for an anonymous caller', () => {
    // The identity check comes FIRST. Fetching the transaction and then refusing would put
    // an admin-credentialled read behind an unauthenticated request.
    const { txShow } = setup({ currentUserFails: true });

    return run().then(() => {
      expect(txShow).not.toHaveBeenCalled();
    });
  });
});

describe('handover-status: what it says is next', () => {
  it.each([
    ['transition/laundry-mark-ready', 'ready-for-pickup', 'picked-up', 'customer'],
    ['transition/laundry-confirm-pickup', 'picked-up', 'returned', 'customer'],
    ['transition/mark-overdue', 'overdue', 'returned', 'customer'],
  ])('after %s, the next step is %s -> %s with the %s', (lastTransition, state, status, party) => {
    setup({ lastTransition });

    return run().then(res => {
      expect(res.body.data.processState).toBe(state);
      expect(res.body.data.step.status).toBe(status);
      expect(res.body.data.step.counterparty).toBe(party);
    });
  });

  // ---------------------------------------------------------------------------
  //   > "cuando el provider va a entregar una prenda a la laundry, la laundry debe ingresar
  //   >  un ticket y luego iniciar el proceso de lavado (...) esto solo sucede si onLaundry es
  //   >  false. Si onLaundry es true, el siguiente paso es del renter" (Jonathan, 2026-09-08)
  //
  // `accepted` is the one state that is two different counters. The pair below is the whole
  // fix: same state, same transition, different next step - and the thing that decides is
  // where the garment physically is, which the state machine has never known.
  // ---------------------------------------------------------------------------
  it('sends a garment still with its owner to the drop-off step', () => {
    setup({ lastTransition: 'transition/accept', onLaundry: false });

    return run().then(res => {
      expect(res.body.data.processState).toBe('accepted');
      expect(res.body.data.step.status).toBe('garment-received');
      expect(res.body.data.step.counterparty).toBe('provider');
      // The code is asked for HERE now, on the way in, rather than at "mark ready".
      expect(res.body.data.takesLaundryCode).toBe(true);
    });
  });

  it('sends a garment already on the rack straight to marking it ready', () => {
    setup({ lastTransition: 'transition/accept', onLaundry: true });

    return run().then(res => {
      expect(res.body.data.processState).toBe('accepted');
      expect(res.body.data.step.status).toBe('ready-for-pickup');
      // Nothing to receive, so nothing to name: this garment already carries this studio's
      // code from the visit that put it on the shelf.
      expect(res.body.data.takesLaundryCode).toBe(false);
    });
  });

  it('flags a late return so the counter can say so', () => {
    setup({ lastTransition: 'transition/mark-overdue' });

    return run().then(res => {
      expect(res.body.data.step.isLate).toBe(true);
    });
  });

  it('offers no step, and no confirm, once the garment is back', () => {
    // `returned` and everything after it is studio-internal work. A confirm button here would
    // advance a cleaning phase because somebody scanned an old code.
    setup({ lastTransition: 'transition/laundry-confirm-return' });

    return run().then(res => {
      expect(res.statusCode).toBe(200);
      expect(res.body.data.step).toBeNull();
      expect(res.body.data.canConfirm).toBe(false);
    });
  });
});

describe('handover-status: the cleaning-days default', () => {
  //   > "estos días deben tener un default de los días que indique la laundry, pero pueden
  //   >  modificarse al recibir"

  it('tells the laundry its own turnaround at the return step', () => {
    setup({ lastTransition: 'transition/laundry-confirm-pickup' }); // -> picked-up, next: returned

    return run().then(res => {
      expect(res.body.data.step.status).toBe('returned');
      expect(res.body.data.defaultCleaningDays).toBe(4);
    });
  });

  it('omits it at every other step', () => {
    // Nothing else consumes the number, and a field that is sometimes meaningless is a field
    // the client has to guess about.
    setup({ lastTransition: 'transition/laundry-mark-ready' }); // -> ready-for-pickup

    return run().then(res => {
      expect(res.body.data).not.toHaveProperty('defaultCleaningDays');
    });
  });

  it('never tells the CUSTOMER a studio turnaround', () => {
    // A studio's configuration is not a renter's business, and the renter cannot act on it.
    setup({
      callerId: CUSTOMER_ID,
      isLaundry: false,
      lastTransition: 'transition/laundry-confirm-pickup',
    });

    return run().then(res => {
      expect(res.body.data.viewerRole).toBe('customer');
      expect(res.body.data).not.toHaveProperty('defaultCleaningDays');
    });
  });

  it('falls back to a usable number when the studio has configured nothing', () => {
    // The chain bottoms out in a hardcoded default: a studio that has set nothing still needs
    // time to clean, and an empty box would be worse than a defensible guess.
    setup({ lastTransition: 'transition/laundry-confirm-pickup', laundryPrivateData: {} });

    return run().then(res => {
      expect(Number.isInteger(res.body.data.defaultCleaningDays)).toBe(true);
      expect(res.body.data.defaultCleaningDays).toBeGreaterThan(0);
    });
  });
});

describe('handover-status: the damage report flag', () => {
  it('asks for one at the return, where the garment is actually inspected', () => {
    setup({ lastTransition: 'transition/laundry-confirm-pickup' });

    return run().then(res => {
      expect(res.body.data.step.status).toBe('returned');
      expect(res.body.data.takesDamageReport).toBe(true);
    });
  });

  it('does not at any other step', () => {
    // Offering it at a collection would invite a report on a garment nobody has inspected.
    setup({ lastTransition: 'transition/laundry-mark-ready' });

    return run().then(res => {
      expect(res.body.data.takesDamageReport).toBe(false);
    });
  });

  it('never asks the customer for one', () => {
    setup({
      callerId: CUSTOMER_ID,
      isLaundry: false,
      lastTransition: 'transition/laundry-confirm-pickup',
    });

    return run().then(res => {
      expect(res.body.data.takesDamageReport).toBe(false);
    });
  });
});

describe('handover-status: what it discloses', () => {
  it('returns the garment and the step, and nothing about the money', () => {
    setup();

    return run().then(res => {
      const keys = Object.keys(res.body.data).sort();
      expect(keys).toEqual(
        [
          'bookingEnd',
          'bookingStart',
          'canConfirm',
          'listingTitle',
          'processState',
          'step',
          'takesDamageReport',
          'ticketCode',
          'transactionId',
          'viewerRole',
          // The studio's own code for the garment, and whether THIS step is the one that asks
          // for it. Both are about where a garment sits on a shelf; neither says anything
          // about the money, which is what this assertion is really guarding.
          'laundryCode',
          'takesLaundryCode',
          // Which garment this is about, and whether the studio may release it. The id was
          // already knowable from the listing title and the ticket; what is new is the
          // permission, and it is a permission to move a garment rather than money.
          'listingId',
          'canHandBack',
        ].sort()
      );
    });
  });

  it('rejects a malformed transaction id before doing anything', () => {
    const { txShow } = setup();

    return run({ transactionId: 'not-a-uuid' }).then(res => {
      expect(res.statusCode).toBe(400);
      expect(txShow).not.toHaveBeenCalled();
    });
  });

  it('rejects a missing transaction id', () => {
    setup();

    return run({}).then(res => {
      expect(res.statusCode).toBe(400);
    });
  });
});

// ---------------------------------------------------------------------------
//   > "el botón para devolver la prenda en el lado de laundry debe aparecer en order,
//   >  handover o inventory"
//   > "si la transacción aparece como cancelada tambien puedo devolver la prenda"
//   >   (Jonathan, 2026-09-07)
//
// `canHandBack` is decided here for the same reason `canConfirm` is: the page renders a
// button off it and does not re-derive the rule in a browser. So the same discipline applies -
// assert the denying direction as hard as the allowing one.
// ---------------------------------------------------------------------------
describe('handover-status: may the studio release the garment', () => {
  it('says yes to the assigned studio when the rental was cancelled', () => {
    setup({ lastTransition: 'transition/cancel', onLaundry: true });

    return run().then(res => {
      expect(res.body.data.canHandBack).toBe(true);
      expect(res.body.data.listingId).toBe(LISTING_ID);
    });
  });

  it('says yes once the rental has finished', () => {
    setup({ lastTransition: 'transition/laundry-mark-available', onLaundry: true });

    return run().then(res => {
      expect(res.body.data.canHandBack).toBe(true);
    });
  });

  it('says no while the rental is still running', () => {
    // The custody endpoint answers 409 for exactly these, which is what enforces "una vez que
    // finalice la limpieza". Offering a button that is going to be refused is its own kind of
    // wrong.
    setup({ lastTransition: 'transition/laundry-start-cleaning', onLaundry: true });

    return run().then(res => {
      expect(res.body.data.canHandBack).toBe(false);
    });
  });

  it('says no when the garment is not on the studio shelf', () => {
    setup({ lastTransition: 'transition/cancel', onLaundry: false });

    return run().then(res => {
      expect(res.body.data.canHandBack).toBe(false);
    });
  });

  it('never says yes to the customer or the owner', () => {
    // Custody is the studio's to record - the owner was deliberately taken off this write.
    // See server/api/listing-custody-status.js.
    setup({
      callerId: CUSTOMER_ID,
      isLaundry: false,
      lastTransition: 'transition/cancel',
      onLaundry: true,
    });

    return run().then(res => {
      expect(res.body.data.canHandBack).toBe(false);
    });
  });
});
