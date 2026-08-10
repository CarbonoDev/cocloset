import { handoverQrPayloadFromRecord, resolveHandoverQrPayload } from './handoverQr';

const TX_ID = '6a74b530-a104-42b6-a586-b35efb5dee79';

const record = {
  version: 1,
  payload: TX_ID,
  encoding: 'transaction-id',
  scope: 'pickup-and-return',
  createdAt: '2026-08-09T12:00:00.000Z',
};

describe('handoverQrPayloadFromRecord', () => {
  it('prefers the stored payload', () => {
    expect(handoverQrPayloadFromRecord({ payload: 'stored' }, TX_ID)).toBe('stored');
  });

  it('falls back to the transaction id (§11: they are the same scheme)', () => {
    expect(handoverQrPayloadFromRecord(null, TX_ID)).toBe(TX_ID);
    expect(handoverQrPayloadFromRecord(undefined, TX_ID)).toBe(TX_ID);
    expect(handoverQrPayloadFromRecord({}, TX_ID)).toBe(TX_ID);
  });

  it('returns null when there is nothing to encode', () => {
    expect(handoverQrPayloadFromRecord(null, null)).toBe(null);
    expect(handoverQrPayloadFromRecord(undefined, undefined)).toBe(null);
  });
});

describe('resolveHandoverQrPayload', () => {
  it('reads the record out of transaction metadata', () => {
    expect(resolveHandoverQrPayload({ handoverQr: record }, 'other-id')).toBe(TX_ID);
  });

  it('ignores unrelated metadata and falls back', () => {
    expect(resolveHandoverQrPayload({ ticketCode: 'PIG-A3F91C' }, TX_ID)).toBe(TX_ID);
  });

  it('agrees with the server mirror in server/api-util/handoverQr.js', () => {
    // Two copies exist because the CommonJS server cannot require ESM out of
    // src/ (see the header of that file). Nothing enforces that they match, so
    // this at least pins the contract this half implements: same metadata key,
    // same precedence, same fallback.
    expect(resolveHandoverQrPayload({ handoverQr: { payload: 'a' } }, 'b')).toBe('a');
    expect(resolveHandoverQrPayload({}, 'b')).toBe('b');
    expect(resolveHandoverQrPayload(undefined, undefined)).toBe(null);
  });
});
