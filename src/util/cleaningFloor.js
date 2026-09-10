import { getStartOf } from './dates';

/**
 * THE CLEANING FLOORS: the first day a garment can be collected.
 *
 * EXTRACTED FROM BookingDatesForm, AND THE REASON IS NOT TIDINESS. The search page needs the
 * same rule (see searchCleaningFloor.js), and importing it from the picker pulled the picker's
 * component module in with it - which reaches `components/index.js`, which reaches most of the
 * app. The cycle that created surfaced as `Cannot access 'loadData' before initialization` in
 * a page duck nobody had touched: a module was being evaluated before the module it depends on
 * had finished, and the error names whichever file lost that race rather than the one that
 * caused it.
 *
 *   > "Uncaught ReferenceError: Cannot access 'loadData' before initialization (...) No compila,
 *   >  traté de revisarlo pero no encontré un error en esa linea" (Jonathan, 2026-09-10)
 *
 * Nobody could find it on that line because it was not there. These helpers are pure - dates
 * and numbers in, a date out - so they belong somewhere with no component imports at all, and
 * anything that needs them can have them without dragging the UI along.
 *
 * The picker still re-exports them, so its callers and its tests are unchanged.
 */

// The picker used a module-level `new Date()` as its default "today". Kept identical: these
// helpers are called on every render, and the alternative - reading the clock per call - would
// make a date range recompute mid-session as midnight passes.
const TODAY = new Date();

/**
 * The upper bound on an initial-cleaning block, in days.
 *
 * Mirrors MAX_INITIAL_CLEANING_DAYS in server/api-util/bookingRules.js, and it is the
 * same number for the same reason: the value is DERIVED from a figure a laundry types
 * into its own profile, so a studio that fat-fingers 4000 would otherwise take every
 * garment assigned to it off the market for a decade with nothing saying so.
 *
 * Duplicated rather than imported because src/ and server/ cannot import each other
 * (ESM/transpiled versus plain CommonJS). initialCleaningAgreement.test.js asserts the
 * two constants are equal, so the duplication is checked rather than trusted.
 */
export const MAX_INITIAL_CLEANING_DAYS = 365;

/**
 * How many days must pass before this garment can be rented at all?
 *
 *   > "Al hacer booking, el calendario muestra el siguiente día como disponible,
 *   >  pero no esta considerando los tiempos de lavado inicial, esto debe aplicar
 *   >  solo para la primera vez en esa prenda, si la prenda aun no esta en el
 *   >  laundry, si la prenda ya esta en laundry entonces si debe aparecer
 *   >  disponible al siguiente día"
 *
 * `onLaundry === true` means the garment has physically reached its laundry, and from
 * then on tomorrow is correct: this must return null and the calendar must behave EXACTLY
 * as it did before this feature existed. That single condition is also what makes the rule
 * first-time-only - once a studio has taken delivery, `onLaundry` never goes back to false
 * without the garment having been cleaned. It is checked FIRST, before the live value is
 * looked at, so a live turnaround cannot resurrect a spent rule.
 *
 * PRECEDENCE: LIVE FIRST, SNAPSHOT SECOND.
 *
 *   > "desde el momento de la carga de listingPage, se debe consultar las propiedades de
 *   >  la laundry seleccionada para este listing para obtener los días que se necesiten
 *   >  para el lavado siempre que onLaundry sea false"
 *
 * `metadata.initialCleaningDays` records what the laundry's turnaround was on the day it
 * was assigned; `liveInitialCleaningDays` is what it is now, resolved at page load through
 * /api/listing-initial-cleaning (the number lives in the laundry USER's `privateData`, so
 * the browser cannot read it itself). A null live value means "no answer yet, or the
 * lookup failed" and falls back to the snapshot - NEVER to "no block", or a flaky network
 * would quietly offer a garment that is still in its owner's wardrobe.
 *
 * An ABSENT value at both levels means no block, deliberately: every listing assigned
 * before the field existed has none, and there is no migration (per the client, "en
 * producción iniciaremos limpio"). Anything malformed - fractional, a string, 0, negative -
 * is treated the same way, because a bad value must not be able to take a listing off the
 * market.
 *
 * The server applies the identical rule, on the identical inputs; see
 * server/api-util/bookingRules.js `resolveInitialCleaningBlockDays`. They MUST agree - a
 * calendar floor and a checkout gate that disagree by a day present as "the calendar
 * offered me a date and then payment refused it". initialCleaningAgreement.test.js exists
 * to hold them together.
 *
 * @param {number} [initialCleaningDays] - listing.attributes.metadata.initialCleaningDays
 * @param {boolean} [onLaundry] - listing.attributes.metadata.onLaundry
 * @param {number} [liveInitialCleaningDays] - the assigned laundry's current turnaround,
 *   from state.ListingPage.initialCleaningDays
 * @returns {number|null}
 */
export const resolveInitialCleaningDays = (
  initialCleaningDays,
  onLaundry,
  liveInitialCleaningDays
) => {
  if (onLaundry === true) {
    return null;
  }

  const isUsable = value => Number.isInteger(value) && value > 0;
  const resolved = isUsable(liveInitialCleaningDays)
    ? liveInitialCleaningDays
    : isUsable(initialCleaningDays)
    ? initialCleaningDays
    : null;

  return resolved === null ? null : Math.min(resolved, MAX_INITIAL_CLEANING_DAYS);
};

/**
 * The first day the picker may offer.
 *
 * Start of day in the LISTING's time zone, offset by whole days - not `now` plus
 * n * 24h. A day count compared against an instant would make the calendar's floor
 * depend on the hour the customer is shopping, and would let it disagree with the
 * server's gate by up to a full day.
 *
 * THE CLEANING STARTS TOMORROW, NOT TODAY - hence the +1.
 *
 *   > "hoy es 12 de agosto, si un listing tiene un periodo de 1 día de laundry segun la
 *   >  limpieza, el próximo día disponible debe ser el 14 de agosto, ya que es un día de
 *   >  lavado (13 de agosto) y el siguiente día disponible es 14"
 *
 * Today is already partly over: the garment cannot reach the studio, be washed and be
 * handed over inside the hours that are left. So the first cleaning day is tomorrow, n
 * cleaning days run from there, and the first bookable day is the one after those.
 *
 * The previous version counted from today (`today + n`), which made a ONE-day turnaround
 * invisible: today is already unbookable anyway, because Sharetribe's availability slot for
 * the current day starts at the moment of the query rather than at midnight, so `today + 1`
 * was the floor with or without the rule. The client noticed exactly that.
 *
 * With no block this is still the stock floor, `getStartOf(today, 'day', timeZone)` - the
 * +1 applies only when there is a turnaround to wait for, so `onLaundry === true` and a
 * listing with no stored turnaround take the exact path they took before this feature.
 *
 * @param {number|null} initialCleaningDays - from resolveInitialCleaningDays
 * @param {string} timeZone - IANA key
 * @param {Date} [today]
 * @returns {Date}
 */
export const earliestBookableDate = (initialCleaningDays, timeZone, today = TODAY) =>
  getStartOf(today, 'day', timeZone, initialCleaningDays ? initialCleaningDays + 1 : 0, 'days');

/**
 * The moment this garment finishes the cleaning it is in RIGHT NOW, if any.
 *
 *   > "al momento en que un laundry recibe la prenda, puede ingresar cuantos dias necesita
 *   >  para la lavada, esto debe apartar dias para que la prenda vuelva a estar disponible"
 *
 * `metadata.readyAt` is written by the studio at the counter when it confirms a return, from
 * the days it asked for (server/api-util/listingCustody.js). Distinct from the initial
 * cleaning above in every way that matters: that one is a lead time for a garment that has
 * never been to a laundry and retires itself for good the first time one takes delivery;
 * this one is an absolute date, and there is a new one after every rental.
 *
 * Unparseable is treated as absent, matching `resolveInitialCleaningDays` and the server's
 * `resolveReadyAt`: a bad write must not be able to take a listing off the market.
 *
 * @param {string|Date} [readyAt] - listing.attributes.metadata.readyAt
 * @returns {Date|null}
 */
export const resolveReadyAt = readyAt => {
  if (!readyAt) {
    return null;
  }
  const date = readyAt instanceof Date ? readyAt : new Date(readyAt);
  return isNaN(date.getTime()) ? null : date;
};

/**
 * The first day the picker may offer, once BOTH cleaning rules have had their say.
 *
 * The later of the two floors, because they are independent facts and either one alone is a
 * reason the garment cannot be handed over: a listing can be waiting on its first cleaning
 * AND have a `readyAt` from a return, and satisfying one says nothing about the other.
 *
 * A `readyAt` in the past floors to a day that is already behind today's, so it changes
 * nothing - which is what makes this safe to apply to every listing unconditionally. The
 * field is only in the future between a return and the end of the days the studio asked for.
 *
 * MUST MATCH `assertCleaningReadiness` / `earliestStartAfterCleaning` in
 * server/api-util/bookingRules.js. cleaningReadinessAgreement.test.js holds them together:
 * a calendar that offers a date the checkout then refuses is the specific failure both
 * agreement tests in this directory exist to prevent.
 *
 * @param {number|null} initialCleaningDays - from resolveInitialCleaningDays
 * @param {string|Date} [readyAt] - listing.attributes.metadata.readyAt
 * @param {string} timeZone - IANA key
 * @param {Date} [today]
 * @returns {Date}
 */
export const earliestBookableStart = (initialCleaningDays, readyAt, timeZone, today = TODAY) => {
  const cleaningFloor = earliestBookableDate(initialCleaningDays, timeZone, today);
  const resolved = resolveReadyAt(readyAt);
  if (!resolved) {
    return cleaningFloor;
  }
  const readyFloor = getStartOf(resolved, 'day', timeZone);
  return readyFloor.getTime() > cleaningFloor.getTime() ? readyFloor : cleaningFloor;
};
