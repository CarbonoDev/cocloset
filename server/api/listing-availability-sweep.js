const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { uuidString } = require('../api-util/uuid');
const { createRateLimiter } = require('../api-util/rateLimit');
const { BUFFER_EXCEPTION_IDS_KEY } = require('../api-util/availabilityBuffer');
const { isActiveLastTransition } = require('../api-util/coclosetBookingProcess');
const log = require('../log');

// Give back the days a booking blocked, once that booking is over.
//
//   > "habia hecho una reservación ya para el mismo artículo y la cancelé como operator, por
//   >  lo tanto, los días reservados deberían estar disponibles, sin embargo no lo estan (...)
//   >  Quiza las transacciones canceladas no las esta considerando como días habiles"
//   >   (Jonathan, 2026-09-07)
//
// POST /api/listing-availability-sweep
// Request body: { listingId }
//
// ---------------------------------------------------------------------------
// WHY A SWEEP AND NOT A HOOK ON `cancel`
// ---------------------------------------------------------------------------
// Accepting a booking creates a `seats: 0` availability exception over the rental dates plus
// the studio's turnaround (api-util/availabilityBuffer.js). Nothing ever removed it. A
// cancelled rental therefore went on blocking its dates for good, which is what the client
// hit - and the cancellation that produced it was made from Console, where no browser code of
// ours runs at all. Neither does anything else: Sharetribe will call a webhook for process
// events, but this marketplace has none configured, and adding one is an operations change
// rather than a code change.
//
// So the cleanup is triggered by a READ instead: the listing page asks for it on load, which
// is exactly where a stale block is visible and exactly when it matters. It is idempotent, it
// converges, and a failure is invisible - the page renders either way.
//
// ---------------------------------------------------------------------------
// WHAT IT WILL AND WILL NOT DELETE - the whole safety argument
// ---------------------------------------------------------------------------
// An availability exception carries no metadata of ours. A block an OWNER created because
// they are away for a week is byte-identical to one this platform created for a booking:
// same listing, same `seats: 0`, same shape. So "delete the blocks over these dates" cannot
// be done safely by looking at dates, and this endpoint does not try.
//
// It deletes ONLY exceptions whose ids this platform recorded when it created them, on a
// transaction it can prove is no longer active. Two facts, both ours, both stored. An
// exception we did not create is not a candidate at any point in this file.
//
// The cost of that discipline is honest and worth stating: bookings accepted BEFORE the ids
// were recorded have no record, so their blocks cannot be attributed and are left alone.
// They are reported in `unattributed` so an operator can clear them by hand once, rather than
// being silently deleted or silently ignored.
//
// Success response (200): { data: { deleted, cleared, unattributed, listingId } }
//   - `deleted`      - ids removed from the calendar
//   - `cleared`      - transactions whose record was emptied, so this is idempotent
//   - `unattributed` - ids of `seats: 0` exceptions with no owning transaction. NOT deleted.
// Failure response: standard handleError() shape (see api-util/sdk.js).

// Public, like the listing page that fires it, and it takes only a listing id - so it is rate
// limited on the same terms as the other public read endpoints. It performs deletes, but only
// of blocks whose booking is provably over: there is nothing a caller can steer.
const limiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxPerKey: 120,
  maxTotal: 6000,
});

const TRANSACTIONS_PER_PAGE = 100;
const EXCEPTIONS_PER_PAGE = 100;

// A year is far more than any buffer window: they are a rental plus a turnaround. Bounded so
// one page load cannot ask the API to enumerate a calendar without end.
const SWEEP_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

module.exports = (req, res) => {
  const listingId = uuidString(req.body?.listingId);

  if (!listingId) {
    res
      .status(400)
      .json({ error: 'Missing required "listingId" in request body.' })
      .end();
    return;
  }

  const { allowed, retryAfterSeconds } = limiter.check(req.ip);
  if (!allowed) {
    res
      .status(429)
      .set('Retry-After', String(retryAfterSeconds))
      .json({ error: 'Too many requests. Please try again later.' })
      .end();
    return;
  }

  const integrationSdk = getIntegrationSdk();
  const now = new Date();

  Promise.all([
    integrationSdk.transactions.query({ listingId, perPage: TRANSACTIONS_PER_PAGE }),
    integrationSdk.availabilityExceptions.query({
      listingId,
      start: now,
      end: new Date(now.getTime() + SWEEP_HORIZON_MS),
      perPage: EXCEPTIONS_PER_PAGE,
    }),
  ])
    .then(([txResponse, exceptionResponse]) => {
      const transactions = txResponse?.data?.data || [];
      const exceptions = exceptionResponse?.data?.data || [];

      // Only blocks. An exception with seats > 0 OPENS days rather than closing them, and
      // deleting one would take availability away - the opposite of this endpoint's job.
      const blocking = exceptions.filter(e => e?.attributes?.seats === 0);
      const blockingIds = new Set(blocking.map(e => e.id.uuid));

      const owned = new Map();
      transactions.forEach(tx => {
        const ids = tx?.attributes?.metadata?.[BUFFER_EXCEPTION_IDS_KEY];
        if (Array.isArray(ids)) {
          ids.forEach(id => owned.set(id, tx));
        }
      });

      // The record outlives the exception - a block deleted by hand leaves a dangling id - so
      // this is intersected with what is actually on the calendar rather than trusted.
      const staleIds = [...owned.keys()].filter(
        id =>
          blockingIds.has(id) && !isActiveLastTransition(owned.get(id)?.attributes?.lastTransition)
      );

      // Everything on the calendar that nobody claims. Reported, never touched: it is either
      // an owner's own block or a booking accepted before the ids were recorded, and this
      // endpoint cannot tell those apart. See the note above.
      const unattributed = blocking.map(e => e.id.uuid).filter(id => !owned.has(id));

      // Sequential: the same reason the creates are (see reconcileBufferWindow). A failed
      // delete must not abandon the rest, so each one is caught - a block that survives this
      // run is picked up by the next page load rather than being lost.
      return staleIds
        .reduce(
          (chain, id) =>
            chain.then(deleted =>
              integrationSdk.availabilityExceptions
                .delete({ id }, { expand: false })
                .then(() => deleted.concat(id))
                .catch(e => {
                  log.error(e, 'availability-sweep-delete-failed', { listingId, exceptionId: id });
                  return deleted;
                })
            ),
          Promise.resolve([])
        )
        .then(deleted => {
          // Emptied so a second sweep has nothing to do, and so a dangling id never keeps a
          // finished transaction on the candidate list forever. Only for transactions all of
          // whose blocks are gone - a partial delete keeps its remainder recorded.
          const toClear = [...new Set(staleIds.map(id => owned.get(id)))].filter(tx => {
            const ids = tx?.attributes?.metadata?.[BUFFER_EXCEPTION_IDS_KEY] || [];
            return ids.every(id => deleted.includes(id) || !blockingIds.has(id));
          });

          return Promise.all(
            toClear.map(tx =>
              integrationSdk.transactions
                .updateMetadata({ id: tx.id, metadata: { [BUFFER_EXCEPTION_IDS_KEY]: null } })
                .catch(e => {
                  log.error(e, 'availability-sweep-clear-failed', {
                    listingId,
                    txId: tx?.id?.uuid,
                  });
                })
            )
          ).then(() => ({ deleted, cleared: toClear.length, unattributed }));
        });
    })
    .then(({ deleted, cleared, unattributed }) => {
      if (unattributed.length > 0) {
        // Loud on purpose. These are days a listing is refusing bookings for, that nothing
        // can explain - the exact symptom the client reported, for the bookings that predate
        // the record.
        log.error(
          new Error('Availability blocks with no owning transaction'),
          'availability-sweep-unattributed',
          { listingId, unattributed }
        );
      }

      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: { listingId, deleted, cleared, unattributed } })
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};

module.exports.limiter = limiter;
