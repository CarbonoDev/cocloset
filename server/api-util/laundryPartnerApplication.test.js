const {
  validateApplication,
  deliverApplication,
  MAX_TURNAROUND_HOURS,
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
  turnaroundHours: '48',
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
      turnaroundHours: 48,
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

  it.each([['0'], ['-1'], ['1.5'], ['abc'], [String(MAX_TURNAROUND_HOURS + 1)]])(
    'rejects turnaroundHours of %s',
    value => {
      const result = validateApplication({ ...validBody(), turnaroundHours: value });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('turnaroundHours');
    }
  );

  it('accepts a numeric turnaroundHours', () => {
    const result = validateApplication({ ...validBody(), turnaroundHours: 24 });

    expect(result.valid).toBe(true);
    expect(result.application.turnaroundHours).toBe(24);
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
  const application = { studioName: 'Spin Cycle', turnaroundHours: 24 };
  let logSpy;
  let warnSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_WEBHOOK_URL;
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
