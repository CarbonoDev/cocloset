const { subtractBlockedRanges, findBookableOverlaps } = require('./availabilityHelpers');
const log = require('../log');

// The Integration-API half of the availability-buffer machinery, factored out
// of server/api/create-availability-buffer.js so it can be reused by the
// late-return path in server/api/laundry-transaction-status.js.
//
// availabilityHelpers.js stays what it was: pure date arithmetic with no SDK,
// no logging and no I/O. This module is the thin layer that talks to the API,
// and is deliberately the only place the query -> subtract -> create dance
// exists.
//
// WHY SUBTRACT-THEN-CREATE RATHER THAN CREATE
// The API rejects an availability exception that overlaps an existing one
// (verified: 400 validation-invalid-value). Owners block weeks manually
// (design §13) and back-to-back bookings produce abutting buffers, so overlap
// is normal rather than exceptional. Creating only the not-yet-blocked
// sub-ranges also makes every caller idempotent: re-running after a partial
// failure creates what is still missing instead of 400ing forever. That
// property is what makes the late-return extension below a safe no-op when
// there is nothing to extend.

/**
 * Block `[start, end)` on a listing's calendar, creating only the sub-ranges
 * that are not already blocked.
 *
 * @param {Object} params
 * @param {Object} params.integrationSdk
 * @param {Object} params.listingId - listing UUID (SDK type, not a string)
 * @param {Date} params.start
 * @param {Date} params.end
 * @param {string} [params.txIdForLog] - transaction id, for the overlap warning
 * @returns {Promise<{exceptionIds: string[], segmentsCreated: number,
 *   alreadyBlocked: boolean, unblockedOverlaps: string[]}>}
 */
const reconcileBufferWindow = ({ integrationSdk, listingId, start, end, txIdForLog }) =>
  integrationSdk.availabilityExceptions.query({ listingId, start, end }).then(existingResponse => {
    const existing = (existingResponse.data.data || []).map(e => ({
      id: e.id.uuid,
      start: e.attributes.start,
      end: e.attributes.end,
      seats: e.attributes.seats,
    }));

    const segments = subtractBlockedRanges({ start, end }, existing);
    const unblockedOverlaps = findBookableOverlaps({ start, end }, existing).map(e => e.id);

    if (unblockedOverlaps.length > 0) {
      // The window looks covered but the listing is still bookable on those
      // days. Creating an overlapping exception would 400, so this needs a
      // human - make it unmissable.
      log.error(
        new Error('Buffer window overlaps availability exceptions with seats > 0'),
        'create-availability-buffer-bookable-overlap',
        { txId: txIdForLog, listingId: listingId?.uuid || listingId, unblockedOverlaps }
      );
    }

    // Sequential rather than Promise.all: two concurrent creates on the same
    // listing can race into an overlap rejection against each other.
    return segments
      .reduce(
        (chain, segment) =>
          chain.then(ids =>
            integrationSdk.availabilityExceptions
              .create(
                { listingId, seats: 0, start: segment.start, end: segment.end },
                { expand: true }
              )
              .then(response => ids.concat(response.data.data.id.uuid))
          ),
        Promise.resolve([])
      )
      .then(exceptionIds => ({
        exceptionIds,
        segmentsCreated: segments.length,
        alreadyBlocked: segments.length === 0,
        unblockedOverlaps,
      }));
  });

module.exports = {
  reconcileBufferWindow,
};
