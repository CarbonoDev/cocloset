jest.mock('../api-util/sdk', () => ({
  handleError: jest.fn(),
  serialize: jest.fn(data => JSON.stringify(data)),
  typeHandlers: [],
}));

jest.mock('../api-util/laundryPartnerApplication', () => ({
  validateApplication: jest.fn(),
  deliverApplication: jest.fn(),
}));

const fs = require('fs');
const path = require('path');

const {
  validateApplication,
  deliverApplication,
} = require('../api-util/laundryPartnerApplication');
const sdkUtil = require('../api-util/sdk');

const laundryPartnerApplication = require('./laundry-partner-application');

const { MAX_PER_IP_PER_WINDOW } = laundryPartnerApplication;

const mockRes = () => ({
  status: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  send: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
  end: jest.fn().mockReturnThis(),
});

const application = { studioName: 'Spin Cycle', turnaroundHours: 24 };

// The handler owns a module-level rate limiter, so each test needs a distinct IP.
let ipCounter = 0;
const nextIp = () => {
  ipCounter = ipCounter + 1;
  return `10.0.0.${ipCounter}`;
};

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('laundry-partner-application', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    validateApplication.mockReturnValue({ valid: true, application });
    deliverApplication.mockResolvedValue({ loggedToStdout: true });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('accepts a valid application and delivers it', async () => {
    const res = mockRes();
    laundryPartnerApplication({ ip: nextIp(), body: { studioName: 'Spin Cycle' } }, res);
    await flush();

    expect(deliverApplication).toHaveBeenCalledWith(application);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ data: { status: 'received' } });
  });

  it('does not echo the submitted values back to the caller', async () => {
    const res = mockRes();
    laundryPartnerApplication({ ip: nextIp(), body: { studioName: 'Spin Cycle' } }, res);
    await flush();

    expect(JSON.stringify(res.send.mock.calls[0][0])).not.toContain('Spin Cycle');
  });

  it('returns 400 with the validation message when the body is invalid', async () => {
    validateApplication.mockReturnValue({ valid: false, error: 'Missing required "email".' });
    const res = mockRes();

    laundryPartnerApplication({ ip: nextIp(), body: {} }, res);
    await flush();

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing required "email".' });
    expect(deliverApplication).not.toHaveBeenCalled();
  });

  it('silently drops honeypot submissions but reports success', async () => {
    validateApplication.mockReturnValue({ valid: true, isSpam: true });
    const res = mockRes();

    laundryPartnerApplication({ ip: nextIp(), body: {} }, res);
    await flush();

    expect(deliverApplication).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ data: { status: 'received' } });
  });

  it('rate limits repeated submissions from the same address', async () => {
    const ip = nextIp();

    for (let i = 0; i < MAX_PER_IP_PER_WINDOW; i++) {
      const okRes = mockRes();
      laundryPartnerApplication({ ip, body: {} }, okRes);
      await flush();
      expect(okRes.status).toHaveBeenCalledWith(200);
    }

    const blockedRes = mockRes();
    laundryPartnerApplication({ ip, body: {} }, blockedRes);
    await flush();

    expect(blockedRes.status).toHaveBeenCalledWith(429);
    expect(blockedRes.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(deliverApplication).toHaveBeenCalledTimes(MAX_PER_IP_PER_WINDOW);
  });

  it('forwards unexpected delivery failures to handleError', async () => {
    const error = new Error('boom');
    deliverApplication.mockRejectedValue(error);
    const res = mockRes();

    laundryPartnerApplication({ ip: nextIp(), body: {} }, res);
    await flush();

    expect(sdkUtil.handleError).toHaveBeenCalledWith(res, error);
  });

  // Regression guard: an unauthenticated endpoint must never get hold of a
  // marketplace SDK, and above all not the full-admin Integration API client.
  it.each(['getIntegrationSdk', 'getTrustedSdk', 'getSdk'])(
    'never references %s',
    sdkFactoryName => {
      const source = fs.readFileSync(
        path.join(__dirname, 'laundry-partner-application.js'),
        'utf8'
      );
      // Strip block comments so the explanatory header does not trip the check.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '');

      expect(code).not.toContain(sdkFactoryName);
    }
  );
});
