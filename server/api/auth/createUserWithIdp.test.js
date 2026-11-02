const sharetribeSdk = require('sharetribe-flex-sdk');

process.env.REACT_APP_GOOGLE_CLIENT_ID = 'google-client-id';

jest.mock('../../api-util/sdk', () => ({
  handleError: jest.fn(),
  serialize: jest.fn(data => JSON.stringify(data)),
  typeHandlers: [],
}));

jest.mock('sharetribe-flex-sdk', () => {
  const createWithIdp = jest.fn();
  const loginWithIdp = jest.fn();
  const show = jest.fn();
  return {
    tokenStore: {
      expressCookieStore: jest.fn(() => ({})),
    },
    createInstance: jest.fn(),
    __mockFns: { createWithIdp, loginWithIdp, show },
  };
});

jest.mock('../../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../../log', () => ({ error: jest.fn() }));

const { getIntegrationSdk } = require('../../api-util/integrationSdk');
const { handleError } = require('../../api-util/sdk');

const createUserWithIdp = require('./createUserWithIdp');

const { __mockFns } = sharetribeSdk;

const IDP_USER_ID = { uuid: 'idp-user-id' };

// Integration SDK double for the inline `metadata.isLaundry = false` default.
const mockIntegrationSdk = existingMetadata => ({
  users: {
    show: jest.fn(() =>
      Promise.resolve({
        data: {
          data: { id: IDP_USER_ID, attributes: { profile: { metadata: existingMetadata } } },
        },
      })
    ),
    updateProfile: jest.fn(params =>
      Promise.resolve({
        data: {
          data: {
            id: IDP_USER_ID,
            attributes: {
              profile: { metadata: { ...existingMetadata, ...params.metadata } },
            },
          },
        },
      })
    ),
  },
});

const idpRequest = () => ({
  cookies: {
    'st-idp-token': 'token-from-cookie',
    'st-authinfo': authInfoCookie,
  },
  body: {},
});

const flush = () => new Promise(resolve => setImmediate(resolve));

const mockRes = () => ({
  status: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  send: jest.fn().mockReturnThis(),
  end: jest.fn().mockReturnThis(),
  clearCookie: jest.fn().mockReturnThis(),
});

const authInfoCookie = 'j:{"idpId":"google","email":"a@example.com"}';

describe('createUserWithIdp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __mockFns.createWithIdp.mockReset();
    __mockFns.loginWithIdp.mockReset();
    __mockFns.show.mockReset();
    // The Marketplace API returns the created user, so the id is available
    // without any extra round trip.
    __mockFns.createWithIdp.mockResolvedValue({
      data: { data: { id: IDP_USER_ID, type: 'user' } },
    });
    __mockFns.loginWithIdp.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      data: {},
    });
    __mockFns.show.mockResolvedValue({ data: { data: { id: IDP_USER_ID } } });
    sharetribeSdk.createInstance.mockReturnValue({
      currentUser: { createWithIdp: __mockFns.createWithIdp, show: __mockFns.show },
      loginWithIdp: __mockFns.loginWithIdp,
    });
    getIntegrationSdk.mockReturnValue(mockIntegrationSdk({}));
  });

  it('returns 400 when st-idp-token cookie is missing', () => {
    const res = mockRes();
    createUserWithIdp(
      {
        cookies: { 'st-authinfo': authInfoCookie },
        body: {},
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(__mockFns.createWithIdp).not.toHaveBeenCalled();
  });

  it('returns 400 when st-authinfo cookie is missing', () => {
    const res = mockRes();
    createUserWithIdp(
      {
        cookies: { 'st-idp-token': 'token-from-cookie' },
        body: {},
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(__mockFns.createWithIdp).not.toHaveBeenCalled();
  });

  it('uses idpToken and idpId from cookies, not request body', async () => {
    const res = mockRes();
    createUserWithIdp(
      {
        cookies: {
          'st-idp-token': 'token-from-cookie',
          'st-authinfo': authInfoCookie,
        },
        body: {
          idpToken: 'token-from-body',
          idpId: 'facebook',
          firstName: 'Edited',
        },
      },
      res
    );

    await new Promise(resolve => setImmediate(resolve));

    expect(__mockFns.createWithIdp).toHaveBeenCalledWith({
      idpId: 'google',
      idpClientId: 'google-client-id',
      idpToken: 'token-from-cookie',
      firstName: 'Edited',
    });
    expect(__mockFns.loginWithIdp).toHaveBeenCalledWith({
      idpId: 'google',
      idpClientId: 'google-client-id',
      idpToken: 'token-from-cookie',
    });
    expect(res.clearCookie).toHaveBeenCalledWith('st-authinfo', expect.any(Object));
    expect(res.clearCookie).toHaveBeenCalledWith('st-idp-token', expect.any(Object));
  });

  // The IdP signup path runs on our server already, so it applies the
  // `metadata.isLaundry = false` default inline instead of relying on the
  // browser to POST /api/init-user-role (which is what the email/password
  // path has to do). See server/api-util/laundryRoleDefaults.js.
  describe('isLaundry default', () => {
    it('sets isLaundry = false on the newly created user', async () => {
      const integrationSdk = mockIntegrationSdk({});
      getIntegrationSdk.mockReturnValue(integrationSdk);

      const res = mockRes();
      createUserWithIdp(idpRequest(), res);
      await flush();

      expect(integrationSdk.users.show).toHaveBeenCalledWith({ id: IDP_USER_ID });
      expect(integrationSdk.users.updateProfile).toHaveBeenCalledWith(
        { id: IDP_USER_ID, metadata: { isLaundry: false } },
        { expand: true }
      );
    });

    it('does NOT demote an IdP user who is already isLaundry = true', async () => {
      const integrationSdk = mockIntegrationSdk({ isLaundry: true });
      getIntegrationSdk.mockReturnValue(integrationSdk);

      const res = mockRes();
      createUserWithIdp(idpRequest(), res);
      await flush();

      expect(integrationSdk.users.updateProfile).not.toHaveBeenCalled();
    });

    it('falls back to the session when the create response carries no user id', async () => {
      __mockFns.createWithIdp.mockResolvedValue({});
      const integrationSdk = mockIntegrationSdk({});
      getIntegrationSdk.mockReturnValue(integrationSdk);

      const res = mockRes();
      createUserWithIdp(idpRequest(), res);
      await flush();

      expect(__mockFns.show).toHaveBeenCalled();
      expect(integrationSdk.users.updateProfile).toHaveBeenCalledWith(
        { id: IDP_USER_ID, metadata: { isLaundry: false } },
        { expand: true }
      );
    });

    // The signup itself must survive every failure of the best-effort default.
    it('still completes the signup when the user id cannot be resolved at all', async () => {
      __mockFns.createWithIdp.mockResolvedValue({});
      __mockFns.show.mockRejectedValue(new Error('session unavailable'));
      const integrationSdk = mockIntegrationSdk({});
      getIntegrationSdk.mockReturnValue(integrationSdk);

      const res = mockRes();
      createUserWithIdp(idpRequest(), res);
      await flush();

      expect(integrationSdk.users.updateProfile).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.clearCookie).toHaveBeenCalledWith('st-authinfo', expect.any(Object));
      expect(handleError).not.toHaveBeenCalled();
    });

    it('still completes the signup when the Integration API is unavailable', async () => {
      getIntegrationSdk.mockImplementation(() => {
        throw new Error('Missing SHARETRIBE_INTEGRATION_SDK_CLIENT_ID');
      });

      const res = mockRes();
      createUserWithIdp(idpRequest(), res);
      await flush();

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.clearCookie).toHaveBeenCalledWith('st-idp-token', expect.any(Object));
      expect(handleError).not.toHaveBeenCalled();
    });

    it('still completes the signup when the metadata write fails', async () => {
      getIntegrationSdk.mockReturnValue({
        users: {
          show: jest.fn(() => Promise.resolve({ data: { data: { attributes: { profile: {} } } } })),
          updateProfile: jest.fn(() => Promise.reject(new Error('integration down'))),
        },
      });

      const res = mockRes();
      createUserWithIdp(idpRequest(), res);
      await flush();

      expect(res.status).toHaveBeenCalledWith(200);
      expect(handleError).not.toHaveBeenCalled();
    });
  });
});
