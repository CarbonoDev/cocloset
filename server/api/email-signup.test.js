jest.mock('../api-util/sdk', () => ({
  handleError: jest.fn(),
  serialize: jest.fn(data => JSON.stringify(data)),
  typeHandlers: [],
}));

jest.mock('../api-util/emailSignup', () => ({
  validateSignup: jest.fn(),
  deliverSignup: jest.fn(),
}));

const fs = require('fs');
const path = require('path');

const { validateSignup, deliverSignup } = require('../api-util/emailSignup');
const sdkUtil = require('../api-util/sdk');

const emailSignup = require('./email-signup');

const { MAX_PER_IP_PER_WINDOW } = emailSignup;

const mockRes = () => ({
  status: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  send: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
  end: jest.fn().mockReturnThis(),
});

const signup = { name: 'Jamie Rivera', email: 'jamie@example.com', zipCode: '78701', consent: true };

// The handler owns a module-level rate limiter, so each test needs a distinct IP.
let ipCounter = 0;
const nextIp = () => {
  ipCounter = ipCounter + 1;
  return `10.0.1.${ipCounter}`;
};

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('email-signup', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    validateSignup.mockReturnValue({ valid: true, signup });
    deliverSignup.mockResolvedValue({ loggedToStdout: true });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('accepts a valid signup and delivers it', async () => {
    const res = mockRes();
    emailSignup({ ip: nextIp(), body: { name: 'Jamie Rivera' } }, res);
    await flush();

    expect(deliverSignup).toHaveBeenCalledWith(signup);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ data: { status: 'received' } });
  });

  it('does not echo the submitted values back to the caller', async () => {
    const res = mockRes();
    emailSignup({ ip: nextIp(), body: { name: 'Jamie Rivera' } }, res);
    await flush();

    expect(JSON.stringify(res.send.mock.calls[0][0])).not.toContain('Jamie Rivera');
  });

  it('returns 400 with the validation message when the body is invalid', async () => {
    validateSignup.mockReturnValue({ valid: false, error: 'Missing required "email".' });
    const res = mockRes();

    emailSignup({ ip: nextIp(), body: {} }, res);
    await flush();

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing required "email".' });
    expect(deliverSignup).not.toHaveBeenCalled();
  });

  it('silently drops honeypot submissions but reports success', async () => {
    validateSignup.mockReturnValue({ valid: true, isSpam: true });
    const res = mockRes();

    emailSignup({ ip: nextIp(), body: {} }, res);
    await flush();

    expect(deliverSignup).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ data: { status: 'received' } });
  });

  it('rate limits repeated submissions from the same address', async () => {
    const ip = nextIp();

    for (let i = 0; i < MAX_PER_IP_PER_WINDOW; i++) {
      const okRes = mockRes();
      emailSignup({ ip, body: {} }, okRes);
      await flush();
      expect(okRes.status).toHaveBeenCalledWith(200);
    }

    const blockedRes = mockRes();
    emailSignup({ ip, body: {} }, blockedRes);
    await flush();

    expect(blockedRes.status).toHaveBeenCalledWith(429);
    expect(blockedRes.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(deliverSignup).toHaveBeenCalledTimes(MAX_PER_IP_PER_WINDOW);
  });

  it('forwards unexpected delivery failures to handleError', async () => {
    const error = new Error('boom');
    deliverSignup.mockRejectedValue(error);
    const res = mockRes();

    emailSignup({ ip: nextIp(), body: {} }, res);
    await flush();

    expect(sdkUtil.handleError).toHaveBeenCalledWith(res, error);
  });

  // Regression guard: an unauthenticated endpoint must never get hold of a marketplace SDK,
  // and above all not the full-admin Integration API client.
  it.each(['getIntegrationSdk', 'getTrustedSdk', 'getSdk'])('never references %s', sdkFactoryName => {
    const source = fs.readFileSync(path.join(__dirname, 'email-signup.js'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '');

    expect(code).not.toContain(sdkFactoryName);
  });
});
