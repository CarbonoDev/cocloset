// Mock the logger the way the rest of the server tests do (see cache.test.js /
// sdkCacheProxy.test.js). Two reasons here: log.error() prints three
// console.error lines per call and would bury the test output, and requiring
// the real server/log.js initialises Sentry from env.
jest.mock('../log', () => ({
  error: jest.fn(),
  devLogger: jest.fn(),
}));

const log = require('../log');
const { sendMail, isMailgunConfigured, parseAddress } = require('./mailgun');

// Every test drives the module through env, so snapshot and restore it rather
// than leaking MAILGUN_* into the rest of the server suite.
const ORIGINAL_ENV = process.env;

const configure = (overrides = {}) => {
  process.env.MAILGUN_API_KEY = 'key-test-abc123';
  process.env.MAILGUN_DOMAIN = 'mg.cocloset.com';
  process.env.MAILGUN_FROM_EMAIL = 'Cocloset <no-reply@mg.cocloset.com>';
  Object.entries(overrides).forEach(([key, value]) => {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
};

const unconfigure = () => {
  delete process.env.MAILGUN_API_KEY;
  delete process.env.MAILGUN_DOMAIN;
  delete process.env.MAILGUN_FROM_EMAIL;
  delete process.env.MAILGUN_API_BASE_URL;
};

const okResponse = (body = { id: '<20260801.1@mg.cocloset.com>', message: 'Queued. Thank you.' }) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });

const errorResponse = (status, body = 'Domain not found: mg.cocloset.com') =>
  Promise.resolve({
    ok: false,
    status,
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(body),
  });

const message = {
  to: 'studio@pigalle.example.com',
  subject: 'Cocloset: pickup scheduled',
  text: 'Please have the garment ready.',
  html: '<p>Please have the garment ready.</p>',
};

let fetchMock;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  unconfigure();
  fetchMock = jest.fn(() => okResponse());
  global.fetch = fetchMock;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  delete global.fetch;
});

describe('isMailgunConfigured()', () => {
  it('is false with no env vars at all', () => {
    expect(isMailgunConfigured()).toBe(false);
  });

  it('is false when only the domain is set', () => {
    process.env.MAILGUN_DOMAIN = 'mg.cocloset.com';
    expect(isMailgunConfigured()).toBe(false);
  });

  it('is false for a blank/whitespace-only key (a common .env accident)', () => {
    process.env.MAILGUN_API_KEY = '   ';
    process.env.MAILGUN_DOMAIN = 'mg.cocloset.com';
    expect(isMailgunConfigured()).toBe(false);
  });

  it('is true once key and domain are both set', () => {
    configure();
    expect(isMailgunConfigured()).toBe(true);
  });

  it('does not require MAILGUN_FROM_EMAIL', () => {
    configure({ MAILGUN_FROM_EMAIL: null });
    expect(isMailgunConfigured()).toBe(true);
  });
});

describe('parseAddress()', () => {
  it('accepts a bare address', () => {
    expect(parseAddress('studio@pigalle.example.com')).toBe('studio@pigalle.example.com');
  });

  it('accepts and preserves the display form', () => {
    expect(parseAddress('Studio Pigalle <studio@pigalle.example.com>')).toBe(
      'Studio Pigalle <studio@pigalle.example.com>'
    );
  });

  it('trims surrounding whitespace', () => {
    expect(parseAddress('  studio@pigalle.example.com  ')).toBe('studio@pigalle.example.com');
  });

  it('rejects malformed addresses', () => {
    expect(parseAddress('not-an-email')).toBeNull();
    expect(parseAddress('no@tld')).toBeNull();
    expect(parseAddress('two@@ats.com')).toBeNull();
    expect(parseAddress('spaces in@example.com')).toBeNull();
    expect(parseAddress('@example.com')).toBeNull();
    expect(parseAddress('')).toBeNull();
  });

  // A comma would let one "address" smuggle in a second recipient.
  it('rejects comma/semicolon-separated lists', () => {
    expect(parseAddress('a@example.com,b@example.com')).toBeNull();
    expect(parseAddress('a@example.com;b@example.com')).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(parseAddress(undefined)).toBeNull();
    expect(parseAddress(null)).toBeNull();
    expect(parseAddress(42)).toBeNull();
    expect(parseAddress({})).toBeNull();
  });
});

// THE CLIENT'S REQUIREMENT, AS REVISED (Jonathan, 2026-08-10): "debe fallar solo
// con log sin impedir el flujo si no existe la key o si no tenemos el mail de la
// laundry".
//
// This REPLACES the original "simplemente se ignora el envío" (2026-08-01), which
// these tests used to pin as *silence* - they asserted log.error was never called
// and that the only output was devLogger, which prints solely when
// REACT_APP_ENV === 'development' AND VERBOSE === 'true', i.e. never in practice.
// With no Mailgun account yet, that made the entire mail path indistinguishable
// from not existing. The skip is still a skip - no throw, no HTTP call, caller
// still resolves - but it now leaves a trace.
describe('sendMail() when Mailgun is not configured', () => {
  it('resolves (never rejects) and reports not-sent', async () => {
    await expect(sendMail(message)).resolves.toEqual({
      sent: false,
      reason: 'not-configured',
    });
  });

  it('makes NO HTTP call', async () => {
    await sendMail(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('LOGS the skip rather than passing silently', async () => {
    await sendMail(message);

    expect(log.error).toHaveBeenCalledTimes(1);
    const [error, code] = log.error.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/MAILGUN_API_KEY is not set/);
    expect(code).toBe('mailgun-skipped-not-configured');
  });

  it('marks the skip as distinct from a send failure', async () => {
    // "We never tried" and "we tried and it broke" are different operational
    // facts. Somebody grepping for a broken mail path must not be drowned in
    // expected Dev skips, and vice versa.
    await sendMail(message);

    const code = log.error.mock.calls[0][1];
    expect(code).toMatch(/^mailgun-skipped-/);
    expect(code).not.toBe('mailgun-send-failed');
    expect(code).not.toBe('mailgun-misconfigured');
  });

  it('keeps the skip out of Sentry while still writing it to stdout', async () => {
    // With no Mailgun account this is the expected outcome of EVERY send, so it
    // belongs in the log, not in an alerting channel.
    await sendMail(message);

    expect(log.error.mock.calls[0][3]).toEqual({ skipSentry: true });
  });

  // Ordering guarantee: the config check comes first, so an unconfigured
  // environment always yields exactly one outcome regardless of the payload.
  it('skips before validating, so bad input is still just a skip', async () => {
    await expect(sendMail({ to: 'nonsense', subject: '', text: '' })).resolves.toEqual({
      sent: false,
      reason: 'not-configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // One line, and the skip one - not the invalid-recipient/content errors,
    // which are never reached.
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][1]).toBe('mailgun-skipped-not-configured');
  });

  it('is safe to fire-and-forget with no arguments at all', async () => {
    await expect(sendMail()).resolves.toEqual({ sent: false, reason: 'not-configured' });
  });
});

describe('sendMail() when the key is set but the domain is missing', () => {
  beforeEach(() => {
    configure({ MAILGUN_DOMAIN: null });
  });

  it('resolves as misconfigured without calling Mailgun', async () => {
    const result = await sendMail(message);
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('misconfigured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Unlike "no key at all", a half-configured deployment IS an operational
  // problem somebody has to see.
  it('logs it loudly', async () => {
    await sendMail(message);
    expect(log.error).toHaveBeenCalledWith(
      expect.any(Error),
      'mailgun-misconfigured',
      expect.anything()
    );
  });
});

describe('sendMail() when configured and the send succeeds', () => {
  beforeEach(() => {
    configure();
  });

  it('resolves sent with the Mailgun message id', async () => {
    await expect(sendMail(message)).resolves.toEqual({
      sent: true,
      id: '<20260801.1@mg.cocloset.com>',
    });
  });

  it('POSTs to the domain-scoped messages endpoint with Basic auth', async () => {
    await sendMail(message);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.mailgun.net/v3/mg.cocloset.com/messages');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe(
      `Basic ${Buffer.from('api:key-test-abc123').toString('base64')}`
    );
  });

  it('sends from, to, subject and both bodies as form fields', async () => {
    await sendMail(message);

    const body = fetchMock.mock.calls[0][1].body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body.get('from')).toBe('Cocloset <no-reply@mg.cocloset.com>');
    expect(body.getAll('to')).toEqual(['studio@pigalle.example.com']);
    expect(body.get('subject')).toBe('Cocloset: pickup scheduled');
    expect(body.get('text')).toBe('Please have the garment ready.');
    expect(body.get('html')).toBe('<p>Please have the garment ready.</p>');
  });

  it('repeats the `to` field for multiple recipients', async () => {
    await sendMail({ ...message, to: ['a@example.com', 'Studio B <b@example.com>'] });

    expect(fetchMock.mock.calls[0][1].body.getAll('to')).toEqual([
      'a@example.com',
      'Studio B <b@example.com>',
    ]);
  });

  it('falls back to no-reply@<domain> when MAILGUN_FROM_EMAIL is unset', async () => {
    configure({ MAILGUN_FROM_EMAIL: null });
    await sendMail(message);
    expect(fetchMock.mock.calls[0][1].body.get('from')).toBe('no-reply@mg.cocloset.com');
  });

  it('lets an explicit `from` override the env default', async () => {
    await sendMail({ ...message, from: 'Ops <ops@mg.cocloset.com>' });
    expect(fetchMock.mock.calls[0][1].body.get('from')).toBe('Ops <ops@mg.cocloset.com>');
  });

  it('omits a body field that was not supplied', async () => {
    await sendMail({ to: message.to, subject: message.subject, text: 'text only' });
    const body = fetchMock.mock.calls[0][1].body;
    expect(body.get('text')).toBe('text only');
    expect(body.get('html')).toBeNull();
  });

  // EU-hosted Mailgun domains must be sent through api.eu.mailgun.net.
  it('honours MAILGUN_API_BASE_URL for the EU region', async () => {
    configure({ MAILGUN_API_BASE_URL: 'https://api.eu.mailgun.net' });
    await sendMail(message);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.eu.mailgun.net/v3/mg.cocloset.com/messages'
    );
  });

  it('resolves sent even when Mailgun returns no id', async () => {
    fetchMock.mockImplementation(() => okResponse({ message: 'Queued. Thank you.' }));
    await expect(sendMail(message)).resolves.toEqual({ sent: true, id: null });
  });

  it('resolves sent even when the success body is not JSON', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('not json')),
        text: () => Promise.resolve('ok'),
      })
    );
    await expect(sendMail(message)).resolves.toEqual({ sent: true, id: null });
  });

  it('logs nothing on the happy path', async () => {
    await sendMail(message);
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe('sendMail() when configured and the send fails', () => {
  beforeEach(() => {
    configure();
  });

  it('resolves (does NOT reject) on a non-2xx response and reports the error', async () => {
    fetchMock.mockImplementation(() => errorResponse(400));

    const result = await sendMail(message);

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('error');
    expect(result.status).toBe(400);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toMatch(/HTTP 400/);
  });

  it('logs a non-2xx loudly, with the status and the response body', async () => {
    fetchMock.mockImplementation(() => errorResponse(401, 'Forbidden'));

    await sendMail(message);

    expect(log.error).toHaveBeenCalledTimes(1);
    const [error, code, data] = log.error.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(code).toBe('mailgun-send-failed');
    expect(data.status).toBe(401);
    expect(data.body).toBe('Forbidden');
    expect(data.recipients).toEqual(['studio@pigalle.example.com']);
  });

  // The API key must never reach stdout or Sentry.
  it('never logs the API key', async () => {
    fetchMock.mockImplementation(() => errorResponse(401, 'Forbidden'));
    await sendMail(message);
    expect(JSON.stringify(log.error.mock.calls[0])).not.toContain('key-test-abc123');
  });

  it('resolves when fetch itself rejects (network/DNS/timeout)', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('ECONNREFUSED')));

    const result = await sendMail(message);

    expect(result).toEqual({
      sent: false,
      reason: 'error',
      error: expect.any(Error),
    });
    expect(result.error.message).toBe('ECONNREFUSED');
    expect(log.error).toHaveBeenCalledWith(expect.any(Error), 'mailgun-send-failed', {
      subject: message.subject,
    });
  });

  it('resolves when reading the failure body itself throws', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('stream closed')),
      })
    );

    const result = await sendMail(message);
    expect(result.sent).toBe(false);
    expect(result.status).toBe(500);
  });
});

describe('sendMail() input validation (configured)', () => {
  beforeEach(() => {
    configure();
  });

  it('refuses a malformed recipient without calling Mailgun', async () => {
    const result = await sendMail({ ...message, to: 'not-an-email' });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('invalid-recipient');
    expect(result.invalid).toEqual(['not-an-email']);
    expect(result.error).toBeInstanceOf(Error);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a missing recipient', async () => {
    await Promise.all(
      [undefined, null, '', [], 42].map(async to => {
        const result = await sendMail({ ...message, to });
        expect(result.reason).toBe('invalid-recipient');
      })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // All-or-nothing: silently dropping one recipient of a two-recipient
  // notification is a worse failure than not sending.
  it('refuses the whole send when only one address of several is malformed', async () => {
    const result = await sendMail({ ...message, to: ['good@example.com', 'bad'] });

    expect(result.reason).toBe('invalid-recipient');
    expect(result.invalid).toEqual(['bad']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs a malformed recipient - it is a caller bug worth seeing', async () => {
    await sendMail({ ...message, to: 'not-an-email' });
    expect(log.error).toHaveBeenCalledWith(expect.any(Error), 'mailgun-invalid-recipient', {
      invalid: ['not-an-email'],
    });
  });

  it('refuses a message with no subject', async () => {
    const result = await sendMail({ ...message, subject: '   ' });
    expect(result.reason).toBe('invalid-content');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a message with neither text nor html', async () => {
    const result = await sendMail({ to: message.to, subject: 'Hello' });
    expect(result.reason).toBe('invalid-content');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
