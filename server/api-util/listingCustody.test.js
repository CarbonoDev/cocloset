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
  //   > "imagina que devuelven la prenda hoy 13, y la laundry ingresa que necesita 4 días
  //   >  de lavado, entonces la prenda debe estar disponible el 18, 4 días despues, no antes"
  //
  // The client's own arithmetic, and the case every test below is a variation of. Note the
  // shape: the RETURN day is not a wash day (the garment is being handed over on it), the n
  // wash days run from the day after, and the garment is bookable on the day after those.
  // Same +1 as the initial-cleaning floor in bookingRules, stated by the client in the same
  // form ("hoy es 12 ... un día de lavado (13) y el siguiente día disponible es 14").

  const MEXICO = 'America/Mexico_City';

  it('frees the garment the day after the wash days the studio asked for', () => {
    // Mid-morning on the 13th in Mexico City.
    const returnedAt = new Date('2026-08-13T16:00:00.000Z');
    const { readyAt, blockWindow } = computeReadiness({
      returnedAt,
      cleaningDays: 4,
      timeZone: MEXICO,
    });

    // 13th (handover) + 14th-17th (four wash days) blocked; bookable on the 18th.
    expect(blockWindow.start.toISOString()).toBe('2026-08-13T06:00:00.000Z');
    expect(blockWindow.end.toISOString()).toBe('2026-08-18T06:00:00.000Z');
    expect(readyAt.toISOString()).toBe('2026-08-18T06:00:00.000Z');
  });

  it('gives the same answer whatever time of day the operator pressed the button', () => {
    // THE BUG THIS PINS. The window used to be `returnedAt + n` floored/ceiled to whole UTC
    // days, so a studio in Mexico City (UTC-6) confirming a return in the EVENING stamped
    // the next UTC day: the block started on the 14th, the 13th stayed bookable, and the
    // far end ran a day long to compensate. The inputs are a wall clock and a day count a
    // human typed; neither means anything in UTC.
    const windows = [
      '2026-08-13T06:01:00.000Z', // 00:01 local
      '2026-08-13T16:00:00.000Z', // 10:00 local
      '2026-08-14T04:59:00.000Z', // 22:59 local, still the 13th in Mexico City
    ].map(iso =>
      computeReadiness({ returnedAt: new Date(iso), cleaningDays: 4, timeZone: MEXICO })
    );

    windows.forEach(({ blockWindow }) => {
      expect(blockWindow.start.toISOString()).toBe('2026-08-13T06:00:00.000Z');
      expect(blockWindow.end.toISOString()).toBe('2026-08-18T06:00:00.000Z');
    });
  });

  it('blocks two days for a one-day wash: the handover day and the wash day', () => {
    const returnedAt = new Date('2026-08-13T16:00:00.000Z');
    const { blockWindow } = computeReadiness({
      returnedAt,
      cleaningDays: 1,
      timeZone: MEXICO,
    });

    expect(blockWindow.start.toISOString()).toBe('2026-08-13T06:00:00.000Z');
    expect(blockWindow.end.toISOString()).toBe('2026-08-15T06:00:00.000Z');
  });

  it('falls back to UTC days when the listing has no time zone', () => {
    // An availability plan with no timezone is not something to guess about, and the
    // server's own TZ is an accident of deployment.
    const returnedAt = new Date('2026-08-13T14:37:00.000Z');
    const { blockWindow } = computeReadiness({ returnedAt, cleaningDays: 4 });

    expect(blockWindow.start.toISOString()).toBe('2026-08-13T00:00:00.000Z');
    expect(blockWindow.end.toISOString()).toBe('2026-08-18T00:00:00.000Z');
  });

  it('produces no window at all for 0 days', () => {
    // An empty range would throw in subtractBlockedRanges; "ready today" means there is
    // nothing to block, which is a different thing from a zero-length block.
    const returnedAt = new Date('2026-08-13T16:00:00.000Z');
    const { readyAt, blockWindow } = computeReadiness({
      returnedAt,
      cleaningDays: 0,
      timeZone: MEXICO,
    });

    expect(blockWindow).toBeNull();
    // Still the start of the return day, so the checkout gate reading this field refuses
    // nothing - "ready today" has to mean bookable today.
    expect(readyAt.toISOString()).toBe('2026-08-13T06:00:00.000Z');
  });

  it('crosses a DST boundary without losing or gaining a day', () => {
    // Europe/Madrid springs forward on 2026-03-29, so 02:00 does not exist that night. A
    // three-day window across it is still three days.
    const returnedAt = new Date('2026-03-28T22:30:00.000Z'); // 23:30 local on the 28th
    const { blockWindow } = computeReadiness({
      returnedAt,
      cleaningDays: 2,
      timeZone: 'Europe/Madrid',
    });

    expect(blockWindow.start.toISOString()).toBe('2026-03-27T23:00:00.000Z'); // 28th, 00:00 CET
    expect(blockWindow.end.toISOString()).toBe('2026-03-30T22:00:00.000Z'); // 31st, 00:00 CEST
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
