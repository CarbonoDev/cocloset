const http = require('http');
const https = require('https');
const sharetribeSdk = require('sharetribe-flex-sdk');
const { handleError, serialize, typeHandlers } = require('../../api-util/sdk');
const {
  clearPendingSignupCookieOptions,
  clearPendingSignupTokenCookieOptions,
  parseJsonCookie,
} = require('../../api-util/cookieOptions');
const { getIntegrationSdk } = require('../../api-util/integrationSdk');
const { ensureLaundryRoleDefault } = require('../../api-util/laundryRoleDefaults');
const log = require('../../log');

const CLIENT_ID = process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID;
const CLIENT_SECRET = process.env.SHARETRIBE_SDK_CLIENT_SECRET;
const TRANSIT_VERBOSE = process.env.REACT_APP_SHARETRIBE_SDK_TRANSIT_VERBOSE === 'true';
const USING_SSL = process.env.REACT_APP_SHARETRIBE_USING_SSL === 'true';
const BASE_URL = process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL;

const FACBOOK_APP_ID = process.env.REACT_APP_FACEBOOK_APP_ID;
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;

const FACEBOOK_IDP_ID = 'facebook';
const GOOGLE_IDP_ID = 'google';

// Instantiate HTTP(S) Agents with keepAlive set to true.
// This will reduce the request time for consecutive requests by
// reusing the existing TCP connection, thus eliminating the time used
// for setting up new TCP connections.
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

const baseUrl = BASE_URL ? { baseUrl: BASE_URL } : {};

const sendMissingAuthCookiesError = res => {
  res
    .status(400)
    .set('Content-Type', 'application/transit+json')
    .send(
      serialize({
        status: 400,
        statusText: 'Pending IdP signup session expired or missing.',
        data: {},
      })
    )
    .end();
};

module.exports = (req, res) => {
  const idpToken = req.cookies['st-idp-token'];
  const authInfo = parseJsonCookie(req.cookies['st-authinfo']);
  const idpId = authInfo?.idpId;

  if (!idpToken || !idpId) {
    sendMissingAuthCookiesError(res);
    return;
  }

  const tokenStore = sharetribeSdk.tokenStore.expressCookieStore({
    clientId: CLIENT_ID,
    req,
    res,
    secure: USING_SSL,
  });

  const sdk = sharetribeSdk.createInstance({
    transitVerbose: TRANSIT_VERBOSE,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    httpAgent,
    httpsAgent,
    tokenStore,
    typeHandlers,
    ...baseUrl,
  });

  // idpToken and idpId are read from cookies above; strip them from the body so a
  // client cannot substitute a different IdP credential while reusing st-authinfo.
  const { idpToken: _ignoredToken, idpId: _ignoredIdpId, ...rest } = req.body || {};

  // Choose the idpClientId based on which authentication method is used.
  const idpClientId =
    idpId === FACEBOOK_IDP_ID ? FACBOOK_APP_ID : idpId === GOOGLE_IDP_ID ? GOOGLE_CLIENT_ID : null;

  // The IdP signup path already runs on our server, so it can apply the
  // `metadata.isLaundry = false` default inline with no extra round trip and
  // no reliance on the browser (unlike the email/password path, which has to
  // POST /api/init-user-role from the client - see src/ducks/auth.duck.js).
  // Captured from the createWithIdp response below.
  let createdUserId = null;

  sdk.currentUser
    .createWithIdp({ idpId, idpClientId, idpToken, ...rest })
    .then(createResponse => {
      createdUserId = createResponse?.data?.data?.id || null;

      // After the user is created, we need to call loginWithIdp endpoint
      // so that the user will be logged in.
      return sdk.loginWithIdp({
        idpId,
        idpClientId: `${idpClientId}`,
        idpToken: `${idpToken}`,
      });
    })
    .then(apiResponse => {
      // Fall back to the now-authenticated session if the create response did
      // not carry the id. This has to happen BEFORE the response is sent: this
      // `sdk`'s token store writes cookies onto `res`, so it must not be used
      // once headers are out.
      //
      // EVERY failure mode here resolves to `null` rather than rejecting -
      // including a synchronous throw, since `currentUser.show` is not
      // guaranteed to exist on every SDK build. Resolving the id is
      // best-effort; it must never be able to fail an IdP signup that has
      // already succeeded.
      let userIdPromise;
      try {
        userIdPromise = createdUserId
          ? Promise.resolve(createdUserId)
          : sdk.currentUser
              .show()
              .then(userResponse => userResponse?.data?.data?.id || null)
              .catch(() => null);
      } catch (e) {
        userIdPromise = Promise.resolve(null);
      }

      return userIdPromise.then(userId => ({ apiResponse, userId }));
    })
    .then(({ apiResponse, userId }) => {
      const { status, statusText, data } = apiResponse;
      res
        .clearCookie('st-authinfo', clearPendingSignupCookieOptions())
        .clearCookie('st-idp-token', clearPendingSignupTokenCookieOptions())
        .status(status)
        .set('Content-Type', 'application/transit+json')
        .send(
          serialize({
            status,
            statusText,
            data,
          })
        )
        .end();

      // Fire-and-continue, deliberately NOT awaited and deliberately after the
      // response: a failure to stamp the default must never turn a successful
      // signup into an error. A user without the key still behaves exactly as
      // a non-laundry (every consumer tests `=== true`), and
      // scripts/backfill-laundry-role.js can repair it later.
      //
      // The try/catch is load-bearing, not defensive noise: `getIntegrationSdk()`
      // THROWS SYNCHRONOUSLY when its env vars are missing, and this code runs
      // after `res.end()` - letting that reach the outer `.catch` would call
      // handleError on an already-sent response.
      try {
        if (!userId) {
          log.error(
            new Error('Could not resolve the created IdP user id'),
            'init-user-role-idp-no-user-id',
            { idpId }
          );
          return;
        }

        ensureLaundryRoleDefault(getIntegrationSdk(), userId).catch(e => {
          log.error(e, 'init-user-role-idp-failed', {
            idpId,
            userId: userId?.uuid || userId,
          });
        });
      } catch (e) {
        log.error(e, 'init-user-role-idp-failed', { idpId });
      }
    })
    .catch(e => {
      handleError(res, e);
    });
};
