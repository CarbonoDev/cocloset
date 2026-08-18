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

/** The steps, in order. Each key has a `ListingPage.rentalTimeline.<key>` translation. */
export const RENTAL_TIMELINE_STEPS = [
  { key: 'bookingConfirmed', state: coclosetStates.ACCEPTED },
  { key: 'laundryPreparing', state: coclosetStates.ACCEPTED },
  { key: 'readyForPickup', state: coclosetStates.READY_FOR_PICKUP },
  { key: 'pickedUp', state: coclosetStates.PICKED_UP },
  { key: 'rentalActive', state: coclosetStates.PICKED_UP },
  { key: 'returnedToLaundry', state: coclosetStates.RETURNED },
  { key: 'cleaning', state: coclosetStates.CLEANING },
  { key: 'readyForNextRental', state: coclosetStates.DELIVERED },
];

export const STEP_DONE = 'done';
export const STEP_CURRENT = 'current';
export const STEP_PENDING = 'pending';

// Where each state sits on the list above. Two steps can share a state (the design splits
// "booking confirmed" from "laundry preparing", and "picked up" from "rental active", which
// are one process state each); the LAST index for a state is the one a transaction in it has
// reached, so the earlier twin reads as done rather than as still happening.
const LAST_INDEX_FOR_STATE = RENTAL_TIMELINE_STEPS.reduce(
  (indexes, step, index) => ({ ...indexes, [step.state]: index }),
  {}
);

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

/**
 * Mark the eight steps against a transaction's current state.
 *
 * `overdue` is treated as `picked-up`, deliberately: a late rental is still a rental in
 * progress, and the timeline's job is to say where the garment is, not to scold. The lateness
 * is surfaced by the status pill, which is where a reader looks for a problem.
 *
 * REVIEW STATES COUNT AS FINISHED. `reviewed`, `reviewed-by-customer` and
 * `reviewed-by-provider` are all the same rental as `delivered` with a review attached; a
 * garment does not become un-returned because somebody wrote about it.
 *
 * @param {string} [processState] - from `resolveLatestProcessName`-aware state derivation
 * @returns {Array<{key: string, status: string}>} always all eight, in order
 */
export const timelineStatusFor = processState => {
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
  const currentIndex = isBefore || isOff ? -1 : LAST_INDEX_FOR_STATE[normalised];

  return RENTAL_TIMELINE_STEPS.map((step, index) => ({
    key: step.key,
    status:
      currentIndex === undefined || currentIndex < 0
        ? STEP_PENDING
        : index < currentIndex
        ? STEP_DONE
        : index === currentIndex
        ? STEP_CURRENT
        : STEP_PENDING,
  }));
};
