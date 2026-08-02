import { LAUNDRY_STATUSES } from '../../util/laundryStatuses';

// Pure row-filtering / counting logic shared by every laundry ops screen.
// Kept out of the components so the filter definitions have exactly one home
// (the Pickups/Returns/Cleaning screens are filtered variants of the Orders
// table, not copies of it) and can be unit tested without rendering.

// ================ Tabs ================ //

// Filter tabs on the Orders screen (mockup 08.jpg), in the order shown there.
export const ORDER_TABS = [
  'all',
  'pickup-today',
  'returns-today',
  'pending-cleaning',
  'ready-for-pickup',
  'late-returns',
  'damaged',
  'completed',
];

// The named screens in the sidebar that render the orders table. Each is just
// a preset filter over the same rows (mockups 05/06/07.jpg).
export const ORDERS_VIEWS = {
  orders: 'all',
  pickups: 'pickups',
  returns: 'returns',
  cleaning: 'cleaning',
};

// ================ Dates ================ //

const startOfDay = date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Is `isoString` on the same calendar day as `now`?
 * Returns false for null/undefined/unparseable values, so rows without a
 * booking simply never match a date-based filter.
 */
export const isSameDayAs = (isoString, now) => {
  if (!isoString) {
    return false;
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return startOfDay(date).getTime() === startOfDay(now).getTime();
};

/**
 * Is `isoString` within the next `hours` from `now` (inclusive of now)?
 */
export const isWithinNextHours = (isoString, now, hours) => {
  if (!isoString) {
    return false;
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const diff = date.getTime() - now.getTime();
  return diff >= 0 && diff <= hours * 60 * 60 * 1000;
};

// ================ Row predicates ================ //

export const isDamaged = row => row?.damageReported?.flag === true;

export const isLate = row => row?.lateReturn === true;

// The three cleaning sub-phases plus the 'returned' hand-off that feeds them
// (design doc §9: all of these map to the single customer-facing "Cleaning"
// step, and mockup 05.jpg shows all three on the Cleaning screen).
export const CLEANING_STATUSES = [
  'returned',
  'pending-cleaning',
  'cleaning-in-progress',
  'quality-inspection',
];

// A garment is "at the studio waiting to go out" either because its
// transaction says so, or - for a garment with no transaction at all - because
// its listing readiness says so (design doc §8's union).
export const isAwaitingPickup = row =>
  row?.laundryStatus === 'ready-for-pickup' ||
  (!row?.laundryStatus && ['incoming', 'stored'].includes(row?.readinessStatus));

/**
 * Filter rows for one of the Orders filter tabs.
 *
 * @param {Array} rows - rows from the /api/laundry-orders response
 * @param {string} tab - one of ORDER_TABS
 * @param {Date} now - injected so tests aren't clock-dependent
 */
export const filterByTab = (rows, tab, now = new Date()) => {
  switch (tab) {
    case 'pickup-today':
      return rows.filter(r => isSameDayAs(r.bookingStart, now));
    case 'returns-today':
      return rows.filter(r => isSameDayAs(r.bookingEnd, now));
    case 'pending-cleaning':
      return rows.filter(r => r.laundryStatus === 'pending-cleaning');
    case 'ready-for-pickup':
      return rows.filter(r => r.laundryStatus === 'ready-for-pickup');
    case 'late-returns':
      return rows.filter(isLate);
    case 'damaged':
      return rows.filter(isDamaged);
    case 'completed':
      return rows.filter(r => r.laundryStatus === 'available-for-booking');
    case 'all':
    default:
      return rows;
  }
};

/**
 * Filter rows for one of the named sidebar screens.
 *
 * @param {Array} rows
 * @param {string} view - a value of ORDERS_VIEWS
 */
export const filterByView = (rows, view) => {
  switch (view) {
    case 'pickups':
      return rows.filter(isAwaitingPickup);
    case 'returns':
      return rows.filter(r => r.laundryStatus === 'picked-up');
    case 'cleaning':
      return rows.filter(r => CLEANING_STATUSES.includes(r.laundryStatus));
    case 'all':
    default:
      return rows;
  }
};

/**
 * Free-text search over the fields the mockup's search box names
 * ("Ticket, customer, garment...").
 */
export const filterBySearch = (rows, query) => {
  const q = (query || '').trim().toLowerCase();
  if (!q) {
    return rows;
  }
  return rows.filter(r =>
    [r.ticketCode, r.customerName, r.ownerName, r.title, r.brand, r.currentRack]
      .filter(Boolean)
      .some(field => field.toLowerCase().includes(q))
  );
};

// ================ Dashboard ================ //

// Stat tiles on the Dashboard (mockup 09.jpg), in the order shown there.
export const DASHBOARD_TILES = [
  'readyForPickup',
  'pickupsToday',
  'returnsExpectedToday',
  'currentlyRented',
  'pendingCleaning',
  'qualityInspection',
  'lateReturns',
  'damaged',
];

/**
 * Counts for the dashboard stat tiles.
 *
 * NOTE on the two date-driven tiles (`pickupsToday`, `returnsExpectedToday`):
 * they read `bookingStart`/`bookingEnd`, which only exist once a transaction
 * has a real Sharetribe booking. Inquiry-stage rows have none and are counted
 * as zero rather than guessed at.
 *
 * @param {Array} rows
 * @param {Date} now
 */
export const dashboardCounts = (rows, now = new Date()) => ({
  readyForPickup: rows.filter(r => r.laundryStatus === 'ready-for-pickup').length,
  pickupsToday: rows.filter(r => isSameDayAs(r.bookingStart, now)).length,
  returnsExpectedToday: rows.filter(r => isSameDayAs(r.bookingEnd, now)).length,
  currentlyRented: rows.filter(r => r.laundryStatus === 'picked-up').length,
  pendingCleaning: rows.filter(r => r.laundryStatus === 'pending-cleaning').length,
  qualityInspection: rows.filter(r => r.laundryStatus === 'quality-inspection').length,
  lateReturns: rows.filter(isLate).length,
  damaged: rows.filter(isDamaged).length,
});

/**
 * "Incoming next 48h" panel: garments arriving at or leaving the studio soon.
 * Includes rows whose booking starts within 48h, plus garments the owner has
 * shipped in but that haven't been received yet (readiness `incoming`), which
 * have no booking date to sort by at all.
 */
export const incomingNext48h = (rows, now = new Date()) =>
  rows
    .filter(r => isWithinNextHours(r.bookingStart, now, 48) || r.readinessStatus === 'incoming')
    .sort((a, b) => {
      // Rows with a date first, soonest first; undated rows after them.
      if (!a.bookingStart && !b.bookingStart) return 0;
      if (!a.bookingStart) return 1;
      if (!b.bookingStart) return -1;
      return new Date(a.bookingStart) - new Date(b.bookingStart);
    });

/** "Needs your attention" panel: damage reports (design doc §10). */
export const needsAttention = rows => rows.filter(isDamaged);

// ================ Sorting ================ //

// Default table order: furthest along the laundry sequence last, so the things
// needing action float to the top. Rows with no laundry status (inventory-only
// garments) sort first since they're usually awaiting intake.
export const sortRows = rows =>
  [...rows].sort((a, b) => {
    const ai = a.laundryStatus ? LAUNDRY_STATUSES.indexOf(a.laundryStatus) : -1;
    const bi = b.laundryStatus ? LAUNDRY_STATUSES.indexOf(b.laundryStatus) : -1;
    if (ai !== bi) {
      return ai - bi;
    }
    return (a.ticketCode || '').localeCompare(b.ticketCode || '');
  });
