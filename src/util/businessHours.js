/**
 * A STUDIO'S OPENING HOURS, ONE ROW PER DAY.
 *
 *   > "el campo business hours te habia solicitado ya que se modificara para mostrar un
 *   >  listado con checkboxes por cada día, cada día debe tener un input para hora de abrir
 *   >  y un input para hora de cerrar, por default todos los días deben estar checkeados"
 *   >  (Jonathan, 2026-09-03)
 *
 * It used to be one free-text box, which is why nothing could ever answer "are they open
 * now" - `"Tue-Sun 10:00-20:00"` is a sentence, not data.
 *
 * ── TWO FIELDS, NOT ONE RENAMED ────────────────────────────────────────────
 * `laundryProfile.businessHoursByDay` is the new structured value. `businessHours` STAYS,
 * written from it as a summary line, because it is what every existing reader prints: the
 * laundry card in the listing wizard, the studio's own profile page, the public directory.
 * Changing that key's type would have broken all three at once, silently, in a string
 * context where `[object Object]` is a perfectly valid thing to render.
 *
 * So the structured value is the source of truth and the string is derived from it on every
 * save. A studio that has not re-saved since this shipped still has only the old string, and
 * still renders correctly - `toFormValues` seeds the grid with the defaults in that case
 * rather than pretending to parse a sentence somebody typed.
 *
 * ── WHY A DAY IS ABSENT RATHER THAN `closed: true` ─────────────────────────
 * A closed day carries no hours, so storing one would mean keeping two fields in agreement
 * forever. The set of keys IS the set of open days; `isOpenOn` is a lookup rather than a
 * flag check, and a malformed record degrades to "closed" instead of to "open at undefined".
 */

// Monday first: the studios are European and their week starts there. The ORDER is
// load-bearing - it is the order the form renders and the summary reads.
export const BUSINESS_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// "por default todos los días deben estar checkeados". A studio that opens the form for the
// first time should be able to save it unchanged and have said something true-ish, so the
// hours are an ordinary high-street day rather than 00:00-00:00.
export const DEFAULT_OPEN_TIME = '09:00';
export const DEFAULT_CLOSE_TIME = '18:00';

// Field names are FLAT. React Final Form reads a dot in a field name as a path, and these
// are built from day keys - `hours.mon.open` would nest, which is fine, but the rest of this
// form already flattens for the same reason and mixing the two conventions in one form is
// how a value ends up saved under a key nobody reads.
export const dayEnabledField = day => `hours_${day}_enabled`;
export const dayOpenField = day => `hours_${day}_open`;
export const dayCloseField = day => `hours_${day}_close`;

// `HH:MM`, 24h. Anything else is not a time this can order or compare, so it is treated as
// absent rather than passed along to be rendered.
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const isTime = value => typeof value === 'string' && TIME_RE.test(value);

/**
 * Is this studio open on this day, according to a stored record?
 *
 * @param {Object} [byDay] - `laundryProfile.businessHoursByDay`
 * @param {string} day - one of BUSINESS_DAYS
 * @returns {boolean}
 */
export const isOpenOn = (byDay, day) => {
  const entry = byDay?.[day];
  return isTime(entry?.open) && isTime(entry?.close);
};

/**
 * The form's flat values -> the record to store.
 *
 * Days whose checkbox is off are omitted entirely. A day that is ticked but has an unusable
 * time is also omitted: writing `{ open: undefined }` would produce a record that
 * `isOpenOn` calls closed anyway, and one that says so honestly is better than one that
 * looks open until something reads it.
 *
 * @param {Object} [values] - form values
 * @returns {Object} `{ mon: { open, close }, ... }`, open days only
 */
export const toBusinessHoursByDay = (values = {}) =>
  BUSINESS_DAYS.reduce((acc, day) => {
    if (!values[dayEnabledField(day)]) {
      return acc;
    }
    const open = values[dayOpenField(day)];
    const close = values[dayCloseField(day)];
    return isTime(open) && isTime(close) ? { ...acc, [day]: { open, close } } : acc;
  }, {});

/**
 * The record -> the form's flat values.
 *
 * With nothing stored - a new studio, or one that last saved when this was a text box - every
 * day comes back ticked at the default hours, which is what the client asked for and also the
 * only honest thing to show: the old free-text string is a sentence, and guessing at it would
 * put words in a studio's mouth about when it is open.
 *
 * @param {Object} [byDay] - `laundryProfile.businessHoursByDay`
 * @returns {Object} flat form values
 */
export const toFormValues = byDay => {
  const hasRecord = !!byDay && BUSINESS_DAYS.some(day => isOpenOn(byDay, day));

  return BUSINESS_DAYS.reduce((acc, day) => {
    const entry = hasRecord ? byDay[day] : null;
    const isOpen = hasRecord ? isOpenOn(byDay, day) : true;
    return {
      ...acc,
      [dayEnabledField(day)]: isOpen,
      [dayOpenField(day)]: (isOpen && entry?.open) || DEFAULT_OPEN_TIME,
      [dayCloseField(day)]: (isOpen && entry?.close) || DEFAULT_CLOSE_TIME,
    };
  }, {});
};

/**
 * The one-line summary written to `businessHours`, for every reader that prints a string.
 *
 * Consecutive days that share the same hours are collapsed into a range, because seven lines
 * of "Mon 09:00-18:00" on a listing card is not a summary. The day names are English here -
 * this string is stored, not rendered from a message, and the alternative is regenerating
 * every studio's stored line whenever a reader's locale changes.
 *
 * @param {Object} [byDay]
 * @param {Object} [options]
 * @param {Array<string>} [options.dayLabels] - overrides for the seven short names
 * @returns {string} e.g. "Mon-Fri 09:00-18:00, Sat 10:00-14:00"
 */
export const businessHoursSummary = (byDay, { dayLabels } = {}) => {
  const labels = dayLabels || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const groups = BUSINESS_DAYS.reduce((acc, day, index) => {
    if (!isOpenOn(byDay, day)) {
      return acc;
    }
    const { open, close } = byDay[day];
    const last = acc[acc.length - 1];
    // Only CONSECUTIVE days merge: a studio open Mon and Wed at the same hours is not open
    // "Mon-Wed", and the reader of a card has no way to discover the Tuesday it implies.
    const isRunOn =
      last && last.endIndex === index - 1 && last.open === open && last.close === close;

    return isRunOn
      ? [...acc.slice(0, -1), { ...last, endIndex: index }]
      : [...acc, { startIndex: index, endIndex: index, open, close }];
  }, []);

  return groups
    .map(({ startIndex, endIndex, open, close }) => {
      const days =
        startIndex === endIndex ? labels[startIndex] : `${labels[startIndex]}-${labels[endIndex]}`;
      return `${days} ${open}-${close}`;
    })
    .join(', ');
};
