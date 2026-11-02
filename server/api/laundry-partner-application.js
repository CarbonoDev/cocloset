/**
 * POST /api/laundry-partner-application
 *
 * Public, unauthenticated endpoint backing the "become a laundry partner" form on
 * PartnerLandingPage. Anyone on the internet can call it, so it is scoped as tightly
 * as possible:
 *
 * - It never constructs a Marketplace API SDK (`getSdk` / `getTrustedSdk`) and never
 *   constructs an Integration API SDK (`getIntegrationSdk`). It therefore cannot read
 *   or write a single marketplace record. Approving an application is a manual,
 *   authenticated act performed elsewhere.
 * - Only whitelisted, length-capped fields are read off the body
 *   (see `server/api-util/laundryPartnerApplication.js`).
 * - Submissions are rate limited per IP and globally.
 * - The response body echoes nothing back to the caller, so the endpoint cannot be used
 *   as a reflector.
 */

const {
  validateApplication,
  deliverApplication,
} = require('../api-util/laundryPartnerApplication');
const { createRateLimiter } = require('../api-util/rateLimit');
const { handleError } = require('../api-util/sdk');

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_IP_PER_WINDOW = 5;
const MAX_TOTAL_PER_WINDOW = 200;

const limiter = createRateLimiter({
  windowMs: WINDOW_MS,
  maxPerKey: MAX_PER_IP_PER_WINDOW,
  maxTotal: MAX_TOTAL_PER_WINDOW,
});

const respondAccepted = res => {
  res
    .status(200)
    .set('Content-Type', 'application/json')
    .send({ data: { status: 'received' } })
    .end();
};

module.exports = (req, res) => {
  const { allowed, retryAfterSeconds } = limiter.check(req.ip);
  if (!allowed) {
    res
      .status(429)
      .set('Retry-After', String(retryAfterSeconds))
      .json({ error: 'Too many applications from this address. Please try again later.' })
      .end();
    return;
  }

  const result = validateApplication(req.body || {});

  if (!result.valid) {
    res
      .status(400)
      .json({ error: result.error })
      .end();
    return;
  }

  // Honeypot hit. Answer as if it succeeded, but never deliver.
  if (result.isSpam) {
    console.log('[laundry-partner-application] rejected: honeypot field was filled.');
    respondAccepted(res);
    return;
  }

  deliverApplication(result.application)
    .then(() => {
      respondAccepted(res);
    })
    .catch(e => {
      handleError(res, e);
    });
};

module.exports.MAX_PER_IP_PER_WINDOW = MAX_PER_IP_PER_WINDOW;
module.exports.MAX_TOTAL_PER_WINDOW = MAX_TOTAL_PER_WINDOW;
module.exports.WINDOW_MS = WINDOW_MS;
