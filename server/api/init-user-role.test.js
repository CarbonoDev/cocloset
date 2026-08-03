jest.mock('../api-util/sdk', () => ({
  getSdk: jest.fn(),
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../log', () => ({ error: jest.fn() }));

const { getSdk, handleError } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const initUserRole = require('./init-user-role');

const CALLER_ID = 'caller-user-id';
const OTHER_ID = 'someone-elses-user-id';

const mockRes = () => ({
  statusCode: null,
  body: null,
  status: jest.fn(function(code) {
    this.statusCode = code;
    return this;
  }),
  set: jest.fn().mockReturnThis(),
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

// The caller's own cookie-scoped Marketplace SDK: this is the ONLY place the
// handler is allowed to learn who it is acting on.
const mockCallerSdk = (userId = CALLER_ID, { authFails = false } = {}) => ({
  currentUser: {
    show: jest.fn(() =>
      authFails
        ? Promise.reject(new Error('401 unauthorized'))
        : Promise.resolve({ data: { data: { id: { uuid: userId } } } })
    ),
  },
});

const mockIntegrationSdk = existingMetadata => ({
  users: {
    show: jest.fn(() =>
      Promise.resolve({
        data: {
          data: {
            id: { uuid: CALLER_ID },
            attributes: { profile: { metadata: existingMetadata } },
          },
        },
      })
    ),
    updateProfile: jest.fn(params =>
      Promise.resolve({
        data: {
          data: {
            id: { uuid: CALLER_ID },
            attributes: {
              profile: { metadata: { ...existingMetadata, ...params.metadata } },
            },
          },
        },
      })
    ),
  },
});

// The handler is promise-based with no callback; flush the microtask queue.
const flush = () => new Promise(resolve => setImmediate(resolve));

describe('POST /api/init-user-role', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes isLaundry = false for a user who does not have the key', () => {
    const integrationSdk = mockIntegrationSdk({});
    getSdk.mockReturnValue(mockCallerSdk());
    getIntegrationSdk.mockReturnValue(integrationSdk);

    const res = mockRes();
    initUserRole({ body: {} }, res);

    return flush().then(() => {
      expect(integrationSdk.users.updateProfile).toHaveBeenCalledTimes(1);
      expect(integrationSdk.users.updateProfile.mock.calls[0][0]).toEqual({
        id: CALLER_ID,
        metadata: { isLaundry: false },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        data: { userId: CALLER_ID, isLaundry: false, updated: true, reason: 'defaulted' },
      });
    });
  });

  // The single most important property: an admin-promoted laundry must survive
  // this endpoint untouched, however often it is called.
  it('does NOT demote a user who is already isLaundry = true', () => {
    const integrationSdk = mockIntegrationSdk({ isLaundry: true });
    getSdk.mockReturnValue(mockCallerSdk());
    getIntegrationSdk.mockReturnValue(integrationSdk);

    const res = mockRes();
    initUserRole({ body: {} }, res);

    return flush().then(() => {
      expect(integrationSdk.users.updateProfile).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        data: { userId: CALLER_ID, isLaundry: true, updated: false, reason: 'already-set' },
      });
    });
  });

  it('is idempotent: a second call on an already-defaulted user writes nothing', () => {
    const integrationSdk = mockIntegrationSdk({ isLaundry: false });
    getSdk.mockReturnValue(mockCallerSdk());
    getIntegrationSdk.mockReturnValue(integrationSdk);

    const res = mockRes();
    initUserRole({ body: {} }, res);

    return flush().then(() => {
      expect(integrationSdk.users.updateProfile).not.toHaveBeenCalled();
      expect(res.body.data.updated).toBe(false);
    });
  });

  // The escalation case: the endpoint holds admin credentials, so it must be
  // impossible to point it at another user or at another value.
  it('ignores a user id supplied in the request body and acts only on the caller', () => {
    const integrationSdk = mockIntegrationSdk({});
    getSdk.mockReturnValue(mockCallerSdk());
    getIntegrationSdk.mockReturnValue(integrationSdk);

    const res = mockRes();
    initUserRole({ body: { userId: OTHER_ID, id: OTHER_ID, isLaundry: true } }, res);

    return flush().then(() => {
      expect(integrationSdk.users.show.mock.calls[0][0]).toEqual({ id: CALLER_ID });
      const update = integrationSdk.users.updateProfile.mock.calls[0][0];
      expect(update.id).toBe(CALLER_ID);
      expect(update.id).not.toBe(OTHER_ID);
      expect(update.metadata).toEqual({ isLaundry: false });
    });
  });

  it('never writes isLaundry = true, or any metadata key other than isLaundry', () => {
    const integrationSdk = mockIntegrationSdk({});
    getSdk.mockReturnValue(mockCallerSdk());
    getIntegrationSdk.mockReturnValue(integrationSdk);

    const res = mockRes();
    initUserRole({ body: { isLaundry: true, metadata: { isLaundry: true, isAdmin: true } } }, res);

    return flush().then(() => {
      const written = integrationSdk.users.updateProfile.mock.calls[0][0].metadata;
      expect(Object.keys(written)).toEqual(['isLaundry']);
      expect(written.isLaundry).toBe(false);
    });
  });

  it('401s and writes nothing when the caller is not authenticated', () => {
    const integrationSdk = mockIntegrationSdk({});
    getSdk.mockReturnValue(mockCallerSdk(CALLER_ID, { authFails: true }));
    getIntegrationSdk.mockReturnValue(integrationSdk);

    const res = mockRes();
    initUserRole({ body: {} }, res);

    return flush().then(() => {
      expect(integrationSdk.users.show).not.toHaveBeenCalled();
      expect(integrationSdk.users.updateProfile).not.toHaveBeenCalled();
      expect(handleError).toHaveBeenCalledTimes(1);
      expect(handleError.mock.calls[0][1].status).toBe(401);
    });
  });

  it('401s and writes nothing when the session resolves no user id', () => {
    const integrationSdk = mockIntegrationSdk({});
    getSdk.mockReturnValue({
      currentUser: { show: jest.fn(() => Promise.resolve({ data: { data: null } })) },
    });
    getIntegrationSdk.mockReturnValue(integrationSdk);

    const res = mockRes();
    initUserRole({ body: {} }, res);

    return flush().then(() => {
      expect(integrationSdk.users.updateProfile).not.toHaveBeenCalled();
      expect(handleError.mock.calls[0][1].status).toBe(401);
    });
  });

  it('reports Integration API failures through handleError instead of throwing', () => {
    getSdk.mockReturnValue(mockCallerSdk());
    getIntegrationSdk.mockReturnValue({
      users: {
        show: jest.fn(() => Promise.reject(new Error('integration down'))),
        updateProfile: jest.fn(),
      },
    });

    const res = mockRes();
    initUserRole({ body: {} }, res);

    return flush().then(() => {
      expect(handleError).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBeNull();
    });
  });
});
