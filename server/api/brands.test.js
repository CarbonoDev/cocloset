jest.mock('../api-util/sdk', () => ({
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

const { handleError } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const brands = require('./brands');
const { limiter } = brands;

// These drive the HANDLER, not the builder - the builder has its own tests in
// api-util/brandDirectory.test.js.
//
// The distinction is not academic. api/laundry-options.js shipped correct, unit-tested builder
// logic behind a handler that passed `{ users, truncated }` where an array was expected: the
// builder read a non-array as "nothing", so every caller got a valid 200 with an empty list and
// no error anywhere. A test that hands the builder an array can never catch that, because the
// array is the one shape the handler was never going to give it. This endpoint pages listings
// through the identical wrapper shape, so it is the identical trap.

const mockRes = () => ({
  statusCode: null,
  body: null,
  headers: {},
  status: jest.fn(function(code) {
    this.statusCode = code;
    return this;
  }),
  set: jest.fn(function(key, value) {
    if (typeof key === 'string') {
      this.headers[key] = value;
    }
    return this;
  }),
  send: jest.fn(function(body) {
    this.body = body;
    return this;
  }),
  json: jest.fn(function(body) {
    this.body = body;
    return this;
  }),
  end: jest.fn().mockReturnThis(),
});

const listing = (brand, id = 'l1') => ({
  id: { uuid: id },
  attributes: {
    title: 'A garment',
    publicData: { brand, size: 'M', retailValue: 120 },
  },
});

const setupSdk = (listings, { totalPages = 1 } = {}) => {
  const query = jest.fn(({ page = 1 } = {}) =>
    Promise.resolve({
      data: {
        data: page === 1 ? listings : [],
        meta: { totalPages, page },
      },
    })
  );
  getIntegrationSdk.mockReturnValue({ listings: { query } });
  return { query };
};

const run = async (res = mockRes()) => {
  await brands({ ip: '203.0.113.9' }, res);
  await new Promise(setImmediate);
  return res;
};

describe('brands', () => {
  beforeEach(() => {
    limiter.reset();
    handleError.mockImplementation((res, e) => {
      res.status(e?.status || 500);
      res.json({ error: 'error' });
      res.end();
    });
  });

  it('answers with the brands, not with an empty list', async () => {
    // THE REGRESSION api/laundry-options.js already shipped once.
    setupSdk([listing('Reformation', 'l1'), listing('Club Monaco', 'l2')]);

    const res = await run();

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual([
      { brand: 'Club Monaco', count: 1 },
      { brand: 'Reformation', count: 1 },
    ]);
  });

  it('sends nothing but a brand and a count', async () => {
    // The shape IS the security contract: this endpoint is public. The listing fixture carries
    // a size and a retail value, and neither may ride along.
    setupSdk([listing('Reformation')]);

    const res = await run();

    expect(Object.keys(res.body)).toEqual(['data', 'meta']);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['brand', 'count']);
  });

  it('only asks for published listings', async () => {
    // A draft's brand is on nothing a reader can reach, so offering it would build a filter
    // that returns no results.
    const { query } = setupSdk([listing('Reformation')]);

    await run();

    expect(query).toHaveBeenCalledWith(expect.objectContaining({ states: ['published'] }));
  });

  it('says when the walk was cut short', async () => {
    // A truncated brand list is not cosmetic: a missing brand means the next person types their
    // own spelling of it, which is the fragmentation this endpoint exists to prevent.
    setupSdk([listing('Reformation')], { totalPages: 999 });

    const res = await run();

    expect(res.body.meta.truncated).toBe(true);
  });

  it('turns a rate-limited caller away with a Retry-After', async () => {
    setupSdk([listing('Reformation')]);
    for (let i = 0; i < 60; i++) {
      await run();
    }

    const res = await run();

    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toEqual(expect.any(String));
  });

  it('does not let a missing Integration SDK escape as an exception', async () => {
    getIntegrationSdk.mockImplementation(() => {
      throw new Error('SHARETRIBE_INTEGRATION_SDK_CLIENT_ID missing');
    });

    const res = await run();

    expect(handleError).toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
  });
});
