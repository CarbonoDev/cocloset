/**
 * GET /api/listing-pickup-status?id=<listing uuid>&token=<pickup token>
 *
 * What the page behind a scanned pickup QR needs to know: whose garment this is, whether
 * it's still there to collect, and whether THIS caller may confirm the hand-back.
 *
 * Mirrors server/api/handover-status.js's shape and reasoning (read this file's comments
 * alongside that one), with one addition: a pickup has no transaction to lean on for
 * authorization, so the token carried in the QR itself is part of what decides `canConfirm` -
 * see api-util/listingPickupQr.js for why this QR is a credential and the handover one is not.
 *
 * Both the owner and the assigned laundry may load this page (the owner sees their own QR's
 * status while waiting; only the laundry ever gets `canConfirm: true`). Anyone else gets 403,
 * anonymous gets 401.
 *
 * Success (200): { data: { listingId, listingTitle, ownerName, onLaundry, viewerRole,
 *   tokenValid, canConfirm } }
 * Failure:
 *   400 - missing/malformed "id", or missing "token"
 *   401 - no usable session
 *   403 - caller is neither the owner nor the assigned laundry
 */

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { authorizeLaundryOrOwnerCaller } = require('../api-util/listingOwnerAuth');
const { pickupTokensMatch, PICKUP_TOKEN_METADATA_KEY } = require('../api-util/listingPickupQr');
const { createRateLimiter } = require('../api-util/rateLimit');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A scan is a human action at a counter, same budget as handover-status.js.
const limiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxPerKey: 300,
  maxTotal: 20000,
});

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
  const token = req.query?.token;

  if (!id || typeof id !== 'string' || !UUID_RE.test(id)) {
    res
      .status(400)
      .json({ error: 'Query parameter "id" must be a listing UUID.' })
      .end();
    return Promise.resolve();
  }
  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'Query parameter "token" is required.' }).end();
    return Promise.resolve();
  }

  const integrationSdk = getIntegrationSdk();

  return integrationSdk.listings
    .show({ id, include: ['author'] })
    .then(listingResponse => {
      const listing = listingResponse.data.data;
      const owner = (listingResponse.data.included || []).find(
        entity => entity.type === 'user'
      );

      return authorizeLaundryOrOwnerCaller(req, res, listing).then(({ role }) => {
        const onLaundry = listing?.attributes?.metadata?.onLaundry === true;
        const storedToken = listing?.attributes?.metadata?.[PICKUP_TOKEN_METADATA_KEY];
        const tokenValid = onLaundry && pickupTokensMatch(token, storedToken);

        res
          .status(200)
          .set('Content-Type', 'application/json')
          .send({
            data: {
              listingId: id,
              listingTitle: listing?.attributes?.title || null,
              ownerName: owner?.attributes?.profile?.displayName || null,
              onLaundry,
              viewerRole: role,
              tokenValid,
              // Only the laundry can ever confirm, and only with a token that both matches
              // AND is still live (a garment already handed back clears its token, so a
              // stale/reused QR reads as invalid rather than as "confirmed already").
              canConfirm: role === 'laundry' && tokenValid,
            },
          })
          .end();
      });
    })
    .catch(e => handleError(res, e));
};

module.exports.limiter = limiter;
