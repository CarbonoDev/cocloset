/**
 * A RENTAL'S LENGTH IN WHOLE WEEKS, FOR THE PRICE BREAKDOWN.
 *
 *   > "el breakdown de dicho correo tiene que tener x 1 week o x 2 weeks dependiendo el caso"
 *   >  (Jonathan, 2026-09-03)
 *
 * WHY THIS IS COMPUTED HERE AND CARRIED, RATHER THAN WORKED OUT WHERE IT IS PRINTED.
 * The breakdown is printed by the transaction email templates, and Sharetribe's template
 * language has no arithmetic - its helpers are `eq`, `contains`, `if`, `date-transform`,
 * `url-encode`, `asset`, `t` and the `format-money` partial. There is no way to divide the
 * line item's day count by seven in the place that needs the answer.
 *
 * So it travels with the transaction, in `protectedData`, next to `unitType` - which those
 * same templates already read for exactly this kind of branch. `transition-privileged` only
 * filters `customerDefaultMessage` and `customer_*` keys out of protectedData, so this one
 * rides through untouched.
 *
 * NULL WHEN IT IS NOT A WHOLE NUMBER OF WEEKS, deliberately. The breakdown falls back to
 * days in that case, which is still true - where "3 weeks" for a 20-day rental would not be.
 * Absent rather than zero, so the template's `{{#if}}` reads as "we know the week count"
 * rather than as "the count is falsy".
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;

/**
 * The same question asked of a day count that has already been worked out.
 *
 * The order breakdown (checkout, transaction page) resolves the rental's length in days
 * itself, from the booking; it does not need the dates again. Sharing this rather than
 * writing `days % 7` there keeps "what counts as a whole number of weeks" in one place -
 * the mail and the screen disagreeing about that is exactly the kind of thing a reader
 * notices and we would not.
 *
 * @param {number} [days]
 * @returns {number|null} whole weeks, or null
 */
export const weeksFromDays = days =>
  Number.isInteger(days) && days > 0 && days % DAYS_PER_WEEK === 0 ? days / DAYS_PER_WEEK : null;

/**
 * @param {Date|string|number} [start] - booking start
 * @param {Date|string|number} [end] - booking end, exclusive (as Sharetribe stores it)
 * @returns {number|null} whole weeks, or null
 */
export const bookingWeeksBetween = (start, end) => {
  if (!start || !end) {
    return null;
  }
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return null;
  }

  // Rounded rather than floored: a booking that crosses a DST boundary is 24h short or long
  // in wall-clock milliseconds, and a seven-day rental must not become six.
  const days = Math.round((endMs - startMs) / MS_PER_DAY);

  return days > 0 && days % DAYS_PER_WEEK === 0 ? days / DAYS_PER_WEEK : null;
};
