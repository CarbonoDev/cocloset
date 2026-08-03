const { sendMail, isMailgunConfigured } = require('./mailgun');
const {
  pickupScheduledNotification,
  returnScheduledNotification,
  cleaningRequiredNotification,
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
// NOT IN SCOPE HERE: "New Incoming Garment" (§3.12). It fires when a garment
// owner ships a garment in, at which point no transaction exists at all, so
// there is no transition to hang it off. It needs its own trigger and is
// deliberately left unwired.

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
    // Cheapest check first, and the one the client asked for: with no
    // MAILGUN_API_KEY, do nothing at all rather than compose a body we would
    // throw away. Keeps local dev, CI and the test suite silent.
    if (!isMailgunConfigured()) {
      return Promise.resolve({ sent: false, reason: 'not-configured' });
    }
    if (!to) {
      // Not an error worth failing anything over, but somebody has configured
      // a laundry we cannot reach - say so once.
      log.error(
        new Error(`No recipient for laundry notification "${name}".`),
        'laundry-mail-no-recipient',
        {
          notification: name,
          ...logContext,
        }
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

module.exports = {
  notifyPickupScheduled,
  notifyReturnScheduled,
  notifyCleaningRequired,
};
