const { validateSignup, deliverSignup, HONEYPOT_FIELD } = require('./emailSignup');

const log = require('../log');

jest.mock('../log', () => ({ error: jest.fn() }));

const validBody = () => ({
  name: 'Jamie Rivera',
  email: 'jamie@example.com',
  zipCode: '78701',
  consent: true,
});

describe('validateSignup', () => {
  it('accepts a complete signup and normalizes it', () => {
    const result = validateSignup(validBody());

    expect(result.valid).toBe(true);
    expect(result.isSpam).toBeUndefined();
    expect(result.signup).toEqual({
      name: 'Jamie Rivera',
      email: 'jamie@example.com',
      zipCode: '78701',
      consent: true,
    });
  });

  it('trims whitespace from string fields', () => {
    const result = validateSignup({ ...validBody(), name: '  Jamie Rivera  ' });

    expect(result.application).toBeUndefined();
    expect(result.signup.name).toBe('Jamie Rivera');
  });

  it('drops unknown keys instead of passing them through', () => {
    const result = validateSignup({ ...validBody(), isAdmin: 'true', metadata: { x: 1 } });

    expect(result.valid).toBe(true);
    expect(result.signup.isAdmin).toBeUndefined();
    expect(result.signup.metadata).toBeUndefined();
  });

  it.each(['name', 'email', 'zipCode'])('rejects a missing %s', field => {
    const body = validBody();
    delete body[field];

    const result = validateSignup(body);

    expect(result.valid).toBe(false);
    expect(result.error).toContain(field);
  });

  it('rejects a whitespace-only required field', () => {
    const result = validateSignup({ ...validBody(), name: '   ' });
    expect(result.valid).toBe(false);
  });

  it('rejects non-string values for string fields', () => {
    const result = validateSignup({ ...validBody(), name: { $ne: null } });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('expected a string');
  });

  it('rejects an over-long name', () => {
    const result = validateSignup({ ...validBody(), name: 'a'.repeat(121) });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('max length is 120');
  });

  it('rejects a malformed email', () => {
    const result = validateSignup({ ...validBody(), email: 'not-an-email' });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('email');
  });

  it('rejects a zip code with unexpected characters', () => {
    const result = validateSignup({ ...validBody(), zipCode: '<script>' });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('zipCode');
  });

  it('accepts a ZIP+4 style zip code', () => {
    const result = validateSignup({ ...validBody(), zipCode: '78701-1234' });

    expect(result.valid).toBe(true);
    expect(result.signup.zipCode).toBe('78701-1234');
  });

  it('rejects an over-long zip code', () => {
    const result = validateSignup({ ...validBody(), zipCode: '1'.repeat(13) });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('zipCode');
  });

  it('rejects a missing consent', () => {
    const { consent, ...withoutConsent } = validBody();
    const result = validateSignup(withoutConsent);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('consent');
  });

  it('rejects a falsy consent', () => {
    const result = validateSignup({ ...validBody(), consent: false });
    expect(result.valid).toBe(false);
  });

  it('rejects a truthy-but-not-boolean consent, since a typo is not opt-in', () => {
    const result = validateSignup({ ...validBody(), consent: 'true' });
    expect(result.valid).toBe(false);
  });

  it('flags a filled honeypot as spam without surfacing an error', () => {
    const result = validateSignup({ ...validBody(), [HONEYPOT_FIELD]: 'http://spam.example' });

    expect(result.valid).toBe(true);
    expect(result.isSpam).toBe(true);
    expect(result.signup).toBeUndefined();
  });

  it('ignores an empty honeypot', () => {
    const result = validateSignup({ ...validBody(), [HONEYPOT_FIELD]: '' });

    expect(result.valid).toBe(true);
    expect(result.isSpam).toBeUndefined();
  });

  it('rejects an undefined body', () => {
    expect(validateSignup(undefined).valid).toBe(false);
  });
});

describe('deliverSignup', () => {
  const signup = { name: 'Jamie Rivera', email: 'jamie@example.com', zipCode: '78701', consent: true };
  let logSpy;
  let warnSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.SERVER_EMAIL_SIGNUP_WEBHOOK_URL;
    delete process.env.SERVER_EMAIL_SIGNUP_EMAIL;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    delete global.fetch;
  });

  it('always writes a structured stdout record', async () => {
    const result = await deliverSignup(signup);

    expect(result.loggedToStdout).toBe(true);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [line] = logSpy.mock.calls[0];
    expect(line).toContain('[email-signup]');
    const record = JSON.parse(line.replace('[email-signup] ', ''));
    expect(record.signup).toEqual(signup);
    expect(typeof record.receivedAt).toBe('string');
  });

  it('warns loudly and skips the webhook when none is configured', async () => {
    const result = await deliverSignup(signup);

    expect(result.webhookConfigured).toBe(false);
    expect(result.webhookDelivered).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POSTs the record to the configured webhook', async () => {
    process.env.SERVER_EMAIL_SIGNUP_WEBHOOK_URL = 'https://hooks.example/signup';
    global.fetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await deliverSignup(signup);

    expect(result.webhookDelivered).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://hooks.example/signup');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body).signup).toEqual(signup);
  });

  it('escalates to log.error when the webhook rejects the request', async () => {
    process.env.SERVER_EMAIL_SIGNUP_WEBHOOK_URL = 'https://hooks.example/signup';
    global.fetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await deliverSignup(signup);

    expect(result.webhookDelivered).toBe(false);
    expect(log.error).toHaveBeenCalledWith(
      expect.any(Error),
      'email-signup-delivery-failed',
      expect.objectContaining({ record: expect.objectContaining({ signup }) })
    );
  });

  it('escalates to log.error when the webhook call throws', async () => {
    process.env.SERVER_EMAIL_SIGNUP_WEBHOOK_URL = 'https://hooks.example/signup';
    global.fetch.mockRejectedValue(new Error('network down'));

    const result = await deliverSignup(signup);

    expect(result.webhookDelivered).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });
});

describe('deliverSignup — email sink', () => {
  const signup = { name: 'Jamie Rivera', email: 'jamie@example.com', zipCode: '78701', consent: true };
  let logSpy;
  let warnSpy;

  const mailgunEnv = () => {
    process.env.MAILGUN_API_KEY = 'key-test';
    process.env.MAILGUN_DOMAIN = 'mg.test';
    process.env.MAILGUN_FROM_EMAIL = 'Cocloset <no-reply@mg.test>';
  };

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.SERVER_EMAIL_SIGNUP_WEBHOOK_URL;
    delete process.env.SERVER_EMAIL_SIGNUP_EMAIL;
    delete process.env.MAILGUN_API_KEY;
    delete process.env.MAILGUN_DOMAIN;
    delete process.env.MAILGUN_FROM_EMAIL;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    delete global.fetch;
  });

  it('emails the configured operator address', async () => {
    mailgunEnv();
    process.env.SERVER_EMAIL_SIGNUP_EMAIL = 'growth@example.com';
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: '<msg@mg.test>' }),
    });

    const result = await deliverSignup(signup);

    expect(result.emailConfigured).toBe(true);
    expect(result.emailDelivered).toBe(true);

    const [, options] = global.fetch.mock.calls[0];
    const params = new URLSearchParams(options.body.toString());
    expect(params.get('to')).toEqual('growth@example.com');
    expect(params.get('subject')).toContain('Jamie Rivera');
    expect(params.get('text')).toContain('Email: jamie@example.com');
    expect(params.get('text')).toContain('Zip code: 78701');
  });

  it('renders every submitted field as a row of an HTML table', async () => {
    mailgunEnv();
    process.env.SERVER_EMAIL_SIGNUP_EMAIL = 'growth@example.com';
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: '<msg@mg.test>' }),
    });

    await deliverSignup(signup);

    const html = new URLSearchParams(global.fetch.mock.calls[0][1].body.toString()).get('html');

    expect(html).toContain('<table');
    expect(html).toContain('>Name</th>');
    expect(html).toContain('>Jamie Rivera</td>');
    expect(html).toContain('>Email</th>');
    expect(html).toContain('>Zip code</th>');
    expect(html).toContain('>78701</td>');
  });

  it('escapes applicant-supplied values in the HTML part', async () => {
    mailgunEnv();
    process.env.SERVER_EMAIL_SIGNUP_EMAIL = 'growth@example.com';
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: '<msg@mg.test>' }),
    });

    await deliverSignup({ ...signup, name: '<script>alert(1)</script>' });

    const [, options] = global.fetch.mock.calls[0];
    const html = new URLSearchParams(options.body.toString()).get('html');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('skips email when no recipient is configured, without sending', async () => {
    mailgunEnv();

    const result = await deliverSignup(signup);

    expect(result.emailConfigured).toBe(false);
    expect(result.emailDelivered).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not reject when Mailgun itself is unconfigured', async () => {
    process.env.SERVER_EMAIL_SIGNUP_EMAIL = 'growth@example.com';

    const result = await deliverSignup(signup);

    expect(result.loggedToStdout).toBe(true);
    expect(result.emailDelivered).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('escalates a send failure to the logs and still resolves', async () => {
    mailgunEnv();
    process.env.SERVER_EMAIL_SIGNUP_EMAIL = 'growth@example.com';
    global.fetch.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('boom') });

    const result = await deliverSignup(signup);

    expect(result.emailDelivered).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });
});
