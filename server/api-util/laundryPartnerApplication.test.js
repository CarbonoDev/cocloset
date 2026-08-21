const {
  validateApplication,
  deliverApplication,
  MAX_TURNAROUND_DAYS,
  MAX_CATEGORIES,
} = require('./laundryPartnerApplication');

const log = require('../log');

jest.mock('../log', () => ({ error: jest.fn() }));

const validBody = () => ({
  studioName: 'Lavandería Central',
  contactName: 'Ana Ruiz',
  email: 'ana@lavanderiacentral.example',
  phone: '+34 600 111 222',
  address: 'Calle Mayor 1, Madrid',
  businessHours: 'Mon-Fri 9:00-19:00',
  acceptedCategories: 'Dresses, Coats , Suits',
  turnaroundDays: '2',
  notes: 'We have 40m2 of hanging storage.',
});

describe('validateApplication', () => {
  it('accepts a complete application and normalizes it', () => {
    const result = validateApplication(validBody());

    expect(result.valid).toBe(true);
    expect(result.isSpam).toBeUndefined();
    expect(result.application).toEqual({
      studioName: 'Lavandería Central',
      contactName: 'Ana Ruiz',
      email: 'ana@lavanderiacentral.example',
      phone: '+34 600 111 222',
      address: 'Calle Mayor 1, Madrid',
      businessHours: 'Mon-Fri 9:00-19:00',
      acceptedCategories: ['Dresses', 'Coats', 'Suits'],
      turnaroundDays: 2,
      notes: 'We have 40m2 of hanging storage.',
    });
  });

  it('treats notes as optional', () => {
    const { notes, ...withoutNotes } = validBody();
    const result = validateApplication(withoutNotes);

    expect(result.valid).toBe(true);
    expect(result.application.notes).toBeUndefined();
  });

  it('trims whitespace from string fields', () => {
    const result = validateApplication({ ...validBody(), studioName: '  Spin Cycle  ' });

    expect(result.application.studioName).toBe('Spin Cycle');
  });

  it('drops unknown keys instead of passing them through', () => {
    const result = validateApplication({
      ...validBody(),
      isAdmin: 'true',
      metadata: { isLaundry: true },
    });

    expect(result.valid).toBe(true);
    expect(result.application.isAdmin).toBeUndefined();
    expect(result.application.metadata).toBeUndefined();
  });

  it.each([
    'studioName',
    'contactName',
    'email',
    'phone',
    'address',
    'businessHours',
    'acceptedCategories',
  ])('rejects a missing %s', field => {
    const body = validBody();
    delete body[field];

    const result = validateApplication(body);

    expect(result.valid).toBe(false);
    expect(result.error).toContain(field);
  });

  it('rejects a whitespace-only required field', () => {
    const result = validateApplication({ ...validBody(), studioName: '   ' });

    expect(result.valid).toBe(false);
  });

  it('rejects non-string values for string fields', () => {
    const result = validateApplication({ ...validBody(), studioName: { $ne: null } });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('expected a string');
  });

  it('rejects an over-long field', () => {
    const result = validateApplication({ ...validBody(), studioName: 'a'.repeat(121) });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('max length is 120');
  });

  it('rejects over-long notes', () => {
    const result = validateApplication({ ...validBody(), notes: 'a'.repeat(2001) });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('notes');
  });

  it('rejects a malformed email', () => {
    const result = validateApplication({ ...validBody(), email: 'not-an-email' });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('email');
  });

  it('rejects a phone number with unexpected characters', () => {
    const result = validateApplication({ ...validBody(), phone: '<script>alert(1)</script>' });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('phone');
  });

  it.each([['0'], ['-1'], ['1.5'], ['abc'], [String(MAX_TURNAROUND_DAYS + 1)]])(
    'rejects turnaroundDays of %s',
    value => {
      const result = validateApplication({ ...validBody(), turnaroundDays: value });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('turnaroundDays');
    }
  );

  it('rejects an hours-shaped value that is out of range as days', () => {
    // A 48 typed into a form that used to ask for hours is now 48 DAYS, which is past
    // the cap. Silently accepting it would block a studio's calendar for seven weeks.
    const result = validateApplication({ ...validBody(), turnaroundDays: 48 });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('turnaroundDays');
  });

  it('accepts a numeric turnaroundDays', () => {
    const result = validateApplication({ ...validBody(), turnaroundDays: 3 });

    expect(result.valid).toBe(true);
    expect(result.application.turnaroundDays).toBe(3);
  });

  it('rejects too many garment categories', () => {
    const acceptedCategories = Array.from({ length: MAX_CATEGORIES + 1 }, (_, i) => `c${i}`).join(
      ','
    );
    const result = validateApplication({ ...validBody(), acceptedCategories });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('acceptedCategories');
  });

  it('rejects an over-long single category', () => {
    const result = validateApplication({
      ...validBody(),
      acceptedCategories: `Dresses, ${'x'.repeat(61)}`,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('60 characters');
  });

  it('rejects categories that are only separators', () => {
    const result = validateApplication({ ...validBody(), acceptedCategories: ' , , ' });

    expect(result.valid).toBe(false);
  });

  it('flags a filled honeypot as spam without surfacing an error', () => {
    const result = validateApplication({ ...validBody(), website: 'http://spam.example' });

    expect(result.valid).toBe(true);
    expect(result.isSpam).toBe(true);
    expect(result.application).toBeUndefined();
  });

  it('ignores an empty honeypot', () => {
    const result = validateApplication({ ...validBody(), website: '' });

    expect(result.valid).toBe(true);
    expect(result.isSpam).toBeUndefined();
  });

  it('rejects an undefined body', () => {
    expect(validateApplication(undefined).valid).toBe(false);
  });
});

describe('deliverApplication', () => {
  const application = { studioName: 'Spin Cycle', turnaroundDays: 2 };
  let logSpy;
  let warnSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_WEBHOOK_URL;
    delete process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_EMAIL;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    delete global.fetch;
  });

  it('always writes a structured stdout record', async () => {
    const result = await deliverApplication(application);

    expect(result.loggedToStdout).toBe(true);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [line] = logSpy.mock.calls[0];
    expect(line).toContain('[laundry-partner-application]');
    const record = JSON.parse(line.replace('[laundry-partner-application] ', ''));
    expect(record.application).toEqual(application);
    expect(typeof record.receivedAt).toBe('string');
  });

  it('warns loudly and skips the webhook when none is configured', async () => {
    const result = await deliverApplication(application);

    expect(result.webhookConfigured).toBe(false);
    expect(result.webhookDelivered).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POSTs the record to the configured webhook', async () => {
    process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_WEBHOOK_URL = 'https://hooks.example/abc';
    global.fetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await deliverApplication(application);

    expect(result.webhookDelivered).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://hooks.example/abc');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body).application).toEqual(application);
  });

  it('escalates to log.error when the webhook rejects the request', async () => {
    process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_WEBHOOK_URL = 'https://hooks.example/abc';
    global.fetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await deliverApplication(application);

    expect(result.webhookDelivered).toBe(false);
    expect(log.error).toHaveBeenCalledWith(
      expect.any(Error),
      'laundry-partner-application-delivery-failed',
      expect.objectContaining({ record: expect.objectContaining({ application }) })
    );
  });

  it('escalates to log.error when the webhook call throws', async () => {
    process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_WEBHOOK_URL = 'https://hooks.example/abc';
    global.fetch.mockRejectedValue(new Error('network down'));

    const result = await deliverApplication(application);

    expect(result.webhookDelivered).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });
});

describe('deliverApplication — email sink', () => {
  const application = {
    studioName: 'Studio Pigalle',
    contactName: 'Ana Rivera',
    email: 'ana@example.com',
    acceptedCategories: ['Eveningwear', 'Silk'],
    turnaroundDays: 2,
  };
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
    delete process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_WEBHOOK_URL;
    delete process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_EMAIL;
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
    process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_EMAIL = 'partners@example.com';
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: '<msg@mg.test>' }),
    });

    const result = await deliverApplication(application);

    expect(result.emailConfigured).toBe(true);
    expect(result.emailDelivered).toBe(true);

    const [, options] = global.fetch.mock.calls[0];
    const params = new URLSearchParams(options.body.toString());
    expect(params.get('to')).toEqual('partners@example.com');
    expect(params.get('subject')).toContain('Studio Pigalle');
    expect(params.get('text')).toContain('Contact name: Ana Rivera');
    // Arrays render as a readable list rather than "[object Object]" or raw JSON.
    expect(params.get('text')).toContain('Garments accepted: Eveningwear, Silk');
  });

  // The operator reads these side by side, one application against the next, so the HTML part
  // is a two-column table rather than the bullet list it started as. Asserted field by field
  // against every key of a FULL application: the failure this guards is not "the table is
  // missing" but "a field was added to the form and never reached the email", which a check on
  // the markup alone would sail straight past.
  it('renders every submitted field as a row of an HTML table', async () => {
    mailgunEnv();
    process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_EMAIL = 'partners@example.com';
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: '<msg@mg.test>' }),
    });

    const full = {
      studioName: 'Studio Pigalle',
      contactName: 'Ana Rivera',
      email: 'ana@example.com',
      phone: '+52 55 1234 5678',
      address: 'Calle Rivera 12, CDMX',
      businessHours: 'Mon-Fri 9:00-19:00',
      acceptedCategories: ['Eveningwear', 'Silk'],
      turnaroundDays: 2,
      notes: 'We already handle bridal.',
    };

    await deliverApplication(full);

    const html = new URLSearchParams(global.fetch.mock.calls[0][1].body.toString()).get('html');

    expect(html).toContain('<table');
    expect(html).not.toContain('<ul>');

    const expectedRows = [
      ['Studio name', 'Studio Pigalle'],
      ['Contact name', 'Ana Rivera'],
      ['Email', 'ana@example.com'],
      ['Phone', '+52 55 1234 5678'],
      ['Address', 'Calle Rivera 12, CDMX'],
      ['Business hours', 'Mon-Fri 9:00-19:00'],
      // Arrays render as a readable list rather than "[object Object]" or raw JSON.
      ['Garments accepted', 'Eveningwear, Silk'],
      ['Turnaround (days)', '2'],
      ['Notes', 'We already handle bridal.'],
    ];

    expectedRows.forEach(([label, value]) => {
      expect(html).toContain(`>${label}</th>`);
      expect(html).toContain(`>${value}</td>`);
    });

    // Every key of the application is accounted for above — no field reaches the operator's
    // inbox only in the plain-text part.
    expect(expectedRows).toHaveLength(Object.keys(full).length);
  });

  // An application that skipped the optional field must not leave an empty row behind.
  it('omits rows for fields the applicant left blank', async () => {
    mailgunEnv();
    process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_EMAIL = 'partners@example.com';
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: '<msg@mg.test>' }),
    });

    await deliverApplication(application);

    const html = new URLSearchParams(global.fetch.mock.calls[0][1].body.toString()).get('html');
    expect(html).not.toContain('>Notes</th>');
  });

  it('escapes applicant-supplied values in the HTML part', async () => {
    // The form is public and unauthenticated, so every value is untrusted input landing
    // in an operator's inbox.
    mailgunEnv();
    process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_EMAIL = 'partners@example.com';
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: '<msg@mg.test>' }),
    });

    await deliverApplication({ ...application, notes: '<script>alert(1)</script>' });

    const [, options] = global.fetch.mock.calls[0];
    const html = new URLSearchParams(options.body.toString()).get('html');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('skips email when no recipient is configured, without sending', async () => {
    mailgunEnv();

    const result = await deliverApplication(application);

    expect(result.emailConfigured).toBe(false);
    expect(result.emailDelivered).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not reject when Mailgun itself is unconfigured', async () => {
    // Local dev and CI run without credentials; a missing key must not break a submission.
    process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_EMAIL = 'partners@example.com';

    const result = await deliverApplication(application);

    expect(result.loggedToStdout).toBe(true);
    expect(result.emailDelivered).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('escalates a send failure to the logs and still resolves', async () => {
    mailgunEnv();
    process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_EMAIL = 'partners@example.com';
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('boom'),
    });

    const result = await deliverApplication(application);

    expect(result.emailDelivered).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });

  it('warns only when neither email nor webhook is configured', async () => {
    mailgunEnv();
    process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_EMAIL = 'partners@example.com';
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: '<msg@mg.test>' }),
    });

    await deliverApplication(application);

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
