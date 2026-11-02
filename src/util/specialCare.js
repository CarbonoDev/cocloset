/**
 * SPECIAL CARE: what the studio needs to know before it washes the garment.
 *
 *   > "En editListingPage hay que agregar una sección 'Special Care' con un conjunto de check
 *   >  boxes, las opciones son: Embellishments (sequins, beadwork, etc.), Leather/Suede Trim,
 *   >  Pressed Pleats, High Value Item (Over $1K), Note to Cleaner: ___
 *   >  Este dato solo debe ser visible para el provider y laundry, nadie mas"
 *
 * ── ONE HIGH VALUE FLAG, NOT TWO ───────────────────────────────────────────
 * A separate request asked for a standalone "High Value item" checkbox, and this list already
 * contains one. Two controls meaning the same thing can disagree - a garment marked high value
 * in one place and not the other - and nothing downstream could say which was right. So there
 * is one, and it lives here.
 *
 * ── WHERE IT IS STORED, AND WHY THAT IS THE ONLY OPTION ────────────────────
 * `privateData`. Console's extended data cannot express "the owner and the studio, nobody
 * else": `publicData` is visible to the world, including the renter, and `privateData` is
 * visible to the owner and the operator. The studio is neither - it is not a party to the
 * transaction in Sharetribe's sense.
 *
 * What makes it work is that the studio never reads a listing through the Marketplace API. It
 * reads through our own server endpoints, which use the Integration API and can therefore see
 * privateData and hand over exactly the fields we choose. So `privateData` keeps the renter
 * out, and the ops endpoint lets the studio in - see server/api/laundry-orders.js.
 *
 * That is also why this is NOT a Console listing field: a Console field would have to be
 * public (renter sees it) or private (studio does not), and neither is what was asked for.
 */

export const SPECIAL_CARE_EMBELLISHMENTS = 'embellishments';
export const SPECIAL_CARE_LEATHER_SUEDE_TRIM = 'leatherSuedeTrim';
export const SPECIAL_CARE_PRESSED_PLEATS = 'pressedPleats';
export const SPECIAL_CARE_HIGH_VALUE = 'highValue';

/**
 * The checkbox options, in the order the client listed them.
 *
 * Keys rather than labels: a label is a sentence somebody will want to reword, and rewording it
 * must not silently orphan the flag already stored on every listing that carries it.
 */
export const SPECIAL_CARE_OPTIONS = [
  SPECIAL_CARE_EMBELLISHMENTS,
  SPECIAL_CARE_LEATHER_SUEDE_TRIM,
  SPECIAL_CARE_PRESSED_PLEATS,
  SPECIAL_CARE_HIGH_VALUE,
];

export const SPECIAL_CARE_NOTE_MAX_LENGTH = 500;

/**
 * The flags a listing actually carries, in the canonical order and with anything unrecognised
 * dropped.
 *
 * ONLY WHAT IS TRUE. An unchecked box is not a fact about the garment - "this dress has no
 * sequins" is not something a studio needs told - so it is absent rather than stored false.
 * That is also what the client asked for on the high-value flag: "no se debe mostrar si está
 * en false".
 *
 * @param {Object} [privateData] - a listing's privateData
 * @returns {Array<string>}
 */
export const specialCareFlags = privateData => {
  const stored = privateData?.specialCare?.flags;
  const flags = Array.isArray(stored) ? stored : [];
  return SPECIAL_CARE_OPTIONS.filter(option => flags.includes(option));
};

/**
 * The free-text note, trimmed, or null when there is none.
 *
 * @param {Object} [privateData] - a listing's privateData
 * @returns {string|null}
 */
export const specialCareNote = privateData => {
  const note = privateData?.specialCare?.note;
  if (typeof note !== 'string') {
    return null;
  }
  const trimmed = note.trim();
  return trimmed === '' ? null : trimmed.slice(0, SPECIAL_CARE_NOTE_MAX_LENGTH);
};

/**
 * What to store for a submitted form.
 *
 * Returns `null` for a garment with nothing to say, so the key is REMOVED rather than left as
 * an empty object - Sharetribe only drops an extended-data key when it is explicitly null, and
 * an empty `specialCare` would read as "somebody considered this and said nothing", which is a
 * different claim from "nobody has said".
 *
 * @param {Object} params
 * @param {Array<string>} [params.flags]
 * @param {string} [params.note]
 * @returns {{flags: Array<string>, note: string|null}|null}
 */
export const specialCareForStorage = ({ flags, note } = {}) => {
  const cleanFlags = SPECIAL_CARE_OPTIONS.filter(option =>
    (Array.isArray(flags) ? flags : []).includes(option)
  );
  const cleanNote = specialCareNote({ specialCare: { note } });

  if (cleanFlags.length === 0 && !cleanNote) {
    return null;
  }

  return { flags: cleanFlags, note: cleanNote };
};
