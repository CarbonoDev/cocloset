jest.mock('../api-util/sdk', () => ({
  getSdk: jest.fn(),
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../api-util/availabilityBuffer', () => ({
  buildBufferForAcceptedTransaction: jest.fn(),
}));

const { getSdk, handleError } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { buildBufferForAcceptedTransaction } = require('../api-util/availabilityBuffer');

const autoAcceptBooking = require('./auto-accept-booking');

// WHY THIS FILE EXISTS
//
//   > "si la prenda esta onLaundry = true, no tiene caso que el provider acepte, se debe
//   >  confirmar automáticamente"
//
// This endpoint captures a payment and takes a decision away from the provider, so the
// condition that lets it fire is the whole of its safety. Every test below asserts the
// denying direction as well as the allowing one: an accept that always fires is not a
// condition, it is a bypass.

const TX_ID = '6a74b530-a104-42b6-a586-b35efb5dee79';
const LISTING_ID = '11111111-1111-1111-1111-111111111111';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
const PROVIDER_ID = '44444444-4444-4444-4444-444444444444';
const STRANGER_ID = '55555555-5555-5555-5555-555555555555';

const mockRes = () => ({
  statusCode: null,
  body: null,
  status: jest.fn(function(code) {
    this.statusCode = code;
    return this;
  }),
  set: jest.fn().mockReturnThis(),
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

const listingEntity = ({ onLaundry, alias = 'cocloset-booking/release-1' } = {}) => ({
  id: { uuid: LISTING_ID },
  type: 'listing',
  attributes: {
    title: 'A silk frock',
    publicData: { unitType: 'day', transactionProcessAlias: alias },
    // `null` means the field is absent. Not `undefined`: `setup` defaults `onLaundry` to
    // true, and passing `undefined` explicitly triggers that default - which would assert
    // the opposite of what the test says.
    metadata: onLaundry == null ? {} : { onLaundry },
  },
});

const setup = ({
  callerId = CUSTOMER_ID,
  lastTransition = 'transition/confirm-payment',
  onLaundry = true,
  alias,
  currentUserFails = false,
  transitionFails = false,
} = {}) => {
  const show = jest.fn(() =>
    currentUserFails
      ? Promise.reject(new Error('no session'))
      : Promise.resolve({ data: { data: { id: { uuid: callerId }, type: 'currentUser' } } })
  );
  getSdk.mockReturnValue({ currentUser: { show } });

  const txShow = jest.fn(() =>
    Promise.resolve({
      data: {
        data: {
          id: { uuid: TX_ID },
          type: 'transaction',
          attributes: { lastTransition },
          relationships: {
            listing: { data: { id: { uuid: LISTING_ID }, type: 'listing' } },
            customer: { data: { id: { uuid: CUSTOMER_ID }, type: 'user' } },
            provider: { data: { id: { uuid: PROVIDER_ID }, type: 'user' } },
          },
        },
        included: [listingEntity({ onLaundry, alias })],
      },
    })
  );
  const transition = jest.fn(() =>
    transitionFails
      ? Promise.reject(Object.assign(new Error('nope'), { status: 409 }))
      : Promise.resolve({ data: { data: { id: { uuid: TX_ID } } } })
  );
  getIntegrationSdk.mockReturnValue({ transactions: { show: txShow, transition } });

  buildBufferForAcceptedTransaction.mockResolvedValue({
    skipped: false,
    listingId: LISTING_ID,
    exceptionIds: ['e1'],
  });

  return { transition, txShow };
};

const run = async (body = { transactionId: TX_ID }) => {
  const res = mockRes();
  await autoAcceptBooking({ body }, res);
  await new Promise(resolve => setImmediate(resolve));
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  handleError.mockImplementation((res, e) => {
    res.status(e.status || 500).json(e.data || {});
    return res;
  });
});

describe('auto-accept-booking: when it fires', () => {
  it('accepts a paid booking whose garment is already at its laundry', () => {
    const { transition } = setup();

    return run().then(res => {
      expect(res.statusCode).toBe(200);
      expect(res.body.data.accepted).toBe(true);
      // The transition the process has always had - no EDN change was needed.
      expect(transition).toHaveBeenCalledWith(
        expect.objectContaining({ transition: 'transition/operator-accept' }),
        expect.anything()
      );
    });
  });

  it('blocks the calendar itself, because no browser hook will', () => {
    // The buffer normally rides on a hook fired after the PROVIDER accepts. Nobody accepted
    // from a sale page here, so without this an auto-accepted garment stays bookable for the
    // whole of its own rental.
    setup();

    return run().then(() => {
      expect(buildBufferForAcceptedTransaction).toHaveBeenCalled();
    });
  });

  it('lets the provider trigger it too - the decision is the listing s, not the caller s', () => {
    const { transition } = setup({ callerId: PROVIDER_ID });

    return run().then(res => {
      expect(res.statusCode).toBe(200);
      expect(transition).toHaveBeenCalled();
    });
  });
});

describe('auto-accept-booking: when it must NOT fire', () => {
  it('does nothing when the garment is not at its laundry', () => {
    // THE WHOLE CONDITION. A garment still in its owner's wardrobe needs its owner to hand it
    // over, so the provider's own accept stays the only way forward.
    const { transition } = setup({ onLaundry: false });

    return run().then(res => {
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toBeNull();
      expect(res.body.reason).toBe('garment-not-at-laundry');
      expect(transition).not.toHaveBeenCalled();
    });
  });

  it('does nothing when the flag is absent entirely', () => {
    const { transition } = setup({ onLaundry: null });

    return run().then(res => {
      expect(res.body.reason).toBe('garment-not-at-laundry');
      expect(transition).not.toHaveBeenCalled();
    });
  });

  it.each([['the string "true"', 'true'], ['1', 1], ['an object', {}]])(
    'does not treat %s as custody',
    (_label, onLaundry) => {
      // `=== true`, matching every other reader of this flag. Bad data must not be able to
      // capture a payment.
      const { transition } = setup({ onLaundry });

      return run().then(res => {
        expect(res.body.reason).toBe('garment-not-at-laundry');
        expect(transition).not.toHaveBeenCalled();
      });
    }
  );

  it('does nothing for a transaction that is not awaiting acceptance', () => {
    const { transition } = setup({ lastTransition: 'transition/request-payment' });

    return run().then(res => {
      expect(res.body.reason).toBe('not-awaiting-acceptance');
      expect(transition).not.toHaveBeenCalled();
    });
  });

  it('is idempotent: an already-accepted booking is a 200, not an error', () => {
    // The browser fires this after payment; a reload or a double submit must not produce a
    // second attempt at a transition Sharetribe would 409.
    const { transition } = setup({ lastTransition: 'transition/accept' });

    return run().then(res => {
      expect(res.statusCode).toBe(200);
      expect(res.body.reason).toBe('already-accepted');
      expect(transition).not.toHaveBeenCalled();
    });
  });

  it('does nothing for a listing on another transaction process', () => {
    const { transition } = setup({ alias: 'default-booking/release-1' });

    return run().then(res => {
      expect(res.body.reason).toBe('not-a-cocloset-booking');
      expect(transition).not.toHaveBeenCalled();
    });
  });

  it('refuses a caller who is not a party to the transaction', () => {
    const { transition } = setup({ callerId: STRANGER_ID });

    return run().then(res => {
      expect(res.statusCode).toBe(403);
      expect(transition).not.toHaveBeenCalled();
    });
  });

  it('refuses an anonymous caller, and never reads the transaction', () => {
    const { transition, txShow } = setup({ currentUserFails: true });

    return run().then(res => {
      expect(res.statusCode).toBe(401);
      expect(txShow).not.toHaveBeenCalled();
      expect(transition).not.toHaveBeenCalled();
    });
  });

  it('rejects a request with no transaction id', () => {
    setup();
    return run({}).then(res => {
      expect(res.statusCode).toBe(400);
    });
  });
});

describe('auto-accept-booking: failure handling', () => {
  it('reports a failed calendar block without failing the acceptance', () => {
    // The booking IS accepted by then. Telling the customer their payment failed would be a
    // lie, and there is nothing they could do about a missing availability exception.
    setup();
    buildBufferForAcceptedTransaction.mockRejectedValue(new Error('exception write failed'));

    return run().then(res => {
      expect(res.statusCode).toBe(200);
      expect(res.body.data.accepted).toBe(true);
      expect(res.body.data.bufferSkippedReason).toBe('buffer-failed');
    });
  });

  it('surfaces a refused transition rather than claiming success', () => {
    setup({ transitionFails: true });

    return run().then(res => {
      expect(res.statusCode).toBe(409);
    });
  });
});
