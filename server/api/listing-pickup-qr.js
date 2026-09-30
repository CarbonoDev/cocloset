/**
 * GET /api/listing-pickup-qr?id=<listing uuid>
 *
 * Renders the pickup QR for a PAUSED listing as a PNG image, server-side - the code a
 * provider shows at the laundry counter to collect a garment that is sitting at their
 * assigned studio with no active rental. See api-util/listingPickupQr.js for the payload
 * scheme and why this is a real credential, unlike the transaction handover QR.
 *
 * OWNER-ONLY, unlike server/api/transaction-qr.js. That endpoint is safely unauthenticated
 * because its payload discloses nothing the caller did not already supply; this one is not
 * echoing input back, it is MINTING a secret (the pickup token) the first time it is called
 * for a given pickup cycle and returning it embedded in the image. An unauthenticated caller
 * who simply knew a listing id could otherwise mint and read a token for someone else's
 * garment - exactly the credential this feature exists to keep away from anyone but the
 * owner and the laundry that scans it.
 *
 * Idempotent while the garment is still at the laundry: a second call (the provider
 * re-opening the page) returns the SAME token, not a freshly rotated one - see
 * listingPickupQr.js's header for why a rotated code would invalidate a QR already saved or
 * printed.
 *
 * Success (200): image/png.
 * Failure:
 *   400 - missing/malformed "id"
 *   401 - no usable session
 *   403 - caller is not this listing's owner
 *   409 - the listing is not currently onLaundry (nothing to pick up)
 *   500 - render/write failure
 */

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { requireListingAuthorCaller } = require('../api-util/listingOwnerAuth');
const {
  PICKUP_TOKEN_METADATA_KEY,
  generatePickupToken,
  buildPickupQrScanUrl,
  renderPickupQrPngBuffer,
} = require('../api-util/listingPickupQr');
const { createRateLimiter } = require('../api-util/rateLimit');
const log = require('../log');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A human reloading their own listing page; generous but not the amplifier budget
// transaction-qr.js needs, since this one is authenticated (one caller's own session, not an
// anonymous <img> fan-out).
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_IP_PER_WINDOW = 120;
const MAX_TOTAL_PER_WINDOW = 5000;

const limiter = createRateLimiter({
  windowMs: WINDOW_MS,
  maxPerKey: MAX_PER_IP_PER_WINDOW,
  maxTotal: MAX_TOTAL_PER_WINDOW,
});

const conflictError = message => {
  const error = new Error(message);
  error.status = 409;
  error.statusText = message;
  error.data = {};
  return error;
};

module.exports = (req, res) => {
  const { allowed, retryAfterSeconds } = limiter.check(req.ip);
  if (!allowed) {
    res
      .status(429)
      .set('Retry-After', String(retryAfterSeconds))
      .json({ error: 'Too many requests. Please try again later.' })
      .end();
    return Promise.resolve();
  }

  const id = req.query?.id;
  if (!id || typeof id !== 'string' || !UUID_RE.test(id)) {
    res
      .status(400)
      .json({ error: 'Query parameter "id" must be a listing UUID.' })
      .end();
    return Promise.resolve();
  }

  const integrationSdk = getIntegrationSdk();

  return integrationSdk.listings
    .show({ id, include: ['author'] })
    .then(listingResponse => {
      const listing = listingResponse.data.data;

      return requireListingAuthorCaller(req, res, listing).then(() => {
        if (listing?.attributes?.metadata?.onLaundry !== true) {
          throw conflictError('This listing has nothing to pick up right now.');
        }

        const existingToken = listing?.attributes?.metadata?.[PICKUP_TOKEN_METADATA_KEY];
        const tokenPromise = existingToken
          ? Promise.resolve(existingToken)
          : Promise.resolve(generatePickupToken()).then(token =>
              integrationSdk.listings
                .update({ id, metadata: { [PICKUP_TOKEN_METADATA_KEY]: token } })
                .then(() => token)
            );

        return tokenPromise;
      });
    })
    .then(token => renderPickupQrPngBuffer(buildPickupQrScanUrl(id, token)))
    .then(buffer => {
      res
        .status(200)
        .set('Content-Type', 'image/png')
        // Unlike transaction-qr.js's immutable cache: this image's payload can change
        // (a token is cleared the moment the garment is handed back), so it must be
        // re-fetched rather than trusted indefinitely.
        .set('Cache-Control', 'private, no-store')
        .set('Content-Length', String(buffer.length))
        .send(buffer)
        .end();
    })
    .catch(e => {
      if (e?.status) {
        handleError(res, e);
        return;
      }
      log.error(e, 'listing-pickup-qr-render-failed', { listingId: id, message: e?.message });
      res
        .status(500)
        .json({ error: 'Failed to render the pickup QR code.' })
        .end();
    });
};

module.exports.limiter = limiter;
module.exports.MAX_PER_IP_PER_WINDOW = MAX_PER_IP_PER_WINDOW;
module.exports.WINDOW_MS = WINDOW_MS;
module.exports.MAX_TOTAL_PER_WINDOW = MAX_TOTAL_PER_WINDOW;
