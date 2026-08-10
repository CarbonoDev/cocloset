/**
 * Client-side helpers for the handover QR code.
 *
 * The authoritative module is server/api-util/handoverQr.js - it owns the
 * payload scheme, the `metadata.handoverQr` record, the rendering, and the
 * reasoning behind all three. This file is the small read-only half the browser
 * needs, and exists as a separate copy for the reason documented at the top of
 * server/api-util/coclosetBookingProcess.js: the server runs as plain CommonJS
 * with no Babel step and cannot require an ESM module out of `src/`, and
 * webpack's ModuleScopePlugin blocks the reverse direction.
 *
 * Nothing here generates a QR. Generation happens once, server-side, when the
 * reservation is created.
 */

// Must match HANDOVER_QR_METADATA_KEY in server/api-util/handoverQr.js.
export const HANDOVER_QR_METADATA_KEY = 'handoverQr';

/**
 * The payload to render, given a `handoverQr` record (or nothing).
 *
 * The fallback to the bare transaction id is not a guess: design §11 fixes the
 * QR payload as the transaction id, so a transaction with no record still gets a
 * correct, scannable code. It exists for the bookings that predate this feature
 * - which is all of them, since the QR "nunca se genera" was the bug being
 * fixed - so those are not left with a blank panel. Every reservation created
 * from now on carries a real record.
 *
 * Takes the record rather than the whole metadata object because
 * /api/laundry-orders denormalizes it onto its rows as `row.handoverQr`.
 *
 * @param {Object} [record] - a `metadata.handoverQr` record
 * @param {string} [transactionUuid] - transaction.id.uuid
 * @returns {string|null}
 */
export const handoverQrPayloadFromRecord = (record, transactionUuid) =>
  record?.payload || transactionUuid || null;

/**
 * The payload to render for a transaction, preferring the persisted record.
 *
 * Mirror of `resolveHandoverQrPayload` in server/api-util/handoverQr.js.
 *
 * @param {Object} [metadata] - transaction.attributes.metadata
 * @param {string} [transactionUuid] - transaction.id.uuid
 * @returns {string|null}
 */
export const resolveHandoverQrPayload = (metadata, transactionUuid) =>
  handoverQrPayloadFromRecord(metadata?.[HANDOVER_QR_METADATA_KEY], transactionUuid);
