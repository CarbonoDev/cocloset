import { states as coclosetStates } from '../transactions/transactionProcessCoclosetBooking';

/**
 * THE EIGHT STEPS OF A RENTAL, AND WHERE A GIVEN ONE HAS GOT TO.
 *
 * The listing page shows this list as a description of how renting here works - nothing is
 * highlighted, because there is no transaction yet. The inbox shows the SAME list against a
 * real rental, with the steps behind it done and the one it is on marked.
 *
 * ONE LIST, TWO READERS. Two copies would drift the first time a step was renamed, and the
 * two surfaces sit one click apart - a customer who read "Returned to laundry" on a listing
 * page and then sees "Back at the studio" in their inbox has been told about two things.
 *
 * ── WHY IT IS TRANSCRIBED FROM THE PROCESS RATHER THAN DERIVED FROM IT ──────
 * The process's own state graph carries branches this list must not tell: declines, expiry,
 * cancellations, late returns, the two review states. Deriving the story from the graph would
 * mean either rendering those (a timeline that says "declined" as step 4) or filtering them
 * out here, which is transcription with extra steps. So the happy path is written down, and
 * the states that are NOT on it are handled by `timelineStatusFor` returning nothing rather
 * than by pretending they fit.
 */

export const TIMELINE_AUDIENCE_CUSTOMER = 'customer';
export const TIMELINE_AUDIENCE_PROVIDER = 'provider';

/**
 * NOT EVERY STEP IS EVERY READER'S BUSINESS.
 *
 *   > "aparecen para el customer Cleaning y Ready for next rental, el customer no tiene que
 *   >  saber eso, laundry y provider si, podemos agregar para customer y provider los steps de
 *   >  review? y para customer remover los dos steps que te menciono?"
 *
 * A renter's story ends when they hand the garment back. What happens to it afterwards -
 * washing it, putting it back on the shelf - is the owner's and the studio's business, and
 * showing it to the renter invites a question they have no stake in ("is my rental still going
 * on?"). The owner needs exactly those two, because for them the rental is not over until the
 * garment can go out again.
 *
 * Both of them get a review step, which the list never had: the process has had review states
 * all along and the timeline just stopped short of them, so a rental that was waiting on the
 * READER to write a review looked finished.
 *
 * `audience` is a list rather than a flag, so a third reader - a laundry-facing view, which
 * does not exist yet - is a word here rather than a rewrite.
 */
const ALL_AUDIENCES = [TIMELINE_AUDIENCE_CUSTOMER, TIMELINE_AUDIENCE_PROVIDER];

/** The steps, in order. Each key has a `ListingPage.rentalTimeline.<key>` translation. */
export const RENTAL_TIMELINE_STEPS = [
  { key: 'bookingConfirmed', state: coclosetStates.ACCEPTED, audience: ALL_AUDIENCES },
  // THE STEP THE GARMENT ACTUALLY WAITS ON.
  //
  //   > "Podemos agregar el paso 'drop of at cleaners' despues de Booking
  //   >  confirmed en el listado de pasos de la transacción?" (Jonathan, 2026-09-03)
  //
  // Between a confirmed booking and a studio preparing the garment there is a
  // person carrying it there. The list jumped straight from one to the other, so
  // the wait had no name - and it is the step most likely to be the reason a
  // rental is not moving.
  //
  // Shares `accepted` with the two steps around it, as `laundryPreparing`
  // already does: the process has one state for the whole run-up, and
  // `lastIndexForState` resolves a tie to the last step carrying it, so the
  // three read as "done, done, current" rather than fighting each other.
  { key: 'dropOffAtCleaners', state: coclosetStates.ACCEPTED, audience: ALL_AUDIENCES },
  { key: 'laundryPreparing', state: coclosetStates.ACCEPTED, audience: ALL_AUDIENCES },
  { key: 'readyForPickup', state: coclosetStates.READY_FOR_PICKUP, audience: ALL_AUDIENCES },
  { key: 'pickedUp', state: coclosetStates.PICKED_UP, audience: ALL_AUDIENCES },
  { key: 'rentalActive', state: coclosetStates.PICKED_UP, audience: ALL_AUDIENCES },
  { key: 'returnedToLaundry', state: coclosetStates.RETURNED, audience: ALL_AUDIENCES },
  {
    key: 'cleaning',
    state: coclosetStates.CLEANING,
    audience: [TIMELINE_AUDIENCE_PROVIDER],
  },
  {
    key: 'readyForNextRental',
    state: coclosetStates.DELIVERED,
    audience: [TIMELINE_AUDIENCE_PROVIDER],
  },
  // The review step has NO state of its own. Every other step is "the rental reached this
  // point"; this one is "it is your turn, and have you done it" - which is a different
  // question for each reader, so it is answered per audience in `timelineStatusFor` rather
  // than by a state on the list. `state: null` is what marks it as that kind of step.
  { key: 'review', state: null, audience: ALL_AUDIENCES },
];

/**
 * The steps a given reader sees, in order.
 *
 * Defaults to the CUSTOMER's list. The listing page renders this with no transaction and no
 * role, as a description of how renting here works - and the person reading a listing is
 * deciding whether to rent it.
 *
 * @param {string} [audience] - TIMELINE_AUDIENCE_CUSTOMER or TIMELINE_AUDIENCE_PROVIDER
 * @returns {Array<Object>}
 */
export const rentalTimelineSteps = (audience = TIMELINE_AUDIENCE_CUSTOMER) =>
  RENTAL_TIMELINE_STEPS.filter(step => step.audience.includes(audience));

/**
 * The message id for a step's label.
 *
 *   > "en el status 'Returned to laundry', podemos poner 'Returned to laundry - reported' solo
 *   >  si la prenda fue reportada como dañada, si no tiene daños debe permanecer igual y el
 *   >  resto de los pasos debe funcionar igual"
 *
 * Damage is recorded at the return, by the studio holding the garment, so the return step is
 * the only one that can carry the annotation - and this function is where that knowledge
 * lives, beside the step list itself, rather than in whichever component happens to render it.
 *
 * The annotation is a fact about a step that has HAPPENED, so it stays once the rental moves
 * on to cleaning: a garment does not become undamaged because it went in the wash. It is also
 * a whole separate string rather than a suffix pasted onto the plain one - " - reported" is
 * not a phrase every language builds the same way, and the listing page (which has no
 * transaction, so no damage to report) keeps using the plain key untouched.
 *
 * @param {string} stepKey - one of RENTAL_TIMELINE_STEPS' keys
 * @param {Object} [options]
 * @param {boolean} [options.damageReported] - the transaction's `metadata.damageReported.flag`
 * @returns {string} a translation key
 */
export const timelineStepMessageId = (stepKey, options = {}) =>
  stepKey === 'returnedToLaundry' && options.damageReported === true
    ? 'ListingPage.rentalTimeline.returnedToLaundryReported'
    : `ListingPage.rentalTimeline.${stepKey}`;

export const STEP_DONE = 'done';
export const STEP_CURRENT = 'current';
export const STEP_PENDING = 'pending';

// Where each state sits on a reader's list. Two steps can share a state (the design splits
// "booking confirmed" from "laundry preparing", and "picked up" from "rental active", which
// are one process state each); the LAST index for a state is the one a transaction in it has
// reached, so the earlier twin reads as done rather than as still happening.
//
// COMPUTED PER AUDIENCE, because the lists are different lengths now: an index into the
// customer's list means a different step than the same index into the owner's.
const lastIndexForState = steps =>
  steps.reduce(
    (indexes, step, index) => (step.state ? { ...indexes, [step.state]: index } : indexes),
    {}
  );

// THE ONE STATE THAT ISN'T ONE MOMENT.
//
//   > "he aceptado la solicitud del pedido, pero aún no lo he llevado a la laundry. Esto
//   >  debería mostrar el segundo punto con un contorno oscuro pero sin relleno (...) el punto
//   >  actual debe ser 'Drop off at cleaner'" (Jonathan, 2026-09-11)
//
// `bookingConfirmed`, `dropOffAtCleaners` and `laundryPreparing` all share `state: ACCEPTED`
// on purpose (see the comment on `dropOffAtCleaners` above) - `lastIndexForState` resolves
// that tie to the LAST of the three, so a transaction that has only just been accepted, with
// nobody having carried the garment anywhere yet, was marked "laundryPreparing" as CURRENT and
// "dropOffAtCleaners" as already DONE. Both were wrong: the garment has not left its owner.
//
// The disambiguating fact already exists elsewhere in this codebase - `metadata.onLaundry`,
// the same flag `create-availability-buffer` and the initial-cleaning floor read - it just was
// not threaded into this function. `onLaundry !== true` means the accepted booking is still
// waiting on the owner, so the current step is `dropOffAtCleaners`; `onLaundry === true` means
// the studio already has it, so `laundryPreparing` resumes being current and
// `dropOffAtCleaners` reads DONE, same as before this fix for that case.
const currentIndexForAccepted = (steps, onLaundry) => {
  if (onLaundry === true) {
    return lastIndexForState(steps)[coclosetStates.ACCEPTED];
  }
  const dropOffIndex = steps.findIndex(step => step.key === 'dropOffAtCleaners');
  return dropOffIndex >= 0 ? dropOffIndex : lastIndexForState(steps)[coclosetStates.ACCEPTED];
};

// States that come BEFORE the first step. A booking still awaiting payment or acceptance has
// not started the story, so nothing is marked - the alternative is a timeline that claims
// "booking confirmed" for a booking nobody has confirmed.
const PRE_TIMELINE_STATES = [
  coclosetStates.INITIAL,
  coclosetStates.INQUIRY,
  coclosetStates.PENDING_PAYMENT,
  coclosetStates.PREAUTHORIZED,
];

// States the happy path never reaches. A cancelled or declined rental has no position on this
// list, and putting it at one would be a story about a rental that did not happen.
const OFF_TIMELINE_STATES = [
  coclosetStates.PAYMENT_EXPIRED,
  coclosetStates.DECLINED,
  coclosetStates.EXPIRED,
  coclosetStates.CANCELED,
];

// Has THIS reader already written their review? The process records the two reviews
// separately, and `reviewed` means both are in.
const hasReviewed = (processState, audience) =>
  processState === coclosetStates.REVIEWED ||
  (audience === TIMELINE_AUDIENCE_CUSTOMER &&
    processState === coclosetStates.REVIEWED_BY_CUSTOMER) ||
  (audience === TIMELINE_AUDIENCE_PROVIDER && processState === coclosetStates.REVIEWED_BY_PROVIDER);

// Is the rental far enough along for a review to be possible at all?
const REVIEWABLE_STATES = [
  coclosetStates.DELIVERED,
  coclosetStates.REVIEWED,
  coclosetStates.REVIEWED_BY_CUSTOMER,
  coclosetStates.REVIEWED_BY_PROVIDER,
];

/**
 * Mark a reader's steps against a transaction's current state.
 *
 * `overdue` is treated as `picked-up`, deliberately: a late rental is still a rental in
 * progress, and the timeline's job is to say where the garment is, not to scold. The lateness
 * is surfaced by the status pill, which is where a reader looks for a problem.
 *
 * THE REVIEW STEP IS ANSWERED SEPARATELY, and it is the reason the review states no longer
 * simply collapse into `delivered`. `reviewed-by-customer` means the CUSTOMER has written
 * one: that step is done for them and still waiting for the owner. Folding both into
 * "finished" would tell one of the two parties they had done something they had not.
 *
 * @param {string} [processState] - from `resolveLatestProcessName`-aware state derivation
 * @param {Object} [options]
 * @param {string} [options.audience] - whose list to mark; defaults to the customer's
 * @param {boolean} [options.onLaundry] - the listing's `metadata.onLaundry`; disambiguates the
 *   ACCEPTED state's three shared steps (see `currentIndexForAccepted`)
 * @returns {Array<{key: string, status: string}>} that reader's steps, in order
 */
export const timelineStatusFor = (processState, options = {}) => {
  const { audience = TIMELINE_AUDIENCE_CUSTOMER, onLaundry } = options;
  const steps = rentalTimelineSteps(audience);

  const normalised =
    processState === coclosetStates.OVERDUE
      ? coclosetStates.PICKED_UP
      : [
          coclosetStates.REVIEWED,
          coclosetStates.REVIEWED_BY_CUSTOMER,
          coclosetStates.REVIEWED_BY_PROVIDER,
        ].includes(processState)
      ? coclosetStates.DELIVERED
      : processState;

  const isBefore = PRE_TIMELINE_STATES.includes(normalised);
  const isOff = OFF_TIMELINE_STATES.includes(normalised);
  const currentIndex =
    isBefore || isOff
      ? -1
      : normalised === coclosetStates.ACCEPTED
      ? currentIndexForAccepted(steps, onLaundry)
      : lastIndexForState(steps)[normalised];

  const canReview = REVIEWABLE_STATES.includes(processState);
  const reviewStatus = hasReviewed(processState, audience)
    ? STEP_DONE
    : canReview
    ? STEP_CURRENT
    : STEP_PENDING;

  return steps.map((step, index) => ({
    key: step.key,
    status:
      step.state === null
        ? reviewStatus
        : currentIndex === undefined || currentIndex < 0
        ? STEP_PENDING
        : index < currentIndex
        ? STEP_DONE
        : index === currentIndex
        ? STEP_CURRENT
        : STEP_PENDING,
  }));
};
