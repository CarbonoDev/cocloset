import { LAUNDRY_STATES, opsStatus, isOverdue, wasReturnedLate } from '../../util/laundryStatuses';

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

/**
 * Is this row late?
 *
 * Reads the real process state (`overdue`, entered automatically by
 * transition/mark-overdue) rather than the `metadata.lateReturn` flag we used
 * to maintain by hand. A garment that has already come back late is included
 * too - it leaves `overdue` for `returned` the instant it is scanned in, and
 * an ops screen that stopped flagging it at that moment would hide the thing
 * the operator most wants to see.
 */
export const isLate = row => isOverdue(row) || wasReturnedLate(row);

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
  opsStatus(row) === 'ready-for-pickup' ||
  (!opsStatus(row) && ['incoming', 'stored'].includes(row?.readinessStatus));

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
      return rows.filter(r => opsStatus(r) === 'pending-cleaning');
    case 'ready-for-pickup':
      return rows.filter(r => opsStatus(r) === 'ready-for-pickup');
    case 'late-returns':
      return rows.filter(isLate);
    case 'damaged':
      return rows.filter(isDamaged);
    case 'completed':
      // 'delivered' is where the laundry chain ends: cleaning is finished and
      // the garment is back in inventory (transition/laundry-mark-available).
      return rows.filter(r => opsStatus(r) === 'delivered');
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
      // Out with the customer - on time or already late.
      return rows.filter(r => ['picked-up', 'overdue'].includes(opsStatus(r)));
    case 'cleaning':
      return rows.filter(r => CLEANING_STATUSES.includes(opsStatus(r)));
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
  'dropOffsToday',
  'currentlyRented',
  'pendingCleaning',
  'qualityInspection',
  'lateReturns',
  'damaged',
];

/**
 * Counts for the dashboard stat tiles.
 *
 * NOTE on the two date-driven tiles (`pickupsToday`, `dropOffsToday`): they read
 * `bookingStart`/`bookingEnd`, which only exist once a transaction has a real
 * Sharetribe booking. Inquiry-stage rows have none and are counted as zero
 * rather than guessed at.
 *
 * @param {Array} rows
 * @param {Date} now
 */
export const dashboardCounts = (rows, now = new Date()) => ({
  readyForPickup: rows.filter(r => opsStatus(r) === 'ready-for-pickup').length,
  pickupsToday: rows.filter(r => isSameDayAs(r.bookingStart, now)).length,
  // BOTH KINDS OF DROP-OFF, NOT JUST THE RENTER'S.
  //
  //   > "el que era returns expected today, puedes integrar Lender or Renter
  //   >  drop offs?" (Jonathan, 2026-09-03)
  //
  // Two different people walk in with a garment: a RENTER returning one whose
  // booking ends today, and a LENDER bringing one in for the first time. The
  // tile counted only the first, so the counter staff's own question - how many
  // garments am I taking in - had no answer on the dashboard.
  //
  // A lender drop-off has no booking date to be "today": the garment is
  // `incoming` until the studio receives it, and it stays that way for as long
  // as it takes the owner to turn up. So it is counted as outstanding rather
  // than as due today, which is what the label says.
  dropOffsToday:
    rows.filter(r => isSameDayAs(r.bookingEnd, now)).length +
    rows.filter(r => r?.readinessStatus === 'incoming' && !opsStatus(r)).length,
  // "Currently rented" is the garment being out with the customer, which stays
  // true after it goes overdue.
  currentlyRented: rows.filter(r => ['picked-up', 'overdue'].includes(opsStatus(r))).length,
  pendingCleaning: rows.filter(r => opsStatus(r) === 'pending-cleaning').length,
  qualityInspection: rows.filter(r => opsStatus(r) === 'quality-inspection').length,
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
// needing action float to the top. Rows with no process state (inventory-only
// garments) sort first since they're usually awaiting intake.
//
// Sorts on the STATE rather than the display status: the three cleaning
// sub-phases are one position in the operational sequence, and ordering by
// them would interleave cleaning rows with returned ones.
const stateRank = row => (row?.state ? LAUNDRY_STATES.indexOf(row.state) : -1);

export const sortRows = rows =>
  [...rows].sort((a, b) => {
    const ai = stateRank(a);
    const bi = stateRank(b);
    if (ai !== bi) {
      return ai - bi;
    }
    return (a.ticketCode || '').localeCompare(b.ticketCode || '');
  });

// ================ Presentation ================ //

/**
 * Visual tone per status badge (mockups 04-09.jpg tint each status differently).
 *
 * This is presentation only - it never affects which rows are shown or what
 * they mean. Tone is always a SECONDARY cue: every badge also renders its
 * translated text label, so nothing here is conveyed by colour alone.
 *
 * Keys cover both vocabularies the badges draw from (`LAUNDRY_STATUSES` for
 * transaction rows, `READINESS_STATUSES` for inventory-only rows).
 */
export const STATUS_TONES = {
  // Transaction laundry statuses
  'ready-for-pickup': 'Green',
  'picked-up': 'Rose',
  returned: 'Amber',
  'pending-cleaning': 'Blue',
  'cleaning-in-progress': 'Blue',
  'quality-inspection': 'Violet',
  'available-for-booking': 'Green',
  // Listing readiness statuses
  incoming: 'Amber',
  stored: 'Neutral',
  available: 'Green',
};

/**
 * Tone name for a row's status badge. Mirrors `statusLabelKey`'s precedence
 * (transaction status wins over readiness) so the badge's colour and its text
 * can never describe different things.
 *
 * @param {Object} row - a row from the /api/laundry-orders response
 * @returns {string} one of the tone suffixes used by LaundryOpsPage.module.css
 */
export const statusTone = row =>
  STATUS_TONES[(row?.laundryStatus)] || STATUS_TONES[(row?.readinessStatus)] || 'Neutral';

/**
 * Tones for the dashboard stat tile values (mockup 09.jpg): work-in-progress
 * counts are tinted, problem counts are red, everything else stays ink-black.
 * Tiles without an entry render in the default colour.
 */
export const TILE_TONES = {
  pendingCleaning: 'Blue',
  qualityInspection: 'Violet',
  lateReturns: 'Critical',
  damaged: 'Critical',
};
