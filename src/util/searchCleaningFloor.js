import {
  earliestBookableStart,
  resolveInitialCleaningDays,
} from '../components/OrderPanel/BookingDatesForm/BookingDatesForm';

/**
 * Drop the garments a date search would offer but a booking would refuse.
 *
 *   > "tengo un listing que estará disponible hasta el día 22 de septiembre; sin embargo,
 *   >  cuando hago filtros por fecha, al seleccionar por ejemplo el día 10 (...) aparece el
 *   >  listing como resultado de la búsqueda" (Jonathan, 2026-09-10)
 *
 * ── WHY THE SEARCH CANNOT ALREADY KNOW ──────────────────────────────────────
 * `listings.query` filters on Sharetribe's own calendar: the availability plan and its
 * exceptions. Three of the four things that make a garment unbookable are there - an accepted
 * booking's window, and a wash in progress, are both written as real exceptions.
 *
 * The INITIAL cleaning lead time is not, and cannot sensibly be. It is "n days after the owner
 * hands the garment in", which is relative to a drop-off that has not happened: an exception is
 * a fixed date range, so expressing it would mean rewriting the calendar every day and hoping
 * whatever does the rewriting never fails quietly. The picker computes it instead, and so does
 * the checkout gate (server/api-util/bookingRules.js). Search was the third surface, and had
 * neither.
 *
 * ── THE SAME RULE, NOT A SECOND ONE ─────────────────────────────────────────
 * This imports `resolveInitialCleaningDays` and `earliestBookableStart` from the picker rather
 * than restating them. A search that hid a different set of garments from the one the calendar
 * refuses would be a new bug wearing the old one's clothes.
 *
 * One difference is deliberate and worth knowing: the picker prefers the studio's LIVE
 * turnaround, fetched per listing on the listing page. A results page cannot make one request
 * per card, so this reads the snapshot on the listing (`metadata.initialCleaningDays`). They
 * differ only for a studio that changed its turnaround after a garment was assigned to it, and
 * the snapshot is never the LONGER of the two by much - so this errs towards showing a garment
 * the picker will then narrow, rather than hiding one it would have offered.
 */

/**
 * The first day this listing could be collected, or null when nothing blocks it.
 *
 * @param {Object} listing - a listing entity from the search response
 * @returns {Date|null}
 */
export const earliestBookableStartForListing = listing => {
  const { onLaundry, initialCleaningDays, readyAt } = listing?.attributes?.metadata || {};
  const timeZone = listing?.attributes?.availabilityPlan?.timezone;

  // `null` for the live value: there is none on a results page. See the note above.
  const days = resolveInitialCleaningDays(initialCleaningDays, onLaundry, null);
  if (days === null && !readyAt) {
    return null;
  }

  return earliestBookableStart(days, readyAt, timeZone);
};

/**
 * Is this garment collectable on the day the search asked about?
 *
 * @param {Object} listing
 * @param {Date|null} requestedStart - the first day of the dates filter
 * @returns {boolean} true when nothing is known to block it
 */
export const isBookableFrom = (listing, requestedStart) => {
  if (!requestedStart) {
    return true;
  }
  const earliest = earliestBookableStartForListing(listing);
  // No floor, or a floor already passed. `getTime` rather than `>=` on the dates themselves,
  // which compares object identity.
  return !earliest || earliest.getTime() <= requestedStart.getTime();
};

/**
 * Filter a search response, and correct what it claims to have found.
 *
 *   > "trata de corregir el conteo" (Jonathan, 2026-09-10)
 *
 * THE COUNT IS BEST-EFFORT, AND THAT IS NOT A DETAIL TO BURY. Sharetribe counts before this
 * filter runs, so the true total is unknowable without fetching every page. What is knowable is
 * how many THIS page dropped, and the total is reduced by exactly that - so the number only
 * ever moves towards the truth, and never claims more garments than a reader could reach.
 *
 * `totalPages` is deliberately left alone. It is what the pager is built from, and shrinking it
 * on the strength of one page would remove pages that still hold results.
 *
 * @param {Object} response - the raw `listings.query` response
 * @param {Date|null} requestedStart
 * @returns {Object} the same response shape, with unbookable listings removed
 */
export const withoutUnbookableListings = (response, requestedStart) => {
  const data = response?.data?.data;
  if (!requestedStart || !Array.isArray(data)) {
    return response;
  }

  const kept = data.filter(listing => isBookableFrom(listing, requestedStart));
  const dropped = data.length - kept.length;
  if (dropped === 0) {
    return response;
  }

  const meta = response.data.meta || {};
  const totalItems = Number.isFinite(meta.totalItems)
    ? Math.max(0, meta.totalItems - dropped)
    : meta.totalItems;

  return {
    ...response,
    data: {
      ...response.data,
      data: kept,
      meta: { ...meta, totalItems },
    },
  };
};
