const { getIntegrationSdk } = require('./integrationSdk');
const { readAssignedLaundryId, resolveInitialCleaningDays } = require('./laundryAssignment');

// THE LIVE INITIAL CLEANING TURNAROUND.
//
//   > "desde el momento de la carga de listingPage, se debe consultar las propiedades
//   >  de la laundry seleccionada para este listing para obtener los días que se
//   >  necesiten para el lavado siempre que onLaundry sea false, ya que, si la laundry
//   >  necesita por ejemplo 2 días para su lavado, la disponibilidad debe estar 2 días
//   >  despues de hoy"
//
// `listing.metadata.initialCleaningDays` is a SNAPSHOT, written once when the owner
// picked a laundry (server/api/listing-laundry-assignment.js). A studio that later
// changes its turnaround - or its per-category turnaround - does not change that number
// on the garments already assigned to it, so the calendar goes on offering dates the
// studio can no longer meet. This module answers the same question against the laundry's
// CURRENT configuration.
//
// WHY THIS CANNOT BE DONE IN THE BROWSER
// The turnaround lives in the laundry USER's `privateData`, which is readable only by
// that user and by the operator. A customer looking at a listing is neither. So the
// resolution has to happen server-side, and the only credential that can see it is the
// Integration API's. Hence the endpoint (server/api/listing-initial-cleaning.js) rather
// than an SDK call from the page.
//
// WHY IT REUSES laundryAssignment.resolveInitialCleaningDays
// That is the exact function that computed the snapshot in the first place - the
// per-top-level-category turnaround, then the studio-wide `privateData.turnaroundDays`,
// then DEFAULT_LAUNDRY_BUFFER_DAYS, then a hardcoded 2, all rounded up through
// computeBufferDays. Reusing it is what guarantees the live value EQUALS the snapshot
// whenever nothing has actually changed. Re-deriving the same chain from
// resolveCategoryTurnaroundDays/resolveTurnaroundDays by hand would be a second
// implementation of a number two other subsystems already agree on, and the first
// rounding difference would show up as "the calendar and checkout disagree".

/**
 * The listing's CURRENT initial cleaning turnaround, in whole days.
 *
 * Returns null - meaning "no live answer, use the stored snapshot" - rather than
 * throwing, in every case that is not a clean success. This is called on the checkout
 * path, where an exception is a lost sale, and by a public endpoint, where an exception
 * is a broken listing page.
 *
 * NO API CALL AT ALL when `metadata.onLaundry === true`. That is not an optimisation, it
 * is the rule: once a studio has taken delivery the lead time is spent and there is
 * nothing to resolve. It is also what keeps this off the COMMON checkout path - a
 * previous change deliberately removed the Integration API from pricing a booking, and
 * this reintroduces it only for a garment that has never reached a laundry, i.e. its
 * first rental.
 *
 * `=== true` and not truthiness, matching bookingRules.resolveInitialCleaningBlockDays
 * and evaluateLaundryAssignment: only a real boolean is custody, and bad data must not
 * be able to switch the rule off.
 *
 * @param {Object} params
 * @param {Object} params.listing - a listing API entity (Marketplace or Integration)
 * @param {Object} [params.integrationSdk] - injectable for tests
 * @param {*} [params.envDefaultBufferDays] - defaults to DEFAULT_LAUNDRY_BUFFER_DAYS
 * @returns {Promise<number|null>} a positive integer, or null for "no live answer"
 */
const resolveLiveInitialCleaningDays = ({ listing, integrationSdk, envDefaultBufferDays }) => {
  const metadata = listing?.attributes?.metadata;

  if (metadata?.onLaundry === true) {
    return Promise.resolve(null);
  }

  const assignedLaundryId = readAssignedLaundryId(listing);
  if (!assignedLaundryId || typeof assignedLaundryId !== 'string') {
    // No laundry assigned, so there is no studio to ask. The snapshot cannot exist
    // either in that case, but saying null here keeps the "unknown" answer in one shape.
    return Promise.resolve(null);
  }

  // Promise.resolve() first so that a SYNCHRONOUS failure - a misconfigured Integration
  // API client, `getIntegrationSdk` throwing on missing credentials - lands in the same
  // `.catch` as a rejected request. Calling `.users.show()` directly would let that
  // escape as a thrown exception into a caller that is only prepared for a rejection,
  // and on the checkout path that is a 500 instead of a stale-but-safe fallback.
  return Promise.resolve()
    .then(() => (integrationSdk || getIntegrationSdk()).users.show({ id: assignedLaundryId }))
    .then(response => {
      const laundryPrivateData = response?.data?.data?.attributes?.profile?.privateData;

      // A laundry whose profile we cannot read at all is not the same as a laundry with
      // nothing configured: resolveInitialCleaningDays would happily return the
      // hardcoded 2-day default for `undefined`, which would invent a lead time out of a
      // failed read. Fall back to the snapshot instead.
      if (!laundryPrivateData || typeof laundryPrivateData !== 'object') {
        return null;
      }

      const days = resolveInitialCleaningDays({
        laundryPrivateData,
        listingPublicData: listing?.attributes?.publicData,
        envDefaultBufferDays:
          envDefaultBufferDays !== undefined
            ? envDefaultBufferDays
            : process.env.DEFAULT_LAUNDRY_BUFFER_DAYS,
      });

      return Number.isInteger(days) && days > 0 ? days : null;
    })
    .catch(() => {
      // A deleted laundry, an Integration API outage, a rate limit. THE GATE MUST NOT
      // OPEN: the caller treats null as "use the snapshot", never as "no block". See
      // bookingRules.resolveInitialCleaningBlockDays, where the precedence lives.
      return null;
    });
};

module.exports = {
  resolveLiveInitialCleaningDays,
};
