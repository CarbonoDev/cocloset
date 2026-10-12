const { getSdk, handleError } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { notifyBookingRequest } = require('../api-util/lenderMailer');
const log = require('../log');

// Email the lender that a customer has requested their garment, but only when the lender
// really has to act: the booking is still WAITING for them.
//
// POST /api/lender-new-request
// Request body: { transactionId }
//
// THE CONDITION IS THE STORED STATE, NOT A GUESS ABOUT THE LISTING. A garment that is already
// at a laundry is accepted on the operator's behalf (see auto-accept-booking.js), which moves
// the transaction out of `preauthorized`; this endpoint then does nothing, and the hosted
// "accepted on your behalf" email (which stays in the process) is the lender's only email.
// If that auto-accept FAILED, the booking is still `preauthorized` and the lender really does
// have to accept it by hand, so they get this email - which a check on the listing alone would
// have denied them.
//
// THE CLIENT MUST CALL THIS AFTER auto-accept SETTLES, not alongside it. The decision is made
// from the stored state, so calling it while the auto-accept is still in flight would read
// `preauthorized` for a garment that is about to be accepted and send an approve/decline
// request nobody needs. See the call site in CheckoutPageTransactionHelpers.js.
//
// WHY THIS IS SENT FROM HERE INSTEAD OF BY SHARETRIBE
// The hosted provider "new booking request" notification fires on every request,
// unconditionally, and gave a lender at a laundry an approve/decline email for a booking that
// had already been accepted. It must be REMOVED from the transaction process (process.edn),
// otherwise the lender gets Sharetribe's copy as well as this one.
//
// AUTHENTICATED. The caller must have a session AND be the CUSTOMER of that transaction. The
// body carries nothing but the transaction id: recipient, garment, dates and amounts are all
// read server-side, so a caller cannot make this endpoint mail anyone anything.
//
// IDEMPOTENT. A successful send stamps `metadata.lenderRequestNotifiedAt` on the transaction
// and a repeat call does nothing, so a retry cannot send the same email twice.
//
// Success response (200): { data: { notified, reason? } }
//   reason, when notified is false:
//   'not-awaiting-acceptance' | 'already-sent' | 'not-sent'
// Failure responses:
//   400 - missing transactionId
//   401 - no usable session
//   403 - caller is not the customer of this transaction
//   otherwise: standard handleError() shape (see api-util/sdk.js).

// The process state in which a request is waiting for the lender. VERIFY against the Cocloset
// process.edn: this is the default booking process's state after payment is confirmed.
const AWAITING_ACCEPT_STATES = ['state/preauthorized'];

const NOTIFIED_FLAG = 'lenderRequestNotifiedAt';

const uuidOf = id => (id && typeof id === 'object' ? id.uuid : id);

const httpError = (httpStatus, message) => Object.assign(new Error(message), { httpStatus });

const findIncluded = (included, type, ref) =>
  ref ? included.find(e => e.type === type && uuidOf(e.id) === uuidOf(ref.id)) : null;

// The lender has this long to accept before the request expires. The Integration API does not
// expose the delayed transition's run time, so it is derived from an env var; when unset the
// email says "soon" rather than inventing a date.
const resolveAcceptBy = transaction => {
  const days = 2;
  const since = transaction.attributes?.lastTransitionedAt;
  if (!Number.isFinite(days) || days <= 0 || !since) {
    return null;
  }
  return new Date(new Date(since).getTime() + days * 24 * 60 * 60 * 1000);
};

const toMoney = money => (money ? { amount: money.amount, currency: money.currency } : undefined);

module.exports = (req, res) => {
  const { transactionId } = req.body || {};

  if (!transactionId || typeof transactionId !== 'string') {
    res
      .status(400)
      .json({ error: 'Missing or invalid "transactionId" in request body.' })
      .end();
    return;
  }

  const sdk = getSdk(req, res);
  const integrationSdk = getIntegrationSdk();

  sdk.currentUser
    .show()
    .then(
      response => uuidOf(response.data.data.id),
      () => {
        throw httpError(401, 'Authentication required.');
      }
    )
    .then(callerId =>
      integrationSdk.transactions
        .show({ id: transactionId, include: ['customer', 'provider', 'listing', 'booking'] })
        .then(txResponse => {
          const transaction = txResponse.data.data;
          const included = txResponse.data.included || [];
          const attrs = transaction.attributes || {};

          // Only the customer who made the request may trigger it.
          if (uuidOf(transaction.relationships?.customer?.data?.id) !== callerId) {
            throw httpError(403, 'Only the customer of this transaction may do this.');
          }

          // THE CONDITION. Anything that is not waiting for the lender - above all a booking
          // already accepted on the operator's behalf - gets nothing from here. A 200, not an
          // error: for a garment at a laundry this is the normal outcome, not a failure.
          if (!AWAITING_ACCEPT_STATES.includes(attrs.state)) {
            return { notified: false, reason: 'not-awaiting-acceptance' };
          }
          if (attrs.metadata?.[NOTIFIED_FLAG]) {
            return { notified: false, reason: 'already-sent' };
          }

          const customer = findIncluded(included, 'user', transaction.relationships?.customer?.data);
          const booking = findIncluded(included, 'booking', transaction.relationships?.booking?.data);
          const listingRef = transaction.relationships?.listing?.data;

          return integrationSdk.listings.show({ id: uuidOf(listingRef.id) }).then(listingResponse => {
            const listing = listingResponse.data.data;
            const providerId = uuidOf(transaction.relationships?.provider?.data?.id);

            // The email is read from the user entity itself, not from `included`, which does
            // not carry it.
            return integrationSdk.users.show({ id: providerId }).then(providerResponse => {
              const provider = providerResponse.data.data;

              return notifyBookingRequest({
                to: provider.attributes?.email,
                garmentTitle: listing.attributes?.title,
                customerName: customer?.attributes?.profile?.displayName,
                transactionId: uuidOf(transaction.id),
                priceVariantName: attrs.protectedData?.priceVariantName,
                bookingWeeks: attrs.protectedData?.bookingWeeks,
                bookingStart: booking?.attributes?.start,
                bookingEnd: booking?.attributes?.end,
                timeZone: listing.attributes?.availabilityPlan?.timezone,
                lineItems: (attrs.lineItems || []).map(item => ({
                  code: item.code,
                  unitPrice: toMoney(item.unitPrice),
                  lineTotal: toMoney(item.lineTotal),
                  quantity: item.quantity,
                  units: item.units,
                  seats: item.seats,
                  includeFor: item.includeFor,
                })),
                payoutTotal: toMoney(attrs.payoutTotal),
                acceptBy: resolveAcceptBy(transaction),
              }).then(result => {
                if (!result.sent) {
                  return { notified: false, reason: 'not-sent' };
                }
                // Stamp only after a real send, so a skipped or failed mail can be retried.
                // A failure to stamp must not turn a sent email into an error response.
                return integrationSdk.transactions
                  .updateMetadata({
                    id: transactionId,
                    metadata: { [NOTIFIED_FLAG]: new Date().toISOString() },
                  })
                  .catch(e => {
                    log.error(e, 'lender-new-request-flag-failed', { txId: transactionId });
                  })
                  .then(() => ({ notified: true }));
              });
            });
          });
        })
    )
    .then(result => {
      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: result })
        .end();
    })
    .catch(e => {
      if (e && e.httpStatus) {
        res
          .status(e.httpStatus)
          .json({ error: e.message })
          .end();
        return;
      }
      handleError(res, e);
    });
};