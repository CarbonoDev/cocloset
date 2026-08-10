const {
  HANDOVER_QR_METADATA_KEY,
  HANDOVER_QR_VERSION,
  HANDOVER_QR_SCOPE_PICKUP_AND_RETURN,
  HANDOVER_QR_VISIBLE_STATES,
  transitionsServedByHandoverQr,
  isHandoverQrVisibleState,
  buildHandoverQrPayload,
  buildHandoverQrRecord,
  resolveHandoverQrPayload,
  renderHandoverQrPngBuffer,
  renderHandoverQrDataUrl,
  ensureHandoverQr,
} = require('./handoverQr');
const { STATES, TRANSITIONS } = require('./coclosetBookingProcess');

const TX_ID = '6a74b530-a104-42b6-a586-b35efb5dee79';
const FIXED_NOW = () => new Date('2026-08-09T12:00:00.000Z');

describe('buildHandoverQrPayload', () => {
  it('encodes the transaction id itself (design §11)', () => {
    expect(buildHandoverQrPayload(TX_ID)).toBe(TX_ID);
  });

  it('throws rather than encoding an empty payload', () => {
    expect(() => buildHandoverQrPayload()).toThrow(/transactionUuid is required/);
    expect(() => buildHandoverQrPayload('')).toThrow(/transactionUuid is required/);
  });
});

describe('buildHandoverQrRecord', () => {
  it('builds the persisted record', () => {
    expect(buildHandoverQrRecord(TX_ID, FIXED_NOW)).toEqual({
      version: HANDOVER_QR_VERSION,
      payload: TX_ID,
      encoding: 'transaction-id',
      scope: HANDOVER_QR_SCOPE_PICKUP_AND_RETURN,
      createdAt: '2026-08-09T12:00:00.000Z',
    });
  });

  it('stays small: the record must not carry the rendered image', () => {
    // The whole point of storing a descriptor rather than a data URL. A PNG
    // data URL for this payload is ~2 KB; if someone adds it to the record this
    // guard fails and they have to come and read the reasoning first.
    const serialized = JSON.stringify(buildHandoverQrRecord(TX_ID, FIXED_NOW));
    expect(serialized).not.toContain('data:image');
    expect(serialized.length).toBeLessThan(256);
  });
});

describe('one QR for both handover events', () => {
  it('maps the pickup-and-return scope to BOTH handover directions', () => {
    const served = transitionsServedByHandoverQr(HANDOVER_QR_SCOPE_PICKUP_AND_RETURN);

    // laundry -> customer
    expect(served).toContain(TRANSITIONS.LAUNDRY_CONFIRM_PICKUP);
    // customer -> laundry, on time and late (same physical event)
    expect(served).toContain(TRANSITIONS.LAUNDRY_CONFIRM_RETURN);
    expect(served).toContain(TRANSITIONS.LAUNDRY_CONFIRM_RETURN_LATE);
  });

  it('is the scope every generated record uses', () => {
    expect(buildHandoverQrRecord(TX_ID, FIXED_NOW).scope).toBe(HANDOVER_QR_SCOPE_PICKUP_AND_RETURN);
  });

  it('serves nothing for an unknown scope', () => {
    expect(transitionsServedByHandoverQr('pickup-only')).toEqual([]);
    expect(transitionsServedByHandoverQr(undefined)).toEqual([]);
  });
});

describe('isHandoverQrVisibleState', () => {
  it('shows the code while either handover is still ahead', () => {
    expect(isHandoverQrVisibleState(STATES.ACCEPTED)).toBe(true);
    expect(isHandoverQrVisibleState(STATES.READY_FOR_PICKUP)).toBe(true);
    expect(isHandoverQrVisibleState(STATES.PICKED_UP)).toBe(true);
    expect(isHandoverQrVisibleState(STATES.OVERDUE)).toBe(true);
  });

  it('hides the code from `returned` onwards - entering `returned` IS the second handover', () => {
    expect(isHandoverQrVisibleState(STATES.RETURNED)).toBe(false);
    expect(isHandoverQrVisibleState(STATES.CLEANING)).toBe(false);
    expect(isHandoverQrVisibleState(STATES.DELIVERED)).toBe(false);
    expect(isHandoverQrVisibleState(STATES.REVIEWED)).toBe(false);
  });

  it('hides the code before the booking is accepted, and in dead-end states', () => {
    expect(isHandoverQrVisibleState(STATES.INQUIRY)).toBe(false);
    expect(isHandoverQrVisibleState(STATES.PENDING_PAYMENT)).toBe(false);
    expect(isHandoverQrVisibleState(STATES.PREAUTHORIZED)).toBe(false);
    expect(isHandoverQrVisibleState(STATES.DECLINED)).toBe(false);
    expect(isHandoverQrVisibleState(STATES.CANCELED)).toBe(false);
    expect(isHandoverQrVisibleState(STATES.EXPIRED)).toBe(false);
    expect(isHandoverQrVisibleState(null)).toBe(false);
    expect(isHandoverQrVisibleState(undefined)).toBe(false);
  });

  it('covers exactly the states between accept and the return, inclusive', () => {
    // Restates the rule as a set, so widening or narrowing the window is a
    // deliberate edit rather than a side effect.
    expect(HANDOVER_QR_VISIBLE_STATES).toEqual([
      'accepted',
      'ready-for-pickup',
      'picked-up',
      'overdue',
    ]);
  });
});

describe('resolveHandoverQrPayload', () => {
  it('prefers the persisted record', () => {
    const metadata = { [HANDOVER_QR_METADATA_KEY]: { payload: 'stored-payload' } };
    expect(resolveHandoverQrPayload(metadata, TX_ID)).toBe('stored-payload');
  });

  it('falls back to the transaction id for bookings that predate the feature', () => {
    expect(resolveHandoverQrPayload({}, TX_ID)).toBe(TX_ID);
    expect(resolveHandoverQrPayload(undefined, TX_ID)).toBe(TX_ID);
    expect(resolveHandoverQrPayload({ ticketCode: 'PIG-1' }, TX_ID)).toBe(TX_ID);
  });

  it('returns null when there is nothing to encode', () => {
    expect(resolveHandoverQrPayload(undefined, undefined)).toBe(null);
  });
});

describe('rendering', () => {
  it('renders a real PNG', async () => {
    const buffer = await renderHandoverQrPngBuffer(TX_ID);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    // PNG magic number.
    expect(buffer.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  });

  it('renders a data URL from the same bytes, so the two forms cannot drift', async () => {
    const [buffer, dataUrl] = await Promise.all([
      renderHandoverQrPngBuffer(TX_ID),
      renderHandoverQrDataUrl(TX_ID),
    ]);
    expect(dataUrl).toBe(`data:image/png;base64,${buffer.toString('base64')}`);
  });

  it('rejects an empty payload', async () => {
    await expect(renderHandoverQrPngBuffer('')).rejects.toThrow(/payload is required/);
  });
});

describe('ensureHandoverQr', () => {
  const mockSdk = () => ({
    transactions: { updateMetadata: jest.fn(() => Promise.resolve({})) },
  });

  it('writes the record, keyed under handoverQr and nothing else', async () => {
    const integrationSdk = mockSdk();

    const result = await ensureHandoverQr({
      integrationSdk,
      transactionId: { uuid: TX_ID },
      existingMetadata: {},
      now: FIXED_NOW,
    });

    expect(result.created).toBe(true);
    expect(integrationSdk.transactions.updateMetadata).toHaveBeenCalledTimes(1);

    const call = integrationSdk.transactions.updateMetadata.mock.calls[0][0];
    expect(call.id).toBe(TX_ID);
    // Only this one key: updateMetadata is a top-level shallow merge (verified
    // against the real Dev Integration API), so sibling keys such as ticketCode
    // must NOT be resent, and cannot be clobbered.
    expect(Object.keys(call.metadata)).toEqual([HANDOVER_QR_METADATA_KEY]);
    expect(call.metadata[HANDOVER_QR_METADATA_KEY]).toEqual({
      version: HANDOVER_QR_VERSION,
      payload: TX_ID,
      encoding: 'transaction-id',
      scope: HANDOVER_QR_SCOPE_PICKUP_AND_RETURN,
      createdAt: '2026-08-09T12:00:00.000Z',
    });
  });

  it('accepts a plain uuid string as well as a UUID object', async () => {
    const integrationSdk = mockSdk();
    await ensureHandoverQr({ integrationSdk, transactionId: TX_ID, now: FIXED_NOW });
    expect(integrationSdk.transactions.updateMetadata.mock.calls[0][0].id).toBe(TX_ID);
  });

  it('is idempotent: an existing record is never regenerated', async () => {
    // This is requirement (2) enforced. If this test ever fails, a second QR can
    // come into existence for the return step.
    const integrationSdk = mockSdk();
    const existing = {
      version: 1,
      payload: TX_ID,
      encoding: 'transaction-id',
      scope: HANDOVER_QR_SCOPE_PICKUP_AND_RETURN,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    const result = await ensureHandoverQr({
      integrationSdk,
      transactionId: TX_ID,
      existingMetadata: { [HANDOVER_QR_METADATA_KEY]: existing },
      now: FIXED_NOW,
    });

    expect(result).toEqual({ created: false, record: existing });
    // Including createdAt: re-stamping it would turn "when the reservation was
    // created" into "the last time anything called this".
    expect(result.record.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(integrationSdk.transactions.updateMetadata).not.toHaveBeenCalled();
  });

  it('regenerates when a record exists but has no payload', async () => {
    const integrationSdk = mockSdk();
    const result = await ensureHandoverQr({
      integrationSdk,
      transactionId: TX_ID,
      existingMetadata: { [HANDOVER_QR_METADATA_KEY]: { version: 1 } },
      now: FIXED_NOW,
    });

    expect(result.created).toBe(true);
    expect(integrationSdk.transactions.updateMetadata).toHaveBeenCalledTimes(1);
  });

  it('never rejects when the write fails, and logs instead', async () => {
    // The caller is a checkout endpoint whose response the customer is waiting
    // on; a QR is not worth failing a booking over.
    const boom = new Error('API down');
    const integrationSdk = {
      transactions: { updateMetadata: jest.fn(() => Promise.reject(boom)) },
    };
    const log = { error: jest.fn() };

    const result = await ensureHandoverQr({
      integrationSdk,
      transactionId: TX_ID,
      existingMetadata: {},
      log,
      now: FIXED_NOW,
    });

    expect(result.created).toBe(false);
    expect(result.error).toBe(boom);
    expect(log.error).toHaveBeenCalledWith(boom, 'handover-qr-write-failed', {
      txId: TX_ID,
      message: 'API down',
    });
  });

  it('never rejects when there is no transaction id, and does not write', async () => {
    const integrationSdk = mockSdk();
    const log = { error: jest.fn() };

    const result = await ensureHandoverQr({ integrationSdk, transactionId: null, log });

    expect(result.created).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(integrationSdk.transactions.updateMetadata).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  it('tolerates being called without a logger', async () => {
    const integrationSdk = {
      transactions: { updateMetadata: jest.fn(() => Promise.reject(new Error('nope'))) },
    };
    await expect(
      ensureHandoverQr({ integrationSdk, transactionId: TX_ID, now: FIXED_NOW })
    ).resolves.toMatchObject({ created: false });
  });
});
