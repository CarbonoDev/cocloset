// ---------------------------------------------------------------------------
// THE STUDIO'S OWN CODE FOR A GARMENT
// ---------------------------------------------------------------------------
//
//   > "cuando laundry recibe la prenda desde el provider, debe aparecer un input para que
//   >  laundry pueda ingresar un código interno para esa prenda, ese código se le debe mostrar
//   >  a todas las partes de la transacción y debe guardarse tambien en el metadata del
//   >  listing (...) si el listing regresa a su dueño y se lo envia a otra laundry, este código
//   >  va a cambiar, por lo que puede haber varios códigos o reemplazar el mismo"
//
// ── WHY IT IS STORED IN TWO PLACES, AND WHY THEY ARE DIFFERENT SHAPES ───────
//
// The code means something only INSIDE the studio that issued it: it is where that studio's
// staff will find the garment on their own shelving. Move the garment to another studio and
// the old code is not history, it is a wrong answer.
//
// So:
//
//   ON THE LISTING - ONE code, stamped with the studio that issued it and when.
//   `metadata.laundryCode = { code, laundryId, updatedAt }`. Replacing a bare string would
//   leave nobody able to tell a live code from a dead one; the stamp is what makes
//   `isCurrentFor` possible, and a code whose studio is no longer the assigned one is simply
//   not shown. A LIST of past codes was the other option the client offered and it is not
//   built: nothing in this product asks what a garment was called at a studio it has left, and
//   an unread list is a thing to keep correct for no reader.
//
//   ON THE TRANSACTION - the code as a plain string, written once at the reception step.
//   `metadata.laundryCode`. This is what makes it visible to both parties (transaction
//   metadata rides along on every `transactions.show` for a party), and it makes a past rental
//   historically honest: it keeps the code that was true while it ran, even after the garment
//   has moved to another studio and been given a new one.
//
// Neither is writable by the people who read it: `metadata` on both entities is
// Integration-API-only, so a customer cannot invent a code and an owner cannot rewrite one.

const LISTING_CODE_KEY = 'laundryCode';
const TRANSACTION_CODE_KEY = 'laundryCode';

// Long enough for "A-04 / RACK 12 / BIN 7", short enough that it is a label rather than a
// note. Studios name their own shelving; this puts no format on it beyond a length and a
// trim, because inventing one would be inventing somebody else's system.
const MAX_CODE_LENGTH = 40;

/**
 * Validate a caller-supplied code.
 *
 * ABSENT IS VALID AND MEANS "NOT GIVEN". The reception step should ask for a code, but a
 * studio that has not decided on one yet must still be able to advance the garment - refusing
 * the transition would leave a garment physically at the counter and stuck in the app.
 *
 * An EMPTY string is also "not given" rather than an error: it is what an untouched input
 * posts, and treating it as a code would store a blank one.
 *
 * @param {*} value
 * @returns {{valid: boolean, value: string|null}}
 */
const validateLaundryCode = value => {
  if (value === undefined || value === null) {
    return { valid: true, value: null };
  }
  if (typeof value !== 'string') {
    return { valid: false, value: null };
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return { valid: true, value: null };
  }
  if (trimmed.length > MAX_CODE_LENGTH) {
    return { valid: false, value: null };
  }
  return { valid: true, value: trimmed };
};

/**
 * The record stored on the LISTING.
 *
 * @param {Object} params
 * @param {string} params.code
 * @param {string} params.laundryId - the studio issuing it
 * @param {Date} [params.now]
 * @returns {{code: string, laundryId: string, updatedAt: string}}
 */
const buildListingCodeRecord = ({ code, laundryId, now = new Date() }) => ({
  code,
  laundryId,
  // ISO string rather than a Date: the SDK would encode a Date as a transit timestamp, and
  // this record is read back by plain JSON consumers. Same reason `readyAt` is a string.
  updatedAt: now.toISOString(),
});

/**
 * Read the listing's code, but ONLY if the studio that issued it still holds the garment.
 *
 * THE WHOLE REASON THE RECORD CARRIES A `laundryId`. A garment that went home and was then
 * sent to a different studio has a code that means nothing there - showing it would send
 * somebody to the wrong shelf, which is worse than showing nothing.
 *
 * @param {Object} [listing] - a listing API entity
 * @returns {string|null}
 */
const currentLaundryCodeFor = listing => {
  const record = listing?.attributes?.metadata?.[LISTING_CODE_KEY];
  const assignedLaundryId = listing?.attributes?.metadata?.assignedLaundryId;

  if (!record || typeof record.code !== 'string' || record.code === '') {
    return null;
  }
  // `=== ` on two ids, and both must be present: an absent assignment cannot match anything,
  // and a record with no issuer is from a shape we no longer write.
  if (!record.laundryId || !assignedLaundryId || record.laundryId !== assignedLaundryId) {
    return null;
  }
  return record.code;
};

/**
 * Is this the step where the studio takes the garment IN from its owner?
 *
 * That is the one moment the code is asked for: the garment is physically on the counter and
 * about to go onto a shelf, which is when a studio decides where it lives. Everything after it
 * only reads the code.
 *
 * Expressed as the handover STATUS the caller is requesting rather than as a transition name,
 * because that is what both the phone page and the ops worklist send.
 *
 * @param {string} status
 * @returns {boolean}
 */
// Reception, and again at "Process for Cleaning" (Jonathan, 2026-09-03: "que ingrese
// nuevamente el ticket, por si debe cambiarlo"). A garment coming back from a rental often
// does not go back on the shelf it left.
//
// MUST match LAUNDRY_CODE_STATUSES in src/util/laundryStatuses.js. This is the half that
// decides whether the code is READ; a step the client asks at and this does not would take an
// operator's input and drop it silently.
const takesLaundryCode = status => ['ready-for-pickup', 'pending-cleaning'].includes(status);

module.exports = {
  LISTING_CODE_KEY,
  TRANSACTION_CODE_KEY,
  MAX_CODE_LENGTH,
  validateLaundryCode,
  buildListingCodeRecord,
  currentLaundryCodeFor,
  takesLaundryCode,
};
