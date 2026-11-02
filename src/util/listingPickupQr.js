/**
 * Client-side helpers for the listing pickup QR code.
 *
 * The authoritative module is server/api-util/listingPickupQr.js - it owns the token scheme,
 * the rendering, and the reasoning behind both. This file is the small read-only half the
 * browser needs (just the path, to link to the confirm page - there is no client-side payload
 * to resolve, unlike the handover QR, since the token is never sent to the browser except
 * embedded in the rendered image itself).
 *
 * Mirrors src/util/handoverQr.js's own reason for being a separate copy from its server
 * module: the server runs as plain CommonJS with no Babel step.
 */

// Must match PICKUP_PATH in server/api-util/listingPickupQr.js.
export const PICKUP_PATH = 'pickup';

/**
 * The in-app path for a listing's pickup-confirm page.
 *
 * Relative and WITHOUT the token - the browser reads the token off its own URL (the query
 * string a scan lands on), never off this helper. Used only for building the <img> src that
 * renders the QR itself, which the server embeds the token into.
 *
 * @param {string} listingId
 * @returns {string|null}
 */
export const pickupPathFor = listingId => (listingId ? `/${PICKUP_PATH}/${listingId}` : null);
