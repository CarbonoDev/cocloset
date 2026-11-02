// The pickup QR: a provider pauses a listing to go collect their garment from
// the laundry, and this is the code they show at the counter.
//
//   > "quiza podamos empatar un pin ademas del id, la laundry no debe ingresar
//   >  ningun dato adicional ni el provider, solo con el QR" (Jonathan, 2026-09-30)
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT THE SAME SCHEME AS api-util/handoverQr.js
// ---------------------------------------------------------------------------
// The existing handover QR is deliberately NOT a credential - its own header comment
// states plainly that "anyone who knows a transaction id can render the same code", and
// that is safe there because the QR's payload is a transaction id, a resource the two real
// parties (customer, provider) can already read via their own session; the studio confirming
// a scan is still gated by real authorization (assigned-laundry check) and by Sharetribe
// rejecting an out-of-order transition.
//
// This QR has no transaction to lean on: a paused, pure-inventory listing is exactly the §8
// case that has none. And Jonathan asked for something the handover QR explicitly is not -
// a credential, not just an identifier, with NOTHING typed by either party. So the payload
// here is TWO things: the listing id (which id to act on) and a random, unguessable PIN
// (proof the holder is looking at a QR this server actually issued for THIS pickup cycle).
// Without a matching token, not even the assigned laundry's own logged-in session may
// confirm the hand-back through this door - see server/api/listing-pickup-confirm.js.
//
// ---------------------------------------------------------------------------
// LIFECYCLE
// ---------------------------------------------------------------------------
// One token per pickup cycle, idempotent while the garment is still at the laundry (a
// provider re-opening the page gets the SAME code, not a freshly rotated one that would
// invalidate a QR they already saved or printed). The token is cleared the moment custody
// actually flips - see writeCustodyMetadata in listingCustody.js, which every hand-back path
// funnels through - so a spent or abandoned QR cannot be replayed once the garment has gone
// home by any door, QR or the ops-dashboard button alike.
//
// Stored at `listing.metadata.pickupToken`, Integration-API-only like every other custody
// field, so a provider cannot mint their own token and cannot read a value that would let
// them forge one client-side - the client only ever sees the rendered image.

const crypto = require('crypto');

const { renderHandoverQrPngBuffer } = require('./handoverQr');

// 16 random bytes -> 32 hex chars. Short enough for a clean query string, long enough that
// guessing one is not a realistic attack (2^128 space) - this is the PIN, so its whole job is
// to not be guessable.
const PICKUP_TOKEN_BYTES = 16;

const PICKUP_TOKEN_METADATA_KEY = 'pickupToken';

const PICKUP_PATH = 'pickup';

/**
 * A fresh, random pickup token.
 *
 * @returns {string} 32 lowercase hex characters
 */
const generatePickupToken = () => crypto.randomBytes(PICKUP_TOKEN_BYTES).toString('hex');

/**
 * Constant-time comparison of a caller-supplied token against the stored one.
 *
 * A plain `===` leaks timing information proportional to how many leading characters match,
 * which matters for a value whose entire job is to be a secret. Length is checked first and
 * ordinarily (not constant-time) - that alone is not exploitable (the length of a 32-char hex
 * token is not a secret), and it is what lets `timingSafeEqual` run at all, since it throws on
 * mismatched buffer lengths rather than returning false.
 *
 * @param {string} [provided] - from the request
 * @param {string} [stored] - `listing.metadata.pickupToken`
 * @returns {boolean}
 */
const pickupTokensMatch = (provided, stored) => {
  if (typeof provided !== 'string' || typeof stored !== 'string' || !provided || !stored) {
    return false;
  }
  if (provided.length !== stored.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(stored));
};

/**
 * The string actually ENCODED into the image: a URL that opens the pickup-confirm page,
 * carrying both the listing id and the token as a query parameter.
 *
 * DERIVED AT RENDER TIME, exactly like buildHandoverQrScanUrl and for the same reason - the
 * root URL is a property of the environment, not something to persist.
 *
 * @param {string} listingId - the listing's raw uuid string
 * @param {string} token - from generatePickupToken / the stored metadata value
 * @param {string} [rootUrl] - defaults to REACT_APP_MARKETPLACE_ROOT_URL
 * @returns {string} an absolute URL, or a relative one when no root URL is configured
 */
const buildPickupQrScanUrl = (
  listingId,
  token,
  rootUrl = process.env.REACT_APP_MARKETPLACE_ROOT_URL
) => {
  if (!listingId || typeof listingId !== 'string') {
    throw new Error('buildPickupQrScanUrl: listingId is required');
  }
  if (!token || typeof token !== 'string') {
    throw new Error('buildPickupQrScanUrl: token is required');
  }
  const trimmed = typeof rootUrl === 'string' ? rootUrl.trim().replace(/\/+$/, '') : '';
  const path = `${PICKUP_PATH}/${listingId}?token=${token}`;

  // Unlike the handover QR, there is no honest bare-id fallback here: without a root URL the
  // token would have nowhere safe to go, and a relative link is not scannable from a phone
  // camera outside the app anyway.
  return trimmed ? `${trimmed}/${path}` : path;
};

// Rendering is the SAME renderer the handover QR uses (server/api-util/handoverQr.js) - it is
// a pure function of a payload string and render options, with nothing transaction-specific
// about it, so this reuses it directly rather than keeping a second copy of the same
// `QRCode.toBuffer` call to drift from.
module.exports = {
  PICKUP_PATH,
  PICKUP_TOKEN_METADATA_KEY,
  generatePickupToken,
  pickupTokensMatch,
  buildPickupQrScanUrl,
  renderPickupQrPngBuffer: renderHandoverQrPngBuffer,
};
