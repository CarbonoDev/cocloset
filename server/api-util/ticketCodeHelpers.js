// Pure helpers for generating the cosmetic, human-readable ticket code shown
// to laundry staff (design doc §11: "Display ticket code (shown to humans on
// ops screens, not encoded in the QR) = {LAUNDRY_CODE}-{sequence} (e.g.
// PIG-2032), generated once per transaction and stored in
// transaction.metadata.ticketCode at accept time").
//
// This is NOT what's encoded in the QR - per the design doc, the QR payload
// is just the transaction id itself (already globally unique). This code
// exists purely so a human can read/write it on a paper ticket, the way a
// physical dry-cleaner would ("PIG-2032"), and is looked up incidentally,
// never used as the actual scan/lookup key.
//
// See server/api/create-availability-buffer.js for where this is called -
// it reuses the transaction id + assigned laundry that endpoint already
// fetches for the availability-buffer calculation.

const DEFAULT_LAUNDRY_CODE = 'LDY';
const LAUNDRY_CODE_LENGTH = 3;
const SEQUENCE_HEX_LENGTH = 6;

/**
 * Derive a short, stable, uppercase code from a laundry's studioName, e.g.
 * "Studio Pigalle" -> "PIG".
 *
 * Scheme (Phase 1, deliberately simple - the design doc doesn't specify an
 * exact algorithm, only the target shape from the mockups, "PIG-2032" for
 * "Studio Pigalle"):
 *   - split the name on whitespace, strip anything that isn't a letter/digit
 *     from each resulting word
 *   - take the LAST word rather than the first: studio names in the
 *     mockups/profile form follow a "<generic prefix> <distinguishing
 *     name>" pattern ("Studio Pigalle"), so the last word is usually the
 *     more identifying one. This also degrades gracefully for a
 *     single-word name (last word == only word), unlike hardcoding "second
 *     word", which would break on a one-word name.
 *   - uppercase it and take the first 3 characters (pad not needed - a
 *     shorter-than-3-char result, e.g. from "Studio Q", is left as-is
 *     rather than padded, since padding characters would be misleadingly
 *     specific)
 *   - if the name is missing/empty, or has no alphanumeric characters at
 *     all, fall back to a generic "LDY" code rather than throwing - this is
 *     cosmetic display data, not something that should ever block the
 *     `accept` transition it rides along with.
 *
 * Not guaranteed globally unique across laundries (two different laundries
 * could both derive "PIG") - that's fine, because the sequence part (see
 * deriveTicketSequence) only needs to be unique *within* one laundry's own
 * tickets, matching how a physical laundry numbers its own paper tickets
 * starting from 1 (design doc §11 + task spec).
 *
 * @param {string} [studioName]
 * @returns {string}
 */
const deriveLaundryCode = studioName => {
  if (!studioName || typeof studioName !== 'string') {
    return DEFAULT_LAUNDRY_CODE;
  }

  const words = studioName
    .trim()
    .split(/\s+/)
    .map(word => word.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(word => word.length > 0);

  if (words.length === 0) {
    return DEFAULT_LAUNDRY_CODE;
  }

  const lastWord = words[words.length - 1];
  return lastWord.slice(0, LAUNDRY_CODE_LENGTH).toUpperCase();
};

/**
 * Derive the "{sequence}" part of the ticket code from the transaction id
 * itself, rather than a real incrementing per-laundry counter.
 *
 * Why not a real counter: a gapless/strictly-sequential per-laundry counter
 * needs its own persistent, atomically-incrementable storage - Sharetribe
 * doesn't expose an "increment and return" primitive we could piggyback on,
 * and the alternative (query every existing ticket for this laundry, take
 * max+1) is both a race condition under concurrent `accept`s and an
 * unbounded query that gets slower as a laundry's ticket volume grows.
 * That's real infrastructure, out of scope for Phase 1 ("keep it simple").
 *
 * The design doc only requires the display code to be purely cosmetic and
 * per-laundry unique-*enough* to look like a real ticket number, not
 * gapless or strictly sequential. So Phase 1 takes a shortcut: slice a few
 * hex characters off the tail of the (already globally unique) transaction
 * id and uppercase them. This is not guaranteed unique even within one
 * laundry, but a collision is a cosmetic near-miss (two paper tickets
 * happening to display the same code), not a functional bug - the QR
 * code / actual transaction id is always the real lookup key (design doc
 * §11), never this display code.
 *
 * @param {string} transactionUuid - the transaction id's raw uuid string
 * @returns {string}
 */
const deriveTicketSequence = transactionUuid => {
  if (!transactionUuid || typeof transactionUuid !== 'string') {
    throw new Error('deriveTicketSequence: transactionUuid is required');
  }

  const hexOnly = transactionUuid.replace(/-/g, '');
  return hexOnly.slice(-SEQUENCE_HEX_LENGTH).toUpperCase();
};

/**
 * Build the full display ticket code, e.g. "PIG-A3F91C".
 *
 * @param {string} [studioName] - assigned laundry's publicData.laundryProfile.studioName
 * @param {string} transactionUuid - the transaction id's raw uuid string
 * @returns {string}
 */
const buildTicketCode = (studioName, transactionUuid) => {
  const laundryCode = deriveLaundryCode(studioName);
  const sequence = deriveTicketSequence(transactionUuid);
  return `${laundryCode}-${sequence}`;
};

module.exports = {
  DEFAULT_LAUNDRY_CODE,
  LAUNDRY_CODE_LENGTH,
  SEQUENCE_HEX_LENGTH,
  deriveLaundryCode,
  deriveTicketSequence,
  buildTicketCode,
};
