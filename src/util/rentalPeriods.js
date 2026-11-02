import { COCLOSET_BOOKING_PROCESS_NAME, DAY } from '../transactions/transaction';

/**
 * FIXED RENTAL PERIODS
 * ====================
 *
 *   > "Necesitamos hacer otro ajuste, para que las reservas sean por semanas, 7 días y
 *   >  14 días, el provider necesita establecer el precio para cada periodo en
 *   >  editlistingpage, un precio para 7 y otro para 14 (...) el precio que el cliente
 *   >  va a pagar es el precio que marque el provider, es decir, si puso el precio para
 *   >  7 días en $100, el cliente va a pagar $100, no $700"
 *
 * A garment is no longer rented for an arbitrary number of days. It is rented for one of
 * two fixed periods, each with its own flat price, and the customer chooses only WHICH
 * period and WHEN it starts.
 *
 * WHY THIS RIDES ON `priceVariants` RATHER THAN A NEW publicData KEY
 * `priceVariants` + `priceVariantName` is already plumbed end to end by the template: the
 * order form puts the name in `orderData`, ListingPage.shared.js forwards it to the
 * checkout page, CheckoutPage puts it in the transaction's `protectedData`, and
 * server/api-util/lineItems.js already prices the base line item from the named variant
 * instead of `listing.price`. A parallel Cocloset-only key would have meant threading the
 * same value through all of those a second time, and the two would drift.
 *
 * What this module adds on top of the stock shape is `bookingLengthInDays`: the stock
 * FIXED unit type expresses a fixed booking length in MINUTES, capped at 12 hours, and is
 * tied to the hour-based availability model. Cocloset's garments are day-based
 * (`unitType: 'day'`), so the length is stored in days and the booking end is derived from
 * it. `bookingLengthInMinutes` is deliberately NOT reused: the two are different units on
 * the same object, and a reader that grabbed the wrong one would be off by a factor of
 * 1440 rather than visibly wrong.
 *
 * WHY THE PERIOD IS STORED ON THE LISTING AND NOT JUST DERIVED FROM THE NAME
 * The name is a display/identity string that survives into old transactions. The number of
 * days is a rule the server enforces (`server/api-util/rentalPeriods.js`), and it is read
 * from the listing at the moment of booking, so a period the owner has since removed
 * cannot be booked by replaying an old name.
 *
 * The server half of this module is `server/api-util/rentalPeriods.js`. The two are kept
 * in agreement by `src/util/rentalPeriodsAgreement.test.js`, for the same reason
 * `initialCleaningAgreement.test.js` exists: a calendar that offers a date and a checkout
 * that refuses it is the worst failure this feature can have.
 */

/**
 * The periods a garment owner may price, in days.
 *
 * Two entries, per the client: one week and two weeks. This is the OFFERED set — the set
 * the wizard renders rows for. What a given listing actually offers is whatever is stored
 * on it, which is why every reader below goes through `getRentalPeriods` rather than
 * assuming this array.
 */
export const RENTAL_PERIOD_DAYS = [7, 14];

/**
 * The window the SEARCH date filter asks Sharetribe to find free, in days.
 *
 *   > "el filtro de dates (...) muestra un listing que no es propio de las fechas
 *   >  seleccionadas" (Jonathan, 2026-09-10)
 *
 * Picking a date in search means "I want to start on this day", and nothing here is rented by
 * the day - so the filter has to ask for a whole rental period, not for the days somebody
 * happened to touch.
 *
 * THE SHORTEST PERIOD, DELIBERATELY. A listing offers whichever periods its owner priced, and
 * one query cannot use a different length per listing. The shortest is the permissive choice:
 * it can leave in a garment that only rents for two weeks and has ten free days, but it can
 * never hide one that is genuinely bookable. Between showing a garment the picker will narrow
 * and hiding one it would have offered, the first is recoverable and the second is invisible.
 *
 * It does NOT include the studio's turnaround, which the picker adds on top of the period
 * (BookingRentalPeriodForm `windowDays`). That number is per-studio, so it cannot be in a
 * single query either - and leaving it out errs in the same permissive direction.
 */
export const RENTAL_WINDOW_DAYS = Math.min(...RENTAL_PERIOD_DAYS);

/**
 * Upper bound on a stored period, in days.
 *
 * `publicData` is owner-writable, so `bookingLengthInDays` is a number its own owner can
 * set to anything — including 4000, which would make every date in the calendar fail the
 * "is the whole window free" check and take the listing off the market with nothing saying
 * so. Same reasoning, and same order of magnitude, as MAX_INITIAL_CLEANING_DAYS.
 */
export const MAX_RENTAL_PERIOD_DAYS = 365;

/**
 * The stable identifier stored as a price variant's `name`.
 *
 * Deliberately a slug and not a human phrase. `name` is what ends up in the transaction's
 * `protectedData` and is matched against on the server months later, so it must not change
 * when a translation changes, and it must be URL-safe (the template builds a slug from it
 * for the `?priceVariant=` deep link). The human label is produced at render time by
 * `rentalPeriodLabel`.
 *
 * @param {number} days
 * @returns {string} e.g. '7-days'
 */
export const rentalPeriodVariantName = days => `${days}-days`;

/**
 * The human label for a period, translated.
 *
 * @param {Object} intl - react-intl's intl object
 * @param {number} days
 * @returns {string} e.g. '7 días'
 */
export const rentalPeriodLabel = (intl, days) =>
  intl.formatMessage({ id: 'RentalPeriods.periodLabel' }, { days });

/**
 * Whether a listing type rents by fixed periods rather than by an arbitrary date range.
 *
 * Keyed on the transaction PROCESS, not on a publicData flag. The process is what the
 * whole feature hangs off — `cocloset-booking` is the laundry-mediated garment rental, and
 * every listing on it is rented by the week. A publicData flag would have been owner-
 * writable and would have needed a migration for the listings that already exist; the
 * process alias is baked onto a listing at creation and is the same thing the checkout page
 * already keys on.
 *
 * The unit type is checked as well because every day count in this feature — the period,
 * the cleaning window, the availability check — is a number of DAYS. On an hour-based
 * listing type the same numbers would silently mean something else.
 *
 * @param {Object} [listingTypeConfig] - a restructured listing type (see configHelpers)
 * @returns {boolean}
 */
export const usesFixedRentalPeriods = listingTypeConfig => {
  const { process, unitType } = listingTypeConfig?.transactionType || {};
  return process === COCLOSET_BOOKING_PROCESS_NAME && unitType === DAY;
};

const parseWholeNumber = value => {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : null;
};

/**
 * Is this price variant a usable fixed rental period?
 *
 * A variant needs a name, a whole positive number of days within bounds, and a price. Any
 * variant that fails is DROPPED rather than repaired: a half-written variant that still
 * rendered as a chip would let a customer start a booking the server then refuses.
 *
 * @param {Object} [variant]
 * @returns {boolean}
 */
const isUsableRentalPeriod = variant => {
  const days = parseWholeNumber(variant?.bookingLengthInDays);
  const price = parseWholeNumber(variant?.priceInSubunits);
  return (
    typeof variant?.name === 'string' &&
    variant.name.length > 0 &&
    days !== null &&
    days > 0 &&
    days <= MAX_RENTAL_PERIOD_DAYS &&
    price !== null &&
    price >= 0
  );
};

/**
 * The fixed rental periods a listing actually offers, shortest first.
 *
 * Returns `[]` — never null — so callers can map over it unconditionally. An empty result
 * means the owner has not priced any period yet, which is a listing that cannot be booked;
 * the order panel renders that as "not bookable" rather than as an empty calendar.
 *
 * @param {Object} [publicData] - listing.attributes.publicData
 * @returns {Array<{name: string, bookingLengthInDays: number, priceInSubunits: number}>}
 */
export const getRentalPeriods = publicData => {
  const variants = publicData?.priceVariants;
  if (!Array.isArray(variants)) {
    return [];
  }
  return variants
    .filter(isUsableRentalPeriod)
    .map(variant => ({
      ...variant,
      bookingLengthInDays: parseWholeNumber(variant.bookingLengthInDays),
      priceInSubunits: parseWholeNumber(variant.priceInSubunits),
    }))
    .sort((a, b) => a.bookingLengthInDays - b.bookingLengthInDays);
};

/**
 * How many days does the named period last on THIS listing?
 *
 * Resolved from the listing rather than from the name, so a name that no longer
 * corresponds to an offered period yields null instead of a length parsed out of a string.
 *
 * @param {Object} [publicData] - listing.attributes.publicData
 * @param {string} [priceVariantName]
 * @returns {number|null}
 */
export const resolveRentalPeriodDays = (publicData, priceVariantName) => {
  if (!priceVariantName) {
    return null;
  }
  const period = getRentalPeriods(publicData).find(p => p.name === priceVariantName);
  return period ? period.bookingLengthInDays : null;
};

/**
 * The cleaning window that follows a rental, in days.
 *
 *   > "el booking se queda como 7 días mas los días que necesite laundry (...) debe empatar
 *   >  con lo demas trabajado de onLaundry y el siguiente periodo de lavado"
 *
 * After the customer returns the garment, the laundry needs its turnaround before the
 * garment can go out again. That window is already blocked once a booking is accepted
 * (server/api/create-availability-buffer.js). What this feature adds is that the window has
 * to be free BEFORE the booking is offered — otherwise a start date whose rental fits
 * neatly between two existing bookings would leave no room to wash the garment afterwards,
 * and the buffer write would silently create nothing (it subtracts already-blocked ranges).
 *
 * PRECEDENCE MATCHES resolveInitialCleaningDays: the laundry's live turnaround wins, the
 * assignment-time snapshot (`metadata.initialCleaningDays`) is the fallback, and 0 is the
 * answer when neither is available. 0 — rather than some invented default — because this
 * number only ever makes the availability requirement STRICTER: guessing high would refuse
 * dates the marketplace can actually honour, which is a lost sale caused by a failed read.
 *
 * @param {number} [liveTurnaroundDays] - the assigned laundry's CURRENT turnaround
 * @param {number} [snapshotDays] - listing.attributes.metadata.initialCleaningDays
 * @returns {number} a whole number >= 0
 */
export const resolveCleaningWindowDays = (liveTurnaroundDays, snapshotDays) => {
  const live = parseWholeNumber(liveTurnaroundDays);
  if (live !== null && live > 0) {
    return Math.min(live, MAX_RENTAL_PERIOD_DAYS);
  }
  const snapshot = parseWholeNumber(snapshotDays);
  if (snapshot !== null && snapshot > 0) {
    return Math.min(snapshot, MAX_RENTAL_PERIOD_DAYS);
  }
  return 0;
};
