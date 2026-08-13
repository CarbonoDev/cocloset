// The handover QR code (client requirement, 2026-08: "El QR que se debe mostrar
// al cliente, nunca se genera, se debe generar al momento de crear la
// reservación, este mismo qr debe funcionar para recibir la prenda, como para
// entregarla, y debe desaparecer despues de este evento, la información del qr
// debe permanecer en la metadata de la transacción").
//
// Four requirements, and where each one is satisfied:
//
//   1. "se debe generar al momento de crear la reservación" - `ensureHandoverQr`
//      is called from server/api/initiate-privileged.js and
//      server/api/transition-privileged.js, i.e. the two server endpoints that
//      create a `cocloset-booking` reservation. Not lazily on render. See the
//      GENERATION TIMING note below.
//   2. "este mismo qr debe funcionar para recibir la prenda, como para
//      entregarla" - ONE record, whose `scope` is `pickup-and-return` and
//      whose scope maps to BOTH handover transitions (see
//      HANDOVER_QR_SCOPES). `ensureHandoverQr` is idempotent and never
//      regenerates, so a second QR for the return step cannot come into
//      existence by accident.
//   3. "debe desaparecer despues de este evento" - display only, derived from
//      the transaction's real process state via `isHandoverQrVisibleState`.
//      There is deliberately NO `metadata.qrUsed` flag: the state machine
//      already knows, and a second source of truth would drift from it.
//   4. "la información del qr debe permanecer en la metadata de la
//      transacción" - the record lives at `transaction.metadata.handoverQr`
//      and is never deleted. Hiding it is a UI concern; the record is a
//      permanent part of the transaction.
//
// ---------------------------------------------------------------------------
// WHAT IS STORED, AND WHAT IS NOT
// ---------------------------------------------------------------------------
// Stored (~150 bytes):
//
//   metadata.handoverQr = {
//     version: 1,
//     payload: '<transaction uuid>',
//     encoding: 'transaction-id',
//     scope: 'pickup-and-return',
//     createdAt: '<ISO 8601>',
//   }
//
// NOT stored: the rendered image. A PNG data URL for a UUID payload measures
// ~2.0 KB (1501 PNG bytes, verified with qrcode@1.5.4 at scale 6 / margin 2),
// i.e. ~13x the descriptor above. Three reasons that is the wrong trade:
//
//   - `metadata` is returned inline on every `transactions.show` AND every
//     `transactions.query`. server/api/laundry-orders.js queries transactions
//     for every listing assigned to a laundry, so an embedded image would
//     multiply the ops dashboard payload by an order of magnitude - for an
//     image that response does not even use (the ops table renders its own
//     thumbnail from the endpoint).
//   - It is fully derivable from `payload`, so storing it is a cache in the
//     wrong tier: immutable, unversioned, and impossible to re-render at a
//     different size or error-correction level without a data migration.
//   - Transaction metadata has a practical ceiling (~256 KB) shared with
//     everything else on the transaction (`ticketCode`, `cleaningPhase`,
//     `damageReported`, `offers[]`, and whatever the next feature adds).
//     Spending 2 KB of it on a regenerable PNG buys nothing.
//
// Also rejected: minting a NEW random identifier as the payload. Design doc
// §11 already settled this - the payload is the Sharetribe transaction id,
// which is already globally unique, needs no ID-generation service and no
// collision handling, and (crucially) makes the QR reconstructible from the
// transaction alone even if this metadata record were ever lost.
//
// ---------------------------------------------------------------------------
// GENERATION TIMING - why the reservation-creation endpoints and not `accept`
// ---------------------------------------------------------------------------
// The obvious alternative was server/api/create-availability-buffer.js, which
// runs once per accepted booking and already fetches everything. It was
// rejected for the reason its own header comment documents at length: it is
// fired FROM THE BROWSER after the `accept` transition has already succeeded,
// so it silently does not run when the tab is closed, when an operator accepts
// from Sharetribe Console, or when an automatic transition reaches `accepted`.
// That is an acceptable property for a best-effort calendar reconciliation. It
// is not acceptable for the one artifact the customer is told to bring to the
// counter - "nunca se genera" is precisely the bug being fixed here, and
// hanging the fix off a hook that sometimes does not fire would reproduce it.
//
// `request-payment` / `request-payment-after-inquiry` are privileged
// transitions, which means a `cocloset-booking` reservation CANNOT be created
// without passing through initiate-privileged.js / transition-privileged.js.
// There is no Console path and no client path that bypasses them. That makes
// this the only hook in the codebase that is both server-side and
// unconditional, and it is also the literal reading of the requirement
// ("al momento de crear la reservación" - when the reservation is created,
// which is checkout, not provider acceptance).
//
// Consequence, stated plainly: a reservation whose payment expires also gets a QR record.
// That is one wasted Integration API write on an abandoned checkout, and the record is never
// displayed for such a transaction (see HANDOVER_QR_VISIBLE_STATES, which starts at
// `preauthorized` - i.e. once the payment is confirmed). Cheap, and far preferable to a QR
// that is sometimes missing.

const QRCode = require('qrcode');

const { STATES, TRANSITIONS } = require('./coclosetBookingProcess');

// The metadata key. One place, because it is a wire contract between this
// module, the ops endpoints and the client.
const HANDOVER_QR_METADATA_KEY = 'handoverQr';

// Bump when the payload SCHEME changes (not when rendering options change -
// those are not persisted). A reader that does not recognise a version should
// fall back to `resolveHandoverQrPayload`, which does not need the record.
const HANDOVER_QR_VERSION = 1;

// The payload is the transaction id itself (design §11).
const HANDOVER_QR_ENCODING = 'transaction-id';

// ---------------------------------------------------------------------------
// ONE QR FOR BOTH HANDOVERS
// ---------------------------------------------------------------------------
// This map is the whole point. The `scope` persisted in metadata is not a
// label - it resolves to the exact set of transitions the single code is
// entitled to drive, and `pickup-and-return` contains BOTH handover
// directions:
//
//   - laundry -> customer (collection): transition/laundry-confirm-pickup
//   - customer -> laundry (return):     transition/laundry-confirm-return
//                                       transition/laundry-confirm-return-late
//
// (`-late` is the same physical event; the EDN needs two transitions only
// because `:from` is single-valued and the late path sits in `overdue`.)
//
// If someone later adds a second code for the return step, they have to add a
// second scope here and explain why - which is exactly the conversation the
// requirement wants to force.
const HANDOVER_QR_SCOPE_PICKUP_AND_RETURN = 'pickup-and-return';

const HANDOVER_QR_SCOPES = {
  [HANDOVER_QR_SCOPE_PICKUP_AND_RETURN]: [
    TRANSITIONS.LAUNDRY_CONFIRM_PICKUP,
    TRANSITIONS.LAUNDRY_CONFIRM_RETURN,
    TRANSITIONS.LAUNDRY_CONFIRM_RETURN_LATE,
  ],
};

/**
 * The transitions a QR record of this scope serves.
 *
 * @param {string} scope - a `metadata.handoverQr.scope` value
 * @returns {Array<string>} transition names; empty for an unknown scope
 */
const transitionsServedByHandoverQr = scope => HANDOVER_QR_SCOPES[scope] || [];

// ---------------------------------------------------------------------------
// WHEN THE QR IS SHOWN - derived from process state, never from a flag
// ---------------------------------------------------------------------------
// Visible from `preauthorized` - the moment the customer's payment is confirmed - up to and
// including `overdue` (the garment is still out and still has to come back).
//
//   > "el QR debe mostrarse al cliente desde que se confirma el pago pero con la instrucción
//   >  de que debe esperar a que el provider entregue la prenda y la lavandería haga su
//   >  proceso y que debe acudir a la lavandería por su prenda"
//
// It used to start at `accepted`, on the argument that showing a collection code for a
// booking the provider might still decline would be worse than showing none. The client
// overrode that, and the answer to the original worry is the COPY rather than the absence of
// the code: the panel now states what has to happen before the garment can be collected. A
// customer who has just paid wants to see that something exists; an empty panel reads as a
// broken purchase.
//
// Hidden from `returned` onwards, because entering `returned` IS the second
// handover: `laundry-confirm-return` / `-late` are the only ways in, and both
// mean the laundry has physically taken the garment back. Both handovers are
// therefore complete and the code has nothing left to do - "debe desaparecer
// despues de este evento".
//
// Still hidden before `preauthorized` (`inquiry`, `pending-payment`): the record exists
// from checkout, but until the payment is confirmed there is no rental to collect.
//
// NOTE ON WHAT HIDING DOES AND DOES NOT BUY: the QR is an IDENTIFIER, not a
// credential - it encodes a transaction id and nothing secret. Hiding it does
// not make it stop working, and it was never what stopped a stale code being
// re-used: Sharetribe rejects an out-of-order transition with HTTP 409
// `transaction-invalid-transition` (see coclosetBookingProcess.js), so a
// re-scanned code after the return simply cannot advance anything. Hiding is a
// UI affordance on top of an enforcement that already exists.
const HANDOVER_QR_VISIBLE_STATES = [
  STATES.PREAUTHORIZED,
  STATES.ACCEPTED,
  STATES.READY_FOR_PICKUP,
  STATES.PICKED_UP,
  STATES.OVERDUE,
];

/**
 * Should the handover QR be displayed for a transaction in this state?
 *
 * @param {string} [state] - a `cocloset-booking` state name (see
 *   coclosetBookingProcess.stateFromLastTransition)
 * @returns {boolean}
 */
const isHandoverQrVisibleState = state => HANDOVER_QR_VISIBLE_STATES.includes(state);

// ---------------------------------------------------------------------------
// The payload and the record
// ---------------------------------------------------------------------------

/**
 * The string encoded into the QR image.
 *
 * This is the identity function on the transaction id, and it exists anyway so
 * that the scheme lives in exactly one place. If the payload ever gains a
 * prefix or a checksum, this is the only function that changes - and
 * HANDOVER_QR_VERSION is what tells readers which scheme they are looking at.
 *
 * @param {string} transactionUuid - the transaction id's raw uuid string
 * @returns {string}
 */
const buildHandoverQrPayload = transactionUuid => {
  if (!transactionUuid || typeof transactionUuid !== 'string') {
    throw new Error('buildHandoverQrPayload: transactionUuid is required');
  }
  return transactionUuid;
};

// The path the scanned code opens. Mirrored by HANDOVER_PATH in src/util/handoverQr.js and
// by the route in src/routing/routeConfiguration.js; handoverQrUrlAgreement.test.js keeps
// the three in step, because a mismatch is a QR that scans to a 404 and there is no way to
// notice that from either side alone.
const HANDOVER_PATH = 'handover';

/**
 * The string actually ENCODED into the image: a URL that opens the handover page.
 *
 *   > "al escanear debe llevar al paso siguiente con un button para confirmar y avanzar"
 *
 * A bare UUID is not scannable *to* anywhere - a phone camera reads it and offers nothing to
 * do with it, which is why the code could be shown but never acted on. Wrapping the same id
 * in a URL is what turns the scan into a navigation.
 *
 * DERIVED AT RENDER TIME, NOT PERSISTED. The record keeps storing the transaction id (see
 * `buildHandoverQrRecord`), and this function is applied when the image is drawn. That is
 * deliberate: the root URL is a property of the ENVIRONMENT, and a record written in Dev
 * would otherwise carry a Dev URL for the life of the transaction - including after the
 * marketplace is promoted. Deriving also means every booking made before this change gets a
 * working, navigable code with no migration, since the id it stored is all this needs.
 *
 * The id remains the canonical identity (design §11), so nothing that reads `payload` had to
 * change.
 *
 * @param {string} transactionUuid
 * @param {string} [rootUrl] - defaults to REACT_APP_MARKETPLACE_ROOT_URL
 * @returns {string} an absolute URL, or the bare id when no root URL is configured
 */
const buildHandoverQrScanUrl = (
  transactionUuid,
  rootUrl = process.env.REACT_APP_MARKETPLACE_ROOT_URL
) => {
  const id = buildHandoverQrPayload(transactionUuid);
  const trimmed = typeof rootUrl === 'string' ? rootUrl.trim().replace(/\/+$/, '') : '';

  // No configured root URL means we cannot build an absolute link, and a relative one is not
  // scannable. Fall back to the bare id rather than to a broken URL: the code still
  // identifies the transaction, the ops table can still read it, and the manual fallback
  // (typing the id into the ops search) still works. Silently emitting `/handover/<id>` with
  // no host would produce a code that looks fine and resolves nowhere.
  return trimmed ? `${trimmed}/${HANDOVER_PATH}/${id}` : id;
};

/**
 * Build the record that is persisted at `transaction.metadata.handoverQr`.
 *
 * @param {string} transactionUuid - the transaction id's raw uuid string
 * @param {Function} [now] - injectable clock, for tests
 * @returns {Object} the metadata record
 */
const buildHandoverQrRecord = (transactionUuid, now = () => new Date()) => ({
  version: HANDOVER_QR_VERSION,
  payload: buildHandoverQrPayload(transactionUuid),
  encoding: HANDOVER_QR_ENCODING,
  // Persisted so the record itself states that one code covers both handovers,
  // rather than that fact living only in a comment.
  scope: HANDOVER_QR_SCOPE_PICKUP_AND_RETURN,
  createdAt: now().toISOString(),
});

/**
 * The payload to render for a transaction, preferring the persisted record.
 *
 * The fallback to the bare transaction id is NOT a guess: design §11 fixes the
 * payload as the transaction id, so a transaction with no record still has a
 * correct, scannable code. It exists for the transactions that predate this
 * feature (which is all of them - the QR "nunca se genera" was the bug), so
 * those bookings are not left without one. Every reservation created from now
 * on has a real record.
 *
 * @param {Object} [metadata] - `transaction.attributes.metadata`
 * @param {string} [transactionUuid]
 * @returns {string|null}
 */
const resolveHandoverQrPayload = (metadata, transactionUuid) => {
  const stored = metadata?.[HANDOVER_QR_METADATA_KEY]?.payload;
  return stored || transactionUuid || null;
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
// Rendered server-side, not in the browser, so that ONE implementation serves
// the customer's screen, the laundry ops table, a future laundry email and
// printing. `renderHandoverQrDataUrl` is defined in terms of
// `renderHandoverQrPngBuffer` rather than calling `QRCode.toDataURL`
// separately, so the two forms cannot drift.
//
// - errorCorrectionLevel 'M' (~15% recovery): the default, and the right one
//   for a code that will be shown on a phone screen and printed on a paper
//   ticket that gets handled in a laundry.
// - margin 2 modules: below the spec's 4 but enough for a screen scan, and it
//   keeps the image tight in a table cell.
// - scale 6 (6 px per module): a 36-char UUID needs a version-3 symbol, so
//   this lands around 250 px - large enough to scan off a phone, small enough
//   to serve per ops-table row.
const HANDOVER_QR_RENDER_OPTIONS = {
  errorCorrectionLevel: 'M',
  margin: 2,
  scale: 6,
  type: 'png',
};

/**
 * Render the QR as PNG bytes.
 *
 * @param {string} payload - from buildHandoverQrPayload / resolveHandoverQrPayload
 * @returns {Promise<Buffer>}
 */
const renderHandoverQrPngBuffer = payload => {
  if (!payload || typeof payload !== 'string') {
    return Promise.reject(new Error('renderHandoverQrPngBuffer: payload is required'));
  }
  return QRCode.toBuffer(payload, HANDOVER_QR_RENDER_OPTIONS);
};

/**
 * Render the QR as a `data:image/png;base64,...` URL.
 *
 * Not used by the web UI (which points an <img> at server/api/transaction-qr.js
 * instead - see that file for why), but this is the form an email template or a
 * print job needs, and it must come from the same renderer as everything else.
 *
 * @param {string} payload
 * @returns {Promise<string>}
 */
const renderHandoverQrDataUrl = payload =>
  renderHandoverQrPngBuffer(payload).then(
    buffer => `data:image/png;base64,${buffer.toString('base64')}`
  );

// ---------------------------------------------------------------------------
// The writer
// ---------------------------------------------------------------------------

/**
 * Create `transaction.metadata.handoverQr` if it is not already there.
 *
 * IDEMPOTENT BY DESIGN, and that is requirement (2) enforced rather than
 * hoped for: there is exactly one QR per transaction for its whole life, so
 * every call site can call this unconditionally without any risk of minting a
 * second code for the return step. An existing record is returned untouched -
 * including its original `createdAt`, which would otherwise quietly become
 * "the last time someone happened to call this".
 *
 * Renders the image before writing, so a payload that cannot be encoded fails
 * here (at creation, where it is loggable) rather than at the counter.
 *
 * NEVER REJECTS. A QR is not worth failing a checkout over: the caller is a
 * reservation-creating endpoint whose response the customer is waiting on, and
 * `resolveHandoverQrPayload` means the QR still renders even when the record
 * is missing. Failures are logged and reported in the resolved value.
 *
 * The write is `integrationSdk.transactions.updateMetadata` with only this one
 * key. Verified against the real Dev Integration API: updateMetadata is a
 * TOP-LEVEL SHALLOW MERGE - sibling keys (`ticketCode`, `cleaningPhase`,
 * `damageReported`, `offers`) survive untouched, and an explicit `null`
 * removes a key. So this does not need to read-modify-write the whole metadata
 * object, and cannot clobber a concurrent write to another key.
 *
 * @param {Object} params
 * @param {Object} params.integrationSdk - from api-util/integrationSdk
 * @param {string|Object} params.transactionId - uuid string or UUID object
 * @param {Object} [params.existingMetadata] - `transaction.attributes.metadata`
 * @param {Object} [params.log] - server/log.js (optional; injectable for tests)
 * @param {Function} [params.now] - injectable clock, for tests
 * @returns {Promise<{created: boolean, record: Object|null, error?: Error}>}
 */
const ensureHandoverQr = ({ integrationSdk, transactionId, existingMetadata, log, now }) => {
  const transactionUuid = transactionId?.uuid || transactionId;

  const existing = existingMetadata?.[HANDOVER_QR_METADATA_KEY];
  if (existing?.payload) {
    return Promise.resolve({ created: false, record: existing });
  }

  return Promise.resolve()
    .then(() => {
      const record = buildHandoverQrRecord(transactionUuid, now);
      return renderHandoverQrPngBuffer(record.payload)
        .then(() =>
          integrationSdk.transactions.updateMetadata({
            id: transactionUuid,
            metadata: { [HANDOVER_QR_METADATA_KEY]: record },
          })
        )
        .then(() => ({ created: true, record }));
    })
    .catch(error => {
      // The customer will still see a QR (resolveHandoverQrPayload falls back
      // to the transaction id), but requirement (4) - the record persisting in
      // metadata - has not been met for this transaction, so this must be
      // visible rather than swallowed.
      if (log?.error) {
        log.error(error, 'handover-qr-write-failed', {
          txId: transactionUuid || 'unknown',
          message: error?.message,
        });
      }
      return { created: false, record: null, error };
    });
};

module.exports = {
  HANDOVER_PATH,
  HANDOVER_QR_METADATA_KEY,
  HANDOVER_QR_VERSION,
  HANDOVER_QR_ENCODING,
  HANDOVER_QR_SCOPE_PICKUP_AND_RETURN,
  HANDOVER_QR_SCOPES,
  HANDOVER_QR_VISIBLE_STATES,
  HANDOVER_QR_RENDER_OPTIONS,
  transitionsServedByHandoverQr,
  isHandoverQrVisibleState,
  buildHandoverQrPayload,
  buildHandoverQrScanUrl,
  buildHandoverQrRecord,
  resolveHandoverQrPayload,
  renderHandoverQrPngBuffer,
  renderHandoverQrDataUrl,
  ensureHandoverQr,
};
