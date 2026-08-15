import { processCheckoutWithPayment } from './CheckoutPageTransactionHelpers';
import { autoAcceptBooking } from '../../util/api';

jest.mock('../../util/api', () => ({
  autoAcceptBooking: jest.fn(),
}));

// This project's Jest config resets mock implementations between tests, so the default is
// re-established in `beforeEach` rather than in the factory above.
const resolveAutoAccept = () =>
  autoAcceptBooking.mockImplementation(() => Promise.resolve({ data: null }));

// WHY THIS FILE EXISTS.
//
// The auto-accept endpoint (server/api/auto-accept-booking.js) had unit tests from the day it
// was written, and they passed. It still never accepted a single booking on Dev, because the
// browser called it in the WRONG STEP of the checkout sequence: right after the order was
// created, while the transaction is still `pending-payment`. The endpoint refuses anything
// that is not `preauthorized` - correctly - so it answered `not-awaiting-acceptance` every
// time and the provider went on being asked to accept garments already sitting at their
// studio.
//
// Testing the endpoint could not have caught that. Only the call site can, so it is the call
// site these tests pin: not "does auto-accept work", but "is it fired at a moment when there
// is something to accept".

const ORDER_ID = { uuid: 'order-1' };

// The two transitions that matter here, spelled as the cocloset-booking process spells them.
const REQUEST_PAYMENT = 'transition/request-payment';
const CONFIRM_PAYMENT = 'transition/confirm-payment';

const fakeProcess = {
  transitions: {
    INQUIRE: 'transition/inquire',
    REQUEST_PAYMENT,
    REQUEST_PAYMENT_AFTER_INQUIRY: 'transition/request-payment-after-inquiry',
    REQUEST_PAYMENT_TO_ACCEPT_OFFER: 'transition/request-payment-to-accept-offer',
    CONFIRM_PAYMENT,
  },
  states: { OFFER_PENDING: 'offer-pending' },
  isPrivileged: transition => transition === REQUEST_PAYMENT,
};

// A transaction as each step hands it on. `lastTransition` is the whole point: it is what the
// server reads to decide whether the booking can be accepted yet.
const txAfter = lastTransition => ({
  id: ORDER_ID,
  type: 'transaction',
  attributes: {
    lastTransition,
    protectedData: {
      stripePaymentIntents: { default: { stripePaymentIntentClientSecret: 'secret' } },
    },
  },
});

const buildParams = ({ calls }) => {
  const orderParams = { listingId: { uuid: 'listing-1' }, bookingDates: {} };

  const extraPaymentParams = {
    hasPaymentIntentUserActionsDone: true,
    isPaymentFlowUseSavedCard: false,
    isPaymentFlowPayAndSaveCard: false,
    paymentIntent: { payment_method: 'pm_1' },
    process: fakeProcess,
    pageData: {
      listing: {
        attributes: { publicData: { transactionProcessAlias: 'cocloset-booking/release-1' } },
      },
      // No stored transaction: this is a first pass through the sequence, which is when the
      // ordering bug bit.
      transaction: null,
      orderData: {},
    },
    setPageData: () => {},
    storeData: () => {},
    sessionStorageKey: 'test',
    stripeCustomer: {},
    stripePaymentMethodId: 'pm_1',

    onInitiateOrder: () => {
      calls.push('initiate');
      return Promise.resolve(txAfter(REQUEST_PAYMENT));
    },
    onConfirmCardPayment: () => {
      calls.push('confirm-card');
      return Promise.resolve({ transactionId: ORDER_ID, paymentIntent: { id: 'pi_1' } });
    },
    onConfirmPayment: () => {
      calls.push('confirm-payment');
      return Promise.resolve(txAfter(CONFIRM_PAYMENT));
    },
    onSavePaymentMethod: () => Promise.resolve({}),
  };

  return [orderParams, extraPaymentParams];
};

describe('processCheckoutWithPayment - auto-accept timing', () => {
  beforeEach(() => {
    autoAcceptBooking.mockClear();
    resolveAutoAccept();
  });

  it('asks the server to auto-accept once, for the created order', async () => {
    const calls = [];
    await processCheckoutWithPayment(...buildParams({ calls }));

    expect(autoAcceptBooking).toHaveBeenCalledTimes(1);
    expect(autoAcceptBooking).toHaveBeenCalledWith({ transactionId: ORDER_ID });
  });

  it('does not fire it before the payment is confirmed', async () => {
    // THE REGRESSION. Fired from step 1 the transaction is still `pending-payment`, and the
    // endpoint - rightly - does nothing with it. So the assertion is about ORDER, not about
    // the call happening at all: `confirm-payment` must already have been sent.
    const calls = [];
    let confirmPaymentSeenAtCallTime = null;

    autoAcceptBooking.mockImplementation(() => {
      confirmPaymentSeenAtCallTime = calls.includes('confirm-payment');
      return Promise.resolve({ data: null });
    });

    await processCheckoutWithPayment(...buildParams({ calls }));

    expect(confirmPaymentSeenAtCallTime).toBe(true);
  });

  it('does not fail the checkout when auto-accept rejects', async () => {
    // The customer has paid. A booking that is merely not accepted YET is still a valid
    // booking, and surfacing this failure would present as a failed payment.
    autoAcceptBooking.mockImplementation(() => Promise.reject(new Error('500')));

    const calls = [];
    await expect(processCheckoutWithPayment(...buildParams({ calls }))).resolves.toEqual(
      expect.objectContaining({ orderId: ORDER_ID })
    );
  });
});
