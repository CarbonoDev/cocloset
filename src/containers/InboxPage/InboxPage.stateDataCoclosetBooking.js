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
 *   ready-for-pickup  - the CUSTOMER: the garment is at the studio to collect.
 *   picked-up         - nobody. The rental is simply running.
 *   overdue           - the CUSTOMER: it is late, bring it back.
 *   returned          - nobody. Waiting on the laundry to open a cleaning ticket.
 *   cleaning          - nobody. The rental is over; this is studio work.
 *
 * `isFinal` marks the states nothing can leave. `delivered` is deliberately
 * NOT final: the review window opens there.
 */
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
        return { processName, processState };
      })

      // ---- The laundry custody chain -------------------------------------
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
        return { processName, processState, isFinal: true };
      })
      .cond([states.DECLINED, _], () => {
        return { processName, processState, isFinal: true };
      })
      .cond([states.EXPIRED, _], () => {
        return { processName, processState, isFinal: true };
      })
      .cond([states.DELIVERED, _], () => {
        return { processName, processState, actionNeeded: true };
      })
      .cond([states.REVIEWED_BY_PROVIDER, CUSTOMER], () => {
        return { processName, processState, actionNeeded: true };
      })
      .cond([states.REVIEWED_BY_CUSTOMER, PROVIDER], () => {
        return { processName, processState, actionNeeded: true };
      })
      .cond([states.REVIEWED, _], () => {
        return { processName, processState, isFinal: true };
      })
      .default(() => {
        // Default values for other states
        return { processName, processState };
      })
      .resolve()
  );
};
