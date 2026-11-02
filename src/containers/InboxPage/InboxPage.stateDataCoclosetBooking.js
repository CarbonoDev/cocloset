import {
  TX_TRANSITION_ACTOR_CUSTOMER as CUSTOMER,
  TX_TRANSITION_ACTOR_PROVIDER as PROVIDER,
  CONDITIONAL_RESOLVER_WILDCARD,
  ConditionalResolver,
} from '../../transactions/transaction';

/**
 * State data for the `cocloset-booking` process on the InboxPage.
 *
 * Same hard requirement as its TransactionPage sibling: `getStateData`
 * returns `{}` for an unrecognised process and `stateDataShape` requires
 * `processName`/`processState`, so this file is what stops every Cocloset
 * booking rendering as a blank inbox row.
 *
 * ON `actionNeeded`
 * It drives the "this one is on you" highlight, so it should mean exactly
 * that. The laundry states are the interesting case, because the party who
 * has to act is usually the LAUNDRY - which is not a party to the transaction
 * and does not have an inbox. So the flag is set only where the customer or
 * the provider genuinely has something to do:
 *
 *   accepted          - nobody. Waiting on the laundry to prepare the garment.
 *   initial-cleaning  - nobody. The garment came in for its first wash (2026-09-21).
 *   ready-for-pickup  - the CUSTOMER: the garment is at the studio to collect.
 *   picked-up         - nobody. The rental is simply running.
 *   overdue           - the CUSTOMER: it is late, bring it back.
 *   returned          - nobody. Waiting on the laundry to open a cleaning ticket.
 *   cleaning          - nobody. The rental is over; this is studio work.
 *   delivered         - the CUSTOMER only (2026-09-21): the provider can no longer review the
 *                       customer at all, so this is not "on them" any more.
 *
 * `isFinal` marks the states nothing can leave. `delivered` is deliberately
 * NOT final: the review window opens there.
 *
 * ON `tone`
 *   > "cuando tenemos declined aparece en texto y background verde, puedes
 *   >  ajustar para que si es aceptado permanezca verde, pero si es declined,
 *   >  aparezca en tonalidades de rojo?" (Jonathan, 2026-09-02)
 *
 * The pill was green for every `isFinal` state, so a refused request and a
 * completed rental looked the same - and the one colour a reader takes as
 * meaning "fine" was on the outcome that is not. `tone` says which kind of
 * ending it was, and nothing else: it is presentation, and it does not decide
 * whether a state is final or needs action.
 *
 *   negative - declined, cancelled, expired: the rental did not happen
 *   positive - accepted, and the states after it that ended well
 *
 * Everything else has no tone and keeps the neutral pill. A state in flight is
 * not a verdict, and colouring the whole chain would leave nothing for the two
 * endings that matter to stand out against.
 */
const NEGATIVE = 'negative';
const POSITIVE = 'positive';
export const getStateDataForCoclosetBookingProcess = (txInfo, processInfo) => {
  const { transactionRole } = txInfo;
  const { processName, processState, states } = processInfo;
  const _ = CONDITIONAL_RESOLVER_WILDCARD;

  return (
    new ConditionalResolver([processState, transactionRole])
      .cond([states.INQUIRY, _], () => {
        return { processName, processState, actionNeeded: true };
      })
      .cond([states.PENDING_PAYMENT, CUSTOMER], () => {
        return { processName, processState, actionNeeded: true };
      })
      .cond([states.PREAUTHORIZED, PROVIDER], () => {
        return { processName, processState, actionNeeded: true, isSaleNotification: true };
      })
      .cond([states.ACCEPTED, _], () => {
        return { processName, processState, tone: POSITIVE };
      })
      // NEW (2026-10-15), alongside states.ACCEPTED_ON_LAUNDRY itself. Same treatment as
      // ACCEPTED: nobody but the laundry acts here (the auto-accepted garment is already on
      // the rack, just waiting on the laundry's own ready-for-pickup prep), so no
      // actionNeeded, and the same positive tone an acceptance already earns regardless of
      // which of the two paths produced it.
      .cond([states.ACCEPTED_ON_LAUNDRY, _], () => {
        return { processName, processState, tone: POSITIVE };
      })

      // ---- The laundry custody chain -------------------------------------
      // First-time drop-off's own "in cleaning" moment (2026-09-21) - nobody but the laundry
      // acts here, same as READY_FOR_PICKUP/PICKED_UP/RETURNED/CLEANING below.
      .cond([states.INITIAL_CLEANING, _], () => {
        return { processName, processState };
      })
      .cond([states.READY_FOR_PICKUP, CUSTOMER], () => {
        return { processName, processState, actionNeeded: true };
      })
      .cond([states.READY_FOR_PICKUP, PROVIDER], () => {
        return { processName, processState };
      })
      .cond([states.PICKED_UP, _], () => {
        return { processName, processState };
      })
      .cond([states.OVERDUE, CUSTOMER], () => {
        return { processName, processState, actionNeeded: true };
      })
      .cond([states.OVERDUE, PROVIDER], () => {
        return { processName, processState };
      })
      .cond([states.RETURNED, _], () => {
        return { processName, processState };
      })
      .cond([states.CLEANING, _], () => {
        return { processName, processState };
      })

      // ---- Terminal and review states ------------------------------------
      .cond([states.CANCELED, _], () => {
        return { processName, processState, isFinal: true, tone: NEGATIVE };
      })
      .cond([states.DECLINED, _], () => {
        return { processName, processState, isFinal: true, tone: NEGATIVE };
      })
      .cond([states.EXPIRED, _], () => {
        return { processName, processState, isFinal: true, tone: NEGATIVE };
      })
      // CUSTOMER ONLY (2026-09-21): the provider can no longer review the customer at all, so
      // DELIVERED is not "on them" any more - see the EDN's :transition/review-1-by-customer
      // comment. REVIEWED_BY_PROVIDER / REVIEWED_BY_CUSTOMER are gone with it.
      .cond([states.DELIVERED, CUSTOMER], () => {
        return { processName, processState, actionNeeded: true };
      })
      .cond([states.DELIVERED, PROVIDER], () => {
        return { processName, processState };
      })
      .cond([states.REVIEWED, _], () => {
        // A rental that ran its whole course. Green, as it already was - what
        // changed is that the refusals no longer share the colour with it.
        return { processName, processState, isFinal: true, tone: POSITIVE };
      })
      .default(() => {
        // Default values for other states
        return { processName, processState };
      })
      .resolve()
  );
};
