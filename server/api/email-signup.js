/**
 * POST /api/email-signup
 *
 * Public, unauthenticated endpoint backing the landing page's "CoCloset is coming soon to a
 * city near you" email-list signup (the `invite` section). Same trust boundary and the same
 * shape as `server/api/laundry-partner-application.js`, which this deliberately mirrors:
 *
 * - It never constructs a Marketplace API SDK (`getSdk` / `getTrustedSdk`) and never
 *   constructs an Integration API SDK (`getIntegrationSdk`). It cannot read or write a
 *   single marketplace record.
 * - Only whitelisted, length-capped fields are read off the body, plus a strict `consent`
 *   boolean (see `server/api-util/emailSignup.js`).
 * - Submissions are rate limited per IP and globally, via its own limiter instance - the
 *   laundry-partner endpoint's limiter is a separate module-level object, so sharing it here
 *   would let a flood of one endpoint exhaust the other's budget for no reason.
 * - The response body echoes nothing back to the caller.
 */

const { validateSignup, deliverSignup } = require('../api-util/emailSignup');
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
      .json({ error: 'Too many signups from this address. Please try again later.' })
      .end();
    return;
  }

  const result = validateSignup(req.body || {});

  if (!result.valid) {
    res
      .status(400)
      .json({ error: result.error })
      .end();
    return;
  }

  // Honeypot hit. Answer as if it succeeded, but never deliver.
  if (result.isSpam) {
    console.log('[email-signup] rejected: honeypot field was filled.');
    respondAccepted(res);
    return;
  }

  deliverSignup(result.signup)
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
