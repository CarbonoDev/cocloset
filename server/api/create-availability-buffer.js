const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const {
  computeAvailabilityBufferWindow,
  resolveTurnaroundHours,
} = require('../api-util/availabilityHelpers');
const { buildTicketCode } = require('../api-util/ticketCodeHelpers');

// Creates the "buffer window" availability exception (seats: 0, i.e.
// unavailable) around a booking once it's been accepted, so the listing
// can't be double-booked while the garment is with the laundry: it covers
// buffer-before + the rental dates themselves + buffer-after (see design
// doc §5/§13 and server/api-util/availabilityHelpers.js for the buffer-day
// rounding rule).
//
// This must run via the Integration API rather than a trusted
// customer/provider token exchange (cf. transition-privileged.js) because:
//   - it needs to act on the GARMENT OWNER's listing regardless of which
//     party (customer or operator) triggered the `accept` transition, and
//   - `accept` is not itself a privileged transition in this process (see
//     isPrivileged() in src/transactions/transactionProcessBooking.js), so
//     there's no existing trusted-token flow to piggyback on here.
//
// This is best-effort infrastructure, not part of the payment-critical
// path: the caller (TransactionPage.duck.js) fires this after `accept` has
// already succeeded and does not roll back or block the UI on failure here
// - see the fire-and-continue call site for how failures are surfaced.
//
// While it's here, this endpoint also generates and stores the cosmetic,
// human-readable ticket code (design doc §11, `transaction.metadata.
// ticketCode`, e.g. "PIG-A3F91C") shown to laundry staff on paper/ops
// screens - NOT the QR payload, which is just the transaction id itself.
// It piggybacks here rather than getting its own accept-hook because this
// endpoint already runs exactly once per accepted booking and already has
// the transaction id + assigned laundry in hand (see
// api-util/ticketCodeHelpers.js for the derivation logic).
//
// Request body: { transactionId } (a transaction UUID, transit-encoded).
// Success response (200): { data: { exceptionId, listingId, start, end,
//   bufferBeforeDays, bufferAfterDays, totalBufferDays, ticketCode } }
// "Nothing to do" response (200): { data: null, reason: '<why-skipped>' }
//   - used for expected-but-unconfigured states (no assigned laundry) that
//     are not really errors. No ticket code is generated in this case
//     either, since the code is derived from the assigned laundry's name.
// Failure response: standard handleError() shape (see api-util/sdk.js).
module.exports = (req, res) => {
  const { transactionId } = req.body || {};

  if (!transactionId) {
    res
      .status(400)
      .json({ error: 'Missing required "transactionId" in request body.' })
      .end();
    return;
  }

  const integrationSdk = getIntegrationSdk();

  integrationSdk.transactions
    .show({ id: transactionId, include: ['listing', 'booking'] })
    .then(transactionResponse => {
      const { data, included = [] } = transactionResponse.data;

      const listingRef = data.relationships?.listing?.data;
      const bookingRef = data.relationships?.booking?.data;

      const listing = listingRef
        ? included.find(i => i.type === 'listing' && i.id.uuid === listingRef.id.uuid)
        : null;
      const booking = bookingRef
        ? included.find(i => i.type === 'booking' && i.id.uuid === bookingRef.id.uuid)
        : null;

      if (!listing) {
        const message = `create-availability-buffer: transaction ${transactionId.uuid} has no listing relationship.`;
        const error = new Error(message);
        error.status = 422;
        error.statusText = message;
        error.data = {};
        throw error;
      }
      if (!booking || !booking.attributes?.start || !booking.attributes?.end) {
        const message = `create-availability-buffer: transaction ${transactionId.uuid} has no booking dates.`;
        const error = new Error(message);
        error.status = 422;
        error.statusText = message;
        error.data = {};
        throw error;
      }

      const assignedLaundryId = listing.attributes?.publicData?.assignedLaundryId;
      const { start: bookingStart, end: bookingEnd } = booking.attributes;

      if (!assignedLaundryId) {
        // Not every listing is guaranteed to have a laundry assigned (e.g.
        // partial rollout, or listings created before this feature). This
        // is a valid "nothing to do" state, not a server error.
        return { skipped: true, reason: 'no-laundry-assigned', listing, bookingStart, bookingEnd };
      }

      return integrationSdk.users
        .show({ id: assignedLaundryId })
        .then(userResponse => {
          const laundry = userResponse.data.data;
          const laundryTurnaroundHours = laundry.attributes?.profile?.privateData?.turnaroundHours;
          const turnaroundHours = resolveTurnaroundHours(
            laundryTurnaroundHours,
            process.env.DEFAULT_LAUNDRY_BUFFER_HOURS
          );
          const studioName = laundry.attributes?.profile?.publicData?.laundryProfile?.studioName;
          // Idempotency (step 5): `accept` could in theory fire more than
          // once (e.g. `operator-accept` after `accept` was somehow already
          // processed, or a retried request) - only ever generate the
          // ticket code once per transaction.
          const existingTicketCode = data.attributes?.metadata?.ticketCode;

          return {
            skipped: false,
            listing,
            bookingStart,
            bookingEnd,
            turnaroundHours,
            studioName,
            existingTicketCode,
          };
        });
    })
    .then(result => {
      if (result.skipped) {
        res
          .status(200)
          .set('Content-Type', 'application/json')
          .send({ data: null, reason: result.reason })
          .end();
        return null;
      }

      const {
        listing,
        bookingStart,
        bookingEnd,
        turnaroundHours,
        studioName,
        existingTicketCode,
      } = result;
      const { start, end, bufferBeforeDays, bufferAfterDays, totalBufferDays } =
        computeAvailabilityBufferWindow(bookingStart, bookingEnd, turnaroundHours);

      // These two writes are independent of each other (one touches the
      // listing's availability exceptions, the other the transaction's
      // metadata), so kick both off concurrently rather than chaining them.
      const exceptionPromise = integrationSdk.availabilityExceptions
        .create({ listingId: listing.id, seats: 0, start, end }, { expand: true })
        .then(exceptionResponse => exceptionResponse.data.data);

      const ticketCodePromise = existingTicketCode
        ? Promise.resolve(existingTicketCode)
        : integrationSdk.transactions
            .updateMetadata(
              {
                id: transactionId,
                metadata: { ticketCode: buildTicketCode(studioName, transactionId.uuid) },
              },
              { expand: true }
            )
            .then(updateResponse => updateResponse.data.data.attributes.metadata.ticketCode);

      return Promise.all([exceptionPromise, ticketCodePromise]).then(
        ([exception, ticketCode]) => {
          res
            .status(200)
            .set('Content-Type', 'application/json')
            .send({
              data: {
                exceptionId: exception.id.uuid,
                listingId: listing.id.uuid,
                start: exception.attributes.start,
                end: exception.attributes.end,
                bufferBeforeDays,
                bufferAfterDays,
                totalBufferDays,
                ticketCode,
              },
            })
            .end();
        }
      );
    })
    .catch(e => {
      // handleError() below always logs via server/log.js (console.error,
      // plus Sentry if configured) - that's what makes a failure here
      // visible even though the client-side caller treats this as
      // best-effort and won't surface it to the user (see the fire-and-
      // continue call in TransactionPage.duck.js).
      handleError(res, e);
    });
};
