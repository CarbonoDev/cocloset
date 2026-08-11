const {
  MAX_CLEANING_DAYS,
  validateCleaningDays,
  resolveCleaningDays,
  computeReadiness,
  findActiveTransactions,
  assertNoActiveTransaction,
  writeCustodyMetadata,
} = require('./listingCustody');

const { ACTIVE_LAST_TRANSITIONS } = require('./coclosetBookingProcess');

const LISTING_ID = { uuid: 'listing-1' };

const txEntity = lastTransition => ({
  id: { uuid: `tx-${lastTransition}` },
  type: 'transaction',
  attributes: { lastTransition },
});

const sdkWithTransactions = transactions => {
  const query = jest.fn(() => Promise.resolve({ data: { data: transactions } }));
  return { sdk: { transactions: { query } }, query };
};

describe('validateCleaningDays', () => {
  it('treats an omitted value as "use the configured default"', () => {
    expect(validateCleaningDays(undefined)).toEqual({ valid: true, provided: false, value: null });
    expect(validateCleaningDays(null)).toEqual({ valid: true, provided: false, value: null });
  });

  it('accepts 0 - a laundry may say the garment is ready today', () => {
    expect(validateCleaningDays(0)).toEqual({ valid: true, provided: true, value: 0 });
  });

  it('accepts an integer inside the cap', () => {
    expect(validateCleaningDays(3)).toEqual({ valid: true, provided: true, value: 3 });
    expect(validateCleaningDays(MAX_CLEANING_DAYS)).toMatchObject({ valid: true, value: 365 });
  });

  // Each of these would otherwise be coerced into something plausible and block
  // a calendar on it.
  it.each([
    ['a negative day count', -1],
    ['a fractional day count', 1.5],
    ['past the cap', MAX_CLEANING_DAYS + 1],
    ['a numeric string', '3'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a boolean', true],
    ['an object', { days: 3 }],
  ])('rejects %s', (_label, input) => {
    expect(validateCleaningDays(input)).toMatchObject({ valid: false, provided: true });
  });
});

describe('resolveCleaningDays', () => {
  it("prefers the laundry's own number", () => {
    expect(resolveCleaningDays({ requestedDays: 5, turnaroundDays: 2 })).toEqual({
      days: 5,
      source: 'laundry',
    });
  });

  it('keeps an explicit 0 rather than falling through to the default', () => {
    // The bug this pins: `requestedDays || default` would silently turn "ready
    // today" into a two-day block.
    expect(resolveCleaningDays({ requestedDays: 0, turnaroundDays: 2 })).toEqual({
      days: 0,
      source: 'laundry',
    });
  });

  it('falls back to the configured turnaround, which is already in days', () => {
    expect(resolveCleaningDays({ requestedDays: null, turnaroundDays: 2 })).toEqual({
      days: 2,
      source: 'configured-turnaround',
    });
    expect(resolveCleaningDays({ requestedDays: null, turnaroundDays: 3 })).toEqual({
      days: 3,
      source: 'configured-turnaround',
    });
    // A fraction can still arrive from an env var or a hand-written profile, and is
    // rounded UP: a day and a half of work blocked as one day would offer the garment
    // while it is still in a machine.
    expect(resolveCleaningDays({ requestedDays: null, turnaroundDays: 1.5 })).toEqual({
      days: 2,
      source: 'configured-turnaround',
    });
  });
});

describe('computeReadiness', () => {
  it('puts readyAt exactly n days after the return, to the minute', () => {
    const returnedAt = new Date('2026-08-08T14:37:00.000Z');
    const { readyAt } = computeReadiness({ returnedAt, cleaningDays: 3 });
    expect(readyAt.toISOString()).toBe('2026-08-11T14:37:00.000Z');
  });

  it('blocks whole UTC days, starting with the day the garment came back', () => {
    const returnedAt = new Date('2026-08-08T14:37:00.000Z');
    const { blockWindow } = computeReadiness({ returnedAt, cleaningDays: 3 });
    // The 8th is blocked in full even though the garment arrived mid-afternoon,
    // and the 11th stays blocked because it is not ready until 14:37 that day.
    expect(blockWindow.start.toISOString()).toBe('2026-08-08T00:00:00.000Z');
    expect(blockWindow.end.toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });

  it('does not round the end up when readiness lands exactly on midnight', () => {
    const returnedAt = new Date('2026-08-08T00:00:00.000Z');
    const { blockWindow } = computeReadiness({ returnedAt, cleaningDays: 2 });
    expect(blockWindow.start.toISOString()).toBe('2026-08-08T00:00:00.000Z');
    expect(blockWindow.end.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  it('produces no window at all for 0 days', () => {
    // An empty range would throw in subtractBlockedRanges; "ready today" means
    // there is nothing to block, which is a different thing from a zero-length
    // block.
    const returnedAt = new Date('2026-08-08T14:37:00.000Z');
    const { readyAt, blockWindow } = computeReadiness({ returnedAt, cleaningDays: 0 });
    expect(blockWindow).toBeNull();
    expect(readyAt.toISOString()).toBe('2026-08-08T14:37:00.000Z');
  });

  it('crosses a DST boundary without shifting by an hour', () => {
    // Europe/Madrid loses an hour on 2026-03-29. UTC day arithmetic must not care.
    const returnedAt = new Date('2026-03-28T23:30:00.000Z');
    const { readyAt } = computeReadiness({ returnedAt, cleaningDays: 2 });
    expect(readyAt.toISOString()).toBe('2026-03-30T23:30:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// The active-transaction check. This is the authorization-adjacent half of the
// custody feature: every mistake it can make is a mistake that looks like
// success, so the tests below are mostly about the denial direction.
// ---------------------------------------------------------------------------

describe('findActiveTransactions', () => {
  it('narrows the query with the derived ACTIVE_LAST_TRANSITIONS filter', async () => {
    const { sdk, query } = sdkWithTransactions([]);
    await findActiveTransactions({ integrationSdk: sdk, listingId: LISTING_ID });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: 'listing-1',
        lastTransitions: ACTIVE_LAST_TRANSITIONS,
      })
    );
  });

  it('passes listingId as a single uuid string, which is all the API accepts', async () => {
    const { sdk, query } = sdkWithTransactions([]);
    await findActiveTransactions({ integrationSdk: sdk, listingId: LISTING_ID });
    expect(typeof query.mock.calls[0][0].listingId).toBe('string');
  });

  it('reports no active transaction for an empty result', async () => {
    const { sdk } = sdkWithTransactions([]);
    await expect(
      findActiveTransactions({ integrationSdk: sdk, listingId: LISTING_ID })
    ).resolves.toEqual({ active: false, states: [], unknown: false });
  });

  it('reports the active states it found', async () => {
    const { sdk } = sdkWithTransactions([txEntity('transition/laundry-confirm-pickup')]);
    await expect(
      findActiveTransactions({ integrationSdk: sdk, listingId: LISTING_ID })
    ).resolves.toEqual({ active: true, states: ['picked-up'], unknown: false });
  });

  it('FAILS CLOSED when the query rejects', async () => {
    // The dangerous direction. An Integration API hiccup must not read as
    // permission to reassign a garment that is out on rental.
    const sdk = { transactions: { query: jest.fn(() => Promise.reject(new Error('502'))) } };
    await expect(
      findActiveTransactions({ integrationSdk: sdk, listingId: LISTING_ID })
    ).resolves.toEqual({ active: true, states: [], unknown: true });
  });
});

describe('assertNoActiveTransaction', () => {
  it('resolves when the listing is free', async () => {
    const { sdk } = sdkWithTransactions([]);
    await expect(
      assertNoActiveTransaction({ integrationSdk: sdk, listingId: LISTING_ID })
    ).resolves.toBeUndefined();
  });

  // One case per active state, spelled out rather than looped over
  // ACTIVE_LAST_TRANSITIONS, so that a state accidentally dropped from the
  // definition fails here by name.
  it.each([
    ['accepted', 'transition/accept'],
    ['accepted (operator)', 'transition/operator-accept'],
    ['ready-for-pickup', 'transition/laundry-mark-ready'],
    ['picked-up', 'transition/laundry-confirm-pickup'],
    ['overdue', 'transition/mark-overdue'],
    ['returned', 'transition/laundry-confirm-return'],
    ['returned (late)', 'transition/laundry-confirm-return-late'],
    ['cleaning', 'transition/laundry-mark-pending-cleaning'],
    ['cleaning (in progress)', 'transition/laundry-start-cleaning'],
    ['cleaning (inspection)', 'transition/laundry-start-quality-inspection'],
  ])('refuses with 409 while a transaction is %s', async (_label, lastTransition) => {
    const { sdk } = sdkWithTransactions([txEntity(lastTransition)]);
    await expect(
      assertNoActiveTransaction({ integrationSdk: sdk, listingId: LISTING_ID })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses with 409 when it could not tell', async () => {
    const sdk = { transactions: { query: jest.fn(() => Promise.reject(new Error('502'))) } };
    await expect(
      assertNoActiveTransaction({ integrationSdk: sdk, listingId: LISTING_ID })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('says so in the message when it could not tell, rather than blaming a booking', async () => {
    const sdk = { transactions: { query: jest.fn(() => Promise.reject(new Error('502'))) } };
    await expect(
      assertNoActiveTransaction({ integrationSdk: sdk, listingId: LISTING_ID })
    ).rejects.toThrow(/could not verify/i);
  });
});

describe('writeCustodyMetadata', () => {
  const sdkWithListings = () => {
    const update = jest.fn(() => Promise.resolve({ data: { data: {} } }));
    return { sdk: { listings: { update } }, update };
  };

  it('writes only metadata, so no other extended data is disturbed', async () => {
    const { sdk, update } = sdkWithListings();
    await writeCustodyMetadata({ integrationSdk: sdk, listingId: LISTING_ID, onLaundry: true });

    expect(update).toHaveBeenCalledWith(
      { id: LISTING_ID, metadata: { onLaundry: true } },
      { expand: true }
    );
  });

  it('omits readyAt when it was not supplied', async () => {
    // A plain handover must not clear a readiness moment it knows nothing about.
    const { sdk, update } = sdkWithListings();
    await writeCustodyMetadata({ integrationSdk: sdk, listingId: LISTING_ID, onLaundry: false });
    expect(update.mock.calls[0][0].metadata).toEqual({ onLaundry: false });
  });

  it('stores readyAt as an ISO string', async () => {
    const { sdk, update } = sdkWithListings();
    await writeCustodyMetadata({
      integrationSdk: sdk,
      listingId: LISTING_ID,
      onLaundry: true,
      readyAt: new Date('2026-08-11T14:37:00.000Z'),
    });
    expect(update.mock.calls[0][0].metadata).toEqual({
      onLaundry: true,
      readyAt: '2026-08-11T14:37:00.000Z',
    });
  });
});
