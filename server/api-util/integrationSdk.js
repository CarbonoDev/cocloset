const integrationSdk = require('sharetribe-flex-integration-sdk');

const CLIENT_ID = process.env.SHARETRIBE_INTEGRATION_SDK_CLIENT_ID;
const CLIENT_SECRET = process.env.SHARETRIBE_INTEGRATION_SDK_CLIENT_SECRET;
const BASE_URL = process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL;

const baseUrlMaybe = BASE_URL ? { baseUrl: BASE_URL } : {};

// Integration API has full admin access to the marketplace and authenticates
// with its own client id/secret (separate from the Marketplace API client
// used everywhere else in server/api-util/sdk.js). Never expose this client
// or its credentials to the browser.
//
// Used for: reading/writing user metadata (e.g. the isLaundry role flag,
// which must not be writable by the user themselves), and any query that
// needs to see across users/listings/transactions beyond what a single
// user's trusted token is authorized for.
exports.getIntegrationSdk = () => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    const message =
      'Missing SHARETRIBE_INTEGRATION_SDK_CLIENT_ID / SHARETRIBE_INTEGRATION_SDK_CLIENT_SECRET env vars.';
    const error = new Error(message);
    error.status = 500;
    error.statusText = message;
    error.data = {};
    throw error;
  }

  return integrationSdk.createInstance({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    ...baseUrlMaybe,
  });
};
