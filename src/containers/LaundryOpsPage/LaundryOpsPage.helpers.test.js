import {
  ORDER_TABS,
  DASHBOARD_TILES,
  CLEANING_STATUSES,
  isSameDayAs,
  isWithinNextHours,
  isDamaged,
  isDeliverToday,
  isLate,
  isAwaitingPickup,
  filterByTab,
  filterByView,
  filterBySearch,
  dashboardCounts,
  sortRows,
} from './LaundryOpsPage.helpers';

const NOW = new Date('2026-07-31T12:00:00.000Z');

const row = (overrides = {}) => ({
  id: overrides.id || 'tx:1',
  rowType: 'transaction',
  transactionId: '1',
  ticketCode: 'PIG-2032',
  title: 'Draped jersey gown, crimson',
  brand: 'Norma Kamali',
  size: 'S / UK 8',
  customerName: 'Jane Doe',
  ownerName: 'Ana Rivera',
  currentRack: 'Rack B-03',
  bookingStart: null,
  bookingEnd: null,
  state: null,
  cleaningPhase: null,
  readinessStatus: null,
  damageReported: null,
  returnedLate: false,
  ...overrides,
});

// A row in one of the three cleaning sub-phases: they all share the
// `cleaning` state and differ only by `cleaningPhase`.
const cleaningRow = (cleaningPhase, overrides = {}) =>
  row({ state: 'cleaning', cleaningPhase, ...overrides });

describe('LaundryOpsPage.helpers', () => {
  describe('date predicates', () => {
    it('isSameDayAs matches the same calendar day', () => {
      expect(isSameDayAs('2026-07-31T23:00:00.000Z', NOW)).toBe(true);
      expect(isSameDayAs('2026-08-01T12:00:00.000Z', NOW)).toBe(false);
    });

    it('isSameDayAs is false for missing or unparseable dates', () => {
      expect(isSameDayAs(null, NOW)).toBe(false);
      expect(isSameDayAs(undefined, NOW)).toBe(false);
      expect(isSameDayAs('not-a-date', NOW)).toBe(false);
    });

    it('isWithinNextHours covers the forward window only', () => {
      expect(isWithinNextHours('2026-08-01T12:00:00.000Z', NOW, 48)).toBe(true);
      expect(isWithinNextHours('2026-08-03T12:00:00.000Z', NOW, 48)).toBe(false);
      // Already in the past.
      expect(isWithinNextHours('2026-07-30T12:00:00.000Z', NOW, 48)).toBe(false);
      expect(isWithinNextHours(null, NOW, 48)).toBe(false);
    });
  });

  describe('row predicates', () => {
    it('isDamaged reads the damage flag', () => {
      expect(isDamaged(row({ damageReported: { flag: true, note: 'x' } }))).toBe(true);
      expect(isDamaged(row({ damageReported: { flag: false, note: '' } }))).toBe(false);
      expect(isDamaged(row())).toBe(false);
    });

    it('isLate reads the overdue state, not a metadata flag', () => {
      expect(isLate(row({ state: 'overdue' }))).toBe(true);
      expect(isLate(row({ state: 'picked-up' }))).toBe(false);
      expect(isLate(row())).toBe(false);
    });

    it('isLate keeps flagging a garment that already came back late', () => {
      // It leaves `overdue` for `returned` the moment it is scanned in; an
      // ops screen that stopped flagging it there would hide the problem.
      expect(isLate(row({ state: 'returned', returnedLate: true }))).toBe(true);
      expect(isLate(row({ state: 'returned' }))).toBe(false);
    });

    // Same-day rentals: a garment already at its studio with its cleaning finished can now be
    // booked for collection TODAY (see canBeCollectedToday in util/cleaningFloor.js), so this
    // row can appear at any hour and is the one an operator has to act on first.
    it('isDeliverToday flags a rental that starts today and has not gone out', () => {
      expect(isDeliverToday(row({ bookingStart: NOW.toISOString(), state: 'accepted' }), NOW)).toBe(
        true
      );
      expect(
        isDeliverToday(row({ bookingStart: NOW.toISOString(), state: 'ready-for-pickup' }), NOW)
      ).toBe(true);
      // Booked today, still in its first-time wash - it is due out today all the same, and the
      // studio is the one that has to finish that wash to make it happen.
      expect(
        isDeliverToday(row({ bookingStart: NOW.toISOString(), state: 'initial-cleaning' }), NOW)
      ).toBe(true);
    });

    it('isDeliverToday stops once the garment is with the renter', () => {
      // "Deliver today" on an order handed over this morning is an instruction to do something
      // already done.
      ['picked-up', 'overdue', 'returned', 'cleaning', 'delivered'].forEach(state => {
        expect(isDeliverToday(row({ bookingStart: NOW.toISOString(), state }), NOW)).toBe(false);
      });
    });

    it('isDeliverToday ignores rentals that start on another day, and rows with no booking', () => {
      // A day clear of NOW in the test runner's own zone: `isSameDayAs` compares LOCAL
      // calendar days (the operator's, which is the right one for a studio's day sheet), so a
      // midnight-UTC timestamp the day after NOW is still NOW's day in any western zone.
      expect(
        isDeliverToday(row({ bookingStart: '2026-08-02T12:00:00.000Z', state: 'accepted' }), NOW)
      ).toBe(false);
      expect(isDeliverToday(row({ rowType: 'listing', readinessStatus: 'stored' }), NOW)).toBe(
        false
      );
      expect(isDeliverToday(undefined, NOW)).toBe(false);
    });

    it('isAwaitingPickup covers both the transaction and the readiness side of the union', () => {
      expect(isAwaitingPickup(row({ state: 'ready-for-pickup' }))).toBe(true);
      // Listing-only row: no transaction, readiness says it's in the studio.
      expect(isAwaitingPickup(row({ rowType: 'listing', readinessStatus: 'incoming' }))).toBe(true);
      expect(isAwaitingPickup(row({ rowType: 'listing', readinessStatus: 'stored' }))).toBe(true);
      expect(isAwaitingPickup(row({ rowType: 'listing', readinessStatus: 'available' }))).toBe(
        false
      );
      // A transaction that has moved on shouldn't be pulled back by its
      // listing's stale readiness value.
      expect(isAwaitingPickup(row({ state: 'picked-up', readinessStatus: 'stored' }))).toBe(false);
    });
  });

  describe('filterByTab', () => {
    const rows = [
      row({ id: 'a', state: 'ready-for-pickup' }),
      cleaningRow('pending-cleaning', { id: 'b' }),
      row({ id: 'c', state: 'delivered' }),
      row({ id: 'd', state: 'overdue' }),
      row({ id: 'e', state: 'returned', damageReported: { flag: true, note: 'n' } }),
      row({ id: 'f', bookingStart: '2026-07-31T09:00:00.000Z', state: 'accepted' }),
      row({ id: 'g', bookingEnd: '2026-07-31T18:00:00.000Z', state: 'picked-up' }),
    ];

    it('has a filter for every declared tab', () => {
      ORDER_TABS.forEach(tab => {
        expect(Array.isArray(filterByTab(rows, tab, NOW))).toBe(true);
      });
    });

    it('all returns everything', () => {
      expect(filterByTab(rows, 'all', NOW)).toHaveLength(rows.length);
    });

    it.each([
      ['ready-for-pickup', ['a']],
      ['pending-cleaning', ['b']],
      ['completed', ['c']],
      ['late-returns', ['d']],
      ['damaged', ['e']],
      ['pickup-today', ['f']],
      ['returns-today', ['g']],
    ])('%s selects the right rows', (tab, expectedIds) => {
      expect(filterByTab(rows, tab, NOW).map(r => r.id)).toEqual(expectedIds);
    });

    // Bug (Jonathan, 2026-09-30): "Returns today" matched on `bookingEnd` alone, so a
    // booking ending today that the renter hasn't even collected yet ('ready-for-pickup')
    // showed up as due back today.
    it('returns-today excludes a booking ending today that has not even gone out yet', () => {
      const notYetPickedUp = row({
        id: 'not-out-yet',
        bookingEnd: '2026-07-31T18:00:00.000Z',
        state: 'ready-for-pickup',
      });
      expect(filterByTab([notYetPickedUp], 'returns-today', NOW)).toHaveLength(0);
    });

    it('returns-today still includes an overdue booking whose end date was today', () => {
      const overdueToday = row({
        id: 'overdue-today',
        bookingEnd: '2026-07-31T18:00:00.000Z',
        state: 'overdue',
      });
      expect(filterByTab([overdueToday], 'returns-today', NOW).map(r => r.id)).toEqual([
        'overdue-today',
      ]);
    });

    // Same class of bug, the other end of the rental: a booking starting today that
    // already went out (or hasn't reached the studio) isn't "deliver today" any more/yet.
    it('pickup-today excludes a booking starting today that has already gone out', () => {
      const alreadyOut = row({
        id: 'already-out',
        bookingStart: '2026-07-31T09:00:00.000Z',
        state: 'picked-up',
      });
      expect(filterByTab([alreadyOut], 'pickup-today', NOW)).toHaveLength(0);
    });
  });

  describe('filterByView', () => {
    const rows = [
      row({ id: 'a', state: 'ready-for-pickup' }),
      row({ id: 'b', state: 'picked-up' }),
      cleaningRow('cleaning-in-progress', { id: 'c' }),
      cleaningRow('quality-inspection', { id: 'd' }),
      row({ id: 'e', rowType: 'listing', readinessStatus: 'incoming' }),
    ];

    it('pickups shows garments at the studio waiting to go out', () => {
      expect(filterByView(rows, 'pickups').map(r => r.id)).toEqual(['a', 'e']);
    });

    // Bug (Jonathan, 2026-09-30): the Dashboard's "Pending pickups (next 48h)" tile counts
    // upcoming bookings that haven't reached ready-for-pickup yet (dashboardCounts,
    // isWithinNextHours(bookingStart, 48)); this screen - what that card drills into -
    // never showed them, so clicking the card landed on fewer rows than it promised.
    it('pickups ALSO shows a booking starting within 48h that has not reached ready-for-pickup yet', () => {
      const startingSoon = row({
        id: 'starting-soon',
        state: 'accepted',
        bookingStart: '2026-08-02T00:00:00.000Z',
      });
      expect(filterByView([startingSoon], 'pickups', NOW).map(r => r.id)).toEqual([
        'starting-soon',
      ]);
    });

    it('pickups does not reach past the 48h window', () => {
      const startingLater = row({
        id: 'starting-later',
        state: 'accepted',
        bookingStart: '2026-08-05T00:00:00.000Z',
      });
      expect(filterByView([startingLater], 'pickups', NOW)).toHaveLength(0);
    });

    it("pickups doesn't double-count a booking already ready-for-pickup, even if its start is 48h out", () => {
      // Not a real scenario (ready-for-pickup implies the start date matters less), but
      // guards the OR from ever producing a row twice.
      const readySoon = row({
        id: 'ready-soon',
        state: 'ready-for-pickup',
        bookingStart: '2026-08-02T00:00:00.000Z',
      });
      expect(filterByView([readySoon], 'pickups', NOW).map(r => r.id)).toEqual(['ready-soon']);
    });

    it('returns shows garments currently out with the customer, late or not', () => {
      expect(filterByView(rows, 'returns').map(r => r.id)).toEqual(['b']);
      expect(
        filterByView([row({ id: 'late', state: 'overdue' })], 'returns').map(r => r.id)
      ).toEqual(['late']);
    });

    it('cleaning shows every cleaning sub-phase', () => {
      expect(filterByView(rows, 'cleaning').map(r => r.id)).toEqual(['c', 'd']);
      expect(CLEANING_STATUSES).toContain('pending-cleaning');
      // 'returned' feeds the cleaning queue too (design §9).
      expect(
        filterByView([row({ id: 'r', state: 'returned' })], 'cleaning').map(r => r.id)
      ).toEqual(['r']);
    });

    it('cleaning also shows a garment on its first-ever wash', () => {
      // A first-time drop-off's status badge already said "In cleaning"
      // (2026-09-21); the Cleaning screen itself didn't agree (Jonathan,
      // 2026-09-29).
      expect(
        filterByView([row({ id: 'first-wash', state: 'initial-cleaning' })], 'cleaning').map(
          r => r.id
        )
      ).toEqual(['first-wash']);
    });

    it('all is a pass-through', () => {
      expect(filterByView(rows, 'all')).toHaveLength(rows.length);
    });
  });

  describe('filterBySearch', () => {
    const rows = [
      row({ id: 'a', ticketCode: 'PIG-2032', customerName: 'Jane Doe', title: 'Silk slip dress' }),
      row({ id: 'b', ticketCode: 'MAR-1188', customerName: 'Tom Brady', title: 'Wool trench' }),
    ];

    it('matches ticket, customer and garment, case-insensitively', () => {
      expect(filterBySearch(rows, 'mar-11').map(r => r.id)).toEqual(['b']);
      expect(filterBySearch(rows, 'jane').map(r => r.id)).toEqual(['a']);
      expect(filterBySearch(rows, 'TRENCH').map(r => r.id)).toEqual(['b']);
    });

    it('returns everything for an empty query', () => {
      expect(filterBySearch(rows, '')).toHaveLength(2);
      expect(filterBySearch(rows, '   ')).toHaveLength(2);
    });
  });

  describe('dashboardCounts', () => {
    const rows = [
      row({ id: 'a', state: 'ready-for-pickup' }),
      row({ id: 'b', state: 'picked-up' }),
      // Overdue still counts as rented - the garment is out with the customer.
      row({ id: 'c', state: 'overdue' }),
      cleaningRow('pending-cleaning', { id: 'd' }),
      cleaningRow('pending-cleaning', { id: 'e' }),
      cleaningRow('quality-inspection', { id: 'f' }),
      row({ id: 'g', state: 'returned', damageReported: { flag: true, note: 'n' } }),
      row({
        id: 'h',
        bookingStart: '2026-07-31T09:00:00.000Z',
        bookingEnd: '2026-07-31T18:00:00.000Z',
      }),
    ];

    it('produces a count for every declared tile', () => {
      const counts = dashboardCounts(rows, [], NOW);
      DASHBOARD_TILES.forEach(tile => {
        expect(typeof counts[tile]).toBe('number');
      });
    });

    it('counts each tile correctly', () => {
      expect(dashboardCounts(rows, [{ id: 'inv-1' }, { id: 'inv-2' }], NOW)).toEqual({
        pendingPickups48h: 1,
        rentalOrders: 8,
        outWithRenters: 2,
        inCleaning: 2,
        pendingDropOffs48h: 1,
        rentalInventory: 2,
        flaggedForReview: 1,
      });
    });

    it('counts a garment already ready for pickup even without a booking in the next 48h', () => {
      expect(dashboardCounts(rows, [], NOW).pendingPickups48h).toBe(1);
    });

    it('counts a lender bringing a garment in as a drop-off too', () => {
      //   > "el que era returns expected today, puedes integrar Lender or Renter
      //   >  drop offs?" (Jonathan, 2026-09-03)
      //
      // Two different people walk in with a garment. The tile counted only the
      // renter's return, so a studio expecting three garments today saw one.
      const withIncoming = [
        ...rows,
        { id: 'incoming-1', readinessStatus: 'incoming' },
        { id: 'incoming-2', readinessStatus: 'incoming' },
      ];

      expect(dashboardCounts(withIncoming, [], NOW).pendingDropOffs48h).toBe(3);
    });

    it('does not count a garment the studio already has as an incoming drop-off', () => {
      // `stored` and `available` are garments already on the rack. Only
      // `incoming` is someone still to walk through the door.
      const stored = [{ id: 's', readinessStatus: 'stored' }];

      expect(dashboardCounts(stored, [], NOW).pendingDropOffs48h).toBe(0);
    });

    it('counts date-driven tiles as zero when no row has a booking', () => {
      const undated = [row({ id: 'x', state: 'picked-up' })];
      const counts = dashboardCounts(undated, [], NOW);
      expect(counts.pendingPickups48h).toBe(0);
      expect(counts.pendingDropOffs48h).toBe(0);
    });
  });

  describe('sortRows', () => {
    it('puts earlier laundry phases first and statusless rows before them', () => {
      const rows = [
        row({ id: 'c', state: 'delivered' }),
        row({ id: 'a', state: 'ready-for-pickup' }),
        row({ id: 'none', state: null }),
        row({ id: 'b', state: 'returned' }),
      ];
      expect(sortRows(rows).map(r => r.id)).toEqual(['none', 'a', 'b', 'c']);
    });

    it('does not mutate the input', () => {
      const rows = [row({ id: 'z', state: 'returned' }), row({ id: 'y', state: null })];
      const snapshot = rows.map(r => r.id);
      sortRows(rows);
      expect(rows.map(r => r.id)).toEqual(snapshot);
    });
  });
});
