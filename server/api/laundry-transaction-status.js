const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { uuidString } = require('../api-util/uuid');
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
const { resolveTurnaroundDays } = require('../api-util/availabilityHelpers');
const {
  BUFFER_EXCEPTION_IDS_KEY,
  reconcileBufferWindow,
  writeBufferExceptionIds,
} = require('../api-util/availabilityBuffer');
const {
  LISTING_CODE_KEY,
  MAX_CODE_LENGTH,
  TRANSACTION_CODE_KEY,
  TRANSACTION_CODE_HISTORY_KEY,
  buildListingCodeRecord,
  validateLaundryCode,
} = require('../api-util/laundryCode');
const {
  getListingCategoryValues,
  resolveTurnaroundDaysEntry,
} = require('../api-util/categoryPricing');
const {
  MAX_CLEANING_DAYS,
  validateCleaningDays,
  resolveCleaningDays,
  maxCleaningDaysBeforeNextBooking,
  computeReadiness,
  writeCustodyMetadata,
  releaseCleaningHold,
} = require('../api-util/listingCustody');
const { notifyReturnScheduled, notifyCleaningRequired } = require('../api-util/laundryMailer');
const { getBookingOverdueDays } = require('../api-util/dates');
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
//                            //   for this garment's category, and is capped by the
//                            //   garment's next booking (see listingCustody.js)
//   laundryCode,             // optional string  - only read at status 'ready-for-pickup',
//                            //   the studio's own code for the garment. Written to the
//                            //   transaction (so both parties see it) AND to the listing,
//                            //   stamped with the studio that issued it. See
//                            //   api-util/laundryCode.js.
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
  existingLaundryCodes,
  laundryCode,
  bookingEnd,
}) => {
  const metadata = {};

  if (
    transition === TRANSITIONS.LAUNDRY_MARK_READY ||
    transition === TRANSITIONS.LAUNDRY_MARK_READY_FROM_INITIAL_CLEANING
  ) {
    // Both "mark ready" transitions (2026-09-21) are the same ops step reaching the same
    // outcome from two different starting states - see their comment in
    // server/api-util/coclosetBookingProcess.js. The ticket code and rack are written either
    // way.
    //
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

  // THE STUDIO'S OWN CODE FOR THIS GARMENT.
  //
  //   > "cuando laundry recibe la prenda desde el provider, debe aparecer un input para que
  //   >  laundry pueda ingresar un código interno para esa prenda, ese código se le debe
  //   >  mostrar a todas las partes de la transacción"
  //
  // NOT INSIDE THE mark-ready BRANCH ANY MORE, and that is the other half of the bug the
  // client reported. This whole block used to sit under `transition === LAUNDRY_MARK_READY`
  // while the ops screens asked for a code at TWO steps, so the second answer - the one typed
  // when the garment goes for cleaning, which is the one most likely to differ - was parsed,
  // validated, sent, and then dropped on the floor with nothing on screen to say so.
  //
  // Whether a step takes a code is `takesLaundryCode`'s answer, in one place, and this now
  // simply records whatever arrived.
  //
  // On the TRANSACTION it is a plain string, and that is what makes it visible to both
  // parties: transaction metadata rides along on every `transactions.show` for a party,
  // while the listing record it is also written to is not something a customer can read
  // usefully. It also makes a finished rental honest - it keeps the code that was true while
  // it ran, even after the garment has moved to another studio and been given a new one.
  //
  // Absent when the studio did not type one. See validateLaundryCode for why that is allowed
  // rather than refused: a garment physically on the counter must not be stuck in the app
  // because nobody has decided where it goes yet.
  if (laundryCode) {
    metadata[TRANSACTION_CODE_KEY] = laundryCode;
    // AND THE ONES BEFORE IT.
    //
    //   > "puede ocurrir que no sea el mismo ticket con el que inició, pero al ser asi, no
    //   >  se guarda en la transaction, solo se queda el primer ticket, deben guardarse los
    //   >  dos sin sobreescribirse" (Jonathan, 2026-09-08)
    //
    // The studio is asked for the code more than once in a rental - on the way in, and
    // again when the garment goes for cleaning, because a coat coming back rarely returns
    // to the shelf it left. The second answer used to overwrite the first, so a garment
    // that moved shelves lost the record of where it had been.
    //
    // `laundryCode` stays the CURRENT one: every reader already looks there, and a rental
    // has exactly one place its garment is right now. The history is a separate key, in
    // order, appended rather than replaced - and only when the code actually changed, so
    // confirming the prefilled box does not fill the list with the same string.
    //
    // Read from the transaction we already fetched. Sharetribe merges metadata per TOP-LEVEL
    // key, so writing this array replaces the stored one wholesale - which is exactly why it
    // has to be built from what was there rather than sent as a single new entry.
    const previous = Array.isArray(existingLaundryCodes) ? existingLaundryCodes : [];
    const latest = previous[previous.length - 1];
    if (!latest || latest.code !== laundryCode) {
      metadata[TRANSACTION_CODE_HISTORY_KEY] = [
        ...previous,
        { code: laundryCode, at: new Date().toISOString() },
      ];
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

  // HOW LATE, IN DAYS (2026-10-15). "Si el customer regresa la prenda con retraso, debe
  // informar por correo al provider sobre el retraso" - the provider's own email
  // (:notification/booking-return-completed-late, :template :booking-return-completed-late-owner)
  // has to say the exact day count, and Sharetribe's notification templates have no
  // arithmetic (see the comment in booking-new-request-html.html for the same constraint
  // elsewhere), so the number has to be computed here, at the moment the laundry confirms the
  // late return, and carried in metadata where the template can read it directly.
  //
  // ONLY on the LATE transition - a return confirmed on time has nothing to report, and
  // `getBookingOverdueDays` would just answer 0 for it anyway (the "not yet overdue" branch),
  // so gating on the transition name rather than the computed value keeps the intent visible
  // in the metadata itself: the key's mere presence already says this return was late.
  //
  // Same shape as `getBookingOverdueDays` in src/util/dates.js (see that function's server
  // mirror in api-util/dates.js for why this cannot just import it), read against `now` at the
  // moment of confirmation rather than at booking-end - a return confirmed several days after
  // the garment actually came back should still report the day it was ACTUALLY returned, which
  // is what this moment answers.
  if (transition === TRANSITIONS.LAUNDRY_CONFIRM_RETURN_LATE) {
    metadata.daysLate = getBookingOverdueDays(bookingEnd);
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
  turnaroundDays,
  turnaroundSource,
  requestedCleaningDays,
  transactionId,
  // The transaction entity as the transition left it. Needed only so the exception-id record
  // below MERGES with whatever the accept-time buffer already put there rather than replacing
  // it - dropping those ids would make the booking's own block unattributed and unsweepable.
  transaction,
  txIdForLog,
}) => {
  if (!listing) {
    return Promise.resolve(null);
  }

  const returnedAt = new Date();
  // The listing's own zone, not the server's and not UTC. The days the operator typed are
  // days on the studio's wall calendar; counting them in UTC put the whole window a day out
  // for any studio west of Greenwich confirming a return in the evening.
  const timeZone = listing.attributes?.availabilityPlan?.timezone;

  // HOW LONG THE STUDIO MAY ACTUALLY HOLD IT.
  //
  //   > "si alguien hace booking el 29 y la prenda es devuelta el día 26, solo se tienen dos
  //   >  días para hacer el lavado (...) hay que limitarlo para que no sean mas de esos días"
  //
  // A garment already reserved for a date cannot be held past it, so the room left before
  // that reservation is a ceiling on whatever the studio asks for.
  //
  // A FAILED READ IS NOT "NO CEILING". Treating an outage as "hold it as long as you like"
  // would run a wash straight through a rental somebody has already paid for, so the failure
  // is logged and the clamp simply does not apply - the least-bad of two wrong answers, and
  // the same direction the other best-effort reads on this path err in.
  return Promise.resolve()
    .then(() =>
      resolveNextBookingStart({
        integrationSdk,
        listingId: listing.id?.uuid,
        after: returnedAt,
        excludeTransactionId: transactionId,
      })
    )
    .catch(e => {
      log.error(e, 'next-booking-lookup-failed', { txId: txIdForLog, message: e?.message });
      return null;
    })
    .then(nextBookingStart => {
      const maxCleaningDays = maxCleaningDaysBeforeNextBooking({
        returnedAt,
        nextBookingStart,
        timeZone,
      });

      const {
        days: cleaningDays,
        source: cleaningDaysSource,
        requestedDays: uncappedCleaningDays,
        cappedByNextBooking,
      } = resolveCleaningDays({
        requestedDays: requestedCleaningDays,
        turnaroundDays,
        maxDays: maxCleaningDays,
      });

      if (cappedByNextBooking) {
        // Worth a line in the log: a garment has gone back on the market without the wash its
        // studio asked for, because the calendar left no room. Nobody did anything wrong -
        // this is the rule the client chose - but it is the sort of thing somebody will one
        // day need to explain.
        log.error(new Error('Cleaning days capped by the next booking'), 'cleaning-days-capped', {
          txId: txIdForLog,
          requested: uncappedCleaningDays,
          allowed: cleaningDays,
          nextBookingStart: nextBookingStart ? nextBookingStart.toISOString() : null,
        });
      }

      return writeReadiness({
        integrationSdk,
        listing,
        returnedAt,
        timeZone,
        cleaningDays,
        cleaningDaysSource,
        turnaroundSource,
        maxCleaningDays,
        cappedByNextBooking,
        uncappedCleaningDays,
        transaction,
        txIdForLog,
      });
    });
};

// The custody and calendar writes. Split out of handleRealReturn only so the ceiling lookup
// above reads as one step instead of nesting this whole body another level deep; the behaviour
// is unchanged.
const writeReadiness = ({
  integrationSdk,
  listing,
  returnedAt,
  timeZone,
  cleaningDays,
  cleaningDaysSource,
  turnaroundSource,
  maxCleaningDays,
  cappedByNextBooking,
  uncappedCleaningDays,
  transaction,
  txIdForLog,
}) => {
  const { readyAt, blockWindow } = computeReadiness({ returnedAt, cleaningDays, timeZone });

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
        .then(bufferResult =>
          // REMEMBER WHAT WE BLOCKED, so it can be given back.
          //
          // These ids were created and discarded. That is the same mistake the accept-time
          // buffer made and already fixed for itself (see the comment on writeBufferExceptionIds
          // in api-util/availabilityBuffer.js): an owner's own `seats: 0` exception is
          // indistinguishable from ours to the API, so without this record nothing can safely
          // delete these days again - not listing-availability-sweep, and not the early-finish
          // release this record exists for (releaseCleaningHold in api-util/listingCustody.js).
          //
          // Same key, so the sweep picks these up too and a cancelled rental stops leaving its
          // wash days blocked as well.
          //
          // Fire-and-continue like its sibling: the window IS blocked, which is the part that
          // protects the garment. Losing the record costs the release, not the block.
          writeBufferExceptionIds({
            integrationSdk,
            transaction,
            exceptionIds: bufferResult?.exceptionIds,
            txIdForLog,
          })
            .catch(() => null)
            .then(() => bufferResult)
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
      // What the studio asked for before the next booking cut it short, and the ceiling that
      // did the cutting. Absent when nothing was capped, so a caller cannot mistake a normal
      // return for one that was shortened.
      ...(cappedByNextBooking
        ? { requestedCleaningDays: uncappedCleaningDays, cappedByNextBooking: true }
        : {}),
      ...(Number.isFinite(maxCleaningDays) ? { maxCleaningDays } : {}),
      // Only meaningful when the days were NOT supplied by the laundry: it says
      // which rung of the fallback chain the default came from ('category' - the
      // days this studio set for this garment's top-level category, 'studio' -
      // its studio-wide setting, 'env-default' - ours). "3 days, because you set
      // 3 days for Dresses" and "3 days, because nobody configured anything" are
      // very different statements to put in front of a studio.
      ...(cleaningDaysSource === 'configured-turnaround' ? { turnaroundSource } : {}),
      buffer: bufferResult,
    }));
};

module.exports = (req, res) => {
  const { status, damaged, damageNote, cleaningDays, laundryCode } = req.body || {};
  // Both of this endpoint's callers happen to send a plain string today, so it has never hit
  // the cross-SDK UUID trap that broke auto-accept-booking and create-availability-buffer -
  // but it is the same boundary handing a client-supplied id to the Integration SDK, and
  // "happens to send a string" is not a property a caller can be relied on to keep. See
  // api-util/uuid.js.
  const transactionId = uuidString(req.body?.transactionId);
  const txIdForLog = transactionId || 'unknown';

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

  // Same treatment as `cleaningDays`, and for the same reason: the transition is irreversible
  // once fired, so a malformed value has to be a 400 up front rather than something quietly
  // dropped afterwards with no way to correct it.
  const laundryCodeCheck = validateLaundryCode(laundryCode);
  if (!laundryCodeCheck.valid) {
    res
      .status(400)
      .json({
        error: `Invalid "laundryCode" in request body. Must be a string of at most ${MAX_CODE_LENGTH} characters.`,
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
        // resolveTurnaroundDaysEntry (rather than the thinner
        // resolveCategoryTurnaroundDays wrapper) because the return response
        // reports WHERE the default came from - a laundry accepting a pre-filled
        // "3 days" deserves to know whether that is the number it set for this
        // category, its studio-wide fallback, or ours.
        const turnaroundEntry = resolveTurnaroundDaysEntry(
          profile.privateData,
          getListingCategoryValues(listing.attributes?.publicData)
        );
        const laundry = {
          email: currentUser?.attributes?.email,
          studioName: profile.publicData?.laundryProfile?.studioName,
          turnaroundSource: turnaroundEntry?.source || 'env-default',
          turnaroundDays: resolveTurnaroundDays(
            turnaroundEntry?.value ?? null,
            process.env.DEFAULT_LAUNDRY_BUFFER_DAYS
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
          existingLaundryCodes: data.attributes?.metadata?.[TRANSACTION_CODE_HISTORY_KEY],
          laundryCode: laundryCodeCheck.value,
          bookingEnd: booking?.attributes?.end,
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

      // THE GARMENT'S OWN COPY OF THE CODE.
      //
      //   > "ese código (...) debe guardarse tambien en el metadata del listing"
      //
      // Written AFTER the transition, and fire-and-continue like everything else here: the
      // transition has already succeeded, and failing the request over a listing write would
      // make the ops UI retry a step Sharetribe now answers 409 for. The transaction already
      // carries the code, so the parties see it either way; what a failure here costs is the
      // GARMENT's copy, which is what the next rental at this studio would have inherited.
      //
      // STAMPED WITH THE STUDIO THAT ISSUED IT. The code names a place on one studio's
      // shelving and means nothing at another, so the record carries `laundryId` and readers
      // ignore it once the garment is assigned elsewhere - see api-util/laundryCode.js
      // `currentLaundryCodeFor`. That is also the answer to "several codes or replace the
      // same one": replace, but keep the issuer, because a bare string cannot be told apart
      // from a dead one.
      if (laundryCodeCheck.value && listing?.id) {
        Promise.resolve()
          .then(() =>
            integrationSdk.listings.update(
              {
                id: listing.id,
                metadata: {
                  [LISTING_CODE_KEY]: buildListingCodeRecord({
                    code: laundryCodeCheck.value,
                    laundryId: readAssignedLaundryId(listing),
                  }),
                },
              },
              { expand: true }
            )
          )
          .catch(e => {
            log.error(e, 'laundry-code-listing-write-failed', {
              txId: txIdForLog,
              message: e?.message,
            });
          });
      }

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

      // THE WASH IS SCHEDULED WHEN THE WASH STARTS, NOT WHEN THE GARMENT ARRIVES.
      //
      // This hung off the two RETURN transitions, because that was the step that asked for
      // the cleaning days. The question moved to "Process for Cleaning", so the readiness it
      // feeds - when the garment can be booked again, and the availability block that
      // reserves the time - moves with it. Collecting the days at one step and applying them
      // from another is the bug this avoids.
      //
      // Counting from NOW rather than from the return is also the more honest clock: this is
      // the moment the studio says it is starting, and the days it just typed are days of
      // work, not days since a garment landed on a counter.
      // THE MOMENT THE WORK STARTS, not the moment the garment joins the queue.
      //
      //   > "luego de ahi viene otro paso con un unico button 'Mark cleaning in progress', en
      //   >  ese paso es cuando se pregunta el número de días de lavado" (Jonathan, 2026-09-08)
      //
      // This is where the days the studio typed are consumed - the availability block and the
      // ready-at date are both computed from them - so it has to be the same transition the
      // client asks the question at (CLEANING_DAYS_STATUS in src/util/laundryStatuses.js). A
      // question asked at one step and read at another is an answer thrown away in silence.
      //
      // It also makes the clock honest, which was already the argument for counting from now
      // rather than from the return: a garment can sit in the queue for a day before anybody
      // touches it, and those are not days of work.
      const isCleaningStart = transition === TRANSITIONS.LAUNDRY_START_CLEANING;

      const returnPromise = isCleaningStart
        ? handleRealReturn({
            integrationSdk,
            listing,
            turnaroundDays: laundry.turnaroundDays,
            turnaroundSource: laundry.turnaroundSource,
            requestedCleaningDays: cleaningDaysCheck.value,
            transactionId: txIdForLog,
            transaction: updated,
            txIdForLog,
          })
        : Promise.resolve(null);

      // ...AND THE WASH IS OVER WHEN THE STUDIO SAYS IT IS OVER.
      //
      // `readyAt` and the block above are estimates, computed from the studio's configured
      // turnaround at the moment the work is SCHEDULED. Until now nothing reacted to the
      // moment it actually finished, so a studio that beat its own turnaround kept the garment
      // off the market until the estimate ran out. These are the two transitions where the
      // studio states the work is done, and they are the two ends of the same gap:
      //
      //   - LAUNDRY_MARK_AVAILABLE              - the post-rental wash, estimated at
      //                                           LAUNDRY_START_CLEANING just above.
      //   - LAUNDRY_MARK_READY_FROM_INITIAL_CLEANING - the FIRST wash, estimated at reception
      //                                           (api/laundry-receive-garment.js).
      //
      // Deliberately both, in one change: fixing only one would leave the two cleaning flows
      // behaving differently for the same reason, which is the asymmetry this was held back
      // for last round.
      //
      // NOT LAUNDRY_MARK_READY (the plain one). That is a garment going out to the renter who
      // booked it after an ordinary return - its wash finished at mark-available, which has
      // already run and already released. Releasing again would be a second write that finds
      // nothing, but naming it here would also imply it is a cleaning-completion step, and it
      // is not.
      const isCleaningDone =
        transition === TRANSITIONS.LAUNDRY_MARK_AVAILABLE ||
        transition === TRANSITIONS.LAUNDRY_MARK_READY_FROM_INITIAL_CLEANING;

      const releasePromise = isCleaningDone
        ? releaseCleaningHold({
            integrationSdk,
            listing,
            exceptionIds: storedMetadata?.[BUFFER_EXCEPTION_IDS_KEY],
            log,
            txIdForLog,
          })
        : Promise.resolve(null);

      // The custody/readiness work IS awaited (unlike the mail) so its result can
      // be reported, but handleRealReturn swallows its own failures - a calendar
      // or listing write must not fail a transition that already happened.
      return Promise.all([returnPromise, releasePromise]).then(([returnResult, releaseResult]) => {
        res
          .status(200)
          .set('Content-Type', 'application/json')
          .send({
            data: {
              status,
              transition,
              state: newState,
              ...(ticketCode ? { ticketCode } : {}),
              // Echoed back for the same reason `ticketCode` is: the caller typed it, and a
              // confirmation that says what was stored is worth more than one that says
              // "done". Read off what the API actually kept, not off what we sent.
              ...(storedMetadata?.[TRANSACTION_CODE_KEY]
                ? { laundryCode: storedMetadata[TRANSACTION_CODE_KEY] }
                : {}),
              ...(storedMetadata?.damageReported
                ? { damageReported: storedMetadata.damageReported }
                : {}),
              ...(returnResult ? { custody: returnResult } : {}),
              // What the completion actually gave back, for the same reason `custody` is
              // reported: a studio that finishes early is told the garment is free again,
              // rather than having to notice it on the calendar later.
              ...(releaseResult ? { released: releaseResult } : {}),
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
