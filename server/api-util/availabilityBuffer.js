const {
  computeAvailabilityBufferWindow,
  findBookableOverlaps,
  resolveTurnaroundDays,
  subtractBlockedRanges,
} = require('./availabilityHelpers');
const { getListingCategoryValues, resolveCategoryTurnaroundDays } = require('./categoryPricing');
const { notifyPickupScheduled } = require('./laundryMailer');
const { readAssignedLaundryId } = require('./laundryAssignment');
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

/**
 * Block a newly accepted booking's window: the rental dates plus the assigned laundry's
 * turnaround afterwards.
 *
 * EXTRACTED SO THERE IS ONE COPY. Two paths now reach "a booking has just been accepted":
 * server/api/create-availability-buffer.js, fired from the browser after a provider accepts,
 * and server/api/auto-accept-booking.js, which accepts on the operator's behalf when the
 * garment is already at its studio. Both have to resolve the same turnaround, send the same
 * §3.12 notification and block the same window - and this repository has already been bitten
 * once by three hand-maintained copies of "resolve, then build" drifting apart (see the note
 * on buildLineItemsForListing). So the composition lives here and the endpoints call it.
 *
 * Takes an ALREADY-FETCHED transaction: both callers have one in hand, and re-reading it
 * would be a second Integration API round trip for data that cannot have changed inside the
 * same request.
 *
 * @param {Object} params
 * @param {Object} params.integrationSdk
 * @param {Object} params.transaction - the transaction entity
 * @param {Array<Object>} params.included - its `included` array (listing, booking, customer)
 * @param {string} params.txIdForLog
 * @returns {Promise<Object>} `{ skipped: true, reason }` when there is nothing to do, or the
 *   reconciliation result plus the window that was computed
 */
const buildBufferForAcceptedTransaction = ({
  integrationSdk,
  transaction,
  included = [],
  txIdForLog,
}) => {
  const listingRef = transaction?.relationships?.listing?.data;
  const bookingRef = transaction?.relationships?.booking?.data;
  const customerRef = transaction?.relationships?.customer?.data;

  const listing = listingRef
    ? included.find(i => i.type === 'listing' && i.id.uuid === listingRef.id.uuid)
    : null;
  const booking = bookingRef
    ? included.find(i => i.type === 'booking' && i.id.uuid === bookingRef.id.uuid)
    : null;
  const customer = customerRef
    ? included.find(i => i.type === 'user' && i.id.uuid === customerRef.id.uuid)
    : null;

  if (!listing) {
    return Promise.resolve({ skipped: true, reason: 'no-listing' });
  }
  if (!booking || !booking.attributes?.start || !booking.attributes?.end) {
    return Promise.resolve({ skipped: true, reason: 'no-booking-dates' });
  }

  const assignedLaundryId = readAssignedLaundryId(listing);
  if (!assignedLaundryId) {
    // Not every listing has a laundry assigned. A valid "nothing to do", not an error.
    return Promise.resolve({ skipped: true, reason: 'no-laundry-assigned' });
  }

  const { start: bookingStart, end: bookingEnd } = booking.attributes;

  return integrationSdk.users.show({ id: assignedLaundryId }).then(userResponse => {
    const laundryUser = userResponse.data.data;
    const laundryProfile = laundryUser.attributes?.profile || {};

    // Size the buffer from the turnaround for the garment ACTUALLY being cleaned, not a
    // studio-wide average: a laundry sets DAYS per top-level category, and the listing's own
    // category selects one. Falls back to the studio-wide value, then to the env default.
    const turnaroundDays = resolveTurnaroundDays(
      resolveCategoryTurnaroundDays(
        laundryProfile.privateData,
        getListingCategoryValues(listing.attributes?.publicData)
      ),
      process.env.DEFAULT_LAUNDRY_BUFFER_DAYS
    );

    const {
      start,
      end,
      bufferBeforeDays,
      bufferAfterDays,
      totalBufferDays,
    } = computeAvailabilityBufferWindow(bookingStart, bookingEnd, turnaroundDays);

    // §3.12 Pickup Scheduled. Fired before the calendar work rather than after it, and never
    // awaited: the laundry needs to know a rental is confirmed regardless of whether an
    // exception write succeeds, and this promise cannot reject (see api-util/laundryMailer.js).
    notifyPickupScheduled({
      to: laundryUser.attributes?.email,
      laundryName: laundryProfile.publicData?.laundryProfile?.studioName,
      garmentTitle: listing.attributes?.title,
      customerName: customer?.attributes?.profile?.displayName,
      pickupDate: bookingStart,
      rack: listing.attributes?.privateData?.currentRack,
      transactionId: txIdForLog,
    });

    return reconcileBufferWindow({
      integrationSdk,
      listingId: listing.id,
      start,
      end,
      txIdForLog,
    }).then(exceptionResult => ({
      skipped: false,
      ...exceptionResult,
      listingId: listing.id.uuid,
      start,
      end,
      bufferBeforeDays,
      bufferAfterDays,
      totalBufferDays,
    }));
  });
};

module.exports = {
  reconcileBufferWindow,
  buildBufferForAcceptedTransaction,
};
