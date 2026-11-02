jest.mock('../api-util/sdk', () => ({
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

const { handleError } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const laundryOptions = require('./laundry-options');
const { limiter } = laundryOptions;

// WHY THIS FILE EXISTS, beyond the pure builder's own tests.
//
// `buildLaundryOptions` was unit-tested and correct, and the endpoint still answered every
// caller with an empty list: `fetchAllUsers` resolves to `{ users, truncated }`, and the
// handler passed that wrapper where an array was expected. The builder read a non-array as
// "nothing" - which is right - so the response was a perfectly valid 200 with no laundries in
// it, and the search page simply rendered no filter. No error, nowhere.
//
// A test that hands the builder an array can never catch that, because the array is the one
// shape the handler was never going to give it. So these drive the handler.

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

const laundryUser = (id, studioName) => ({
  id: { uuid: id },
  attributes: {
    profile: {
      metadata: { isLaundry: true },
      publicData: { laundryProfile: { studioName, address: 'somewhere', businessHours: '9-5' } },
      privateData: { turnaroundDays: 2 },
    },
  },
});

// One page of users, in the shape the Integration API returns them.
const setupSdk = (users, { totalPages = 1 } = {}) => {
  const query = jest.fn(() =>
    Promise.resolve({ data: { data: users, meta: { totalPages, page: 1 } } })
  );
  getIntegrationSdk.mockReturnValue({ users: { query } });
  return { query };
};

const run = async (res = mockRes()) => {
  await laundryOptions({ ip: '203.0.113.9' }, res);
  await new Promise(setImmediate);
  return res;
};

describe('laundry-options', () => {
  beforeEach(() => {
    limiter.reset();
    handleError.mockImplementation((res, e) => {
      res.status(e?.status || 500);
      res.json({ error: 'error' });
      res.end();
    });
  });

  it('answers with the studios, not with an empty list', async () => {
    // THE REGRESSION. Everything below it was already true when this returned nothing.
    setupSdk([laundryUser('l1', 'Maison du Marais'), laundryUser('l2', 'Studio Pigalle')]);

    const res = await run();

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      data: [
        { id: 'l1', name: 'Maison du Marais', neighborhood: null },
        { id: 'l2', name: 'Studio Pigalle', neighborhood: null },
      ],
    });
  });

  it('sends nothing but an id, a name and a neighborhood', async () => {
    // The shape IS the security contract: this endpoint is public, and the authenticated
    // directory it sits beside carries addresses, coordinates, hours and a turnaround
    // resolved from privateData.
    //
    // The neighborhood joined that list deliberately on 2026-09-03, to label the search
    // filter. It is a district the studio typed about itself - the granularity a shopper
    // picks a pickup point by - and the street address it sits near is still not sent.
    setupSdk([laundryUser('l1', 'Maison du Marais')]);

    const res = await run();

    expect(Object.keys(res.body.data[0]).sort()).toEqual(['id', 'name', 'neighborhood']);
    expect(JSON.stringify(res.body)).not.toContain('somewhere');
    expect(JSON.stringify(res.body)).not.toContain('turnaround');
  });

  it('serves an anonymous caller', async () => {
    // Deliberately public: the search page is public, so a filter that only worked for
    // logged-in readers would be a filter that mostly does not work.
    setupSdk([laundryUser('l1', 'Maison du Marais')]);
    expect((await run()).statusCode).toBe(200);
  });

  it('pages through the users rather than reading only the first page', async () => {
    const { query } = setupSdk([laundryUser('l1', 'Maison du Marais')], { totalPages: 2 });
    await run();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('forwards a failed read through handleError instead of claiming there are none', async () => {
    getIntegrationSdk.mockReturnValue({
      users: { query: () => Promise.reject(Object.assign(new Error('nope'), { status: 503 })) },
    });

    const res = await run();

    expect(res.statusCode).toBe(503);
  });

  it('does not throw when the Integration API client cannot be built', async () => {
    // getIntegrationSdk throws on missing env vars, synchronously. An escaping throw here
    // would take down the request rather than answering it.
    getIntegrationSdk.mockImplementation(() => {
      throw Object.assign(new Error('Missing env vars'), { status: 500 });
    });

    const res = await run();

    expect(res.statusCode).toBe(500);
  });

  it('429s a caller that exceeds its budget', async () => {
    // Public AND backed by a walk of the whole user list - the expensive half of the
    // combination api/laundries.js avoided by requiring a session.
    setupSdk([laundryUser('l1', 'Maison du Marais')]);
    let res = null;
    for (let i = 0; i < 61; i += 1) {
      res = await run();
    }
    expect(res.statusCode).toBe(429);
    expect(Number.parseInt(res.headers['Retry-After'], 10)).toBeGreaterThan(0);
  });
});
