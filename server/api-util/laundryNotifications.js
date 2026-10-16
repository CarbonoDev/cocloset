// Message bodies for the four laundry-facing notifications in Project
// Overview §3.12: New Incoming Garment, Pickup Scheduled, Return Scheduled,
// Cleaning Required.
//
// WHY THESE ARE HAND-WRITTEN RATHER THAN SHARETRIBE TEMPLATES:
// Sharetribe notification `:to` accepts only `:actor.role/customer` or
// `:actor.role/provider`. A laundry is neither, so these four can never be
// hosted Handlebars templates in `ext/transaction-processes/` like the other
// ten §3.12 notifications - they have to be composed here and sent through
// ./mailgun.js. (See the header of that file for the full argument.)
//
// SCOPE: Jonathan asked for "muy sencillo, solo para cubrir la funcionalidad"
// and will supply real design/copy later. So: plain sentences, a labelled
// detail list, no branding, no layout, no i18n. Everything is a pure function
// of its arguments returning `{ subject, text, html }`, with no transport, no
// SDK and no env lookups beyond the marketplace name - which keeps them
// testable on their own and makes them trivial to swap for designed templates.
//
// NOT WIRED ANYWHERE YET on purpose: the endpoints that will call these
// (laundry-transaction-status.js / the events poller in Proposal §2.3) are
// owned by separate follow-up work.

// Fallbacks. Every field is treated as possibly-missing: these emails are
// assembled from Integration API data (display names, listing titles, booking
// dates), any of which can legitimately be absent, and a notification must
// degrade to a slightly vaguer email rather than throw inside a
// transaction-flow side effect.
const UNKNOWN_GARMENT = 'a garment';
const UNKNOWN_DATE = 'to be confirmed';
const DEFAULT_GREETING_NAME = 'there';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MARKETPLACE_ROOT_URL = process.env.REACT_APP_MARKETPLACE_ROOT_URL;
const MARKETPLACE_NAME = process.env.REACT_APP_MARKETPLACE_NAME;
/**
 * Escape a value for interpolation into the HTML body.
 *
 * Load-bearing, not decorative: garment titles and display names are
 * user-authored strings. Interpolating them raw would let a listing titled
 * `<script>…` or `"><a href=…>` rewrite an email that goes to a third party
 * (the laundry) who never saw the listing.
 *
 * @param {*} value
 * @returns {string}
 */
const escapeHtml = value => {
  if (value == null) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

/**
 * Format a Date / ISO string / epoch ms as a short, unambiguous UTC stamp,
 * e.g. `Mon 3 Aug 2026, 10:00 UTC`.
 *
 * Explicitly UTC and explicitly hand-formatted rather than
 * `toLocaleString()`: the output has to be identical on a developer laptop,
 * on Railway and in CI (no ICU/TZ-dependent drift), and a laundry reading a
 * pickup time needs to know which zone it is in. When Jonathan supplies real
 * templates this is the obvious place to switch to the laundry's local time.
 *
 * @param {Date|string|number} [value]
 * @returns {string} formatted stamp, or 'to be confirmed' when unusable
 */
const formatDateTime = value => {
  if (value == null || value === '') {
    return UNKNOWN_DATE;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return UNKNOWN_DATE;
  }
  const weekday = WEEKDAYS[date.getUTCDay()];
  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${weekday} ${day} ${month} ${year}, ${hours}:${minutes} UTC`;
};

// Drop detail rows whose value is missing, so an email never shows
// "Ticket: undefined". A row is [label, value].
const usableRows = rows =>
  rows.filter(([, value]) => value != null && String(value).trim().length > 0);

/**
 * Shared renderer: one greeting, one or two sentences, a labelled detail
 * list, one sign-off. Produces the text and html variants from the same data
 * so the two can never drift apart.
 */
const renderEmail = ({ subject, greetingName, intro, rows, outro, marketplaceName }) => {
  const greeting = `Hi ${greetingName || DEFAULT_GREETING_NAME},`;
  const details = usableRows(rows);

  const textLines = [
    greeting,
    '',
    intro,
    '',
    ...details.map(([label, value]) => `${label}: ${value}`),
  ];
  if (outro) {
    textLines.push('', outro);
  }
  textLines.push('', `— ${marketplaceName}`);

  const htmlRows = details
    .map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`)
    .join('');

  const html = [
    `<img
    src="${MARKETPLACE_ROOT_URL}/static/images/cocloset-banner.jpg"
    alt="${MARKETPLACE_NAME}"
    width="600"
    style="width:100%;max-width:600px;height:auto;display:block;margin:0 0 24px;border:0;border-radius:8px;"
    />`,
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    htmlRows ? `<ul>${htmlRows}</ul>` : '',
    outro ? `<p>${escapeHtml(outro)}</p>` : '',
    `<p>— ${escapeHtml(marketplaceName)}</p>`,
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, text: textLines.join('\n'), html };
};

// REACT_APP_MARKETPLACE_NAME is the template's existing marketplace-name var
// (public, safe to read here). Read at call time so tests can set it, and
// defaulted rather than required so a missing var never blocks a send.
const resolveMarketplaceName = name => name || process.env.REACT_APP_MARKETPLACE_NAME || 'Cocloset';

/**
 * §3.12 Laundry — New Incoming Garment.
 *
 * Fires when a garment owner assigns a garment to this laundry and ships it
 * in. There is NO transaction at this point (design doc §8: listing readiness
 * is a separate lifecycle from transaction state), so this one deliberately
 * carries listing data only - no ticket code, no booking dates, no customer.
 *
 * WIRED as of 2026-08-10, via laundryMailer.notifyNewIncomingGarment, from
 * server/api/listing-laundry-assignment.js. It was defined and tested but
 * unreachable before that: the absence of a transaction meant there was no
 * transition to hang it off, and the assignment endpoint - the moment an owner
 * actually picks a studio - only became the obvious trigger once the write moved
 * server-side into it. The endpoint fires it on a real change only.
 *
 * @param {Object} data
 * @param {string} [data.laundryName] - studio name, used in the greeting
 * @param {string} [data.garmentTitle] - listing title
 * @param {string} [data.ownerName] - garment owner's display name
 * @param {string} [data.listingId]
 * @param {string} [data.category] - listing category, for accepted-category triage
 * @param {string} [data.marketplaceName]
 * @returns {{subject: string, text: string, html: string}}
 */
const newIncomingGarmentNotification = ({
  laundryName,
  garmentTitle,
  ownerName,
  listingId,
  category,
  marketplaceName,
} = {}) => {
  const name = resolveMarketplaceName(marketplaceName);
  const garment = garmentTitle || UNKNOWN_GARMENT;
  return renderEmail({
    subject: `${name}: new incoming garment — ${garment}`,
    greetingName: laundryName,
    intro: `A garment owner has assigned ${garment} to your studio and is sending it in. Please mark it as received in your ${name} laundry dashboard when it arrives.`,
    rows: [
      ['Garment', garmentTitle],
      ['Owner', ownerName],
      ['Category', category],
      ['Listing ID', listingId],
    ],
    outro: 'The garment cannot be booked until you confirm you have received it.',
    marketplaceName: name,
  });
};

/**
 * §3.12 Laundry — Pickup Scheduled.
 *
 * Fires once a booking is confirmed: the customer will collect the garment
 * from the laundry at the start of the rental.
 *
 * @param {Object} data
 * @param {string} [data.laundryName]
 * @param {string} [data.garmentTitle]
 * @param {string} [data.ticketCode] - cosmetic display code, e.g. 'PIG-2032' (design §11)
 * @param {string} [data.customerName]
 * @param {Date|string|number} [data.pickupDate] - booking start
 * @param {string} [data.rack] - listing.privateData.currentRack, e.g. 'Rack A-04'
 * @param {string} [data.transactionId] - also the QR payload (design §11)
 * @param {string} [data.marketplaceName]
 * @returns {{subject: string, text: string, html: string}}
 */
const pickupScheduledNotification = ({
  laundryName,
  garmentTitle,
  ticketCode,
  customerName,
  pickupDate,
  rack,
  transactionId,
  marketplaceName,
} = {}) => {
  const name = resolveMarketplaceName(marketplaceName);
  const garment = garmentTitle || UNKNOWN_GARMENT;
  const ticketSuffix = ticketCode ? ` (${ticketCode})` : '';
  return renderEmail({
    subject: `${name}: pickup scheduled — ${garment}${ticketSuffix}`,
    greetingName: laundryName,
    intro: `A rental has been confirmed. Please have ${garment} ready for the customer to collect from your studio at the time below.`,
    rows: [
      ['Ticket', ticketCode],
      ['Garment', garmentTitle],
      ['Customer', customerName],
      ['Pickup', formatDateTime(pickupDate)],
      ['Rack', rack],
      ['Transaction', transactionId],
    ],
    outro: 'Scan the QR code on the ticket to confirm the handover.',
    marketplaceName: name,
  });
};

/**
 * §3.12 Laundry — Return Scheduled.
 *
 * Fires when the customer has picked the garment up: the laundry now knows
 * when to expect it back.
 *
 * @param {Object} data
 * @param {string} [data.laundryName]
 * @param {string} [data.garmentTitle]
 * @param {string} [data.ticketCode]
 * @param {string} [data.customerName]
 * @param {Date|string|number} [data.returnDate] - booking end
 * @param {string} [data.transactionId]
 * @param {string} [data.marketplaceName]
 * @returns {{subject: string, text: string, html: string}}
 */
const returnScheduledNotification = ({
  laundryName,
  garmentTitle,
  ticketCode,
  customerName,
  returnDate,
  transactionId,
  marketplaceName,
} = {}) => {
  const name = resolveMarketplaceName(marketplaceName);
  const garment = garmentTitle || UNKNOWN_GARMENT;
  const ticketSuffix = ticketCode ? ` (${ticketCode})` : '';
  return renderEmail({
    subject: `${name}: return scheduled — ${garment}${ticketSuffix}`,
    greetingName: laundryName,
    intro: `${garment} is out on rental and is due back at your studio at the time below.`,
    rows: [
      ['Ticket', ticketCode],
      ['Garment', garmentTitle],
      ['Customer', customerName],
      ['Return due', formatDateTime(returnDate)],
      ['Transaction', transactionId],
    ],
    outro: 'Scan the QR code on the ticket when the garment comes back in.',
    marketplaceName: name,
  });
};

/**
 * §3.12 Laundry — Cleaning Required.
 *
 * Fires when the garment has been returned and the cleaning cycle should
 * start. Carries the damage flag (design §10) when the return was recorded
 * with one, since that changes how the laundry handles the garment.
 *
 * @param {Object} data
 * @param {string} [data.laundryName]
 * @param {string} [data.garmentTitle]
 * @param {string} [data.ticketCode]
 * @param {Date|string|number} [data.returnedAt]
 * @param {boolean} [data.damageReported] - transaction.metadata.damageReported.flag
 * @param {string} [data.damageNote]
 * @param {string} [data.transactionId]
 * @param {string} [data.marketplaceName]
 * @returns {{subject: string, text: string, html: string}}
 */
const cleaningRequiredNotification = ({
  laundryName,
  garmentTitle,
  ticketCode,
  returnedAt,
  damageReported,
  damageNote,
  transactionId,
  marketplaceName,
} = {}) => {
  const name = resolveMarketplaceName(marketplaceName);
  const garment = garmentTitle || UNKNOWN_GARMENT;
  const ticketSuffix = ticketCode ? ` (${ticketCode})` : '';
  return renderEmail({
    subject: `${name}: cleaning required — ${garment}${ticketSuffix}`,
    greetingName: laundryName,
    intro: `${garment} has been returned and is ready for cleaning. Please update its status in your ${name} laundry dashboard as the cleaning progresses.`,
    rows: [
      ['Ticket', ticketCode],
      ['Garment', garmentTitle],
      ['Returned', formatDateTime(returnedAt)],
      ['Damage reported', damageReported ? damageNote || 'Yes — no details given' : null],
      ['Transaction', transactionId],
    ],
    outro: damageReported
      ? 'Damage was reported at return — please inspect the garment before cleaning.'
      : 'The garment becomes bookable again once you mark it available.',
    marketplaceName: name,
  });
};

/**
 * THE ONE THAT GOES TO THE OWNER, NOT TO A STUDIO.
 *
 *   > "se debe enviar un correo al provider confirmando la operación" (Jonathan, 2026-09-07)
 *
 * Every other notification in this file is addressed to a laundry. This one confirms to a
 * garment's owner that the studio has recorded handing it back - which matters because the
 * handover is a physical act with a data consequence the owner cannot see: until it is
 * recorded, the garment is still in that studio's inventory and its laundry cannot be
 * reassigned. So the mail says what CHANGED, not just that something happened.
 *
 * @param {Object} data
 * @param {string} [data.ownerName]
 * @param {string} [data.garmentTitle]
 * @param {string} [data.laundryName]
 * @param {Date|string|number} [data.handedBackAt]
 * @param {string} [data.marketplaceName]
 * @returns {{subject: string, text: string, html: string}}
 */
const garmentHandedBackNotification = ({
  ownerName,
  garmentTitle,
  laundryName,
  handedBackAt,
  marketplaceName,
} = {}) => {
  const name = resolveMarketplaceName(marketplaceName);
  const garment = garmentTitle || UNKNOWN_GARMENT;
  return renderEmail({
    subject: `${name}: ${garment} is back with you`,
    greetingName: ownerName,
    intro: `${laundryName ||
      'The store'} has recorded handing ${garment} back to you. It is no longer in their inventory.`,
    rows: [
      ['Garment', garmentTitle],
      ['Handed back by', laundryName],
      ['Recorded', formatDateTime(handedBackAt)],
    ],
    outro: `Your garment cannot be rented while it is with you. When you want it listed again, take it to a ${name} partner store and they will receive it back in.`,
  });
};

/**
 * Customer self-cancellation (2026-10-13) - the laundry side.
 *
 * Fires on EITHER `transition/customer-cancel` (from `:state/accepted`) or, since the
 * 2026-10-15 accepted/accepted-on-laundry state split,
 * `transition/customer-cancel-from-accepted-on-laundry` (from `:state/accepted-on-laundry`) -
 * see server/api/customer-cancel-notify-laundry.js for where both are checked. Before that
 * split, both of the physical situations below shared one state and so shared one transition;
 * the split moved the second situation to its own state and its own (new) transition, but the
 * laundry-facing message below did not need to change, because it was never about which state
 * the booking was in - it is about there being no new handover to expect FOR THIS BOOKING:
 * the provider never dropped the garment off, or it was already at the laundry from a
 * previous cycle but the laundry had not yet run its ready-for-pickup prep. Either way, that
 * is the whole message.
 *
 * Mirrors returnScheduledNotification's exact shape: a plain subject/text/html via the shared
 * renderEmail() helper above, same optional-ticket-code suffix convention.
 *
 * @param {Object} data
 * @param {string} [data.laundryName]
 * @param {string} [data.garmentTitle]
 * @param {string} [data.ticketCode] - cosmetic display code; may not exist yet if the laundry
 *   never issued one for this booking (see design §11 - a ticket is only opened once the
 *   garment is actually received)
 * @param {string} [data.customerName]
 * @param {string} [data.transactionId]
 * @param {string} [data.marketplaceName]
 * @returns {{subject: string, text: string, html: string}}
 */
const bookingCancelledNotification = ({
  laundryName,
  garmentTitle,
  ticketCode,
  customerName,
  transactionId,
  marketplaceName,
} = {}) => {
  const name = resolveMarketplaceName(marketplaceName);
  const garment = garmentTitle || UNKNOWN_GARMENT;
  const renter = customerName || 'The renter';
  const ticketSuffix = ticketCode ? ` (${ticketCode})` : '';
  return renderEmail({
    subject: `${name}: booking cancelled — ${garment}${ticketSuffix}`,
    greetingName: laundryName,
    intro: `${renter} cancelled this booking for ${garment} before any handover took place. There is no garment to expect for this booking, and nothing further is needed from you.`,
    rows: [
      ['Ticket', ticketCode],
      ['Garment', garmentTitle],
      ['Customer', customerName],
      ['Transaction', transactionId],
    ],
    outro: 'If you were already expecting a drop-off or a pickup for this booking, you can stand down - it will not happen.',
    marketplaceName: name,
  });
};

/**
 * Customer partial-refund self-cancellation (2026-10-13) - tells the assigned laundry that a
 * booking it has ALREADY RECEIVED THE GARMENT FOR is off.
 *
 * DELIBERATELY NOT bookingCancelledNotification-shaped wording ("before any handover took
 * place"): by the time `transition/partial-refund-cancel-from-initial-cleaning` can fire, the
 * laundry has already run `transition/laundry-receive-from-provider` - the garment is
 * physically on their rack. So this says the opposite of the full-refund-while-accepted
 * cancellation: there IS a garment at the studio for this transaction, and it is not going to
 * be rented out under this booking, but the laundry's OWN custody of it (onLaundry on the
 * listing) is untouched by this mail - this is a transaction-level notice, not a custody
 * instruction.
 *
 * @param {Object} data
 * @param {string} [data.laundryName]
 * @param {string} [data.garmentTitle]
 * @param {string} [data.ticketCode] - cosmetic display code, if the laundry already issued one
 * @param {string} [data.customerName]
 * @param {string} [data.transactionId]
 * @param {string} [data.marketplaceName]
 * @returns {{subject: string, text: string, html: string}}
 */
const partialRefundBookingCancelledNotification = ({
  laundryName,
  garmentTitle,
  ticketCode,
  customerName,
  transactionId,
  marketplaceName,
} = {}) => {
  const name = resolveMarketplaceName(marketplaceName);
  const garment = garmentTitle || UNKNOWN_GARMENT;
  const renter = customerName || 'The renter';
  const ticketSuffix = ticketCode ? ` (${ticketCode})` : '';
  return renderEmail({
    subject: `${name}: booking cancelled after drop-off — ${garment}${ticketSuffix}`,
    greetingName: laundryName,
    intro: `${renter} cancelled this booking for ${garment} after you already received it for its first cleaning. This booking will not go out on rental, but it does not change your custody of the garment - it stays with you under its own listing, exactly as before.`,
    rows: [
      ['Ticket', ticketCode],
      ['Garment', garmentTitle],
      ['Customer', customerName],
      ['Transaction', transactionId],
    ],
    outro: 'If you were expecting to prepare this garment for pickup under this booking, you can stand down - that will not happen under this transaction.',
    marketplaceName: name,
  });
};

module.exports = {
  garmentHandedBackNotification,
  newIncomingGarmentNotification,
  pickupScheduledNotification,
  returnScheduledNotification,
  cleaningRequiredNotification,
  bookingCancelledNotification,
  partialRefundBookingCancelledNotification,
  // Exported for tests and for reuse by any future laundry-facing email.
  escapeHtml,
  formatDateTime,
};
