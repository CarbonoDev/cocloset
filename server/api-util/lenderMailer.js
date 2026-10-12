const { sendMail } = require('./mailgun');
const { bookingRequestNotification } = require('./lenderNotifications');
const log = require('../log');

// Sends the lender's "new booking request" email (body in ./lenderNotifications.js).
//
// Deliberately SIMPLE, in the style of emailSignup.js's deliverSignup rather than
// laundryMailer.js: this is a single, conditional exception in the flow, so there is no
// per-notification state machine here. It leans on sendMail(), which never rejects and
// already logs and skips by itself when Mailgun is not configured (reason 'not-configured').
//
// Whether to send at all is decided by the CALLER (server/api/lender-new-request.js). The
// hosted Sharetribe provider "new booking request" notification must also be removed from the
// transaction process, otherwise the lender gets both.
//
// Always resolves, so the caller can ignore the promise: the flow that triggers this has
// already succeeded and a mail problem must not fail it.

/**
 * @param {Object} params - `to` (the lender's email) plus the fields of
 *   bookingRequestNotification
 * @returns {Promise<Object>} a sendMail-shaped result; never rejects
 */
const notifyBookingRequest = ({ to, ...data }) => {
  const logContext = { txId: data.transactionId };

  if (!to) {
    log.error(
      new Error('No recipient for lender booking-request email.'),
      'lender-mail-skipped-no-recipient',
      logContext,
      { skipSentry: true }
    );
    return Promise.resolve({ sent: false, reason: 'no-recipient' });
  }

  try {
    return sendMail({ to, ...bookingRequestNotification(data) }).then(result => {
      if (!result.sent && result.reason !== 'not-configured') {
        log.error(
          result.error || new Error(`Mailgun did not send: ${result.reason}`),
          'lender-mail-failed',
          logContext
        );
      }
      return result;
    });
  } catch (error) {
    // Composing the body from partial API data threw.
    log.error(error, 'lender-mail-failed', logContext);
    return Promise.resolve({ sent: false, reason: 'error', error });
  }
};

module.exports = {
  notifyBookingRequest,
};