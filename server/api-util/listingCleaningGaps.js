const { getIntegrationSdk } = require('./integrationSdk');
const { resolveLiveTurnaroundDays } = require('./liveInitialCleaning');
const { readAssignedLaundryId } = require('./laundryAssignment');
const { INITIAL_CLEANING_DAYS_KEY } = require('./bookingRules');
const {
  assertCleaningGap,
  collectBookingsAwaitingCleaning,
  computeCleaningGaps,
  countCompletedRentals,
  resolveGapDays,
} = require('./cleaningGaps');
const log = require('../log');

// The Integration-API half of the cleaning-gap rule. api-util/cleaningGaps.js stays pure date
// arithmetic with no SDK and no I/O; this module is the thin layer that fetches what that
// arithmetic needs, and is the ONE place both consumers go through:
//
//   - server/api/initiate-privileged.js and transition-privileged.js, to refuse a booking
//     that leaves no room for a wash;
//   - server/api/listing-initial-cleaning.js, to tell the picker which days it must not
//     offer as a start date.
//
// One place on purpose. A gate and a calendar that compute the same rule from two copies is
// precisely how "the calendar offered me a date and then my card was refused" happens, and
// this repository has already paid for that lesson twice (see the agreement tests under
// src/components/OrderPanel/BookingDatesForm).
//
// IT ALSO RESOLVES THE LIVE TURNAROUND, AND HANDS IT BACK. The initial-cleaning gate needs
// the same number from the same studio, and it used to fetch it separately. Two `users.show`
// calls for one number in one request is not just waste - it is two chances for the two gates
// to see different values. So the fetch happens once here and both gates read the result.

/**
 * Everything the two booking gates need about this listing's cleaning, in one pass.
 *
 * NEVER REJECTS. Each of the two reads has its own failure answer, and both mean "carry on
 * without this" rather than "refuse the booking":
 *
 *   - a failed turnaround read leaves `liveTurnaroundDays` null, and the callers fall back to
 *     the `metadata.initialCleaningDays` snapshot - the precedence
 *     bookingRules.resolveInitialCleaningBlockDays already documents;
 *   - a failed bookings read leaves `bookings` and `gaps` NULL, which is deliberately not the
 *     same as `[]`. The gate treats null as "unknown" and lets the booking through; the public
 *     endpoint omits the gaps rather than telling the picker there are none. Refusing every
 *     booking on the marketplace because a query hiccupped would be a worse failure than the
 *     one this rule exists to prevent, and the calendar block is still there as the other
 *     mechanism.
 *
 * @param {Object} params
 * @param {Object} params.listing - a listing API entity, already fetched by the caller
 * @param {Object} [params.integrationSdk] - injectable for tests
 * @param {string} [params.excludeTransactionId] - the transaction being transitioned, which
 *   must not be compared against its own dates
 * @param {Object} [params.log] - injectable for tests
 * @returns {Promise<{liveTurnaroundDays: number|null, turnaroundDays: number,
 *   bookings: Array|null, gaps: Array|null}>}
 */
const resolveBookingConstraints = ({
  listing,
  integrationSdk,
  excludeTransactionId,
  // The public endpoint wants the transactions query even when there is no wash to hold days
  // for, because it also reports how many rentals this garment has completed. The GATES do
  // not: on the checkout path a query that cannot change the answer is a round trip between a
  // customer and their payment for nothing.
  countRentals = false,
  log: logger = log,
}) => {
  const listingId = listing?.id?.uuid;
  const timeZone = listing?.attributes?.availabilityPlan?.timezone;

  // Promise.resolve() FIRST, so a synchronous failure lands in the same place a rejected
  // request would: `getIntegrationSdk()` throws when the Integration API env vars are
  // missing, and an escaping throw here would reach a caller prepared only for a rejection -
  // on the checkout path that is a 500 where the contract says "carry on without this".
  return Promise.resolve()
    .then(() => {
      const sdk = integrationSdk || getIntegrationSdk();
      return resolveLiveTurnaroundDays({ listing, integrationSdk: sdk }).then(days => ({
        sdk,
        liveTurnaroundDays: days,
      }));
    })
    .catch(e => {
      logger.error(e, 'cleaning-gap-turnaround-read-failed', { listingId, message: e?.message });
      return { sdk: null, liveTurnaroundDays: null };
    })
    .then(({ sdk, liveTurnaroundDays }) => {
      // PRECEDENCE, matching every other reader of this number: the studio's CURRENT
      // configuration wins, the assignment-time snapshot on the listing is the fallback.
      const snapshot = listing?.attributes?.metadata?.[INITIAL_CLEANING_DAYS_KEY];
      const turnaroundDays = resolveGapDays(
        liveTurnaroundDays !== null && liveTurnaroundDays !== undefined
          ? liveTurnaroundDays
          : snapshot
      );

      const nothingToHold = {
        liveTurnaroundDays,
        turnaroundDays,
        bookings: [],
        gaps: [],
        completedRentals: null,
      };

      // No turnaround, no gap - and no reason to spend a transactions query finding out which
      // bookings it would have applied to.
      //
      // NO ASSIGNED STUDIO IS ALSO NO GAP, and it is checked separately rather than left to
      // fall out of the turnaround being 0. There is no one to do the washing, so there is
      // nothing to hold days for; and a listing with a stale `initialCleaningDays` snapshot but
      // no studio must not spend an Integration API call proving that.
      // `sdk` is null when even building the client failed. That is a READ FAILURE, not an
      // answer, so it takes the "unknown" shape rather than `[]` - the picker must not read a
      // broken Integration API client as a clear calendar.
      if (!sdk) {
        return {
          liveTurnaroundDays,
          turnaroundDays,
          bookings: null,
          gaps: null,
          completedRentals: null,
        };
      }

      const holdsDays = turnaroundDays > 0 && !!readAssignedLaundryId(listing);
      if (!listingId || (!holdsDays && !countRentals)) {
        return nothingToHold;
      }

      return queryListingTransactions({ integrationSdk: sdk, listingId })
        .then(response => {
          const transactions = response?.data?.data || [];
          const included = response?.data?.included || [];
          const bookings = holdsDays
            ? collectBookingsAwaitingCleaning({ transactions, included, excludeTransactionId })
            : [];

          return {
            liveTurnaroundDays,
            turnaroundDays,
            bookings,
            gaps: holdsDays ? computeCleaningGaps({ bookings, turnaroundDays, timeZone }) : [],
            completedRentals: countRentals ? countCompletedRentals(transactions) : null,
          };
        })
        .catch(e => {
          logger.error(e, 'cleaning-gap-bookings-read-failed', { listingId, message: e?.message });
          return {
            liveTurnaroundDays,
            turnaroundDays,
            bookings: null,
            gaps: null,
            completedRentals: null,
          };
        });
    });
};

/**
 * This listing's transactions, with their bookings.
 *
 * WHY TRANSACTIONS RATHER THAN BOOKINGS. A booking whose garment is already back is governed
 * by `metadata.readyAt`, written from the REAL return date; projecting `bookingEnd +
 * turnaround` on top of that would double-block a rental returned early. Only the transaction
 * knows whether the return has happened, so the transaction is what is queried and
 * `stateFromLastTransition` is what filters. The completed-rental count needs the same page
 * of data, which is why one query serves both.
 *
 * `perPage: 100` is a cap, not a promise. It bounds the cost of a garment with a long history;
 * the consequence for the gap rule is nil in practice (only bookings awaiting a wash matter,
 * and those are few), and the consequence for the count is that a garment past 100
 * transactions under-reports. Stated rather than hidden.
 *
 * @param {Object} params
 * @param {Object} params.integrationSdk
 * @param {string} params.listingId
 * @returns {Promise<Object>} the raw query response
 */
const queryListingTransactions = ({ integrationSdk, listingId }) =>
  integrationSdk.transactions.query({ listingId, include: ['booking'], perPage: 100 });

/**
 * The gaps alone, for the public endpoint that feeds the picker.
 *
 * Also carries the completed-rental count, because the listing page shows it next to the
 * rating and it comes free out of the same query.
 *
 * @param {Object} params - see resolveBookingConstraints
 * @returns {Promise<{turnaroundDays: number, gaps: Array|null, completedRentals: number|null}>}
 */
const resolveCleaningGapsForListing = params =>
  resolveBookingConstraints({ ...params, countRentals: true }).then(
    ({ turnaroundDays, gaps, completedRentals }) => ({
      turnaroundDays,
      gaps,
      completedRentals,
    })
  );

/**
 * Refuse a booking that leaves no room for a wash either side of it.
 *
 * Resolves with the constraints it read - so the caller can reuse the live turnaround for the
 * initial-cleaning gate instead of fetching it a second time - and REJECTS with the 400 from
 * `assertCleaningGap` when the dates are not acceptable.
 *
 * NOT GATED ON THE PROCESS - the callers check that. This module is only reached for
 * `cocloset-booking`.
 *
 * @param {Object} params - see resolveBookingConstraints, plus:
 * @param {Date|string} params.bookingStart
 * @param {Date|string} params.bookingEnd
 * @returns {Promise<Object>} the resolved constraints
 */
const assertCleaningGapForListing = ({ listing, bookingStart, bookingEnd, ...rest }) =>
  resolveBookingConstraints({ listing, ...rest }).then(constraints => {
    // `null` bookings means the read failed and we do not know. Enforcing nothing is the
    // documented direction to be wrong in here; see resolveBookingConstraints.
    if (constraints.bookings) {
      assertCleaningGap({
        bookingStart,
        bookingEnd,
        bookings: constraints.bookings,
        turnaroundDays: constraints.turnaroundDays,
        timeZone: listing?.attributes?.availabilityPlan?.timezone,
      });
    }
    return constraints;
  });

/**
 * The live turnaround as the INITIAL CLEANING gate wants it: null once the garment has
 * reached its studio, because that rule is spent then and must change nothing.
 *
 * Reads the value already fetched rather than asking again. The condition lives here, in one
 * line, for the same reason `resolveLiveInitialCleaningDays` used to carry it - see
 * api-util/liveInitialCleaning.js.
 *
 * @param {Object} listing
 * @param {Object} [constraints] - from resolveBookingConstraints
 * @returns {number|null}
 */
const liveInitialCleaningDaysFrom = (listing, constraints) =>
  listing?.attributes?.metadata?.onLaundry === true
    ? null
    : constraints?.liveTurnaroundDays ?? null;

/**
 * When this garment is next spoken for.
 *
 *   > "quiza podríamos indicar que ya esta reservado el mismo listing para la próxima fecha"
 *
 * The earliest booking that starts AFTER the given moment, out of the ones still awaiting
 * their wash. Used at the return counter to cap how long a studio may hold the garment: it
 * cannot be held past a date somebody has already reserved.
 *
 * NULL MEANS "NOTHING BOOKED NEXT", NOT "COULD NOT TELL" - and the two must not be confused,
 * so a failed read REJECTS rather than resolving null. A caller that treated an outage as "no
 * ceiling" would let a studio hold a garment straight through a rental somebody has paid for.
 *
 * @param {Object} params
 * @param {Object} params.integrationSdk
 * @param {string} params.listingId
 * @param {Date} params.after - typically the return moment
 * @param {string} [params.excludeTransactionId] - the rental being returned right now
 * @returns {Promise<Date|null>}
 */
const resolveNextBookingStart = ({ integrationSdk, listingId, after, excludeTransactionId }) =>
  // Promise.resolve() first, so a SYNCHRONOUS failure - an SDK without a `transactions`
  // property, `getIntegrationSdk()` throwing on missing env vars - reaches the caller's
  // `.catch` rather than escaping as an exception into a caller that only handles rejections.
  // Every other Integration API helper on these paths does the same, for the same reason.
  Promise.resolve()
    .then(() => queryListingTransactions({ integrationSdk, listingId }))
    .then(response => {
      const bookings = collectBookingsAwaitingCleaning({
        transactions: response?.data?.data || [],
        included: response?.data?.included || [],
        excludeTransactionId,
      });

      const starts = bookings
        .map(booking => booking.start)
        .filter(start => start instanceof Date && start.getTime() > after.getTime())
        .sort((a, b) => a.getTime() - b.getTime());

      return starts.length > 0 ? starts[0] : null;
    });

module.exports = {
  resolveBookingConstraints,
  resolveNextBookingStart,
  queryListingTransactions,
  resolveCleaningGapsForListing,
  assertCleaningGapForListing,
  liveInitialCleaningDaysFrom,
};
