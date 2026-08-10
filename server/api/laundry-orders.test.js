jest.mock('../api-util/sdk', () => ({
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../api-util/laundryAuth', () => ({
  requireLaundryCaller: jest.fn(),
}));

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { requireLaundryCaller } = require('../api-util/laundryAuth');
const { handleError } = require('../api-util/sdk');

const laundryOrders = require('./laundry-orders');
const { OPS_LAST_TRANSITIONS } = require('../api-util/coclosetBookingProcess');

const LAUNDRY_ID = 'laundry-1';
const OTHER_LAUNDRY_ID = 'laundry-2';

const mockRes = () => {
  const res = {
    statusCode: null,
    body: null,
    status: jest.fn(function(code) {
      this.statusCode = code;
      return this;
    }),
    set: jest.fn().mockReturnThis(),
    send: jest.fn(function(body) {
      this.body = body;
      return this;
    }),
    json: jest.fn(function(body) {
      this.body = body;
      return this;
    }),
    end: jest.fn().mockReturnThis(),
  };
  return res;
};

const listing = (id, overrides = {}) => ({
  id: { uuid: id },
  type: 'listing',
  attributes: {
    title: `Listing ${id}`,
    state: 'published',
    publicData: { brand: 'Galvan', size: 'FR 38' },
    privateData: { currentRack: 'Rack A-04' },
    metadata: { assignedLaundryId: LAUNDRY_ID, readinessStatus: 'stored' },
    ...overrides.attributes,
  },
  relationships: {
    author: { data: { id: { uuid: 'owner-1' }, type: 'user' } },
    images: { data: [{ id: { uuid: 'image-1' }, type: 'image' }] },
    ...overrides.relationships,
  },
});

const listingIncluded = [
  {
    id: { uuid: 'owner-1' },
    type: 'user',
    attributes: { profile: { displayName: 'Ana Rivera' } },
  },
  {
    id: { uuid: 'image-1' },
    type: 'image',
    attributes: { variants: { 'square-small': { url: 'https://example.com/small.jpg' } } },
  },
];

const transaction = (id, metadata = {}, lastTransition = 'transition/accept') => ({
  id: { uuid: id },
  type: 'transaction',
  attributes: {
    processName: 'cocloset-booking',
    lastTransition,
    metadata,
  },
  relationships: {
    customer: { data: { id: { uuid: 'customer-1' }, type: 'user' } },
    provider: { data: { id: { uuid: 'owner-1' }, type: 'user' } },
    booking: { data: { id: { uuid: 'booking-1' }, type: 'booking' } },
  },
});

const txIncluded = [
  {
    id: { uuid: 'customer-1' },
    type: 'user',
    attributes: { profile: { displayName: 'Jane Doe' } },
  },
  { id: { uuid: 'owner-1' }, type: 'user', attributes: { profile: { displayName: 'Ana Rivera' } } },
  {
    id: { uuid: 'booking-1' },
    type: 'booking',
    attributes: {
      start: new Date('2026-08-09T00:00:00.000Z'),
      end: new Date('2026-08-11T00:00:00.000Z'),
    },
  },
];

const setupSdk = ({ listingPages, transactionsByListing }) => {
  const listingsQuery = jest.fn(params => Promise.resolve(listingPages[(params.page || 1) - 1]));
  const transactionsQuery = jest.fn(params =>
    Promise.resolve(transactionsByListing[params.listingId] || { data: { data: [], included: [] } })
  );
  getIntegrationSdk.mockReturnValue({
    listings: { query: listingsQuery },
    transactions: { query: transactionsQuery },
  });
  return { listingsQuery, transactionsQuery };
};

const page = (data, included = [], meta = { totalPages: 1 }) => ({
  data: { data, included, meta },
});

describe('laundry-orders', () => {
  beforeEach(() => {
    // The shared jest config sets `resetMocks: true`, so implementations have
    // to be (re)installed per test, not just in the module factory.
    requireLaundryCaller.mockResolvedValue({ id: { uuid: LAUNDRY_ID } });
    handleError.mockImplementation((res, e) => {
      res.status(e.status || 500);
      res.json({ error: e.statusText || 'error' });
      res.end();
    });
  });

  it('rejects a caller that is not a laundry user', async () => {
    const error = new Error('Caller is not a laundry user.');
    error.status = 403;
    error.statusText = 'Caller is not a laundry user.';
    requireLaundryCaller.mockRejectedValue(error);
    getIntegrationSdk.mockReturnValue({
      listings: { query: jest.fn() },
      transactions: { query: jest.fn() },
    });

    const res = mockRes();
    await laundryOrders({}, res);
    await new Promise(setImmediate);

    expect(handleError).toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('only includes listings assigned to the calling laundry', async () => {
    const mine = listing('listing-mine');
    const theirs = listing('listing-theirs', {
      attributes: { metadata: { assignedLaundryId: OTHER_LAUNDRY_ID } },
    });
    setupSdk({
      listingPages: [page([mine, theirs], listingIncluded)],
      transactionsByListing: {},
    });

    const res = mockRes();
    await laundryOrders({}, res);
    await new Promise(setImmediate);

    expect(res.statusCode).toBe(200);
    const { orders, inventory } = res.body.data;
    expect(inventory).toHaveLength(1);
    expect(inventory[0].listingId).toBe('listing-mine');
    expect(orders).toHaveLength(1);
    expect(orders.every(o => o.listingId === 'listing-mine')).toBe(true);
  });

  it('builds a denormalized transaction row', async () => {
    const mine = listing('listing-mine');
    setupSdk({
      listingPages: [page([mine], listingIncluded)],
      transactionsByListing: {
        'listing-mine': {
          data: {
            data: [
              transaction(
                'tx-1',
                {
                  ticketCode: 'PIG-2032',
                  damageReported: { flag: true, note: 'Small pull at left cuff.' },
                },
                'transition/laundry-confirm-pickup'
              ),
            ],
            included: txIncluded,
          },
        },
      },
    });

    const res = mockRes();
    await laundryOrders({}, res);
    await new Promise(setImmediate);

    const row = res.body.data.orders[0];
    expect(row).toMatchObject({
      id: 'tx:tx-1',
      rowType: 'transaction',
      transactionId: 'tx-1',
      ticketCode: 'PIG-2032',
      title: 'Listing listing-mine',
      brand: 'Galvan',
      size: 'FR 38',
      imageUrl: 'https://example.com/small.jpg',
      customerName: 'Jane Doe',
      ownerName: 'Ana Rivera',
      state: 'picked-up',
      cleaningPhase: null,
      readinessStatus: 'stored',
      currentRack: 'Rack A-04',
      returnedLate: false,
      damageReported: { flag: true, note: 'Small pull at left cuff.' },
    });
    expect(row.bookingStart).toBe('2026-08-09T00:00:00.000Z');
    expect(row.bookingEnd).toBe('2026-08-11T00:00:00.000Z');
  });

  it('emits a listing-only row for an assigned garment with no transaction (design §8 union)', async () => {
    setupSdk({
      listingPages: [page([listing('listing-idle')], listingIncluded)],
      transactionsByListing: {},
    });

    const res = mockRes();
    await laundryOrders({}, res);
    await new Promise(setImmediate);

    const row = res.body.data.orders[0];
    expect(row).toMatchObject({
      id: 'listing:listing-idle',
      rowType: 'listing',
      transactionId: null,
      ticketCode: null,
      customerName: null,
      state: null,
      cleaningPhase: null,
      readinessStatus: 'stored',
      returnedLate: false,
      damageReported: null,
    });
    expect(res.body.data.meta.transactionCount).toBe(0);
  });

  it('returns exactly one inventory row per assigned listing, however many transactions it has', async () => {
    setupSdk({
      listingPages: [page([listing('listing-busy')], listingIncluded)],
      transactionsByListing: {
        'listing-busy': {
          data: {
            data: [
              transaction('tx-1', { ticketCode: 'A-1' }, 'transition/laundry-confirm-return'),
              transaction('tx-2', { ticketCode: 'A-2' }, 'transition/laundry-confirm-pickup'),
            ],
            included: txIncluded,
          },
        },
      },
    });

    const res = mockRes();
    await laundryOrders({}, res);
    await new Promise(setImmediate);

    const { orders, inventory, meta } = res.body.data;
    expect(orders).toHaveLength(2);
    expect(inventory).toHaveLength(1);
    expect(inventory[0].state).toBe('returned');
    expect(meta).toEqual({ listingCount: 1, transactionCount: 2, truncated: false });
  });

  it('follows listing pagination and queries transactions per listing', async () => {
    const { listingsQuery, transactionsQuery } = setupSdk({
      listingPages: [
        page([listing('l-1')], listingIncluded, { totalPages: 2 }),
        page([listing('l-2')], listingIncluded, { totalPages: 2 }),
      ],
      transactionsByListing: {},
    });

    const res = mockRes();
    await laundryOrders({}, res);
    await new Promise(setImmediate);

    expect(listingsQuery).toHaveBeenCalledTimes(2);
    // One query per assigned listing: `transactions.query` accepts a single
    // listingId UUID only (verified against the real API), so there is no
    // batched alternative.
    expect(transactionsQuery).toHaveBeenCalledTimes(2);
    expect(transactionsQuery.mock.calls.map(c => c[0].listingId).sort()).toEqual(['l-1', 'l-2']);
    expect(res.body.data.meta.listingCount).toBe(2);
    expect(res.body.data.meta.truncated).toBe(false);
  });

  it('passes meta_assignedLaundryId so the query filters server-side once a search schema exists', async () => {
    const { listingsQuery } = setupSdk({
      listingPages: [page([listing('l-1')], listingIncluded)],
      transactionsByListing: {},
    });

    const res = mockRes();
    await laundryOrders({}, res);
    await new Promise(setImmediate);

    // `meta_`, not `pub_` - the field moved scope, and so must the param. The
    // already-pushed schema on `pub_assignedLaundryId` is dead; see the runbook.
    expect(listingsQuery.mock.calls[0][0]).toMatchObject({ meta_assignedLaundryId: LAUNDRY_ID });
    expect(listingsQuery.mock.calls[0][0].pub_assignedLaundryId).toBeUndefined();
  });

  it('narrows the transaction query with the native lastTransitions filter', async () => {
    // Unlike the extended-data filters, this one really filters today (verified
    // against the real Dev API). It is what keeps inquiry-stage transactions off
    // the studio worklist.
    const { transactionsQuery } = setupSdk({
      listingPages: [page([listing('l-1')], listingIncluded)],
      transactionsByListing: {},
    });

    const res = mockRes();
    await laundryOrders({}, res);
    await new Promise(setImmediate);

    const { lastTransitions } = transactionsQuery.mock.calls[0][0];
    expect(lastTransitions).toEqual(OPS_LAST_TRANSITIONS);
    expect(lastTransitions).toContain('transition/accept');
    expect(lastTransitions).toContain('transition/laundry-confirm-return-late');
    // Everything before accept is noise on a studio worklist.
    expect(lastTransitions).not.toContain('transition/inquire');
  });

  describe('derived state', () => {
    const rowFor = async lastTransition => {
      setupSdk({
        listingPages: [page([listing('l-1')], listingIncluded)],
        transactionsByListing: {
          'l-1': {
            data: {
              data: [transaction('tx-1', {}, lastTransition)],
              included: txIncluded,
            },
          },
        },
      });
      const res = mockRes();
      await laundryOrders({}, res);
      await new Promise(setImmediate);
      return res.body.data.orders[0];
    };

    it.each([
      ['transition/accept', 'accepted'],
      ['transition/laundry-mark-ready', 'ready-for-pickup'],
      ['transition/laundry-confirm-pickup', 'picked-up'],
      ['transition/mark-overdue', 'overdue'],
      ['transition/laundry-confirm-return', 'returned'],
      ['transition/laundry-confirm-return-late', 'returned'],
      ['transition/laundry-mark-pending-cleaning', 'cleaning'],
      ['transition/laundry-start-cleaning', 'cleaning'],
      ['transition/laundry-start-quality-inspection', 'cleaning'],
      ['transition/laundry-mark-available', 'delivered'],
      ['transition/cancel-from-returned', 'canceled'],
    ])('derives state %s -> %s', async (lastTransition, expected) => {
      expect((await rowFor(lastTransition)).state).toBe(expected);
    });

    it('flags a garment that came back late, which its state no longer says', async () => {
      const late = await rowFor('transition/laundry-confirm-return-late');
      expect(late.state).toBe('returned');
      expect(late.returnedLate).toBe(true);

      const onTime = await rowFor('transition/laundry-confirm-return');
      expect(onTime.returnedLate).toBe(false);
    });

    it('surfaces the cleaning sub-phase from metadata', async () => {
      setupSdk({
        listingPages: [page([listing('l-1')], listingIncluded)],
        transactionsByListing: {
          'l-1': {
            data: {
              data: [
                transaction(
                  'tx-1',
                  { cleaningPhase: 'quality-inspection' },
                  'transition/laundry-start-quality-inspection'
                ),
              ],
              included: txIncluded,
            },
          },
        },
      });
      const res = mockRes();
      await laundryOrders({}, res);
      await new Promise(setImmediate);

      expect(res.body.data.orders[0]).toMatchObject({
        state: 'cleaning',
        cleaningPhase: 'quality-inspection',
      });
    });
  });
});
