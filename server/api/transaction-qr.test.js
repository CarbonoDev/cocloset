jest.mock('../log', () => ({ error: jest.fn() }));

const log = require('../log');
const transactionQr = require('./transaction-qr');

const { MAX_PER_IP_PER_WINDOW } = transactionQr;

const TX_ID = '6a74b530-a104-42b6-a586-b35efb5dee79';

const mockRes = () => {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    status: jest.fn(code => {
      res.statusCode = code;
      return res;
    }),
    set: jest.fn((key, value) => {
      res.headers[key] = value;
      return res;
    }),
    send: jest.fn(body => {
      res.body = body;
      return res;
    }),
    json: jest.fn(body => {
      res.body = body;
      return res;
    }),
    end: jest.fn(() => res),
  };
  return res;
};

// The handler owns a module-level rate limiter, so each test needs its own IP.
let ipCounter = 0;
const nextIp = () => {
  ipCounter = ipCounter + 1;
  return `10.1.0.${ipCounter}`;
};

// The handler returns its render promise, so a request can simply be awaited.
const request = (query, ip = nextIp()) => {
  const res = mockRes();
  return Promise.resolve(transactionQr({ ip, query }, res)).then(() => res);
};

describe('transaction-qr', () => {
  beforeEach(() => {
    log.error.mockClear();
  });

  it('renders a PNG for a valid transaction id', async () => {
    const res = await request({ id: TX_ID });

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(res.headers['Content-Length']).toBe(String(res.body.length));
  });

  it('marks the image immutable and private', async () => {
    // The image is a pure function of `id`, so it can be cached hard; `private`
    // keeps shared proxies out of it.
    const res = await request({ id: TX_ID });

    expect(res.headers['Cache-Control']).toBe('private, max-age=86400, immutable');
  });

  it('renders the SAME image for the same id - one code for both handovers', async () => {
    // Pickup and return are two scans of one code. Nothing about this endpoint
    // takes an "event" parameter, and this pins that: two requests for the same
    // transaction are byte-identical, so there is no way to end up with a
    // "pickup QR" and a different "return QR".
    const [first, second] = await Promise.all([request({ id: TX_ID }), request({ id: TX_ID })]);

    expect(first.body.equals(second.body)).toBe(true);
  });

  it('rejects a missing id', async () => {
    const res = await request({});

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/must be a transaction UUID/);
  });

  it('rejects anything that is not a UUID', async () => {
    // This is the control that matters on an unauthenticated endpoint: without
    // it, the endpoint would render arbitrary attacker-chosen text (e.g. a
    // phishing URL) as a QR on the marketplace's own domain.
    const notUuids = [
      'https://evil.example.com',
      '../../etc/passwd',
      'PIG-A3F91C',
      `${TX_ID} `,
      `${TX_ID}extra`,
      '6a74b530a10442b6a586b35efb5dee79',
    ];

    for (const id of notUuids) {
      const res = await request({ id });
      expect(res.statusCode).toBe(400);
    }
  });

  it('accepts an uppercase UUID', async () => {
    const res = await request({ id: TX_ID.toUpperCase() });

    expect(res.statusCode).toBe(200);
  });

  it('rate limits a single address', async () => {
    const ip = nextIp();

    // The limiter is checked before the id is validated, so an invalid id is
    // enough to consume the budget - and avoids rendering hundreds of PNGs
    // just to reach the limit.
    for (let i = 0; i < MAX_PER_IP_PER_WINDOW; i = i + 1) {
      const res = await request({ id: 'not-a-uuid' }, ip);
      expect(res.statusCode).toBe(400);
    }

    const overBudget = await request({ id: TX_ID }, ip);
    expect(overBudget.statusCode).toBe(429);
    expect(overBudget.headers['Retry-After']).toEqual(expect.any(String));
  });

  it('logs and 500s when rendering fails', async () => {
    // Defensive path: UUID validation means a payload `qrcode` cannot encode
    // should be unreachable. Covered anyway so a render failure can never
    // become a hung request or a silent 200.
    const boom = new Error('render exploded');
    const res = mockRes();
    let isolatedLog;

    await jest.isolateModulesAsync(async () => {
      jest.doMock('../api-util/handoverQr', () => ({
        ...jest.requireActual('../api-util/handoverQr'),
        renderHandoverQrPngBuffer: () => Promise.reject(boom),
      }));

      const handler = require('./transaction-qr');
      isolatedLog = require('../log');
      await Promise.resolve(handler({ ip: nextIp(), query: { id: TX_ID } }, res));
    });

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/Failed to render/);
    expect(isolatedLog.error).toHaveBeenCalledWith(boom, 'transaction-qr-render-failed', {
      txId: TX_ID,
      message: 'render exploded',
    });
  });
});
