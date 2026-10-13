jest.mock('../api-util/sdk', () => ({
  getSdk: jest.fn(),
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../api-util/laundryMailer', () => ({
  notifyBookingCancelled: jest.fn(),
}));

const { getSdk, handleError } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { notifyBookingCancelled } = require('../api-util/laundryMailer');

const customerCancelNotifyLaundry = require('./customer-cancel-notify-laundry');

// WHY THIS FILE EXISTS
//
// `transition/customer-cancel` itself is not privileged and is fired straight from the
// browser through the generic transition thunk - no new transition-dispatch plumbing. What
// this endpoint covers is the one thing the EDN cannot do: tell the assigned LAUNDRY (not a
// transaction party) that the booking is off. It must never trust the caller's say-so that a
// cancellation happened, and it must never turn a laundry-mail hiccup into a failure the
// browser could mistake for the cancellation itself failing.

const TX_ID = '6a74b530-a104-42b6-a586-b35efb5dee79';
const LISTING_ID = '11111111-1111-1111-1111-111111111111';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
const PROVIDER_ID = '44444444-4444-4444-4444-444444444444';
const STRANGER_ID = '55555555-5555-5555-5555-555555555555';
const LAUNDRY_ID = '66666666-6666-6666-6666-666666666666';

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

const listingEntity = ({
  assignedLaundryId = LAUNDRY_ID,
  alias = 'cocloset-booking/release-1',
} = {}) => ({
  id: { uuid: LISTING_ID },
  type: 'listing',
  attributes: {
    title: 'A silk frock',
    publicData: { unitType: 'day', transactionProcessAlias: alias },
    metadata: assignedLaundryId == null ? {} : { assignedLaundryId },
  },
});

const customerEntity = () => ({
  id: { uuid: CUSTOMER_ID },
  type: 'user',
  attributes: { profile: { displayName: 'Alex R.' } },
});

const laundryUserEntity = ({ email = 'studio@example.com' } = {}) => ({
  id: { uuid: LAUNDRY_ID },
  type: 'user',
  attributes: {
    email,
    profile: { publicData: { laundryProfile: { studioName: 'Studio Pigalle' } } },
  },
});

const setup = ({
  callerId = CUSTOMER_ID,
  lastTransition = 'transition/customer-cancel',
  assignedLaundryId = LAUNDRY_ID,
  alias,
  currentUserFails = false,
  laundryEmail = 'studio@example.com',
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
          attributes: { lastTransition, metadata: {} },
          relationships: {
            listing: { data: { id: { uuid: LISTING_ID }, type: 'listing' } },
            customer: { data: { id: { uuid: CUSTOMER_ID }, type: 'user' } },
            provider: { data: { id: { uuid: PROVIDER_ID }, type: 'user' } },
          },
        },
        included: [listingEntity({ assignedLaundryId, alias }), customerEntity()],
      },
    })
  );
  const usersShow = jest.fn(() =>
    Promise.resolve({ data: { data: laundryUserEntity({ email: laundryEmail }) } })
  );
  getIntegrationSdk.mockReturnValue({
    transactions: { show: txShow },
    users: { show: usersShow },
  });

  notifyBookingCancelled.mockResolvedValue({ sent: true });

  return { txShow, usersShow };
};

const run = async (body = { transactionId: TX_ID }) => {
  const res = mockRes();
  await customerCancelNotifyLaundry({ body }, res);
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

describe('customer-cancel-notify-laundry: the happy path', () => {
  it('notifies the assigned laundry with the garment, the renter and the ticket', () => {
    setup();

    return run().then(res => {
      expect(res.statusCode).toBe(200);
      expect(notifyBookingCancelled).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'studio@example.com',
          laundryName: 'Studio Pigalle',
          garmentTitle: 'A silk frock',
          customerName: 'Alex R.',
          transactionId: TX_ID,
        })
      );
    });
  });

  it('is scoped to the customer - the caller on this transaction must be the customer', () => {
    const { txShow } = setup({ callerId: CUSTOMER_ID });

    return run().then(res => {
      expect(res.statusCode).toBe(200);
      expect(txShow).toHaveBeenCalledWith(
        expect.objectContaining({ id: TX_ID, include: ['listing', 'customer', 'provider'] })
      );
    });
  });
});

describe('customer-cancel-notify-laundry: authentication and authorization', () => {
  it('refuses an anonymous caller, and never reads the transaction', () => {
    const { txShow } = setup({ currentUserFails: true });

    return run().then(res => {
      expect(res.statusCode).toBe(401);
      expect(txShow).not.toHaveBeenCalled();
      expect(notifyBookingCancelled).not.toHaveBeenCalled();
    });
  });

  it('rejects the PROVIDER on this transaction - only the customer may trigger this', () => {
    setup({ callerId: PROVIDER_ID });

    return run().then(res => {
      expect(res.statusCode).toBe(403);
      expect(notifyBookingCancelled).not.toHaveBeenCalled();
    });
  });

  it('rejects a caller who is not a party to the transaction at all', () => {
    setup({ callerId: STRANGER_ID });

    return run().then(res => {
      expect(res.statusCode).toBe(403);
      expect(notifyBookingCancelled).not.toHaveBeenCalled();
    });
  });

  it('rejects a request with no transaction id', () => {
    setup();
    return run({}).then(res => {
      expect(res.statusCode).toBe(400);
      expect(notifyBookingCancelled).not.toHaveBeenCalled();
    });
  });
});

describe('customer-cancel-notify-laundry: when it must NOT notify anyone', () => {
  it('short-circuits for a listing on another transaction process', () => {
    setup({ alias: 'default-booking/release-1' });

    return run().then(res => {
      expect(res.statusCode).toBe(200);
      expect(res.body.reason).toBe('not-a-cocloset-booking');
      expect(notifyBookingCancelled).not.toHaveBeenCalled();
    });
  });

  it('does not trust the client: a transaction that is not actually at customer-cancel is rejected', () => {
    // The body makes no claim about what happened - this is read off the STORED transaction,
    // same philosophy as auto-accept-booking.js's own checks.
    setup({ lastTransition: 'transition/accept' });

    return run().then(res => {
      expect(res.statusCode).toBe(200);
      expect(res.body.reason).toBe('not-a-customer-cancel');
      expect(notifyBookingCancelled).not.toHaveBeenCalled();
    });
  });

  it('does not error when no laundry is assigned - it just has nobody to tell', () => {
    setup({ assignedLaundryId: null });

    return run().then(res => {
      expect(res.statusCode).toBe(200);
      expect(res.body.reason).toBe('no-laundry-assigned');
      expect(notifyBookingCancelled).not.toHaveBeenCalled();
    });
  });
});

describe('customer-cancel-notify-laundry: never fails the surrounding flow', () => {
  it('still responds 200 when the laundry mail composer itself rejects', () => {
    // notifyBookingCancelled is documented never to reject, but this endpoint must not depend
    // on that: the cancellation transition has already succeeded by the time this runs.
    setup();
    notifyBookingCancelled.mockRejectedValue(new Error('mailgun exploded'));

    return run().then(res => {
      expect(res.statusCode).toBe(200);
    });
  });

  it('still responds 200 when the laundry user lookup itself fails', () => {
    setup();
    getIntegrationSdk.mockReturnValue({
      transactions: {
        show: jest.fn(() =>
          Promise.resolve({
            data: {
              data: {
                id: { uuid: TX_ID },
                attributes: { lastTransition: 'transition/customer-cancel', metadata: {} },
                relationships: {
                  listing: { data: { id: { uuid: LISTING_ID }, type: 'listing' } },
                  customer: { data: { id: { uuid: CUSTOMER_ID }, type: 'user' } },
                  provider: { data: { id: { uuid: PROVIDER_ID }, type: 'user' } },
                },
              },
              included: [listingEntity(), customerEntity()],
            },
          })
        ),
      },
      users: { show: jest.fn(() => Promise.reject(new Error('integration api down'))) },
    });

    return run().then(res => {
      expect(res.statusCode).toBe(200);
      expect(res.body.reason).toBe('error');
    });
  });
});

describe('customer-cancel-notify-laundry: the id handed to the Integration SDK', () => {
  const idShapes = [
    ['a plain string', TX_ID],
    ['an SDK UUID instance', { uuid: TX_ID, _sdkType: 'UUID' }],
    ['a plain { uuid } object', { uuid: TX_ID }],
  ];

  idShapes.forEach(([label, transactionId]) => {
    it(`is a plain string when the body carries ${label}`, () => {
      const { txShow } = setup();

      return run({ transactionId }).then(res => {
        expect(res.statusCode).toBe(200);
        expect(txShow).toHaveBeenCalledWith(expect.objectContaining({ id: TX_ID }));
      });
    });
  });

  it('rejects an id that carries no usable uuid', () => {
    setup();
    return run({ transactionId: {} }).then(res => {
      expect(res.statusCode).toBe(400);
    });
  });
});
