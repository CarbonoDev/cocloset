const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { authorizeLaundryCaller } = require('../api-util/laundryAuth');
const {
  TRANSITIONS,
  STATES,
  LAUNDRY_STATUSES,
  stateFromLastTransition,
  transitionForStatus,
  isInvalidTransitionError,
} = require('../api-util/coclosetBookingProcess');
const { buildTicketCode } = require('../api-util/ticketCodeHelpers');
const {
  computeAvailabilityBufferWindow,
  resolveTurnaroundHours,
} = require('../api-util/availabilityHelpers');
const { reconcileBufferWindow } = require('../api-util/availabilityBuffer');
const { notifyReturnScheduled, notifyCleaningRequired } = require('../api-util/laundryMailer');
const log = require('../log');

// Lets an authenticated laundry user advance a transaction through the laundry
// custody chain of the `cocloset-booking` transaction process.
//
// This endpoint used to write `transaction.metadata.laundryStatus` against the
// unmodified `default-booking` process, because "Laundry Shop" is not a native
// Sharetribe actor. That is no longer true in the way that mattered: the
// laundry steps are now REAL process transitions (all
// `:actor.role/operator`, fired here through the Integration API), so this
// endpoint calls `transactions.transition()` and metadata rides along in the
// transition's `action/privileged-update-metadata`.
//
// What that buys, and what it costs:
//   + Sharetribe enforces the ordering. The hand-rolled legality check that
//     used to live here (and in the now-deleted
//     server/api-util/laundryStatusHelpers.js) has been removed: the platform's
//     check is authoritative, race-free and cannot drift from the EDN.
//   + Every step is timestamped and audited in
//     `transaction.attributes.transitions`.
//   + Native notifications fire (see the :notifications block in the EDN).
//   + Payout and the cancel-with-refund windows become expressible at all.
//   - The transitions must exist in the pushed process. A marketplace still on
//     `default-booking` will answer 409 for every call here.
//
// AUTHORIZATION IS STILL OURS.
// Sharetribe has no idea what a laundry is; every laundry transition is an
// operator transition, and the Integration API is full-admin. So
// server/api-util/laundryAuth.js remains load-bearing and unchanged: the
// caller must be flagged `metadata.isLaundry` AND be the laundry assigned to
// this transaction's listing. Removing it would let any authenticated user
// drive any transaction's custody chain, including the payout.
//
// Request body: {
//   transactionId,           // transaction UUID (transit-encoded)
//   status,                  // one of LAUNDRY_STATUSES - the step to advance to
//   damaged,                 // optional boolean - only read at status 'returned'
//   damageNote,              // optional string  - only read at status 'returned'
// }
//
// `status` rather than a transition name is deliberate. It is what makes the
// two-way `returned` branch safe: "the garment came back" is
// `laundry-confirm-return` from `picked-up` and `laundry-confirm-return-late`
// from `overdue` (`:from` is single-valued in the EDN), and only the server
// knows which, because the ops dashboard's row may be stale by the time the
// button is clicked. See transitionForStatus() in
// server/api-util/coclosetBookingProcess.js.
//
// Success response (200): {
//   data: { status, transition, state, ticketCode?, damageReported? }
// }
// Failure responses:
//   400 - missing/unknown transactionId or status
//   403 - caller is not the assigned laundry (laundryAuth.js)
//   409 - Sharetribe refused the transition as illegal from the current state.
//         Same status code the hand-rolled pre-check used to return, so client
//         behaviour is unchanged.
//   otherwise: standard handleError() shape (see api-util/sdk.js).

const httpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  error.statusText = message;
  error.data = {};
  return error;
};

const findIncluded = (included, type, id) =>
  id ? included.find(entity => entity.type === type && entity.id.uuid === id) : null;

// Metadata written by the transition's action/privileged-update-metadata.
// Only the fields the ops UI actually produces are written; the EDN also names
// pickupEmployee / returnEmployee / conditionNotes, which have no input in the
// dashboard yet and are deliberately not invented here.
//
// NOTE: `metadata.lateReturn` is gone entirely. It was a flag we maintained to
// answer "is this garment late?"; that question is now `state === 'overdue'`,
// which the process maintains itself via the automatic transition/mark-overdue.
const buildTransitionMetadata = ({
  transition,
  cleaningPhase,
  damaged,
  damageNote,
  listing,
  studioName,
  txIdForLog,
  existingTicketCode,
}) => {
  const metadata = {};

  if (transition === TRANSITIONS.LAUNDRY_MARK_READY) {
    // The cosmetic, human-readable ticket code (design §11, e.g. "PIG-A3F91C")
    // shown to laundry staff on paper and ops screens - NOT the QR payload,
    // which is the transaction id itself.
    //
    // This moved here from create-availability-buffer.js. Three reasons:
    //   1. It is now free. `laundry-mark-ready` already carries
    //      privileged-update-metadata, so the code rides an API call we are
    //      making anyway instead of costing a separate updateMetadata write.
    //   2. It closes half of that endpoint's documented client-hook gap. The
    //      buffer endpoint is fired from the browser after `accept`, so it
    //      never runs when an operator accepts from Console; the ticket code
    //      went missing with it. This transition is server-side by
    //      construction and cannot be skipped.
    //   3. It is the right moment. `ready-for-pickup` is when the laundry
    //      physically prepares the garment and prints the ticket. Generating
    //      the code at `accept` created an identifier for a garment nobody had
    //      touched yet.
    // The cost: the Pickup Scheduled email (sent at accept) no longer carries
    // a ticket code. That row is optional in the template and is dropped when
    // absent - and the code genuinely does not exist yet at that point.
    metadata.ticketCode = existingTicketCode || buildTicketCode(studioName, txIdForLog);

    const currentRack = listing?.attributes?.privateData?.currentRack;
    if (currentRack) {
      metadata.currentRack = currentRack;
    }
  }

  if (
    transition === TRANSITIONS.LAUNDRY_CONFIRM_RETURN ||
    transition === TRANSITIONS.LAUNDRY_CONFIRM_RETURN_LATE
  ) {
    if (typeof damaged === 'boolean') {
      // Design §10. Kept as metadata rather than a state because it is a
      // non-linear flag: a transaction is simultaneously `returned` and
      // damaged, and the damage outlives the state.
      metadata.damageReported = { flag: damaged, note: damageNote || '' };
    }
  }

  if (cleaningPhase) {
    metadata.cleaningPhase = cleaningPhase;
  }

  return metadata;
};

// ---------------------------------------------------------------------------
// Post-transition side effects
//
// All of these run AFTER the transition has succeeded, and none of them may
// fail the request: the garment has physically moved and Sharetribe has
// recorded it. Reporting an error here would make the ops UI retry a
// transition the platform would then answer 409 for.
// ---------------------------------------------------------------------------

// design §6: "does the blocked window just extend dynamically (recompute
// exceptions) when the laundry marks it returned late?"
//
// Until now that was undetectable without polling. `laundry-confirm-return-late`
// makes it a single unambiguous event, so the extension is implemented here:
// recompute the buffer window from the ACTUAL return date (now) instead of the
// booking end, and block whatever part of it is not blocked already.
//
// It is additive and idempotent by construction: reconcileBufferWindow only
// creates the sub-ranges that are not yet blocked, so the original exception
// (bookingStart-buffer .. bookingEnd+buffer) is left alone and only the tail
// beyond it is created. A return that is late by less than the buffer-after
// period produces zero segments and does nothing at all.
//
// What this does NOT do is late fees. Design §6's other two questions were
// never answered, and inventing a fee is not this change's job.
const extendBufferForLateReturn = ({
  integrationSdk,
  listing,
  booking,
  turnaroundHours,
  txIdForLog,
}) => {
  const bookingStart = booking?.attributes?.start;
  const bookingEnd = booking?.attributes?.end;
  if (!listing || !bookingStart || !bookingEnd) {
    return Promise.resolve(null);
  }

  // Never shorter than the window the original buffer already covers. The
  // transaction can be in `overdue` while the actual return timestamp is still
  // at or before booking end (clock skew, a booking edited after the fact), and
  // a window that ended before the one already blocked would be a nonsensical
  // range rather than an extension.
  const actualReturn = new Date(Math.max(new Date().getTime(), new Date(bookingEnd).getTime()));
  const { start, end } = computeAvailabilityBufferWindow(
    new Date(bookingStart),
    actualReturn,
    turnaroundHours
  );

  return reconcileBufferWindow({
    integrationSdk,
    listingId: listing.id,
    start,
    end,
    txIdForLog,
  }).catch(e => {
    log.error(e, 'laundry-late-return-buffer-failed', { txId: txIdForLog });
    return null;
  });
};

module.exports = (req, res) => {
  const { transactionId, status, damaged, damageNote } = req.body || {};
  const txIdForLog = transactionId?.uuid || transactionId || 'unknown';

  if (!transactionId) {
    res
      .status(400)
      .json({ error: 'Missing required "transactionId" in request body.' })
      .end();
    return;
  }
  if (!status || !LAUNDRY_STATUSES.includes(status)) {
    res
      .status(400)
      .json({
        error: `Missing or invalid "status" in request body. Must be one of: ${LAUNDRY_STATUSES.join(
          ', '
        )}.`,
      })
      .end();
    return;
  }

  const integrationSdk = getIntegrationSdk();

  integrationSdk.transactions
    .show({ id: transactionId, include: ['listing', 'booking', 'customer'] })
    .then(transactionResponse => {
      const { data, included = [] } = transactionResponse.data;

      const listing = findIncluded(
        included,
        'listing',
        data.relationships?.listing?.data?.id?.uuid
      );
      const booking = findIncluded(
        included,
        'booking',
        data.relationships?.booking?.data?.id?.uuid
      );
      const customer = findIncluded(included, 'user', data.relationships?.customer?.data?.id?.uuid);

      if (!listing) {
        throw httpError(
          422,
          `laundry-transaction-status: transaction ${txIdForLog} has no listing relationship.`
        );
      }

      const assignedLaundryId = listing.attributes?.publicData?.assignedLaundryId;

      return authorizeLaundryCaller(req, res, assignedLaundryId).then(currentUser => {
        // The caller IS the assigned laundry (just verified), so their own
        // profile is the authoritative source for the studio name, the
        // notification address and the turnaround time. No extra users.show.
        const profile = currentUser?.attributes?.profile || {};
        const laundry = {
          email: currentUser?.attributes?.email,
          studioName: profile.publicData?.laundryProfile?.studioName,
          turnaroundHours: resolveTurnaroundHours(
            profile.privateData?.turnaroundHours,
            process.env.DEFAULT_LAUNDRY_BUFFER_HOURS
          ),
        };

        const currentState = stateFromLastTransition(data.attributes?.lastTransition);
        const { transition, cleaningPhase } = transitionForStatus(status, currentState);

        const metadata = buildTransitionMetadata({
          transition,
          cleaningPhase,
          damaged,
          damageNote,
          listing,
          studioName: laundry.studioName,
          txIdForLog,
          existingTicketCode: data.attributes?.metadata?.ticketCode,
        });

        return integrationSdk.transactions
          .transition({ id: transactionId, transition, params: { metadata } }, { expand: true })
          .then(transitionResponse => ({
            transition,
            metadata,
            transitionResponse,
            listing,
            booking,
            customer,
            laundry,
          }));
      });
    })
    .then(({ transition, metadata, transitionResponse, listing, booking, customer, laundry }) => {
      const updated = transitionResponse?.data?.data;
      const newState = stateFromLastTransition(updated?.attributes?.lastTransition);
      // Prefer what the API actually stored over what we sent.
      const storedMetadata = updated?.attributes?.metadata || metadata;

      const garmentTitle = listing?.attributes?.title;
      const ticketCode = storedMetadata?.ticketCode;
      const customerName = customer?.attributes?.profile?.displayName;

      // ---- Fire-and-continue side effects ---------------------------------
      // The try/catch is not belt-and-braces. api-util/laundryMailer.js is
      // documented never to reject, but these calls sit inside the `.then()`
      // whose rejections land in the endpoint's catch - so a synchronous throw
      // from anywhere in here would turn a transition that ALREADY SUCCEEDED
      // into a 500, and the ops UI would retry a step Sharetribe now answers
      // 409 for. Isolating them is what actually makes "a mail failure never
      // fails a transition" true at this call site rather than by convention.
      try {
        if (transition === TRANSITIONS.LAUNDRY_CONFIRM_PICKUP) {
          notifyReturnScheduled({
            to: laundry.email,
            laundryName: laundry.studioName,
            garmentTitle,
            ticketCode,
            customerName,
            returnDate: booking?.attributes?.end,
            transactionId: txIdForLog,
          });
        }

        if (
          transition === TRANSITIONS.LAUNDRY_CONFIRM_RETURN ||
          transition === TRANSITIONS.LAUNDRY_CONFIRM_RETURN_LATE
        ) {
          const damageReported = storedMetadata?.damageReported;
          notifyCleaningRequired({
            to: laundry.email,
            laundryName: laundry.studioName,
            garmentTitle,
            ticketCode,
            returnedAt: new Date(),
            damageReported: damageReported?.flag === true,
            damageNote: damageReported?.note,
            transactionId: txIdForLog,
          });
        }
      } catch (mailError) {
        log.error(mailError, 'laundry-notification-failed', {
          txId: txIdForLog,
          transition,
        });
      }

      const bufferPromise =
        transition === TRANSITIONS.LAUNDRY_CONFIRM_RETURN_LATE
          ? extendBufferForLateReturn({
              integrationSdk,
              listing,
              booking,
              turnaroundHours: laundry.turnaroundHours,
              txIdForLog,
            })
          : Promise.resolve(null);

      // The buffer extension IS awaited (unlike the mail) so its result can be
      // reported, but extendBufferForLateReturn swallows its own failures - a
      // calendar write must not fail a transition that already happened.
      return bufferPromise.then(bufferResult => {
        res
          .status(200)
          .set('Content-Type', 'application/json')
          .send({
            data: {
              status,
              transition,
              state: newState,
              ...(ticketCode ? { ticketCode } : {}),
              ...(storedMetadata?.damageReported
                ? { damageReported: storedMetadata.damageReported }
                : {}),
              ...(bufferResult ? { bufferExtension: bufferResult } : {}),
            },
          })
          .end();
      });
    })
    .catch(e => {
      // Sharetribe refusing the transition as illegal from the current state
      // is an expected, client-visible outcome, not a server fault. It already
      // arrives as HTTP 409; re-shape it so the client gets the same
      // status code and a message that names the transition, exactly as the
      // hand-rolled pre-check used to.
      if (isInvalidTransitionError(e)) {
        const message =
          `laundry-transaction-status: "${status}" is not a legal step for transaction ` +
          `${txIdForLog} in its current state.`;
        handleError(res, httpError(409, message));
        return;
      }
      handleError(res, e);
    });
};

// Exported for tests and for the ops dashboard's status vocabulary.
module.exports.LAUNDRY_STATUSES = LAUNDRY_STATUSES;
module.exports.STATES = STATES;
