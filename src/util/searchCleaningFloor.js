import { earliestBookableStart, resolveInitialCleaningDays } from './cleaningFloor';
import { getStartOf } from './dates';

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
 * The "Pickup Today" badge condition, for a card or a listing page.
 *
 *   > "la tag debe ser mostrada para los listings que esten en laundry y que esten
 *   >  disponibles para hoy" (Jonathan, 2026-09-11)
 *
 * Two conditions, both from data already on a search-response listing entity: the garment is
 * physically at its studio right now (`metadata.onLaundry === true` - the same flag every
 * other reader of custody uses), and nothing known blocks a collection today (the same
 * cleaning-floor check the date filter already relies on).
 *
 * NOT A GUARANTEE, and said so rather than hidden: this reads only the initial-cleaning and
 * post-rental-readiness floors, which is everything a search-response listing carries. It does
 * NOT re-check Sharetribe's own availability exceptions (an active or upcoming booking sitting
 * across today), because that would mean a real availability query per card rather than a read
 * of data already in hand. This is the same trade-off `withoutUnbookableListings` already
 * makes for the dates filter's post-fetch pass, and the same direction it errs in: showing the
 * badge on a garment a booking would then refuse, rather than hiding it from one that is
 * genuinely free. A search actually filtered by today's date (the "Available today" filter)
 * goes through the real query instead and does not share this gap.
 *
 * @param {Object} listing - a listing entity from the search response
 * @param {Date} [today] - for tests; defaults to the real current instant
 * @returns {boolean}
 */
export const isPickupTodayListing = (listing, today = new Date()) => {
  const onLaundry = listing?.attributes?.metadata?.onLaundry === true;
  if (!onLaundry) {
    return false;
  }
  const timeZone = listing?.attributes?.availabilityPlan?.timezone || 'Etc/UTC';
  const startOfToday = getStartOf(today, 'day', timeZone);
  return isBookableFrom(listing, startOfToday);
};

/**
 * Filter a search response by a per-listing predicate, and correct what it claims to have
 * found.
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
 * @param {(listing: Object) => boolean} keepIf - true for a listing that should survive
 * @returns {Object} the same response shape, with the dropped listings removed
 */
const filterSearchResponse = (response, keepIf) => {
  const data = response?.data?.data;
  if (!Array.isArray(data)) {
    return response;
  }

  const kept = data.filter(keepIf);
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

/**
 * @param {Object} response - the raw `listings.query` response
 * @param {Date|null} requestedStart
 * @returns {Object} the same response shape, with unbookable listings removed
 */
export const withoutUnbookableListings = (response, requestedStart) => {
  if (!requestedStart) {
    return response;
  }
  return filterSearchResponse(response, listing => isBookableFrom(listing, requestedStart));
};

/**
 * The post-fetch half of the "Pickup Today" search filter.
 *
 *   > "hay que agregar un filtro en el search que nos permita filtrar por listings que esten
 *   >  disponibles para hoy" (Jonathan, 2026-09-11)
 *
 * Reuses `isPickupTodayListing` - the exact same rule the card badge uses - so a listing the
 * filter offers and the badge does not agree about would be a new bug wearing an old one's
 * clothes. Unlike the badge, this runs on top of a REAL availability query for today (see
 * SearchPage.duck.js, which reuses `datesSearchParams` internally rather than a second copy of
 * that logic), so it does not carry the badge's "does not see active bookings" caveat.
 *
 * @param {Object} response - the raw `listings.query` response, already date-filtered for today
 * @returns {Object} the same response shape, with everything not pickup-today removed
 */
export const withOnlyPickupTodayListings = response =>
  filterSearchResponse(response, listing => isPickupTodayListing(listing));
