import {
  ORDER_TABS,
  DASHBOARD_TILES,
  CLEANING_STATUSES,
  isSameDayAs,
  isWithinNextHours,
  isDamaged,
  isLate,
  isAwaitingPickup,
  filterByTab,
  filterByView,
  filterBySearch,
  dashboardCounts,
  incomingNext48h,
  needsAttention,
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
  laundryStatus: null,
  readinessStatus: null,
  damageReported: null,
  lateReturn: false,
  ...overrides,
});

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

    it('isLate reads the late-return flag', () => {
      expect(isLate(row({ lateReturn: true }))).toBe(true);
      expect(isLate(row())).toBe(false);
    });

    it('isAwaitingPickup covers both the transaction and the readiness side of the union', () => {
      expect(isAwaitingPickup(row({ laundryStatus: 'ready-for-pickup' }))).toBe(true);
      // Listing-only row: no transaction, readiness says it's in the studio.
      expect(isAwaitingPickup(row({ rowType: 'listing', readinessStatus: 'incoming' }))).toBe(true);
      expect(isAwaitingPickup(row({ rowType: 'listing', readinessStatus: 'stored' }))).toBe(true);
      expect(isAwaitingPickup(row({ rowType: 'listing', readinessStatus: 'available' }))).toBe(
        false
      );
      // A transaction that has moved on shouldn't be pulled back by its
      // listing's stale readiness value.
      expect(isAwaitingPickup(row({ laundryStatus: 'picked-up', readinessStatus: 'stored' }))).toBe(
        false
      );
    });
  });

  describe('filterByTab', () => {
    const rows = [
      row({ id: 'a', laundryStatus: 'ready-for-pickup' }),
      row({ id: 'b', laundryStatus: 'pending-cleaning' }),
      row({ id: 'c', laundryStatus: 'available-for-booking' }),
      row({ id: 'd', laundryStatus: 'picked-up', lateReturn: true }),
      row({ id: 'e', laundryStatus: 'returned', damageReported: { flag: true, note: 'n' } }),
      row({ id: 'f', bookingStart: '2026-07-31T09:00:00.000Z' }),
      row({ id: 'g', bookingEnd: '2026-07-31T18:00:00.000Z' }),
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
  });

  describe('filterByView', () => {
    const rows = [
      row({ id: 'a', laundryStatus: 'ready-for-pickup' }),
      row({ id: 'b', laundryStatus: 'picked-up' }),
      row({ id: 'c', laundryStatus: 'cleaning-in-progress' }),
      row({ id: 'd', laundryStatus: 'quality-inspection' }),
      row({ id: 'e', rowType: 'listing', readinessStatus: 'incoming' }),
    ];

    it('pickups shows garments at the studio waiting to go out', () => {
      expect(filterByView(rows, 'pickups').map(r => r.id)).toEqual(['a', 'e']);
    });

    it('returns shows garments currently out with the customer', () => {
      expect(filterByView(rows, 'returns').map(r => r.id)).toEqual(['b']);
    });

    it('cleaning shows every cleaning sub-phase', () => {
      expect(filterByView(rows, 'cleaning').map(r => r.id)).toEqual(['c', 'd']);
      expect(CLEANING_STATUSES).toContain('pending-cleaning');
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
      row({ id: 'a', laundryStatus: 'ready-for-pickup' }),
      row({ id: 'b', laundryStatus: 'picked-up' }),
      row({ id: 'c', laundryStatus: 'picked-up', lateReturn: true }),
      row({ id: 'd', laundryStatus: 'pending-cleaning' }),
      row({ id: 'e', laundryStatus: 'pending-cleaning' }),
      row({ id: 'f', laundryStatus: 'quality-inspection' }),
      row({ id: 'g', laundryStatus: 'returned', damageReported: { flag: true, note: 'n' } }),
      row({
        id: 'h',
        bookingStart: '2026-07-31T09:00:00.000Z',
        bookingEnd: '2026-07-31T18:00:00.000Z',
      }),
    ];

    it('produces a count for every declared tile', () => {
      const counts = dashboardCounts(rows, NOW);
      DASHBOARD_TILES.forEach(tile => {
        expect(typeof counts[tile]).toBe('number');
      });
    });

    it('counts each tile correctly', () => {
      expect(dashboardCounts(rows, NOW)).toEqual({
        readyForPickup: 1,
        pickupsToday: 1,
        returnsExpectedToday: 1,
        currentlyRented: 2,
        pendingCleaning: 2,
        qualityInspection: 1,
        lateReturns: 1,
        damaged: 1,
      });
    });

    it('counts date-driven tiles as zero when no row has a booking', () => {
      const undated = [row({ id: 'x', laundryStatus: 'picked-up' })];
      const counts = dashboardCounts(undated, NOW);
      expect(counts.pickupsToday).toBe(0);
      expect(counts.returnsExpectedToday).toBe(0);
    });
  });

  describe('dashboard panels', () => {
    it('incomingNext48h includes soon-to-start bookings and undated incoming garments', () => {
      const rows = [
        row({ id: 'soon', bookingStart: '2026-08-01T09:00:00.000Z' }),
        row({ id: 'later', bookingStart: '2026-08-20T09:00:00.000Z' }),
        row({ id: 'incoming', rowType: 'listing', readinessStatus: 'incoming' }),
      ];
      expect(incomingNext48h(rows, NOW).map(r => r.id)).toEqual(['soon', 'incoming']);
    });

    it('needsAttention surfaces damage reports', () => {
      const rows = [
        row({ id: 'ok' }),
        row({ id: 'bad', damageReported: { flag: true, note: 'Small pull at left cuff.' } }),
      ];
      expect(needsAttention(rows).map(r => r.id)).toEqual(['bad']);
    });
  });

  describe('sortRows', () => {
    it('puts earlier laundry phases first and statusless rows before them', () => {
      const rows = [
        row({ id: 'c', laundryStatus: 'available-for-booking' }),
        row({ id: 'a', laundryStatus: 'ready-for-pickup' }),
        row({ id: 'none', laundryStatus: null }),
        row({ id: 'b', laundryStatus: 'returned' }),
      ];
      expect(sortRows(rows).map(r => r.id)).toEqual(['none', 'a', 'b', 'c']);
    });

    it('does not mutate the input', () => {
      const rows = [
        row({ id: 'z', laundryStatus: 'returned' }),
        row({ id: 'y', laundryStatus: null }),
      ];
      const snapshot = rows.map(r => r.id);
      sortRows(rows);
      expect(rows.map(r => r.id)).toEqual(snapshot);
    });
  });
});
