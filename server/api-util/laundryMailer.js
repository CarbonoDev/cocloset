const { sendMail, isMailgunConfigured } = require('./mailgun');
const {
  newIncomingGarmentNotification,
  pickupScheduledNotification,
  returnScheduledNotification,
  cleaningRequiredNotification,
  garmentHandedBackNotification,
  bookingCancelledNotification,
  partialRefundBookingCancelledNotification,
} = require('./laundryNotifications');
const log = require('../log');

// Wiring layer between the laundry-facing email bodies
// (./laundryNotifications.js, pure functions) and the transport
// (./mailgun.js). Nothing else in server/ should call sendMail directly for a
// laundry notification.
//
// FIRE-AND-CONTINUE, NOT FIRE-AND-FORGET-QUIETLY
// Every one of these hangs off a transaction transition that has ALREADY
// SUCCEEDED. A mail failure must never turn a completed transition into a
// failed HTTP response - the garment really did move, and reporting an error
// would make the ops UI retry a transition Sharetribe would then reject with a
// 409. So each helper returns a promise that always resolves, and callers are
// free to ignore it entirely.
//
// sendMail() already never rejects (see its header), but these wrappers add
// the two guards it cannot: a missing recipient (the Integration API can
// legitimately hand back a user with no email loaded) and an unexpected throw
// while composing a body from partial API data.
//
// BOTH SKIPS ARE LOGGED (Jonathan, 2026-08-10: "debe fallar solo con log sin
// impedir el flujo si no existe la key o si no tenemos el mail de la laundry").
// Note that the unconfigured check below SHORT-CIRCUITS before sendMail, so
// mailgun.js's own skip log never runs for a laundry notification - this layer
// has to do its own. That is not duplication; it is the only place the line gets
// written on this path, and with no Mailgun account yet this path is every send.
//
// A skip is distinguishable from a failure by its code: `laundry-mail-skipped-*`
// (we never tried) versus `laundry-mail-failed` (we tried and it broke). Skips
// pass { skipSentry: true } - stdout, not alerting.

/**
 * Compose + send one laundry notification. Always resolves.
 *
 * @param {Object} params
 * @param {string} params.name - short label for logs, e.g. 'return-scheduled'
 * @param {string} [params.to] - the laundry's email address
 * @param {Function} params.compose - () => {subject, text, html}
 * @param {Object} [params.logContext] - extra fields for the failure log
 * @returns {Promise<Object>} a sendMail-shaped result; never rejects
 */
const send = ({ name, to, compose, logContext = {} }) => {
  try {
    // Cheapest check first: with no MAILGUN_API_KEY (or no MAILGUN_DOMAIN), do
    // nothing rather than compose a body we would throw away - but log that a
    // notification was due and went nowhere. Without this line the whole laundry
    // mail path is indistinguishable from not existing.
    if (!isMailgunConfigured()) {
      log.error(
        new Error(`Mailgun is not configured - skipping laundry notification "${name}".`),
        'laundry-mail-skipped-not-configured',
        { notification: name, ...logContext },
        { skipSentry: true }
      );
      return Promise.resolve({ sent: false, reason: 'not-configured' });
    }
    if (!to) {
      // Not an error worth failing anything over, but somebody has configured
      // a laundry we cannot reach - say so once.
      log.error(
        new Error(`No recipient for laundry notification "${name}".`),
        'laundry-mail-skipped-no-recipient',
        { notification: name, ...logContext },
        { skipSentry: true }
      );
      return Promise.resolve({ sent: false, reason: 'no-recipient' });
    }
    return sendMail({ to, ...compose() });
  } catch (error) {
    log.error(error, 'laundry-mail-failed', { notification: name, ...logContext });
    return Promise.resolve({ sent: false, reason: 'error', error });
  }
};

/**
 * §3.12 New Incoming Garment - an owner has assigned this garment to this
 * studio and is sending it in. Triggered from
 * server/api/listing-laundry-assignment.js, which is the only write path for
 * `listing.metadata.assignedLaundryId`.
 *
 * This is the one §3.12 notification with no transaction behind it: listing
 * readiness is a separate lifecycle from transaction state (design §8), so the
 * body carries listing data only and `logContext` keys off the listing id
 * rather than a txId.
 *
 * ONLY ON A REAL CHANGE. The wizard lets an owner re-save the same laundry as
 * often as they like, and this must not become three emails for three clicks.
 * The caller is responsible for that gate (it holds the `changed` decision);
 * see the call site.
 *
 * @param {Object} params - `to` plus the fields of newIncomingGarmentNotification
 * @returns {Promise<Object>} never rejects
 */
const notifyNewIncomingGarment = ({ to, ...data }) =>
  send({
    name: 'new-incoming-garment',
    to,
    compose: () => newIncomingGarmentNotification(data),
    logContext: { listingId: data.listingId },
  });

/**
 * §3.12 Pickup Scheduled - the booking was accepted, have the garment ready.
 * Triggered from server/api/create-availability-buffer.js.
 *
 * @param {Object} params - `to` plus the fields of pickupScheduledNotification
 * @returns {Promise<Object>} never rejects
 */
const notifyPickupScheduled = ({ to, ...data }) =>
  send({
    name: 'pickup-scheduled',
    to,
    compose: () => pickupScheduledNotification(data),
    logContext: { txId: data.transactionId },
  });

/**
 * §3.12 Return Scheduled - the customer has collected the garment, here is
 * when it is due back. Triggered on transition/laundry-confirm-pickup.
 *
 * @param {Object} params - `to` plus the fields of returnScheduledNotification
 * @returns {Promise<Object>} never rejects
 */
const notifyReturnScheduled = ({ to, ...data }) =>
  send({
    name: 'return-scheduled',
    to,
    compose: () => returnScheduledNotification(data),
    logContext: { txId: data.transactionId },
  });

/**
 * §3.12 Cleaning Required - the garment is back. Triggered on both
 * transition/laundry-confirm-return and transition/laundry-confirm-return-late,
 * and carries the damage flag recorded at that transition (design §10), which
 * changes how the laundry handles the garment.
 *
 * @param {Object} params - `to` plus the fields of cleaningRequiredNotification
 * @returns {Promise<Object>} never rejects
 */
const notifyCleaningRequired = ({ to, ...data }) =>
  send({
    name: 'cleaning-required',
    to,
    compose: () => cleaningRequiredNotification(data),
    logContext: { txId: data.transactionId },
  });

// The only one addressed to a garment's OWNER rather than to a studio. It shares `send`
// because everything that makes that function worth having - the not-configured log, the
// no-recipient log, never rejecting - is about the transport, not about who reads the mail.
const notifyGarmentHandedBack = ({ to, ...data }) =>
  send({
    name: 'garment-handed-back',
    to,
    compose: () => garmentHandedBackNotification(data),
    logContext: { listingId: data.listingId },
  });

/**
 * Customer self-cancellation (2026-10-13) - tells the assigned laundry that this booking is
 * off, so it does not keep expecting a drop-off or a pickup for it. Triggered from
 * server/api/customer-cancel-notify-laundry.js, the side-effect endpoint the browser calls
 * right after a successful `transition/customer-cancel` (that transition is not privileged,
 * so Mailgun - which does not run on the EDN - needs this separate hook).
 *
 * @param {Object} params - `to` plus the fields of bookingCancelledNotification
 * @returns {Promise<Object>} never rejects
 */
const notifyBookingCancelled = ({ to, ...data }) =>
  send({
    name: 'booking-cancelled',
    to,
    compose: () => bookingCancelledNotification(data),
    logContext: { txId: data.transactionId },
  });

// Customer partial-refund self-cancellation (2026-10-13) - tells the assigned laundry that a
// booking it has ALREADY RECEIVED THE GARMENT FOR is off. Triggered from
// server/api/customer-partial-refund-cancel.js, the same way notifyCleaningRequired etc. are
// triggered from their own endpoints: a fire-and-continue side effect of a transition that has
// already succeeded (here, after the Stripe refund has already settled too - see that
// endpoint's own ordering comment).
//
// @param {Object} params - `to` plus the fields of partialRefundBookingCancelledNotification
// @returns {Promise<Object>} never rejects
const notifyPartialRefundBookingCancelled = ({ to, ...data }) =>
  send({
    name: 'partial-refund-booking-cancelled',
    to,
    compose: () => partialRefundBookingCancelledNotification(data),
    logContext: { txId: data.transactionId },
  });

module.exports = {
  notifyGarmentHandedBack,
  notifyNewIncomingGarment,
  notifyPickupScheduled,
  notifyReturnScheduled,
  notifyCleaningRequired,
  notifyBookingCancelled,
  notifyPartialRefundBookingCancelled,
};
