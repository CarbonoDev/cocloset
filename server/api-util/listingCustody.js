const {
  ACTIVE_LAST_TRANSITIONS,
  ACTIVE_STATES,
  stateFromLastTransition,
} = require('./coclosetBookingProcess');
const {
  addDays,
  ceilToUtcDay,
  computeBufferDays,
  floorToUtcDay,
} = require('./availabilityHelpers');

// Garment CUSTODY: `listing.metadata.onLaundry`, and the readiness moment
// `listing.metadata.readyAt` that a real return produces.
//
// ── WHAT `onLaundry` MEANS ───────────────────────────────────────────────────
// Where the physical garment IS, and nothing else:
//
//   true  - it is at the laundry (received in, or just returned by a renter)
//   false - it is with its owner
//
// Per the client:
//
//   > "Si el producto ya fue devuelto a la lavandería, se queda en estatus para
//   >  el listing de onLaundry true, pero si se devuelve al dueño de la prenda
//   >  cambia a false"
//
// It is deliberately NOT a third status enum next to `readinessStatus` (design
// §8) and `state` (the transaction process). Those two answer "how far along is
// this garment / this booking"; this answers "who is holding it". A garment can
// be `onLaundry: true` with no transaction at all, and `readinessStatus:
// available` while sitting in a studio.
//
// It lives in `metadata` rather than `publicData` for a reason that carries
// weight later: metadata is operator/Integration-API-writable only, so a garment
// owner cannot forge their own custody state. Every write below therefore goes
// through the Integration API after our own authorization check
// (api-util/listingOwnerAuth.js), and the value can be trusted as an INPUT to
// other decisions - which is what makes the assigned-laundry guard in
// server/api/listing-laundry-assignment.js worth anything at all.
//
// ── `readyAt` ────────────────────────────────────────────────────────────────
//   > "Al momento en que una laundry recibe una prenda (cuando el cliente la
//   >  devuelve) puede determinar cuantos días va a tardar en lavar para
//   >  habilitar la disponibilidad, por default son los días que establece en su
//   >  configuración de la laundry"
//
// Stored as a TIMESTAMP, not the day count the laundry typed. A day count is only
// meaningful next to the moment it was counted from, and that moment - when the
// garment actually came back - is exactly what the estimate made at `accept` did
// not know. `readyAt` answers "when is this garment bookable again" directly;
// a `cleaningDays: 3` on its own answers nothing three days later.

// A laundry may say "ready today" (0). It may not say "ready in three years": a
// mistyped 3650 would block a calendar for a decade and nobody would find it.
// Both bounds are rejected loudly (400) rather than silently clamped - a client
// sending 400 days has a bug, and quietly turning it into 365 hides it.
const MAX_CLEANING_DAYS = 365;

/**
 * Validate a caller-supplied `cleaningDays`.
 *
 * @param {*} cleaningDays - as received from the request body
 * @returns {{valid: boolean, provided: boolean, value: number|null}}
 *   `provided: false` means the caller omitted it and the configured default
 *   applies. `valid: false` means they sent something unusable.
 */
const validateCleaningDays = cleaningDays => {
  if (cleaningDays === undefined || cleaningDays === null) {
    return { valid: true, provided: false, value: null };
  }
  const isUsable =
    typeof cleaningDays === 'number' &&
    Number.isInteger(cleaningDays) &&
    cleaningDays >= 0 &&
    cleaningDays <= MAX_CLEANING_DAYS;

  return isUsable
    ? { valid: true, provided: true, value: cleaningDays }
    : { valid: false, provided: true, value: null };
};

/**
 * How many days will this garment take to clean?
 *
 * The laundry's own number when it gave one, otherwise the turnaround it has
 * configured for this garment's category — which is already in days, so this is
 * a unit-free choice between two day counts.
 *
 * The default still goes through computeBufferDays() rather than using the
 * number raw, so the "never under-block, always round up" rule stays in one
 * place: a fractional 1.5-day turnaround out of an env var is 2 days, not 1.
 *
 * @param {Object} params
 * @param {number|null} [params.requestedDays] - validated caller value, or null
 * @param {number} params.turnaroundDays - resolved per-category turnaround, in days
 * @returns {{days: number, source: 'laundry'|'configured-turnaround'}}
 */
const resolveCleaningDays = ({ requestedDays, turnaroundDays }) => {
  if (typeof requestedDays === 'number') {
    return { days: requestedDays, source: 'laundry' };
  }
  return {
    days: computeBufferDays(turnaroundDays).totalBufferDays,
    source: 'configured-turnaround',
  };
};

/**
 * The readiness moment, and the whole-day window to block until it.
 *
 * `readyAt` is exact (returnedAt + n days, UTC day arithmetic so DST cannot
 * shift it). The BLOCK is snapped outwards to whole UTC days, because a listing
 * booked by the day is unbookable for any day an exception touches: the day the
 * garment came back must be blocked in full even though it came back at 14:37,
 * and the day it becomes ready must stay blocked unless it becomes ready at
 * midnight. See ceilToUtcDay for why that is a ceiling and not floor + 1.
 *
 * `blockWindow` is null when cleaningDays is 0 - "ready today" means there is
 * nothing to block, and an empty range would throw in subtractBlockedRanges.
 *
 * @param {Object} params
 * @param {Date} params.returnedAt - when the garment physically came back
 * @param {number} params.cleaningDays
 * @returns {{readyAt: Date, blockWindow: {start: Date, end: Date}|null}}
 */
const computeReadiness = ({ returnedAt, cleaningDays }) => {
  const readyAt = addDays(returnedAt, cleaningDays);

  if (cleaningDays <= 0) {
    return { readyAt, blockWindow: null };
  }

  return {
    readyAt,
    blockWindow: { start: floorToUtcDay(returnedAt), end: ceilToUtcDay(readyAt) },
  };
};

/**
 * Does this listing have an ACTIVE transaction? See the ACTIVE_STATES block in
 * api-util/coclosetBookingProcess.js for the definition and its rationale.
 *
 * FAILS CLOSED. Two ways this can go wrong and both are handled as "yes, assume
 * there is one":
 *
 *   1. The query rejects (network, credentials, rate limit). Answering "no" on
 *      an error would turn every Integration API hiccup into permission to
 *      reassign a garment that is out on rental.
 *   2. `lastTransitions` matches nothing for an unrecognised transition name
 *      rather than erroring (verified against Dev). That direction is mitigated
 *      upstream by deriving ACTIVE_LAST_TRANSITIONS from the process
 *      transcription instead of hand-listing it; it cannot be detected here.
 *
 * `listingId` is passed as a single UUID because that is all transactions.query
 * accepts - an array or comma-separated string is rejected with
 * validation-invalid-value (verified; see server/api/laundry-orders.js).
 *
 * @param {Object} params
 * @param {Object} params.integrationSdk
 * @param {Object|string} params.listingId
 * @returns {Promise<{active: boolean, states: Array<string>, unknown: boolean}>}
 *   `unknown: true` means the query failed and `active` is a safe assumption
 *   rather than an observation.
 */
const findActiveTransactions = ({ integrationSdk, listingId }) =>
  integrationSdk.transactions
    .query({
      listingId: listingId?.uuid || listingId,
      lastTransitions: ACTIVE_LAST_TRANSITIONS,
      perPage: 100,
    })
    .then(response => {
      const transactions = response?.data?.data || [];
      const states = transactions
        .map(tx => stateFromLastTransition(tx?.attributes?.lastTransition))
        .filter(state => ACTIVE_STATES.includes(state));

      return { active: transactions.length > 0, states, unknown: false };
    })
    .catch(() => ({ active: true, states: [], unknown: true }));

const conflictError = message => {
  const error = new Error(message);
  error.status = 409;
  error.statusText = message;
  error.data = {};
  return error;
};

/**
 * Throw a 409 unless this listing is free of active transactions.
 *
 * @param {Object} params - as findActiveTransactions
 * @returns {Promise<void>}
 */
const assertNoActiveTransaction = ({ integrationSdk, listingId }) =>
  findActiveTransactions({ integrationSdk, listingId }).then(result => {
    if (!result.active) {
      return;
    }
    throw conflictError(
      result.unknown
        ? 'Could not verify whether this listing has an active transaction; refusing the change.'
        : `This listing has an active transaction (${result.states.join(', ') || 'state unknown'}).`
    );
  });

/**
 * Write custody fields onto a listing via the Integration API.
 *
 * Extended-data updates are merged per top-level key server-side, so this does
 * NOT need to read-and-spread the listing's other `metadata` keys (verified
 * against the real Dev API - see server/api/listing-readiness-status.js).
 * `readyAt` is only included when supplied, so a plain custody toggle never
 * clears a readiness moment it knows nothing about.
 *
 * `readyAt` is stored as an ISO string rather than a Date. The SDK would encode
 * a Date as a transit timestamp, which round-trips back through the Marketplace
 * API to browsers as a value the client would then have to know to unwrap; a
 * string is what every consumer here already does `new Date(...)` on.
 *
 * @param {Object} params
 * @param {Object} params.integrationSdk
 * @param {Object|string} params.listingId
 * @param {boolean} params.onLaundry
 * @param {Date} [params.readyAt]
 * @returns {Promise<{onLaundry: boolean, readyAt: string|undefined}>}
 */
const writeCustodyMetadata = ({ integrationSdk, listingId, onLaundry, readyAt }) => {
  const metadata = {
    onLaundry,
    ...(readyAt ? { readyAt: readyAt.toISOString() } : {}),
  };

  return integrationSdk.listings
    .update({ id: listingId, metadata }, { expand: true })
    .then(() => metadata);
};

module.exports = {
  MAX_CLEANING_DAYS,
  validateCleaningDays,
  resolveCleaningDays,
  computeReadiness,
  findActiveTransactions,
  assertNoActiveTransaction,
  writeCustodyMetadata,
};
