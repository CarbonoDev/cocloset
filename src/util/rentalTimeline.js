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

// WHERE THE TRANSACTION SITS ON THIS READER'S LIST: { index, settled }.
// `settled` means the step at `index` has already HAPPENED, so it reads DONE instead of CURRENT.
//
//   > "he aceptado la solicitud del pedido, pero aún no lo he llevado a la laundry. Esto
//   >  debería mostrar el segundo punto con un contorno oscuro pero sin relleno (...) el punto
//   >  actual debe ser 'Drop off at cleaner'" (Jonathan, 2026-09-11)
//
// - ACCEPTED isn't one moment. `bookingConfirmed`, `dropOffAtCleaners` and `laundryPreparing`
//   all share it on purpose (see the comment on `dropOffAtCleaners` above), and
//   `lastIndexForState` would resolve that tie to the LAST of the three. `metadata.onLaundry`
//   decides instead: `onLaundry !== true` means the garment is still with its owner, so the
//   current step is `dropOffAtCleaners`; `onLaundry === true` means the studio already has it,
//   so `laundryPreparing` is current and `dropOffAtCleaners` reads DONE.
// - ACCEPTED_ON_LAUNDRY (auto-accept, garment already at the studio) and INITIAL_CLEANING (the
//   studio received the garment and is washing it) have no step of their own in the list.
//   Both mean the garment is at the studio being prepared, so both point at
//   `laundryPreparing`. Without this they resolved to `undefined` and the whole list went grey.
// - If the state's own step is not on this reader's list (the customer has no `cleaning` or
//   `readyForNextRental`), use the nearest EARLIER step they do see, settled: the rental has
//   moved past everything they are shown, so it reads DONE rather than current.
// - DELIVERED is an arrival, not a wait: it is reached when the studio marks the garment
//   available again, so its own step (`readyForNextRental`) has happened and is settled too.
//   The review is answered separately in `timelineStatusFor` and is what is left current.
const currentPositionFor = (steps, state, onLaundry) => {
  const aliasKey =
    state === coclosetStates.ACCEPTED
      ? onLaundry === true
        ? 'laundryPreparing'
        : 'dropOffAtCleaners'
      : state === coclosetStates.ACCEPTED_ON_LAUNDRY || state === coclosetStates.INITIAL_CLEANING
      ? 'laundryPreparing'
      : null;
  if (aliasKey) {
    return { index: steps.findIndex(step => step.key === aliasKey), settled: false };
  }

  const ownIndex = lastIndexForState(steps)[state];
  if (ownIndex !== undefined) {
    return { index: ownIndex, settled: state === coclosetStates.DELIVERED };
  }

  const fullIndex = RENTAL_TIMELINE_STEPS.reduce(
    (found, step, index) => (step.state === state ? index : found),
    -1
  );
  for (let i = fullIndex - 1; i >= 0; i--) {
    const index = steps.findIndex(step => step.key === RENTAL_TIMELINE_STEPS[i].key);
    if (index >= 0) {
      return { index, settled: true };
    }
  }
  return { index: -1, settled: false };
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

// Is the review step done? THERE IS ONLY ONE REVIEWER NOW (2026-09-21): the provider can no
// longer write one at all, so `reviewed-by-customer` / `reviewed-by-provider` - which used to
// tell the two halves of the review apart while the process waited on the second party - no
// longer exist. `reviewed` is reached the moment the customer reviews (or the 7-day window
// lapses with no review), so it is the one fact either audience needs: the owner still gets a
// `review` step on their timeline (they watch it the same way they watch `cleaning`, without
// it being their action), and it goes DONE for them at the same instant it does for the renter.
const hasReviewed = processState => processState === coclosetStates.REVIEWED;

// Is the rental far enough along for a review to be possible at all?
const REVIEWABLE_STATES = [coclosetStates.DELIVERED, coclosetStates.REVIEWED];

/**
 * Mark a reader's steps against a transaction's current state.
 *
 * `overdue` is treated as `picked-up`, deliberately: a late rental is still a rental in
 * progress, and the timeline's job is to say where the garment is, not to scold. The lateness
 * is surfaced by the status pill, which is where a reader looks for a problem.
 *
 * THE REVIEW STEP USED TO BE ANSWERED SEPARATELY per audience, back when either party could
 * review first and `reviewed-by-customer` / `reviewed-by-provider` recorded which one had. Now
 * that only the customer can review at all (2026-09-21), `reviewed` is reached in one step and
 * both audiences' `review` step goes DONE together - there is no longer a "done for them, still
 * waiting for the owner" split to preserve.
 *
 * @param {string} [processState] - from `resolveLatestProcessName`-aware state derivation
 * @param {Object} [options]
 * @param {string} [options.audience] - whose list to mark; defaults to the customer's
 * @param {boolean} [options.onLaundry] - the listing's `metadata.onLaundry`; disambiguates the
 *   ACCEPTED state's three shared steps (see `currentPositionFor`)
 * @returns {Array<{key: string, status: string}>} that reader's steps, in order
 */
export const timelineStatusFor = (processState, options = {}) => {
  const { audience = TIMELINE_AUDIENCE_CUSTOMER, onLaundry } = options;
  const steps = rentalTimelineSteps(audience);

  const normalised =
    processState === coclosetStates.OVERDUE
      ? coclosetStates.PICKED_UP
      : processState === coclosetStates.REVIEWED
      ? coclosetStates.DELIVERED
      : processState;

  const isBefore = PRE_TIMELINE_STATES.includes(normalised);
  const isOff = OFF_TIMELINE_STATES.includes(normalised);
  const { index: currentIndex, settled } =
    isBefore || isOff
      ? { index: -1, settled: false }
      : currentPositionFor(steps, normalised, onLaundry);

  const canReview = REVIEWABLE_STATES.includes(processState);
  const reviewStatus = hasReviewed(processState)
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
        ? settled
          ? STEP_DONE
          : STEP_CURRENT
        : STEP_PENDING,
  }));
};
