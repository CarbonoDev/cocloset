const { PAYMENT_INTENT_METADATA_KEY, capturePaymentIntentIdMaybe } = require('./paymentIntentLedger');

const TX_ID = { uuid: 'tx-1' };
const STRIPE_PAYMENT_INTENT_ID = 'pi_3Abc123';

// A transaction entity shaped the way `transactions.initiate` /
// `transitionSpeculative` / `transition` hand it back: protectedData carrying
// the PaymentIntent id the moment it is available (between
// `:action/stripe-create-payment-intent` and `:action/stripe-confirm-payment-intent`),
// and whatever metadata it already has.
const transactionEntity = ({ stripePaymentIntentId, existingMetadata = {} } = {}) => ({
  id: TX_ID,
  type: 'transaction',
  attributes: {
    protectedData:
      stripePaymentIntentId === undefined
        ? {}
        : {
            stripePaymentIntents: {
              default: { stripePaymentIntentId },
            },
          },
    metadata: existingMetadata,
  },
});

const mockIntegrationSdk = (updateMetadataImpl = () => Promise.resolve({})) => ({
  transactions: { updateMetadata: jest.fn(updateMetadataImpl) },
});

const mockLog = () => ({ error: jest.fn() });

describe('capturePaymentIntentIdMaybe', () => {
  it('writes the PaymentIntent id into metadata on the happy path', async () => {
    const integrationSdk = mockIntegrationSdk();
    const transaction = transactionEntity({ stripePaymentIntentId: STRIPE_PAYMENT_INTENT_ID });

    const result = await capturePaymentIntentIdMaybe({ integrationSdk, transaction, log: mockLog() });

    expect(result).toEqual({ captured: true, stripePaymentIntentId: STRIPE_PAYMENT_INTENT_ID });
    expect(integrationSdk.transactions.updateMetadata).toHaveBeenCalledTimes(1);
    expect(integrationSdk.transactions.updateMetadata).toHaveBeenCalledWith({
      id: TX_ID.uuid,
      metadata: { [PAYMENT_INTENT_METADATA_KEY]: STRIPE_PAYMENT_INTENT_ID },
    });
  });

  it('writes only the one key, so sibling metadata (handoverQr, ticketCode, offers) survives', async () => {
    // updateMetadata is a top-level shallow merge on the real Integration API (see
    // handoverQr.js); this call must not try to read-modify-write the whole object.
    const integrationSdk = mockIntegrationSdk();
    const transaction = transactionEntity({ stripePaymentIntentId: STRIPE_PAYMENT_INTENT_ID });

    await capturePaymentIntentIdMaybe({ integrationSdk, transaction, log: mockLog() });

    const call = integrationSdk.transactions.updateMetadata.mock.calls[0][0];
    expect(Object.keys(call.metadata)).toEqual([PAYMENT_INTENT_METADATA_KEY]);
  });

  it('is a no-op when the transaction has no PaymentIntent id (e.g. a push-payment method)', async () => {
    const integrationSdk = mockIntegrationSdk();
    const transaction = transactionEntity({});

    const result = await capturePaymentIntentIdMaybe({ integrationSdk, transaction, log: mockLog() });

    expect(result).toEqual({ captured: false });
    expect(integrationSdk.transactions.updateMetadata).not.toHaveBeenCalled();
  });

  it('is a no-op when protectedData itself is absent', async () => {
    const integrationSdk = mockIntegrationSdk();
    const transaction = { id: TX_ID, type: 'transaction', attributes: {} };

    const result = await capturePaymentIntentIdMaybe({ integrationSdk, transaction, log: mockLog() });

    expect(result).toEqual({ captured: false });
    expect(integrationSdk.transactions.updateMetadata).not.toHaveBeenCalled();
  });

  it('is idempotent: does not re-write when the same id is already captured', async () => {
    const integrationSdk = mockIntegrationSdk();
    const transaction = transactionEntity({
      stripePaymentIntentId: STRIPE_PAYMENT_INTENT_ID,
      existingMetadata: { [PAYMENT_INTENT_METADATA_KEY]: STRIPE_PAYMENT_INTENT_ID },
    });

    const result = await capturePaymentIntentIdMaybe({ integrationSdk, transaction, log: mockLog() });

    expect(result).toEqual({ captured: false });
    expect(integrationSdk.transactions.updateMetadata).not.toHaveBeenCalled();
  });

  it('DOES re-write when a different PaymentIntent id is captured than what is stored', async () => {
    // Not expected in practice (a transaction has one PaymentIntent), but the idempotency
    // check compares values rather than just checking presence, so a changed id is not
    // silently ignored.
    const integrationSdk = mockIntegrationSdk();
    const transaction = transactionEntity({
      stripePaymentIntentId: STRIPE_PAYMENT_INTENT_ID,
      existingMetadata: { [PAYMENT_INTENT_METADATA_KEY]: 'pi_some_other_one' },
    });

    const result = await capturePaymentIntentIdMaybe({ integrationSdk, transaction, log: mockLog() });

    expect(result.captured).toBe(true);
    expect(integrationSdk.transactions.updateMetadata).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for a non-cocloset / unrelated listing scenario where no PaymentIntent id exists', async () => {
    // This module itself has no notion of "cocloset listing" - that gate lives in the
    // endpoint call sites (capturePaymentIntentLedgerMaybe), mirroring ensureHandoverQr not
    // knowing about isCoclosetBookingListing either. What this module guarantees on its own
    // is: no id present -> no API call, regardless of caller.
    const integrationSdk = mockIntegrationSdk();
    const transaction = transactionEntity({});

    await capturePaymentIntentIdMaybe({ integrationSdk, transaction, log: mockLog() });

    expect(integrationSdk.transactions.updateMetadata).not.toHaveBeenCalled();
  });

  it('resolves (does not throw/reject) and logs when the Integration API write fails', async () => {
    const boom = new Error('Integration API is down');
    const integrationSdk = mockIntegrationSdk(() => Promise.reject(boom));
    const transaction = transactionEntity({ stripePaymentIntentId: STRIPE_PAYMENT_INTENT_ID });
    const log = mockLog();

    const result = await capturePaymentIntentIdMaybe({ integrationSdk, transaction, log });

    expect(result.captured).toBe(false);
    expect(result.error).toBe(boom);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][0]).toBe(boom);
    expect(log.error.mock.calls[0][1]).toBe('payment-intent-ledger-capture-failed');
    expect(log.error.mock.calls[0][2]).toMatchObject({ txId: TX_ID.uuid });
  });

  it('never rejects even when the Integration API write fails and no log is given', async () => {
    const integrationSdk = mockIntegrationSdk(() => Promise.reject(new Error('nope')));
    const transaction = transactionEntity({ stripePaymentIntentId: STRIPE_PAYMENT_INTENT_ID });

    await expect(
      capturePaymentIntentIdMaybe({ integrationSdk, transaction })
    ).resolves.toMatchObject({ captured: false });
  });

  it('handles a missing transaction entirely without throwing', async () => {
    const integrationSdk = mockIntegrationSdk();

    const result = await capturePaymentIntentIdMaybe({ integrationSdk, transaction: undefined, log: mockLog() });

    expect(result).toEqual({ captured: false });
    expect(integrationSdk.transactions.updateMetadata).not.toHaveBeenCalled();
  });
});
