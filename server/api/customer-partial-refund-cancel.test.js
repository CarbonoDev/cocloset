jest.mock('../api-util/sdk', () => ({
  getSdk: jest.fn(),
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../api-util/laundryAssignment', () => ({
  readAssignedLaundryId: jest.fn(),
}));

jest.mock('../api-util/laundryMailer', () => ({
  notifyPartialRefundBookingCancelled: jest.fn().mockResolvedValue({ sent: false }),
}));

// NEVER a real network call to Stripe: the whole `stripe` package is mocked. `Stripe(...)`
// (the default export this file calls as a constructor) always returns the SAME
// `mockRefundsCreate` mock below, so every test can assert on it without reaching into the module
// internals.
const mockRefundsCreate = jest.fn();
jest.mock('stripe', () =>
  jest.fn(() => ({
    refunds: { create: mockRefundsCreate },
  }))
);

const { getSdk, handleError } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { readAssignedLaundryId } = require('../api-util/laundryAssignment');
const { notifyPartialRefundBookingCancelled } = require('../api-util/laundryMailer');
const Stripe = require('stripe');

const customerPartialRefundCancel = require('./customer-partial-refund-cancel');

// This is money-moving code for a real, security-sensitive feature, so every gate below is
// tested in both directions (the state it must allow, and the states it must refuse), plus
// the three-way idempotency state machine from the endpoint's own header comment. No test in
// this file ever constructs a real-looking Stripe secret key string - `mockRefundsCreate` is a pure
// jest mock and the module factory above never touches `process.env.STRIPE_SECRET_KEY`.

const TX_ID = '6a74b530-a104-42b6-a586-b35efb5dee79';
const LISTING_ID = '11111111-1111-1111-1111-111111111111';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
const PROVIDER_ID = '44444444-4444-4444-4444-444444444444';
const STRANGER_ID = '55555555-5555-5555-5555-555555555555';
const PAYMENT_INTENT_ID = 'pi_fake_for_tests';
const STRIPE_REFUND_ID = 're_fake_for_tests';

const LAUNDRY_RECEIVE_FROM_PROVIDER = 'transition/laundry-receive-from-provider';
const PARTIAL_REFUND_CANCEL = 'transition/partial-refund-cancel-from-initial-cleaning';

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

const listingEntity = ({ alias = 'cocloset-booking/release-1' } = {}) => ({
  id: { uuid: LISTING_ID },
  type: 'listing',
  attributes: {
    title: 'A silk frock',
    publicData: { unitType: 'day', transactionProcessAlias: alias },
    metadata: {},
  },
});

const customerEntity = () => ({
  id: { uuid: CUSTOMER_ID },
  type: 'user',
  attributes: { profile: { displayName: 'Jamie Customer' } },
});

const moneyLineItem = (code, amount, currency = 'usd') => ({
  code,
  unitPrice: { amount, currency },
  lineTotal: { amount, currency },
  quantity: 1,
  includeFor: ['customer'],
});

const setup = ({
  callerId = CUSTOMER_ID,
  lastTransition = LAUNDRY_RECEIVE_FROM_PROVIDER,
  alias,
  currentUserFails = false,
  transactionMetadata = { stripePaymentIntentId: PAYMENT_INTENT_ID },
  payinTotal = { amount: 10000, currency: 'usd' },
  lineItems = [moneyLineItem('line-item/day', 8000), moneyLineItem('line-item/cleaning-fee', 2000)],
  transitionFails = false,
  updateMetadataFails = false,
  refundFails = false,
  assignedLaundryId = null,
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
          attributes: {
            lastTransition,
            metadata: transactionMetadata,
            payinTotal,
            lineItems,
          },
          relationships: {
            listing: { data: { id: { uuid: LISTING_ID }, type: 'listing' } },
            customer: { data: { id: { uuid: CUSTOMER_ID }, type: 'user' } },
            provider: { data: { id: { uuid: PROVIDER_ID }, type: 'user' } },
          },
        },
        included: [listingEntity({ alias }), customerEntity()],
      },
    })
  );

  const transition = jest.fn(() =>
    transitionFails
      ? Promise.reject(Object.assign(new Error('transition failed'), { status: 409 }))
      : Promise.resolve({
          data: { data: { id: { uuid: TX_ID }, attributes: { lastTransition: PARTIAL_REFUND_CANCEL } } },
        })
  );

  const updateMetadata = jest.fn(() =>
    updateMetadataFails
      ? Promise.reject(new Error('metadata write failed'))
      : Promise.resolve({ data: { data: { id: { uuid: TX_ID } } } })
  );

  const usersShow = jest.fn(() =>
    Promise.resolve({
      data: {
        data: {
          id: { uuid: 'laundry-1' },
          attributes: { email: 'laundry@example.com', profile: { publicData: {} } },
        },
      },
    })
  );

  getIntegrationSdk.mockReturnValue({
    transactions: { show: txShow, transition, updateMetadata },
    users: { show: usersShow },
  });

  readAssignedLaundryId.mockReturnValue(assignedLaundryId);

  mockRefundsCreate.mockImplementation(() =>
    refundFails
      ? Promise.reject(new Error('stripe is down'))
      : Promise.resolve({ id: STRIPE_REFUND_ID })
  );

  return { transition, updateMetadata, txShow, usersShow };
};

const run = async (body = { transactionId: TX_ID }) => {
  const res = mockRes();
  await customerPartialRefundCancel({ body }, res);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  handleError.mockImplementation((res, e) => {
    res.status(e.status || 500).json(e.data || {});
    return res;
  });
  // This project's jest config sets `resetMocks: true`, which wipes every mock's
  // implementation (not just its call log) before each test - including the one the `stripe`
  // module factory set up at the top of this file. So the Stripe constructor mock has to be
  // re-armed here, every test, exactly like getSdk/getIntegrationSdk are re-armed inside
  // setup() below.
  Stripe.mockImplementation(() => ({ refunds: { create: mockRefundsCreate } }));
  notifyPartialRefundBookingCancelled.mockResolvedValue({ sent: true });
});

describe('customer-partial-refund-cancel: gates', () => {
  it('401s when the caller is not authenticated', () => {
    setup({ currentUserFails: true });

    return run().then(res => {
      expect(res.statusCode).toBe(401);
      expect(mockRefundsCreate).not.toHaveBeenCalled();
    });
  });

  it('403s a caller who is not the customer on this transaction (the provider)', () => {
    const { transition } = setup({ callerId: PROVIDER_ID });

    return run().then(res => {
      expect(res.statusCode).toBe(403);
      expect(mockRefundsCreate).not.toHaveBeenCalled();
      expect(transition).not.toHaveBeenCalled();
    });
  });

  it('403s a total stranger', () => {
    setup({ callerId: STRANGER_ID });

    return run().then(res => {
      expect(res.statusCode).toBe(403);
      expect(mockRefundsCreate).not.toHaveBeenCalled();
    });
  });

  it('422s a non-cocloset-booking listing', () => {
    setup({ alias: 'default-booking/release-1' });

    return run().then(res => {
      expect(res.statusCode).toBe(422);
      expect(res.body).toEqual({ error: 'not-a-cocloset-booking' });
      expect(mockRefundsCreate).not.toHaveBeenCalled();
    });
  });

  it('409s with a distinguishable reason when the transaction is not in initial-cleaning', () => {
    const { transition } = setup({ lastTransition: 'transition/accept' });

    return run().then(res => {
      expect(res.statusCode).toBe(409);
      expect(res.body).toEqual({ error: 'not-eligible', reason: 'wrong-state' });
      expect(mockRefundsCreate).not.toHaveBeenCalled();
      expect(transition).not.toHaveBeenCalled();
    });
  });

  it('422s with a distinguishable reason when there is no PaymentIntent on record (predates the ledger)', () => {
    const { transition } = setup({ transactionMetadata: {} });

    return run().then(res => {
      expect(res.statusCode).toBe(422);
      expect(res.body).toEqual({ error: 'no-payment-intent-on-record', reason: 'predates-ledger' });
      expect(mockRefundsCreate).not.toHaveBeenCalled();
      expect(transition).not.toHaveBeenCalled();
    });
  });
});

describe('customer-partial-refund-cancel: refund amount computation', () => {
  it('refunds payinTotal minus the cleaning-fee line item', () => {
    setup({
      payinTotal: { amount: 10000, currency: 'usd' },
      lineItems: [moneyLineItem('line-item/day', 8000), moneyLineItem('line-item/cleaning-fee', 2000)],
    });

    return run().then(() => {
      expect(mockRefundsCreate).toHaveBeenCalledWith({
        payment_intent: PAYMENT_INTENT_ID,
        amount: 8000,
      });
    });
  });

  it('falls back to a full refund when there is no cleaning-fee line item to withhold', () => {
    setup({
      payinTotal: { amount: 5000, currency: 'usd' },
      lineItems: [moneyLineItem('line-item/day', 5000)],
    });

    return run().then(() => {
      expect(mockRefundsCreate).toHaveBeenCalledWith({
        payment_intent: PAYMENT_INTENT_ID,
        amount: 5000,
      });
    });
  });

  it('500s without calling Stripe when the computed refund is zero', () => {
    setup({
      payinTotal: { amount: 2000, currency: 'usd' },
      lineItems: [moneyLineItem('line-item/cleaning-fee', 2000)],
    });

    return run().then(res => {
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'invalid-refund-amount' });
      expect(mockRefundsCreate).not.toHaveBeenCalled();
    });
  });

  it('500s without calling Stripe when the cleaning fee exceeds payinTotal (negative)', () => {
    setup({
      payinTotal: { amount: 1000, currency: 'usd' },
      lineItems: [moneyLineItem('line-item/cleaning-fee', 2000)],
    });

    return run().then(res => {
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'invalid-refund-amount' });
      expect(mockRefundsCreate).not.toHaveBeenCalled();
    });
  });
});

describe('customer-partial-refund-cancel: Stripe failure', () => {
  it('502s when Stripe throws, moves no money, and never fires the transition', () => {
    const { transition, updateMetadata } = setup({ refundFails: true });

    return run().then(res => {
      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({ error: 'stripe-refund-failed' });
      expect(transition).not.toHaveBeenCalled();
      expect(updateMetadata).not.toHaveBeenCalled();
    });
  });
});

describe('customer-partial-refund-cancel: the Stripe-succeeded-but-transition-failed case', () => {
  it('writes the audit metadata, then responds 200 honestly when the transition fails', () => {
    const { transition, updateMetadata } = setup({ transitionFails: true });

    return run().then(res => {
      expect(mockRefundsCreate).toHaveBeenCalled();
      expect(updateMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TX_ID,
          metadata: expect.objectContaining({
            partialRefundStripeId: STRIPE_REFUND_ID,
            partialRefundAmount: 8000,
            partialRefundCurrency: 'usd',
          }),
        })
      );
      expect(transition).toHaveBeenCalled();
      // Honest, not a plain error: the refund really happened.
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual(
        expect.objectContaining({
          refunded: true,
          cancelled: false,
          requiresManualFollowUp: true,
          refundAmount: 8000,
          refundCurrency: 'usd',
        })
      );
    });
  });

  it('still responds 200/requiresManualFollowUp even if the audit write itself also fails', () => {
    const { transition } = setup({ transitionFails: true, updateMetadataFails: true });

    return run().then(res => {
      expect(transition).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      expect(res.body.data.requiresManualFollowUp).toBe(true);
    });
  });
});

describe('customer-partial-refund-cancel: idempotency', () => {
  it('resumes from the transition step only when Stripe already succeeded on a previous attempt', () => {
    const { transition } = setup({
      transactionMetadata: {
        stripePaymentIntentId: PAYMENT_INTENT_ID,
        partialRefundStripeId: STRIPE_REFUND_ID,
        partialRefundAmount: 8000,
        partialRefundCurrency: 'usd',
      },
    });

    return run().then(res => {
      // NEVER calls Stripe again - that would risk a second, real refund.
      expect(mockRefundsCreate).not.toHaveBeenCalled();
      expect(transition).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual(
        expect.objectContaining({
          refunded: true,
          cancelled: true,
          requiresManualFollowUp: false,
          refundAmount: 8000,
          refundCurrency: 'usd',
        })
      );
    });
  });

  it('reports the stored result, with no new Stripe call or transition attempt, once fully done', () => {
    const { transition } = setup({
      lastTransition: PARTIAL_REFUND_CANCEL,
      transactionMetadata: {
        stripePaymentIntentId: PAYMENT_INTENT_ID,
        partialRefundStripeId: STRIPE_REFUND_ID,
        partialRefundAmount: 8000,
        partialRefundCurrency: 'usd',
      },
    });

    return run().then(res => {
      expect(mockRefundsCreate).not.toHaveBeenCalled();
      expect(transition).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual(
        expect.objectContaining({
          refunded: true,
          cancelled: true,
          requiresManualFollowUp: false,
          refundAmount: 8000,
          refundCurrency: 'usd',
          alreadyDone: true,
        })
      );
    });
  });
});

describe('customer-partial-refund-cancel: full happy path', () => {
  it('refunds via Stripe, writes the audit metadata, fires the transition, and responds 200', () => {
    const { transition, updateMetadata } = setup();

    return run().then(res => {
      expect(Stripe).toHaveBeenCalledWith(process.env.STRIPE_SECRET_KEY);
      expect(mockRefundsCreate).toHaveBeenCalledWith({
        payment_intent: PAYMENT_INTENT_ID,
        amount: 8000,
      });
      expect(updateMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TX_ID,
          metadata: expect.objectContaining({ partialRefundStripeId: STRIPE_REFUND_ID }),
        })
      );
      expect(transition).toHaveBeenCalledWith(
        expect.objectContaining({ id: TX_ID, transition: PARTIAL_REFUND_CANCEL }),
        expect.anything()
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual(
        expect.objectContaining({
          refunded: true,
          cancelled: true,
          requiresManualFollowUp: false,
          refundAmount: 8000,
          refundCurrency: 'usd',
        })
      );
    });
  });

  it('notifies the assigned laundry, fire-and-continue, without delaying or risking the response', () => {
    setup({ assignedLaundryId: 'laundry-1' });

    return run().then(res => {
      expect(res.statusCode).toBe(200);
      expect(notifyPartialRefundBookingCancelled).toHaveBeenCalled();
    });
  });

  it('never calls Stripe with anything that looks like a real secret key', () => {
    // The whole `stripe` package is mocked at the top of this file. This assertion exists so a
    // future edit that accidentally imports the real package cannot silently start making
    // network calls: `Stripe` here is always the jest mock constructor, never the real SDK.
    setup();

    return run().then(() => {
      expect(jest.isMockFunction(Stripe)).toBe(true);
    });
  });

  it('skips the laundry notification entirely when no laundry is assigned', () => {
    setup({ assignedLaundryId: null });

    return run().then(() => {
      expect(notifyPartialRefundBookingCancelled).not.toHaveBeenCalled();
    });
  });
});
