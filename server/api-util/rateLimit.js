/**
 * Minimal in-memory fixed-window rate limiter.
 *
 * The template has no rate limiting at all, and every other endpoint in `server/api/`
 * is effectively gated by a Marketplace API session. The public laundry-partner
 * application endpoint has no such gate, so it needs its own.
 *
 * This is deliberately dependency-free (see the "prefer the template's local utilities
 * over new npm packages" rule in the workspace CLAUDE.md) and deliberately small.
 *
 * KNOWN LIMITATIONS — read before relying on this for anything more sensitive:
 * - State lives in this process's memory. It resets on deploy and is not shared between
 *   instances, so N instances allow N x the configured budget.
 * - It keys on `req.ip`, which is only meaningful when Express `trust proxy` is set
 *   correctly. On Railway that means `SERVER_SHARETRIBE_TRUST_PROXY` must be configured
 *   (see `server/index.js`); otherwise every request appears to come from the proxy and
 *   the global budget becomes the only effective limit.
 * - A determined attacker with many source addresses is not stopped by this. Real
 *   protection belongs at the edge (Cloudflare / Railway WAF).
 */

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Create a fixed-window limiter.
 *
 * @param {Object} options
 * @param {number} options.windowMs length of the window in milliseconds
 * @param {number} options.maxPerKey max requests per key (e.g. IP) per window
 * @param {number} options.maxTotal max requests across all keys per window; also bounds
 *   how much memory a distributed flood can make us allocate
 * @param {Function} [options.now] injectable clock, for tests
 * @returns {Object} `{ check(key), reset() }`
 */
const createRateLimiter = options => {
  const { windowMs = DEFAULT_WINDOW_MS, maxPerKey, maxTotal, now = () => Date.now() } =
    options || {};

  let windowStartedAt = now();
  let total = 0;
  let counts = new Map();

  const rollWindowIfNeeded = timestamp => {
    if (timestamp - windowStartedAt >= windowMs) {
      windowStartedAt = timestamp;
      total = 0;
      counts = new Map();
    }
  };

  return {
    /**
     * Record an attempt and report whether it is allowed.
     *
     * @param {string} key typically the client IP
     * @returns {Object} `{ allowed, retryAfterSeconds }`
     */
    check: key => {
      const timestamp = now();
      rollWindowIfNeeded(timestamp);

      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowStartedAt + windowMs - timestamp) / 1000)
      );
      const safeKey = typeof key === 'string' && key !== '' ? key : 'unknown';
      const used = counts.get(safeKey) || 0;

      if (total >= maxTotal || used >= maxPerKey) {
        return { allowed: false, retryAfterSeconds };
      }

      counts.set(safeKey, used + 1);
      total = total + 1;
      return { allowed: true, retryAfterSeconds };
    },

    reset: () => {
      windowStartedAt = now();
      total = 0;
      counts = new Map();
    },
  };
};

module.exports = { createRateLimiter, DEFAULT_WINDOW_MS };
