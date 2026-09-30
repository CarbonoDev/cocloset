import { PICKUP_PATH, pickupPathFor } from './listingPickupQr';
import routeConfiguration from '../routing/routeConfiguration';
import { getDefaultConfiguration } from './testHelpers';

// eslint-disable-next-line import/no-commonjs
const { PICKUP_PATH: SERVER_PICKUP_PATH, buildPickupQrScanUrl } = require('../../server/api-util/listingPickupQr');

/**
 * WHY THIS FILE EXISTS
 *
 * Mirrors src/util/handoverQrUrlAgreement.test.js's own reasoning for the pickup path,
 * spelled in three places that must agree:
 *
 *   1. server/api-util/listingPickupQr.js builds the absolute URL (id + token) encoded
 *      into the image a laundry scans;
 *   2. src/util/listingPickupQr.js builds the in-app path (no token - that lives in the
 *      query string, read off the page's own URL);
 *   3. src/routing/routeConfiguration.js declares the route that resolves it.
 *
 * Unlike the handover URL, the token is NOT part of the path - only the pathname needs to
 * agree across all three; the query string is opaque to the route table by design.
 */

const LISTING_ID = '6aa26840-16da-44df-8a74-ff4ece1da4eb';
const TOKEN = 'a'.repeat(32);

describe('the pickup URL agrees across client, server and the route table', () => {
  it('uses the same path segment on both sides', () => {
    expect(PICKUP_PATH).toBe(SERVER_PICKUP_PATH);
  });

  it('builds the same pathname from the server URL and the client helper', () => {
    const serverUrl = buildPickupQrScanUrl(LISTING_ID, TOKEN, 'https://cocloset.example.com');
    const { pathname } = new URL(serverUrl);

    expect(pathname).toBe(pickupPathFor(LISTING_ID));
  });

  it('carries the token as a query parameter, not in the path', () => {
    const serverUrl = buildPickupQrScanUrl(LISTING_ID, TOKEN, 'https://cocloset.example.com');
    const { search } = new URL(serverUrl);

    expect(search).toBe(`?token=${TOKEN}`);
  });

  it('tolerates a trailing slash on the configured root URL', () => {
    expect(buildPickupQrScanUrl(LISTING_ID, TOKEN, 'https://cocloset.example.com/')).toBe(
      `https://cocloset.example.com${pickupPathFor(LISTING_ID)}?token=${TOKEN}`
    );
  });

  it('generates a URL the app actually has a route for', () => {
    const routes = routeConfiguration(getDefaultConfiguration().layout);
    const pickupRoute = routes.find(r => r.name === 'PickupPage');

    expect(pickupRoute).toBeDefined();

    // The generated path must match the declared pattern, parameter name included: the
    // page's loadData reads `params.listingId`, so a route declared with any other
    // parameter name would resolve with no listing id at all.
    const generated = pickupPathFor(LISTING_ID);
    const pattern = pickupRoute.path.replace(/:([A-Za-z0-9_]+)/g, '([^/]+)');
    const match = new RegExp(`^${pattern}$`).exec(generated);

    expect(match).not.toBeNull();
    expect(pickupRoute.path).toBe('/pickup/:listingId');
    expect(match[1]).toBe(LISTING_ID);
  });

  it('requires authentication, because the page has to know who is reading', () => {
    const routes = routeConfiguration(getDefaultConfiguration().layout);
    const pickupRoute = routes.find(r => r.name === 'PickupPage');

    expect(pickupRoute.auth).toBe(true);
  });
});
