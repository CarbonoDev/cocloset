import { HANDOVER_PATH, handoverPathFor } from './handoverQr';
import routeConfiguration from '../routing/routeConfiguration';
import { getDefaultConfiguration } from './testHelpers';

// eslint-disable-next-line import/no-commonjs
const {
  HANDOVER_PATH: SERVER_HANDOVER_PATH,
  buildHandoverQrScanUrl,
} = require('../../server/api-util/handoverQr');

/**
 * WHY THIS FILE EXISTS
 *
 * The handover URL is spelled in THREE places and they must agree:
 *
 *   1. `server/api-util/handoverQr.js` builds the absolute URL that gets encoded into the
 *      image a customer scans;
 *   2. `src/util/handoverQr.js` builds the in-app path for links inside the app;
 *   3. `src/routing/routeConfiguration.js` declares the route that resolves it.
 *
 * If any one of them drifts, the QR scans to a 404 — and nothing in the codebase would show
 * it: the server test would pass (it built a URL), the client test would pass (it built a
 * path), and the route test would pass (the route exists). Only comparing them catches it,
 * and the symptom in the field is a customer standing at a counter with a code that goes
 * nowhere.
 *
 * The route is checked by RESOLVING a real generated URL against the real route table, not
 * by comparing two strings — a path constant that matches a route pattern it does not
 * actually match (`/handover/:id` vs `/handover/:transactionId` would compare equal on the
 * literal prefix) is exactly the mistake worth catching.
 */

const TX_ID = '6a74b530-a104-42b6-a586-b35efb5dee79';

describe('the handover URL agrees across client, server and the route table', () => {
  it('uses the same path segment on both sides', () => {
    expect(HANDOVER_PATH).toBe(SERVER_HANDOVER_PATH);
  });

  it('builds the same path from the server URL and the client helper', () => {
    const serverUrl = buildHandoverQrScanUrl(TX_ID, 'https://cocloset.example.com');
    const { pathname } = new URL(serverUrl);

    expect(pathname).toBe(handoverPathFor(TX_ID));
  });

  it('tolerates a trailing slash on the configured root URL', () => {
    // REACT_APP_MARKETPLACE_ROOT_URL is typed into a .env by a human, and `//handover/...`
    // is a different path from `/handover/...` to a router.
    expect(buildHandoverQrScanUrl(TX_ID, 'https://cocloset.example.com/')).toBe(
      `https://cocloset.example.com${handoverPathFor(TX_ID)}`
    );
  });

  it('falls back to the bare id when no root URL is configured', () => {
    // A relative URL is not scannable, so a code that at least still identifies the
    // transaction beats one that resolves nowhere. The manual fallback (reading the id out)
    // keeps working.
    // `null` rather than `undefined`: the parameter defaults to
    // REACT_APP_MARKETPLACE_ROOT_URL, and passing `undefined` explicitly triggers that
    // default — which is set in this test environment, so it would assert the opposite of
    // what it says.
    expect(buildHandoverQrScanUrl(TX_ID, null)).toBe(TX_ID);
    expect(buildHandoverQrScanUrl(TX_ID, '')).toBe(TX_ID);
    expect(buildHandoverQrScanUrl(TX_ID, '   ')).toBe(TX_ID);
  });

  it('generates a URL the app actually has a route for', () => {
    const routes = routeConfiguration(getDefaultConfiguration().layout);
    const handoverRoute = routes.find(r => r.name === 'HandoverPage');

    expect(handoverRoute).toBeDefined();

    // The generated path must match the declared pattern, parameter name included: the page
    // reads `params.id`, so a route declared with any other parameter name would render with
    // no transaction id at all.
    const generated = handoverPathFor(TX_ID);
    const pattern = handoverRoute.path.replace(/:([A-Za-z0-9_]+)/g, '([^/]+)');
    const match = new RegExp(`^${pattern}$`).exec(generated);

    expect(match).not.toBeNull();
    expect(handoverRoute.path).toBe('/handover/:id');
    expect(match[1]).toBe(TX_ID);
  });

  it('requires authentication, because the page has to know who is reading', () => {
    const routes = routeConfiguration(getDefaultConfiguration().layout);
    const handoverRoute = routes.find(r => r.name === 'HandoverPage');

    expect(handoverRoute.auth).toBe(true);
  });
});
