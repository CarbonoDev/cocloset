const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { requireLaundryCaller } = require('../api-util/laundryAuth');
const { resolveInitialCleaningDays } = require('../api-util/laundryAssignment');
const { readAssignedLaundryId } = require('../api-util/laundryAssignment');
const { TRANSACTION_CODE_KEY, currentLaundryCodeFor } = require('../api-util/laundryCode');
const {
  TRANSITIONS,
  OPS_LAST_TRANSITIONS,
  stateFromLastTransition,
} = require('../api-util/coclosetBookingProcess');

// Read endpoint backing the laundry ops dashboard (design doc §8).
//
// GET /api/laundry-orders
//
// Returns everything the ops screens need in one round trip, already
// denormalized (no `included` array for the client to resolve):
//
//   - `orders`    - the §8 UNION: one row per transaction on a listing
//                   assigned to the calling laundry, PLUS one row per assigned
//                   listing that has no transaction at all (a garment can sit
//                   "incoming"/"stored" in the studio with no booking against
//                   it, and still needs to appear in the laundry's queue).
//   - `inventory` - one row per assigned listing, regardless of transactions
//                   (backs the Inventory card grid, mockup 04.jpg).
//
// There is no request body and no caller-supplied filter: the caller's own
// user id IS the laundry filter, so `requireLaundryCaller` is the only
// authorization needed here (unlike the write endpoints, there's no single
// resource to run `assertIsAssignedLaundry` against).
//
// ---------------------------------------------------------------------------
// Why the filtering happens in Node instead of in the query
// ---------------------------------------------------------------------------
// `meta_assignedLaundryId` is passed to `listings.query` below. As of
// 2026-08-12 the metadata-scope search schema IS live on Dev and this filter
// really filters - measured, not assumed: a bogus id returns 0 rather than
// everything, and for each of the three laundries that have garments assigned the
// query returns exactly the number of listings that actually carry that id.
// (`meta_isLaundry` in server/api/laundries.js is live too: true -> 4, false -> 11,
// against a real distribution of 4/11/12 true/false/absent.)
//
// WHAT HAS NOT CHANGED, AND IS WHY THE JS FILTER STAYS. An extended-data filter
// whose key has NO schema is still silently ignored, returning the whole
// marketplace: verified in the same session with `meta_totallyMadeUpKey`, which
// returned all 27 users. So the API fails OPEN on an unrecognised key, and a
// marketplace-wide listing dump reaching one laundry's dashboard is a bug class
// that has already shipped here twice.
//
// A TRAP IN TESTING THIS, worth knowing before you verify it again: probing with
// a deliberately bogus VALUE does not test whether a schema exists. On a
// boolean-typed field a garbage value is coerced to `false` rather than rejected
// (`meta_isLaundry="nonsense"` returns the 11 users whose flag is false), so the
// probe looks broken while the schema is fine. The reliable test is an unknown
// KEY: if the result is everything, the filter did nothing.
//
// THE PREFIX CHANGED WITH THE FIELD, AND THE FAIL-OPEN DID NOT. The assigned
// laundry moved from `publicData` to `metadata` (see
// api-util/laundryAssignment.js), so the param is now `meta_` and the schema
// pushed for `pub_assignedLaundryId` is dead - it has to be unset and re-set on
// the `metadata` scope (docs runbook "Search Schemas (flex-cli)"). Between those
// two moments the query filters NOTHING, silently, and a marketplace-wide listing
// dump reaching a single laundry's dashboard is exactly the bug class that has
// already shipped here twice.
//
// So the filter is applied in JS after fetching, and stays applied whatever the
// query param does. The param is kept only so this endpoint gets server-side
// filtering (i.e. pagination that scales) for free the day the schema exists -
// the JS filter is the load-bearing one, permanently, and must never be
// "optimised" away. Pushing schemas is a `flex-cli` operation and needs explicit
// approval, so it is deliberately NOT done here.
//
// ---------------------------------------------------------------------------
// Why transactions are queried per listing
// ---------------------------------------------------------------------------
// `transactions.query` has no "transactions whose listing is one of these"
// filter. Verified against the real Dev API: `listingId` accepts exactly one
// UUID - both a comma-separated string and an array are rejected with
// `validation-invalid-value` / `(not (instance? java.util.UUID ...))`. There
// is also no usable extended-data filter (same missing-search-schema problem
// as above). The alternatives were (a) query every transaction in the
// marketplace and filter in JS, or (b) one query per assigned listing.
// (b) is used: it scales with the calling laundry's own inventory rather than
// with total marketplace volume, which is the right axis.
//
// ---------------------------------------------------------------------------
// `lastTransitions` IS a real filter (unlike `pub_*` / `meta_*`)
// ---------------------------------------------------------------------------
// The per-listing transaction query below narrows with `lastTransitions`. That
// is a NATIVE `transactions.query` filter, not extended data, so - unlike
// `meta_assignedLaundryId` above - it genuinely works today with no search
// schema. Verified against the real Dev Integration API: the parameter is
// accepted (HTTP 200) and filters.
//
// It matters here for more than tidiness. Every transaction in the marketplace
// currently sits at `transition/inquire`; without the filter a studio's
// worklist is mostly inquiries for garments nobody has committed to renting.
// OPS_LAST_TRANSITIONS is the set from `accept` onwards - see
// server/api-util/coclosetBookingProcess.js for what is in it and why.
//
// The tradeoff, stated plainly: this filter fails CLOSED. A transition name
// that the marketplace does not recognise is not rejected, it simply matches
// nothing (also verified). So a transaction on a process whose transitions are
// not in that list - e.g. a legacy `default-booking` rental on a listing that
// has since been assigned to a laundry - will not appear on the dashboard at
// all. That is the intended scope (laundry listings are `garment-rental`,
// which resolves to `cocloset-booking`), but it is a silent exclusion rather
// than a loud one.
//
// ---------------------------------------------------------------------------
// STATUS IS DERIVED, NOT STORED
// ---------------------------------------------------------------------------
// Rows no longer carry a `laundryStatus` metadata field. The transaction's
// position in the custody chain is now its real process state, derived from
// `attributes.lastTransition`, and the cleaning sub-phase is
// `metadata.cleaningPhase`. `metadata.lateReturn` is gone too - lateness is
// `state === 'overdue'`, maintained by the process itself.
//
// This endpoint emits the raw facts (`state`, `cleaningPhase`, `lastTransition`)
// and leaves the display vocabulary to the client (src/util/laundryStatuses.js),
// rather than inventing a third status enum here.
const LISTINGS_PER_PAGE = 100;
const TRANSACTIONS_PER_PAGE = 100;

// Safety cap so a large marketplace can't turn one dashboard load into an
// unbounded crawl. If it's hit, `meta.truncated` tells the client the view is
// incomplete rather than silently showing a short list.
const MAX_LISTING_PAGES = 20;

// How many per-listing transaction queries to run at once.
const TRANSACTION_QUERY_CONCURRENCY = 5;

const IMAGE_VARIANTS = ['variants.square-small', 'variants.square-small2x'];

// Run `worker` over `items` with at most `limit` promises in flight.
const mapWithConcurrency = (items, limit, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const runner = () => {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= items.length) {
      return Promise.resolve();
    }
    return Promise.resolve(worker(items[index], index)).then(result => {
      results[index] = result;
      return runner();
    });
  };

  const runnerCount = Math.min(limit, items.length);
  return Promise.all(Array.from({ length: runnerCount }, runner)).then(() => results);
};

// Fetch every listing page (up to MAX_LISTING_PAGES), keeping the `included`
// entities alongside each page so images/authors can be resolved per page.
const fetchAllListingPages = (integrationSdk, laundryId) => {
  const pages = [];

  const fetchPage = page =>
    integrationSdk.listings
      .query({
        // No-op today (see note above), correct the day a metadata-scope search
        // schema exists. Never the real filter - that is the JS pass below.
        meta_assignedLaundryId: laundryId,
        page,
        perPage: LISTINGS_PER_PAGE,
        include: ['author', 'images'],
        'fields.image': IMAGE_VARIANTS,
      })
      .then(response => {
        const { data, included = [], meta = {} } = response.data;
        pages.push({ data, included });

        const totalPages = meta.totalPages || 1;
        const hasMore = page < totalPages;
        if (hasMore && page < MAX_LISTING_PAGES) {
          return fetchPage(page + 1);
        }
        return { truncated: hasMore, totalPages };
      });

  return fetchPage(1).then(({ truncated, totalPages }) => ({ pages, truncated, totalPages }));
};

const findIncluded = (included, type, id) =>
  id ? included.find(entity => entity.type === type && entity.id.uuid === id) : null;

const imageUrlFrom = image => {
  const variants = image?.attributes?.variants || {};
  return variants['square-small']?.url || variants['square-small2x']?.url || null;
};

// First image of a listing, resolved out of the page's `included` array.
const listingImageUrl = (listing, included) => {
  const imageRefs = listing.relationships?.images?.data || [];
  const firstRef = imageRefs[0];
  const image = findIncluded(included, 'image', firstRef?.id?.uuid);
  return image ? imageUrlFrom(image) : null;
};

const displayNameOf = user => user?.attributes?.profile?.displayName || null;

// Shape shared by both row kinds - everything that comes from the listing.
//
// `laundryPrivateData` is the CALLING studio's own profile privateData, which is where the
// per-category turnaround table lives. It comes off the `currentUser` this endpoint already
// fetched to authorize the request - a user may read their own privateData through the
// ordinary Marketplace API - so pre-filling the cleaning-days box costs no extra round trip.
const listingFields = (listing, included, laundryPrivateData) => {
  const attrs = listing.attributes || {};
  const publicData = attrs.publicData || {};
  const author = findIncluded(included, 'user', listing.relationships?.author?.data?.id?.uuid);

  return {
    listingId: listing.id.uuid,
    // THE STUDIO'S OWN CODE FOR THIS GARMENT, so the ops table can pre-fill its box the way
    // the handover page already does - a studio re-confirming a step should not be asked to
    // remember its own shelving. It matters most at the RECEPTION step, where the transaction
    // has no code yet but this studio may well have named the garment during an earlier rental.
    //
    // `currentLaundryCodeFor` rather than the raw metadata: it refuses a code issued by a
    // studio that no longer holds the garment, which a bare string could not be told apart
    // from. It compares the record's issuer against the listing's own `assignedLaundryId`, so
    // it needs no caller id. Costs nothing - the listing is already in hand.
    // See api-util/laundryCode.js.
    laundryCode: currentLaundryCodeFor(listing) || null,
    title: attrs.title || null,
    listingState: attrs.state || null,
    brand: publicData.brand || null,
    size: publicData.size || null,
    imageUrl: listingImageUrl(listing, included),
    ownerName: displayNameOf(author),
    readinessStatus: attrs.metadata?.readinessStatus || null,
    currentRack: attrs.privateData?.currentRack || null,
    // Physical custody and the readiness moment a real return produced. Emitted
    // on BOTH row kinds because both questions are about the garment, not about
    // a booking: a listing-only row (§8's no-transaction case) is exactly where
    // "this garment is still in the studio" matters most.
    onLaundry: attrs.metadata?.onLaundry === true,
    readyAt: attrs.metadata?.readyAt || null,
    // How many days THIS studio has said it needs for THIS garment's category.
    //
    //   > "estos días deben tener un default de los días que indique la laundry, pero pueden
    //   >  modificarse al recibir"
    //
    // The box used to start blank, with "leave blank to use the configured turnaround"
    // underneath - which meant the operator could not see the number they were accepting, and
    // had to know their own configuration by heart to tell whether it was right for this
    // garment. The same resolution chain that sizes the availability block, so what is shown
    // is what would have been applied.
    defaultCleaningDays: resolveInitialCleaningDays({
      laundryPrivateData,
      listingPublicData: publicData,
      envDefaultBufferDays: process.env.DEFAULT_LAUNDRY_BUFFER_DAYS,
    }),
  };
};

const transactionRow = (transaction, txIncluded, listingBase) => {
  const attrs = transaction.attributes || {};
  const metadata = attrs.metadata || {};
  const rels = transaction.relationships || {};

  const customer = findIncluded(txIncluded, 'user', rels.customer?.data?.id?.uuid);
  const booking = findIncluded(txIncluded, 'booking', rels.booking?.data?.id?.uuid);
  const provider = findIncluded(txIncluded, 'user', rels.provider?.data?.id?.uuid);

  const damage = metadata.damageReported;
  const lastTransition = attrs.lastTransition || null;

  return {
    ...listingBase,
    id: `tx:${transaction.id.uuid}`,
    rowType: 'transaction',
    transactionId: transaction.id.uuid,
    // The ticket code is written by transition/laundry-mark-ready, so it is
    // null until the laundry has prepared the garment.
    ticketCode: metadata.ticketCode || null,
    // The transaction's own copy of the studio's code wins over the listing's (see
    // `listingFields`): it is the one THIS rental was given and the one both parties see, and
    // it stays historically honest after the garment moves on. `||` rather than `??` because
    // the write path stores no empty strings - an absent code and a blank one are the same
    // "not decided yet", which is what the listing fallback is then free to answer.
    laundryCode: metadata[TRANSACTION_CODE_KEY] || listingBase.laundryCode || null,
    customerName: displayNameOf(customer),
    // Prefer the transaction's own provider (always the listing author, but
    // present even when the listing page's `included` didn't resolve).
    ownerName: displayNameOf(provider) || listingBase.ownerName,
    bookingStart: booking?.attributes?.start
      ? new Date(booking.attributes.start).toISOString()
      : null,
    bookingEnd: booking?.attributes?.end ? new Date(booking.attributes.end).toISOString() : null,
    // The real process state, derived from lastTransition (the API never sends
    // a state name). Null for a transaction on some other process.
    state: stateFromLastTransition(lastTransition),
    cleaningPhase: metadata.cleaningPhase || null,
    // A garment that came back late leaves `overdue` for `returned`, so
    // `state` alone stops answering "was this late?" the moment it is
    // resolved. The transition that resolved it still says so, and the ops
    // screens want to keep flagging the row.
    returnedLate: lastTransition === TRANSITIONS.LAUNDRY_CONFIRM_RETURN_LATE,
    damageReported: damage ? { flag: !!damage.flag, note: damage.note || '' } : null,
    lastTransition,
    processName: attrs.processName || null,
  };
};

const listingOnlyRow = listingBase => ({
  ...listingBase,
  id: `listing:${listingBase.listingId}`,
  rowType: 'listing',
  transactionId: null,
  ticketCode: null,
  customerName: null,
  bookingStart: null,
  bookingEnd: null,
  state: null,
  cleaningPhase: null,
  returnedLate: false,
  damageReported: null,
  lastTransition: null,
  processName: null,
});

module.exports = (req, res) => {
  const integrationSdk = getIntegrationSdk();

  requireLaundryCaller(req, res)
    .then(currentUser => {
      const laundryId = currentUser.id.uuid;
      const laundryPrivateData = currentUser?.attributes?.profile?.privateData;

      return fetchAllListingPages(integrationSdk, laundryId).then(({ pages, truncated }) => {
        // Apply the real filter here (see the no-op note at the top).
        const assigned = [];
        pages.forEach(({ data, included }) => {
          data.forEach(listing => {
            if (readAssignedLaundryId(listing) === laundryId) {
              assigned.push({ listing, included });
            }
          });
        });

        return mapWithConcurrency(
          assigned,
          TRANSACTION_QUERY_CONCURRENCY,
          ({ listing, included }) =>
            integrationSdk.transactions
              .query({
                listingId: listing.id.uuid,
                // Native filter, genuinely effective - see the note at the top.
                lastTransitions: OPS_LAST_TRANSITIONS,
                perPage: TRANSACTIONS_PER_PAGE,
                include: ['customer', 'provider', 'booking'],
              })
              .then(response => ({
                listing,
                included,
                transactions: response.data.data,
                txIncluded: response.data.included || [],
              }))
        ).then(perListing => ({ laundryId, laundryPrivateData, perListing, truncated }));
      });
    })
    .then(({ laundryId, laundryPrivateData, perListing, truncated }) => {
      const orders = [];
      const inventory = [];
      let transactionCount = 0;

      perListing.forEach(({ listing, included, transactions, txIncluded }) => {
        const base = listingFields(listing, included, laundryPrivateData);
        const rows = transactions.map(tx => transactionRow(tx, txIncluded, base));
        transactionCount += rows.length;

        if (rows.length > 0) {
          orders.push(...rows);
        } else {
          // §8: a garment with no transaction still belongs in the queue.
          orders.push(listingOnlyRow(base));
        }

        // Inventory is per-garment, not per-booking: always exactly one row per
        // assigned listing, annotated with its most recent transaction's state
        // so the card grid can show a status badge (mockup 04.jpg).
        const latest = rows[0] || null;
        inventory.push({
          ...base,
          id: `listing:${base.listingId}`,
          ticketCode: latest?.ticketCode || null,
          state: latest?.state || null,
          cleaningPhase: latest?.cleaningPhase || null,
          transactionId: latest?.transactionId || null,
        });
      });

      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({
          data: {
            laundryId,
            orders,
            inventory,
            meta: {
              listingCount: inventory.length,
              transactionCount,
              truncated,
            },
          },
        })
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};
