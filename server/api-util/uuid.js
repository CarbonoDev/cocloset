// ---------------------------------------------------------------------------
// AN ID THIS APP CAN HAND TO EITHER SDK
// ---------------------------------------------------------------------------
//
//   > "Al mandar llamar al endpoint que hace el autoacept obtengo esto (...)
//   >  Don't know how to serialize query parameter 'id': [object Object]"
//
// ── THE TRAP, WHICH IS INVISIBLE FROM EITHER SIDE ──────────────────────────
//
// This app runs TWO Sharetribe SDKs, and each ships its own `UUID` class:
//
//   - `sharetribe-flex-sdk` decodes the transit request bodies (api-util/sdk.js), so a
//     `UUID` the browser put in a body arrives here as a FLEX-SDK UUID;
//   - `sharetribe-flex-integration-sdk` is what every privileged endpoint calls, and its
//     query serializer accepts a value only if it is `instanceof` ITS OWN UUID class.
//
// Cross-package `instanceof` is always false. So a perfectly valid id, correctly encoded and
// correctly decoded, falls past every branch of that serializer and comes out as
// `Don't know how to serialize query parameter 'id': [object Object]` - an error that names
// neither SDK and reads like a corrupt request. Measured against the real Dev API rather than
// reasoned about: a flex-sdk UUID and a plain `{ uuid }` object both fail, while an
// integration UUID and a plain STRING both resolve.
//
// A STRING IS THE ANSWER, not an integration UUID. Both SDKs accept one, so the value stays
// correct wherever it is passed next, and there is no third type for the next reader to get
// wrong. The Marketplace API returns ids as `{ uuid }` and both SDKs' types expose `.uuid`,
// so one property covers every shape this can arrive in.
//
// WHERE TO USE IT: at the boundary, on anything id-shaped that came from a request, before it
// reaches an SDK call. Not deeper - normalising twice is harmless but pretending the seam is
// somewhere else is how the second copy of this bug gets written.

/**
 * The plain-string form of an id, whatever shape it arrived in.
 *
 * Accepts a string, either SDK's `UUID`, or the `{ uuid }` object a JSON client sends.
 *
 * @param {string|{uuid: string}} value
 * @returns {string|null} null when there is no usable id, so callers can keep their own
 *   "missing id" answer rather than sending `"undefined"` to the API
 */
const uuidString = value => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  // Covers both SDKs' UUID instances and the plain `{ uuid }` object, without importing
  // either type - which is the whole point: this file must not have an opinion about which
  // SDK produced the value.
  const inner = value?.uuid;
  return typeof inner === 'string' && inner.trim() !== '' ? inner.trim() : null;
};

module.exports = { uuidString };
