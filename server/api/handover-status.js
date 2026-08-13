const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { getSdk, handleError } = require('../api-util/sdk');
const { isLaundryUser } = require('../api-util/laundryAuth');
const {
  readAssignedLaundryId,
  resolveInitialCleaningDays,
} = require('../api-util/laundryAssignment');
const { stateFromLastTransition } = require('../api-util/coclosetBookingProcess');
const { handoverStepFor } = require('../api-util/handoverSteps');
const { createRateLimiter } = require('../api-util/rateLimit');

/**
 * GET /api/handover-status?transactionId=<uuid>
 *
 * What the page behind a scanned handover QR needs to know: what is due at the counter, who
 * it is with, and whether THIS caller may confirm it.
 *
 *   > "asegurate de que al escanear el qr se procese el siguiente paso, si le corresponde a
 *   >  customer o si le corresponde a provider, al escanear debe llevar al paso siguiente
 *   >  con un button para confirmar y avanzar"
 *   > "El qr solo debe poder leerse si eres laundry, si otro actor lo lee solo debe
 *   >  mostrarle indicaciones"
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ENDPOINT EXISTS AT ALL - the laundry cannot read the transaction
 * ---------------------------------------------------------------------------
 * The customer and the provider are parties to the transaction, so their own Marketplace
 * session can `transactions.show` it. The LAUNDRY is not a party in the Sharetribe sense -
 * it is a third role this marketplace invented - so the Marketplace API will not return the
 * transaction to it at all. That is the same reason api/laundry-orders.js exists.
 *
 * The scan page therefore cannot be built on the SDK: the one role that must be able to act
 * is the one role that cannot read. So the read happens here, through the Integration API,
 * behind an authorization check of our own.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DISCLOSED, AND TO WHOM
 * ---------------------------------------------------------------------------
 * Three roles get an answer, and nobody else does:
 *
 *   - `laundry`  - the studio assigned to this garment. Gets `canConfirm: true` when a step
 *                  is due, and is the ONLY role that ever does.
 *   - `customer` - gets the step and the instructions, never an action.
 *   - `provider` - the same.
 *
 * Any other authenticated user gets 403, and an anonymous caller gets 401. A QR is an
 * identifier rather than a credential (see api-util/handoverQr.js), so anyone can arrive
 * here with a valid-looking transaction id; the check below is what stops that turning into
 * a read of someone else's rental.
 *
 * The response body is deliberately thin - a process state, a step, a listing title, the
 * booking dates. No prices, no line items, no counterparty contact details, no protected
 * data. A laundry has no business reading what the customer paid.
 */

// A scan is a human action at a counter; nobody legitimately does this hundreds of times a
// minute. Generous enough for a busy shift and for the page's own reload after a confirm.
const limiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxPerKey: 300,
  maxTotal: 20000,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROLE_LAUNDRY = 'laundry';
const ROLE_CUSTOMER = 'customer';
const ROLE_PROVIDER = 'provider';

const errorWithStatus = (status, message) => {
  const error = new Error(message);
  error.status = status;
  error.statusText = message;
  error.data = {};
  return error;
};

/**
 * Which of the three roles is this caller, for this transaction?
 *
 * Checked in the order the roles were listed above, and `laundry` is checked FIRST on
 * purpose: a studio that also happens to own garments could in principle be the provider of
 * some other transaction, and the role that matters here is the one that grants the action.
 *
 * @param {Object} currentUser - the caller's own currentUser entity
 * @param {Object} transaction - from the Integration API, with customer/provider included
 * @param {Object} listing - the transaction's listing
 * @returns {string|null}
 */
const resolveViewerRole = (currentUser, transaction, listing) => {
  const callerId = currentUser?.id?.uuid;
  if (!callerId) {
    return null;
  }

  const assignedLaundryId = readAssignedLaundryId(listing);
  const assignedId = assignedLaundryId?.uuid || assignedLaundryId;
  if (isLaundryUser(currentUser) && assignedId && assignedId === callerId) {
    return ROLE_LAUNDRY;
  }

  const rel = transaction?.relationships || {};
  if (rel.customer?.data?.id?.uuid === callerId) {
    return ROLE_CUSTOMER;
  }
  if (rel.provider?.data?.id?.uuid === callerId) {
    return ROLE_PROVIDER;
  }

  return null;
};

const findIncluded = (included, type, id) =>
  (included || []).find(entity => entity.type === type && entity.id?.uuid === id?.uuid);

module.exports = (req, res) => {
  const { allowed, retryAfterSeconds } = limiter.check(req.ip);
  if (!allowed) {
    res
      .status(429)
      .set('Retry-After', String(retryAfterSeconds))
      .json({ error: 'Too many requests. Please try again later.' })
      .end();
    return Promise.resolve();
  }

  const transactionId = req.query?.transactionId;
  if (!transactionId || typeof transactionId !== 'string' || !UUID_RE.test(transactionId)) {
    res
      .status(400)
      .json({ error: 'Query parameter "transactionId" must be a transaction UUID.' })
      .end();
    return Promise.resolve();
  }

  const sdk = getSdk(req, res);

  // The caller's identity comes from their OWN session, never from the request. There is no
  // user id parameter on this endpoint and there must never be one.
  return sdk.currentUser
    .show()
    .catch(() => {
      throw errorWithStatus(401, 'You must be signed in to open a handover.');
    })
    .then(currentUserResponse => {
      const currentUser = currentUserResponse.data.data;

      return getIntegrationSdk()
        .transactions.show({
          id: transactionId,
          include: ['listing', 'booking', 'customer', 'provider'],
        })
        .then(response => ({ currentUser, response }));
    })
    .then(({ currentUser, response }) => {
      const transaction = response.data.data;
      const included = response.data.included;
      const listing = findIncluded(
        included,
        'listing',
        transaction?.relationships?.listing?.data?.id
      );
      const booking = findIncluded(
        included,
        'booking',
        transaction?.relationships?.booking?.data?.id
      );

      const viewerRole = resolveViewerRole(currentUser, transaction, listing);
      if (!viewerRole) {
        // Same body for "not a party" as for "no such transaction" would be nicer still, but
        // the id is already known to whoever scanned the code - it IS the code - so there is
        // nothing to conceal by conflating them.
        throw errorWithStatus(403, 'You are not a party to this handover.');
      }

      const processState = stateFromLastTransition(transaction?.attributes?.lastTransition);
      const step = handoverStepFor(processState);

      // How many days this studio needs to clean THIS garment, so the confirm screen can
      // pre-fill the box instead of asking the operator to remember their own configuration.
      //
      //   > "estos días deben tener un default de los días que indique la laundry, pero
      //   >  pueden modificarse al recibir"
      //
      // Only for the laundry, and only at the step that takes the number - the return. A
      // customer has no business reading a studio's turnaround table, and no other step
      // does anything with it.
      //
      // Read off the caller's OWN privateData, which `currentUser.show()` already returned:
      // a user may read their own, so this costs no extra round trip. Same resolution chain
      // that sizes the availability block, so the number shown is the number that would have
      // been applied.
      const takesCleaningDays = viewerRole === ROLE_LAUNDRY && step?.status === 'returned';
      const defaultCleaningDaysMaybe = takesCleaningDays
        ? {
            defaultCleaningDays: resolveInitialCleaningDays({
              laundryPrivateData: currentUser?.attributes?.profile?.privateData,
              listingPublicData: listing?.attributes?.publicData,
              envDefaultBufferDays: process.env.DEFAULT_LAUNDRY_BUFFER_DAYS,
            }),
          }
        : {};

      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({
          data: {
            transactionId,
            processState,
            viewerRole,
            // A step being due is not the same as this caller being able to advance it. Only
            // the assigned laundry ever gets `true`; the client renders a button off this
            // field alone, so the rule lives here rather than in the page.
            canConfirm: viewerRole === ROLE_LAUNDRY && !!step,
            step: step
              ? {
                  state: step.state,
                  status: step.status,
                  counterparty: step.counterparty,
                  direction: step.direction,
                  isLate: !!step.isLate,
                }
              : null,
            ...defaultCleaningDaysMaybe,
            listingTitle: listing?.attributes?.title || null,
            bookingStart: booking?.attributes?.displayStart || booking?.attributes?.start || null,
            bookingEnd: booking?.attributes?.displayEnd || booking?.attributes?.end || null,
            ticketCode: transaction?.attributes?.metadata?.ticketCode || null,
          },
        })
        .end();
    })
    .catch(e => handleError(res, e));
};

module.exports.limiter = limiter;
module.exports.resolveViewerRole = resolveViewerRole;
module.exports.ROLE_LAUNDRY = ROLE_LAUNDRY;
module.exports.ROLE_CUSTOMER = ROLE_CUSTOMER;
module.exports.ROLE_PROVIDER = ROLE_PROVIDER;
