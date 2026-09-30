const {
  generatePickupToken,
  pickupTokensMatch,
  buildPickupQrScanUrl,
  renderPickupQrPngBuffer,
} = require('./listingPickupQr');

describe('generatePickupToken', () => {
  it('produces a 32-character hex token', () => {
    const token = generatePickupToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('never repeats itself', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generatePickupToken()));
    expect(tokens.size).toBe(50);
  });
});

describe('pickupTokensMatch', () => {
  it('matches identical tokens', () => {
    const token = generatePickupToken();
    expect(pickupTokensMatch(token, token)).toBe(true);
  });

  it('rejects a different token of the same length', () => {
    expect(pickupTokensMatch('a'.repeat(32), 'b'.repeat(32))).toBe(false);
  });

  it('rejects tokens of different lengths without throwing', () => {
    expect(pickupTokensMatch('short', 'a'.repeat(32))).toBe(false);
  });

  it.each([[undefined], [null], ['']])('rejects a missing provided token (%p)', provided => {
    expect(pickupTokensMatch(provided, 'a'.repeat(32))).toBe(false);
  });

  it.each([[undefined], [null], ['']])('rejects a missing stored token (%p)', stored => {
    expect(pickupTokensMatch('a'.repeat(32), stored)).toBe(false);
  });
});

describe('buildPickupQrScanUrl', () => {
  const LISTING_ID = '6aa26840-16da-44df-8a74-ff4ece1da4eb';
  const TOKEN = 'a'.repeat(32);

  it('builds an absolute URL under the configured root, carrying both id and token', () => {
    const url = buildPickupQrScanUrl(LISTING_ID, TOKEN, 'https://cocloset.example');
    expect(url).toBe(`https://cocloset.example/pickup/${LISTING_ID}?token=${TOKEN}`);
  });

  it('strips a trailing slash from the root URL', () => {
    const url = buildPickupQrScanUrl(LISTING_ID, TOKEN, 'https://cocloset.example/');
    expect(url).toBe(`https://cocloset.example/pickup/${LISTING_ID}?token=${TOKEN}`);
  });

  it('falls back to a relative path when no root URL is configured', () => {
    const url = buildPickupQrScanUrl(LISTING_ID, TOKEN, '');
    expect(url).toBe(`pickup/${LISTING_ID}?token=${TOKEN}`);
  });

  it('requires a listingId', () => {
    expect(() => buildPickupQrScanUrl(undefined, TOKEN, 'https://x')).toThrow(/listingId/);
  });

  it('requires a token - unlike the handover QR, there is no honest fallback without one', () => {
    expect(() => buildPickupQrScanUrl(LISTING_ID, undefined, 'https://x')).toThrow(/token/);
  });
});

describe('renderPickupQrPngBuffer', () => {
  it('renders a real PNG buffer for a scan URL', async () => {
    const buffer = await renderPickupQrPngBuffer('https://cocloset.example/pickup/x?token=y');
    // PNG magic bytes.
    expect(buffer.slice(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });
});
