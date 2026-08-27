/**
 * LISTING FIELDS THAT HOLD AN AMOUNT OF MONEY.
 *
 *   > "En listing page puedes identificar el campo de retail value y si es numérico agregar $
 *   >  antes del precio"
 *
 * Console can say a field is a `long`. It cannot say the long is money, so `retailValue` came
 * out of the details grid as a bare "120" sitting under a label - a number the reader has to
 * guess the units of, on a page whose other numbers are days and sizes.
 *
 * ── WHY A KEY LIST AND NOT A CLEVERER RULE ─────────────────────────────────
 * There is nothing in the field's own configuration to key on: schema type, label and options
 * are all a money field shares with any other whole number. Anything smarter - guessing from
 * the label text, from the magnitude of the value - would be a rule that quietly changes
 * behaviour the day an operator renames a field or a garment costs 8. So the keys are listed,
 * in one place, and a key not on the list is left exactly as it is.
 *
 * MUST MATCH THE KEYS IN CONSOLE. `retailValue` is the one that exists today, verified against
 * the Dev marketplace's own listings. This mirrors util/listingFieldSearch.js, which keeps the
 * same kind of listing-page-only, key-driven decision out of the shared field helpers - it is
 * ProfilePage that renders custom fields through the same components and has no prices.
 */
const MONEY_FIELD_KEYS = ['retailValue'];

/**
 * @param {string} key - a listing field key
 * @returns {boolean}
 */
export const isMoneyListingField = key => MONEY_FIELD_KEYS.includes(key);

/**
 * Format a listing field value as an amount, if it is one.
 *
 * NUMERIC ONLY, as the client asked. A field that holds text - because it predates the field
 * being a `long`, or because somebody typed "120 USD" into it - is returned untouched rather
 * than parsed: turning "120 USD" into "$120 USD" would be worse than leaving it alone, and a
 * value this function cannot read is one it has no business rewriting.
 *
 * THE MARKETPLACE'S CURRENCY, NOT A HARDCODED "$". Both currencies this marketplace might run
 * in print `$`, so the literal would look right and be wrong the first time that changes -
 * and `intl` already knows how to place the symbol, which is not before the number in every
 * locale.
 *
 * Whole amounts keep no decimals: a retail value is a round number a person typed, and "$120"
 * is what they meant. A value that does carry cents keeps them.
 *
 * @param {*} value - the stored field value
 * @param {Object} params
 * @param {Object} params.intl - react-intl
 * @param {string} [params.currency] - the marketplace currency, e.g. 'USD'
 * @returns {*} the formatted amount, or the value unchanged
 */
export const formatMoneyListingFieldValue = (value, { intl, currency }) => {
  const isNumeric = typeof value === 'number' && Number.isFinite(value);
  if (!isNumeric || !currency || !intl) {
    return value;
  }

  return intl.formatNumber(value, {
    style: 'currency',
    currency,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });
};
