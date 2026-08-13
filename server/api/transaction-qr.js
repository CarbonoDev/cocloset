/**
 * GET /api/transaction-qr?id=<transaction uuid>
 *
 * Renders the handover QR code for a transaction as a PNG image, server-side.
 * Both consumers point a plain <img src> at it:
 *
 *   - src/containers/TransactionPage/TransactionPanel/HandoverQrMaybe.js (customer/owner)
 *
 * ONE consumer, deliberately. The laundry ops screens used to render a QR per row; they no
 * longer do, per the client: "solamente un provider o un customer pueden ver el QR, laundry
 * solo va a escanear". A studio rendering its own copy of a customer's code could advance a
 * handover with nobody at the counter, which is the whole of what the scan attests.
 *
 * Generation itself is server/api-util/handoverQr.js; see that file for the
 * payload scheme, the metadata record and why generation happens at reservation
 * creation.
 *
 * ---------------------------------------------------------------------------
 * WHY PNG BYTES AND NOT A JSON `{ dataUrl }`
 * ---------------------------------------------------------------------------
 * The generation is server-side either way - the deliberate choice, so the customer's
 * screen, a laundry email and a print job all come from one `qrcode` call. What differs is only the transport, and an
 * `image/png` response is better here for three concrete reasons:
 *
 *   1. `<img src="/api/transaction-qr?id=...">` needs zero client plumbing: no
 *      fetch, no redux action, no loading/error state, and it renders on the
 *      first SSR paint. A JSON data URL would need all of that in a container
 *      that is already large.
 *   2. It stays true for any future consumer that renders several at once (a print sheet,
 *      a batch email): with <img> those are N lazily-fetched, HTTP-cacheable images the
 *      browser manages, rather than N fetches held in component state.
 *   3. base64 costs ~33% more bytes than the PNG it wraps, on every single
 *      render.
 *
 * `renderHandoverQrDataUrl` is still exported from api-util/handoverQr.js for
 * the email/print consumer, and is implemented over the same buffer renderer,
 * so there is one implementation rather than two that can drift.
 *
 * ---------------------------------------------------------------------------
 * AUTHORIZATION - deliberately none, and why that is safe here
 * ---------------------------------------------------------------------------
 * Read this before "fixing" it.
 *
 * The response encodes EXACTLY the handover URL for the transaction id the caller supplied
 * and nothing else - our own origin plus that id (see `buildHandoverQrScanUrl`). So the
 * endpoint discloses no information the caller did not already have; there is nothing for an
 * authorization check to protect. The page that URL opens does its own authorization, and
 * only the assigned laundry is offered an action there. Confirming that the caller is
 * a party to the transaction would cost an Integration API
 * `transactions.show` per image, and even a bare authentication check costs a
 * Marketplace `currentUser.show()` per image - i.e. one per ops-table row,
 * from up to dozens of parallel <img> requests, all of which would also be
 * refreshing the same auth cookie concurrently.
 *
 * What IS enforced:
 *
 *   - `id` must be a well-formed UUID. This is the control that matters, and it matters
 *     MORE now that the encoded string is a URL: the caller supplies only a UUID and the
 *     host comes from our own configuration, so the endpoint still cannot be turned into a
 *     generator for attacker-chosen payloads - a phishing link rendered as a QR on the
 *     marketplace's own domain, which is the only real abuse this shape has.
 *   - Per-IP and global rate limits, so it cannot be used as a CPU/bandwidth
 *     amplifier.
 *
 * WHAT TO TELL THE CLIENT, because "show your QR to collect the garment"
 * implies something this scheme does not provide: the QR is an IDENTIFIER, not
 * a credential. Anyone who knows a transaction id can render the same code
 * with any QR generator on the internet - that is inherent to the §11 payload
 * decision, not to this endpoint. The controls that actually protect a
 * handover are the laundry checking who is standing at the counter, and
 * Sharetribe rejecting an out-of-order transition (HTTP 409
 * `transaction-invalid-transition`). If bearer-token semantics are ever
 * required, the payload scheme has to change (a signed, expiring token) - and
 * HANDOVER_QR_VERSION exists for exactly that migration.
 */

const { createRateLimiter } = require('../api-util/rateLimit');
const { buildHandoverQrScanUrl, renderHandoverQrPngBuffer } = require('../api-util/handoverQr');
const log = require('../log');

// Sharetribe ids are UUIDs. Anchored, case-insensitive, no version pinning
// (the platform has used more than one UUID version).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WINDOW_MS = 10 * 60 * 1000;
// Generous per-IP budget. It was sized for an ops dashboard that asked for one image per
// order row; that consumer is gone (the laundry no longer sees a QR at all), so the real load
// is now one image per transaction page view. Left as it is rather than tightened: the limit
// exists to stop CPU/bandwidth amplification, not to meter honest use, and lowering it would
// only create a way to lock a busy user out.
const MAX_PER_IP_PER_WINDOW = 600;
const MAX_TOTAL_PER_WINDOW = 20000;

const limiter = createRateLimiter({
  windowMs: WINDOW_MS,
  maxPerKey: MAX_PER_IP_PER_WINDOW,
  maxTotal: MAX_TOTAL_PER_WINDOW,
});

// Returns the render promise. Express ignores a handler's return value; this is
// purely so tests can await the response deterministically instead of guessing
// how many microtask ticks `qrcode` needs.
module.exports = (req, res) => {
  const { allowed, retryAfterSeconds } = limiter.check(req.ip);
  if (!allowed) {
    res
      .status(429)
      .set('Retry-After', String(retryAfterSeconds))
      .json({ error: 'Too many QR requests from this address. Please try again later.' })
      .end();
    return Promise.resolve();
  }

  const id = req.query?.id;

  if (!id || typeof id !== 'string' || !UUID_RE.test(id)) {
    res
      .status(400)
      .json({ error: 'Query parameter "id" must be a transaction UUID.' })
      .end();
    return Promise.resolve();
  }

  // What gets ENCODED is the handover URL for this transaction, not the bare id: a scanned
  // code has to take whoever scanned it somewhere. The id is still the whole of the caller's
  // input, and the URL is built here from it plus the marketplace's own root URL - see
  // api-util/handoverQr.js `buildHandoverQrScanUrl`.
  return renderHandoverQrPngBuffer(buildHandoverQrScanUrl(id))
    .then(buffer => {
      res
        .status(200)
        .set('Content-Type', 'image/png')
        .set('Content-Length', String(buffer.length))
        // The image is a pure function of `id`, so it is immutable. `private`
        // because it is tied to one user's booking even though it carries no
        // secret, and it keeps shared proxies out of it.
        .set('Cache-Control', 'private, max-age=86400, immutable')
        .send(buffer)
        .end();
    })
    .catch(e => {
      log.error(e, 'transaction-qr-render-failed', { txId: id, message: e?.message });
      res
        .status(500)
        .json({ error: 'Failed to render the QR code.' })
        .end();
    });
};

module.exports.MAX_PER_IP_PER_WINDOW = MAX_PER_IP_PER_WINDOW;
module.exports.MAX_TOTAL_PER_WINDOW = MAX_TOTAL_PER_WINDOW;
module.exports.WINDOW_MS = WINDOW_MS;
