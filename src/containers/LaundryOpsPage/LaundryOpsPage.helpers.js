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

// The states a garment is in BEFORE the customer walks out with it. Named as its
// own list because "has it gone out yet" is asked from more than one angle and
// the answer is the boundary between `ready-for-pickup` and `picked-up`.
const STATES_BEFORE_PICKUP = ['accepted', 'initial-cleaning', 'ready-for-pickup'];

/**
 * Does this garment have to go out to its renter TODAY?
 *
 *   > "Debe ver 'Entregar hoy'" (Jonathan, 2026-09-28)
 *
 * Asked because a rental can now START on the day it is booked - a garment already at its
 * studio with its cleaning finished can be collected the same day (see canBeCollectedToday in
 * util/cleaningFloor.js). Before that, every booking an operator saw had been placed at least
 * a day ahead, so a date column was enough to plan the day from. Now the row an operator has
 * to act on FIRST can appear at any hour, and a date that happens to read as today is easy to
 * scan past.
 *
 * Bounded by state, not only by date: after `picked-up` the garment is with the renter, and
 * "Deliver today" on an order that was handed over this morning is an instruction to do
 * something that is already done.
 *
 * @param {Object} row - a row from the /api/laundry-orders response
 * @param {Date} [now]
 * @returns {boolean}
 */
export const isDeliverToday = (row, now = new Date()) =>
  isSameDayAs(row?.bookingStart, now) && STATES_BEFORE_PICKUP.includes(opsStatus(row));

// The cleaning sub-phases plus the `returned` hand-off that feeds them
// (design doc §9: all of these map to the single customer-facing "Cleaning"
// step, and mockup 05.jpg shows them on the Cleaning screen).
//
// `quality-inspection` is still here on purpose, even though the phase was
// removed from the workflow on 2026-09-03 and nothing can enter it any more:
// this list decides what the Cleaning SCREEN shows, not what a studio is
// offered. A garment parked in that phase when the change shipped has to stay
// visible, or there is no screen from which to finish it.
//
// `initial-cleaning` (2026-09-21) belongs here too - it is the same activity,
// the studio washing a garment, just for the first time rather than between
// rentals. Missed when the state was added: the row's own status badge already
// read "In cleaning" (`util/laundryStatuses.js`'s `LAUNDRY_STATES`), but the
// garment was invisible on the one screen named for exactly that (Jonathan,
// 2026-09-29 - "el status debe cambiar... para todas las pantallas").
export const CLEANING_STATUSES = [
  'returned',
  'initial-cleaning',
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
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) {
    return rows;
  }
  return rows.filter(r =>
    // `laundryCode` is now what the TICKET column shows, so it has to be searchable - an
    // operator typing what is on screen and getting nothing back reads as a broken box.
    // `ticketCode` stays searchable too: it is still the fallback the column falls back TO.
    [r.laundryCode, r.ticketCode, r.customerName, r.ownerName, r.title, r.brand, r.currentRack]
      .filter(Boolean)
      .some(field => String(field).toLowerCase().includes(q))
  );
};

// ================ Dashboard ================ //

// Stat tiles on the Dashboard, left to right (per Jonathan, 2026-09-11). An
// 8th card, the ticket lookup box, follows these in the same row/grid - see
// LaundryDashboard.js.
export const DASHBOARD_TILES = [
  'pendingPickups48h',
  'rentalOrders',
  'outWithRenters',
  'inCleaning',
  'pendingDropOffs48h',
  'rentalInventory',
  'flaggedForReview',
];

// Which named route each tile drills into when clicked (2026-09-11: "cada
// card del dashboard sea clickeable para poder entrar a cada sección").
export const TILE_ROUTES = {
  pendingPickups48h: 'LaundryOpsPickupsPage',
  rentalOrders: 'LaundryOpsOrdersPage',
  outWithRenters: 'LaundryOpsReturnsPage',
  inCleaning: 'LaundryOpsCleaningPage',
  pendingDropOffs48h: 'LaundryOpsReturnsPage',
  rentalInventory: 'LaundryOpsInventoryPage',
  flaggedForReview: 'LaundryOpsOrdersPage',
};

/**
 * Counts for the dashboard stat tiles.
 *
 * NOTE on the two date-driven tiles (`pendingPickups48h`, `pendingDropOffs48h`):
 * they read `bookingStart`/`bookingEnd`, which only exist once a transaction
 * has a real Sharetribe booking. Inquiry-stage rows have none and are counted
 * as zero rather than guessed at.
 *
 * @param {Array} rows - all rows from the /api/laundry-orders response
 * @param {Array} inventory - per-garment rows from /api/laundry-orders
 * @param {Date} now
 */
export const dashboardCounts = (rows, inventory = [], now = new Date()) => ({
  // "Ready for renter pickup" is instantly within the next 48h, so it counts
  // alongside bookings whose start date falls in that window.
  pendingPickups48h:
    rows.filter(r => opsStatus(r) === 'ready-for-pickup').length +
    rows.filter(
      r => opsStatus(r) !== 'ready-for-pickup' && isWithinNextHours(r.bookingStart, now, 48)
    ).length,
  rentalOrders: rows.length,
  // "Out with renters" is the garment being out with the customer, which stays
  // true after it goes overdue.
  outWithRenters: rows.filter(r => ['picked-up', 'overdue'].includes(opsStatus(r))).length,
  inCleaning: rows.filter(r => opsStatus(r) === 'pending-cleaning').length,
  // BOTH KINDS OF DROP-OFF, NOT JUST THE RENTER'S.
  //
  //   > "el que era returns expected today, puedes integrar Lender or Renter
  //   >  drop offs?" (Jonathan, 2026-09-03)
  //
  // Two different people walk in with a garment: a RENTER returning one whose
  // booking ends within the window, and a LENDER bringing one in for the first
  // time. The tile counted only the first, so the counter staff's own
  // question - how many garments am I taking in - had no answer on the
  // dashboard.
  //
  // A lender drop-off has no booking date to fall "within 48h": the garment is
  // `incoming` until the studio receives it, and it stays that way for as long
  // as it takes the owner to turn up. So it is counted as outstanding rather
  // than as due soon, which is what the label says.
  pendingDropOffs48h:
    rows.filter(r => isWithinNextHours(r.bookingEnd, now, 48)).length +
    rows.filter(r => r?.readinessStatus === 'incoming' && !opsStatus(r)).length,
  rentalInventory: inventory.length,
  flaggedForReview: rows.filter(isDamaged).length,
});

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
  inCleaning: 'Blue',
  flaggedForReview: 'Critical',
};
