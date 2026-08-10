const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { authorizeLaundryCaller } = require('../api-util/laundryAuth');
const { readAssignedLaundryId } = require('../api-util/laundryAssignment');
const {
  TRANSITIONS,
  STATES,
  LAUNDRY_STATUSES,
  stateFromLastTransition,
  transitionForStatus,
  isInvalidTransitionError,
} = require('../api-util/coclosetBookingProcess');
const { buildTicketCode } = require('../api-util/ticketCodeHelpers');
const { resolveTurnaroundHours } = require('../api-util/availabilityHelpers');
const { reconcileBufferWindow } = require('../api-util/availabilityBuffer');
const {
  getListingCategoryValues,
  resolveTurnaroundHoursEntry,
} = require('../api-util/categoryPricing');
const {
  MAX_CLEANING_DAYS,
  validateCleaningDays,
  resolveCleaningDays,
  computeReadiness,
  writeCustodyMetadata,
} = require('../api-util/listingCustody');
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
//   cleaningDays,            // optional integer - only read at status 'returned';
//                            //   defaults to the laundry's configured turnaround
//                            //   for this garment's category
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
//   data: { status, transition, state, ticketCode?, damageReported?, custody? }
// }
//   `custody` is present only on the two return transitions, and reports what the
//   real return produced: { onLaundry, readyAt, cleaningDays, cleaningDaysSource,
//   turnaroundSource?, buffer }. See handleRealReturn below.
// Failure responses:
//   400 - missing/unknown transactionId or status, or an unusable cleaningDays
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

// THE REAL RETURN. Everything downstream of "the garment is physically back".
//
// This replaces an earlier, narrower `extendBufferForLateReturn` that fired only
// on `laundry-confirm-return-late` and recomputed the design §6 window from the
// booking dates. It now fires on BOTH return transitions, and computes from the
// return moment instead. The reason is not tidiness:
//
//   The window blocked at `accept` was a FORECAST - bookingStart - bufferBefore
//   .. bookingEnd + bufferAfter, sized from a turnaround guess, made before the
//   garment had left the studio. This is the first moment anybody knows the two
//   facts that actually determine when the listing is bookable again: when the
//   garment came back, and how long this laundry says THIS garment will take to
//   clean. So the block that matters is [returned .. ready], and it is computed
//   here, not there.
//
// A late return is now just the case where `returnedAt` happens to be past
// bookingEnd; it needs no separate branch, and the design §6 "does the window
// extend dynamically?" behaviour falls out of the same arithmetic.
//
// STILL ADDITIVE, STILL NEVER DELETES. reconcileBufferWindow only creates the
// sub-ranges that are not blocked yet, so this extends the forecast where the
// real turnaround runs longer and is a no-op where the forecast already covers
// it. It does NOT shorten an over-long forecast, and that is deliberate rather
// than unfinished: availability exceptions carry no reason/type field we can rely
// on (design §13 says so explicitly, which is why the calendar derives
// "Cleaning" vs "Booked" client-side), so nothing here can tell OUR forecast
// exception apart from a week the owner blocked by hand. Deleting on a guess
// would un-block days an owner deliberately closed. The cost is stated plainly:
// a garment cleaned faster than forecast stays blocked for the rest of the
// forecast window. Over-blocking is recoverable by the owner; double-booking a
// garment that is in a wash is not.
//
// Failures are swallowed. The garment has moved and Sharetribe has recorded it;
// a calendar or metadata write must never turn a transition that ALREADY
// SUCCEEDED into an error the ops UI would retry into a 409.
const handleRealReturn = ({
  integrationSdk,
  listing,
  turnaroundHours,
  turnaroundSource,
  requestedCleaningDays,
  txIdForLog,
}) => {
  if (!listing) {
    return Promise.resolve(null);
  }

  const returnedAt = new Date();
  const { days: cleaningDays, source: cleaningDaysSource } = resolveCleaningDays({
    requestedDays: requestedCleaningDays,
    turnaroundHours,
  });
  const { readyAt, blockWindow } = computeReadiness({ returnedAt, cleaningDays });

  // Custody first, availability second. Custody is the fact the client asked to
  // be recorded ("se queda en estatus onLaundry true"); the calendar block is a
  // consequence of it. If only one of the two writes can land, it should be the
  // fact.
  // Promise.resolve().then(...) rather than calling straight into
  // writeCustodyMetadata: this whole function runs after a transition that has
  // ALREADY succeeded, so a synchronous throw (an unexpected SDK shape, say)
  // must be caught by the same .catch() as a rejected write rather than escaping
  // into the endpoint's error path and reporting a 500 for work that was done.
  return Promise.resolve()
    .then(() =>
      writeCustodyMetadata({ integrationSdk, listingId: listing.id, onLaundry: true, readyAt })
    )
    .catch(e => {
      log.error(e, 'laundry-return-custody-write-failed', { txId: txIdForLog });
      return null;
    })
    .then(() => {
      if (!blockWindow) {
        // cleaningDays === 0: the laundry says it is ready today, so there is
        // nothing to block.
        return null;
      }
      return Promise.resolve()
        .then(() =>
          reconcileBufferWindow({
            integrationSdk,
            listingId: listing.id,
            start: blockWindow.start,
            end: blockWindow.end,
            txIdForLog,
          })
        )
        .catch(e => {
          log.error(e, 'laundry-return-buffer-failed', { txId: txIdForLog });
          return null;
        });
    })
    .then(bufferResult => ({
      onLaundry: true,
      readyAt: readyAt.toISOString(),
      cleaningDays,
      cleaningDaysSource,
      // Only meaningful when the days were NOT supplied by the laundry: it says
      // which rung of the fallback chain the default came from ('category' - the
      // hours this studio set for this garment's top-level category, 'studio' -
      // its studio-wide setting, 'env-default' - ours). "3 days, because you set
      // 72h for Dresses" and "3 days, because nobody configured anything" are
      // very different statements to put in front of a studio.
      ...(cleaningDaysSource === 'configured-turnaround' ? { turnaroundSource } : {}),
      buffer: bufferResult,
    }));
};

module.exports = (req, res) => {
  const { transactionId, status, damaged, damageNote, cleaningDays } = req.body || {};
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

  // Rejected up front, before any transition is fired. A bad `cleaningDays` is a
  // client bug and must surface as one: falling back to the configured default
  // would hide it, and the transition is irreversible once fired, so there would
  // be no way to correct the block afterwards without a second endpoint.
  const cleaningDaysCheck = validateCleaningDays(cleaningDays);
  if (!cleaningDaysCheck.valid) {
    res
      .status(400)
      .json({
        error:
          'Invalid "cleaningDays" in request body. Must be an integer between 0 and ' +
          `${MAX_CLEANING_DAYS}.`,
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

      const assignedLaundryId = readAssignedLaundryId(listing);

      return authorizeLaundryCaller(req, res, assignedLaundryId).then(currentUser => {
        // The caller IS the assigned laundry (just verified), so their own
        // profile is the authoritative source for the studio name, the
        // notification address and the turnaround time. No extra users.show.
        const profile = currentUser?.attributes?.profile || {};
        // Per-category turnaround, selected by this listing's own top-level
        // category, so the return/cleaning window matches the garment in hand.
        // See api-util/categoryPricing.js for the fallback chain.
        //
        // resolveTurnaroundHoursEntry (rather than the thinner
        // resolveCategoryTurnaroundHours wrapper) because the return response
        // reports WHERE the default came from - a laundry accepting a pre-filled
        // "3 days" deserves to know whether that is the number it set for this
        // category, its studio-wide fallback, or ours.
        const turnaroundEntry = resolveTurnaroundHoursEntry(
          profile.privateData,
          getListingCategoryValues(listing.attributes?.publicData)
        );
        const laundry = {
          email: currentUser?.attributes?.email,
          studioName: profile.publicData?.laundryProfile?.studioName,
          turnaroundSource: turnaroundEntry?.source || 'env-default',
          turnaroundHours: resolveTurnaroundHours(
            turnaroundEntry?.value ?? null,
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

      const isReturn =
        transition === TRANSITIONS.LAUNDRY_CONFIRM_RETURN ||
        transition === TRANSITIONS.LAUNDRY_CONFIRM_RETURN_LATE;

      const returnPromise = isReturn
        ? handleRealReturn({
            integrationSdk,
            listing,
            turnaroundHours: laundry.turnaroundHours,
            turnaroundSource: laundry.turnaroundSource,
            requestedCleaningDays: cleaningDaysCheck.value,
            txIdForLog,
          })
        : Promise.resolve(null);

      // The custody/readiness work IS awaited (unlike the mail) so its result can
      // be reported, but handleRealReturn swallows its own failures - a calendar
      // or listing write must not fail a transition that already happened.
      return returnPromise.then(returnResult => {
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
              ...(returnResult ? { custody: returnResult } : {}),
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
