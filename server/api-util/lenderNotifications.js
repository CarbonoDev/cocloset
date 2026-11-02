// Message body for the lender-facing "New Booking Request" email, ported 1:1 from the hosted
// Sharetribe template (BookingNewRequest.*) into a pure JS function so the server can send it
// CONDITIONALLY.
//
// WHY THIS IS HAND-WRITTEN RATHER THAN THE HOSTED TEMPLATE:
// A hosted template fires on every matching transition, unconditionally. A lender whose garment
// is already at a laundry never has to accept anything (the booking is accepted on their behalf,
// and the hosted "accepted on your behalf" email covers that case), so they must NOT get an
// approve/decline request. Composing it here lets the server send it only when the lender really
// has to act (see server/api/lender-new-request.js).
//
// IMPORTANT: the hosted provider "new booking request" notification must be REMOVED from the
// transaction process (process.edn), otherwise Sharetribe keeps sending its own copy on every
// request. The hosted "operator accepted" notification stays: it is not replaced by anything here.
//
// RECIPIENT / CONDITION: this function decides neither. It only returns
// `{ subject, text, html }`. The caller decides whether to send, looks up the lender's address
// and hands both to the mailer.
//
// Pure function of its arguments: no transport, no SDK, no env lookups beyond the
// marketplace name/url/colour defaults.

const UNKNOWN_GARMENT = 'your garment';
const UNKNOWN_CUSTOMER = 'A customer';
const UNKNOWN_DATE = 'to be confirmed';
const DEFAULT_BUTTON_COLOR = '#355f58';

const COMMISSION_CODE = 'line-item/provider-commission';

/**
 * Escape a value for interpolation into the HTML body. Garment titles and
 * display names are user-authored strings and must never go in raw.
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

const resolveMarketplaceName = name => name || process.env.REACT_APP_MARKETPLACE_NAME || 'Cocloset';
const resolveMarketplaceUrl = url =>
  (url || process.env.REACT_APP_MARKETPLACE_ROOT_URL || '').replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// Money. Accepts Integration API money: `amount` in MINOR units (cents) plus
// `currency`. Assumes a 2-decimal currency. The hosted template hard-codes a
// "$" prefix, so we do too and append the code for non-USD currencies.
// ---------------------------------------------------------------------------
const formatMoney = money => {
  if (!money || typeof money.amount !== 'number' || !Number.isFinite(money.amount)) {
    return '';
  }
  const sign = money.amount < 0 ? '-' : '';
  const base = `${sign}$${(Math.abs(money.amount) / 100).toFixed(2)}`;
  return money.currency && money.currency !== 'USD' ? `${base} ${money.currency}` : base;
};

const plural = (n, one, other) => `${n} ${Number(n) === 1 ? one : other}`;

// ---------------------------------------------------------------------------
// Dates. The hosted template formats in the LISTING's timezone (en_US), so we
// do the same with Intl; an invalid/missing zone falls back to UTC rather than
// throwing inside a transaction-flow side effect.
// ---------------------------------------------------------------------------
const toDate = value => {
  if (value == null || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatInZone = (value, timeZone, options) => {
  const date = toDate(value);
  if (!date) {
    return UNKNOWN_DATE;
  }
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: timeZone || 'UTC' }).format(
      date
    );
  } catch (e) {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(date);
  }
};

const fmtDay = (v, tz) => formatInZone(v, tz, { weekday: 'short' });
const fmtMonthDate = (v, tz) => formatInZone(v, tz, { month: 'short', day: 'numeric' });
const fmtDayTime = (v, tz) =>
  formatInZone(v, tz, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const fmtAcceptBy = (v, tz) =>
  formatInZone(v, tz, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

// Daily bookings have an EXCLUSIVE end (midnight after the last day), so the
// last day shown is "the day before". Subtracting 12h rather than 24h keeps
// this correct across DST changes.
const dayBefore = value => {
  const date = toDate(value);
  return date ? new Date(date.getTime() - 12 * 60 * 60 * 1000) : null;
};

// Same 48h rule as InboxTransactionPanel (recommendedDropTime). Keep the two in step.
const DROP_OFF_HOURS_BEFORE_START = 48;

// Absolute hours, so it is DST-safe and needs no timezone to compute; the zone only
// matters when the result is formatted.
const subtractHours = (value, hours) => {
  const date = toDate(value);
  return date ? new Date(date.getTime() - hours * 60 * 60 * 1000) : null;
};

// Two [start, end] pairs per booking line item, exactly as the template:
// first the weekday (or weekday+time) row, then the month/day row.
const bookingDateRows = (code, start, end, tz) => {
  switch (code) {
    case 'line-item/hour':
    case 'line-item/fixed':
      return [
        [fmtDayTime(start, tz), fmtDayTime(end, tz)],
        [fmtMonthDate(start, tz), fmtMonthDate(end, tz)],
      ];
    case 'line-item/day': {
      const last = dayBefore(end);
      return [
        [fmtDay(start, tz), fmtDay(last, tz)],
        [fmtMonthDate(start, tz), fmtMonthDate(last, tz)],
      ];
    }
    case 'line-item/night':
      return [
        [fmtDay(start, tz), fmtDay(end, tz)],
        [fmtMonthDate(start, tz), fmtMonthDate(end, tz)],
      ];
    default:
      return [];
  }
};

// The price row label for a booking line item (BookingNewRequest.PriceFor*).
const priceLabel = (item, bookingWeeks) => {
  const unit = formatMoney(item.unitPrice);
  const seats = item.seats;
  const qty = item.quantity != null ? item.quantity : item.units;
  const units = item.units != null ? item.units : item.quantity;
  const withSeats = noun => `${unit} × ${noun} x ${plural(seats, 'seat', 'seats')}`;

  switch (item.code) {
    case 'line-item/hour':
      return seats
        ? withSeats(plural(units, 'hour', 'hours'))
        : `${unit} × ${plural(qty, 'hour', 'hours')}`;
    case 'line-item/day':
      if (seats) {
        return withSeats(plural(units, 'day', 'days'));
      }
      return bookingWeeks
        ? `${unit} × ${plural(bookingWeeks, 'week', 'weeks')}`
        : `${unit} × ${plural(qty, 'day', 'days')}`;
    case 'line-item/night':
      return seats
        ? withSeats(plural(units, 'night', 'nights'))
        : `${unit} × ${plural(qty, 'night', 'nights')}`;
    case 'line-item/fixed':
      return seats ? `${unit} × ${plural(seats, 'seat', 'seats')}` : unit;
    default:
      return null;
  }
};

const isProviderVisible = item =>
  !Array.isArray(item.includeFor) || item.includeFor.includes('provider');

// ---------------------------------------------------------------------------
// HTML building blocks (inline styles copied from the hosted template).
// ---------------------------------------------------------------------------
const P_STYLE = 'font-size:16px;line-height:1.4;margin:16px 0;color:#484848';

const pairTable = (left, right, extra = '') =>
  `<table align="center" border="0" cellPadding="0" cellSpacing="0" role="presentation" width="100%"><tbody><tr>` +
  `<td><p style="${P_STYLE};${extra}">${escapeHtml(left)}</p></td>` +
  `<td style="text-align:right"><p style="${P_STYLE};${extra}">${escapeHtml(right)}</p></td>` +
  `</tr></tbody></table>`;

const singleTable = (text, extra = '') =>
  `<table align="center" border="0" cellPadding="0" cellSpacing="0" role="presentation" width="100%"><tbody><tr>` +
  `<td><p style="${P_STYLE};${extra}">${escapeHtml(text)}</p></td>` +
  `</tr></tbody></table>`;

const HR =
  '<hr style="width:100%;border:none;border-top:1px solid #eaeaea;border-color:#E1E1E1;margin:20px 0" />';

/**
 * The bordered breakdown box: price variant, Start/End dates,
 * one row per provider-visible price line, the marketplace fee and "You'll earn".
 *
 * Returns `{ textLines, html }`, both empty when there is nothing to show (no line items and
 * no dates), so an email built from partial data has no box instead of an empty one.
 */
const buildBreakdown = ({
  lineItems,
  bookingWeeks,
  bookingStart,
  bookingEnd,
  timeZone,
  priceVariantName,
  payoutTotal,
  marketplaceName,
}) => {
  const items = Array.isArray(lineItems) ? lineItems : [];

  // Dates: one block per booking line item (normally exactly one).
  const bookingItems = items.filter(i => priceLabel(i, bookingWeeks) !== null);
  const dateBlocks = bookingItems.map(i =>
    bookingDateRows(i.code, bookingStart, bookingEnd, timeZone)
  );

  // Price rows: provider-visible booking items, then the marketplace fee.
  const priceRows = [];
  items.filter(isProviderVisible).forEach(item => {
    if (item.code === COMMISSION_CODE) {
      priceRows.push([`${marketplaceName} fee`, formatMoney(item.lineTotal)]);
    } else {
      const label = priceLabel(item, bookingWeeks);
      if (label !== null) {
        priceRows.push([label, formatMoney(item.lineTotal)]);
      }
    }
  });

  // Earnings.
  let payout = payoutTotal;
  if (!payout) {
    const visible = items.filter(isProviderVisible).filter(i => i.lineTotal);
    if (visible.length > 0) {
      payout = {
        amount: visible.reduce((sum, i) => sum + (i.lineTotal.amount || 0), 0),
        currency: visible[0].lineTotal.currency,
      };
    }
  }
  const earn = formatMoney(payout);

  if (dateBlocks.length === 0 && priceRows.length === 0 && !earn) {
    return { textLines: [], html: '' };
  }

  // ---- plain text ----
  const textLines = [];
  if (priceVariantName) {
    textLines.push(priceVariantName);
  }
  dateBlocks.forEach(rows => {
    if (rows.length === 2) {
      textLines.push(`Start: ${rows[0][0]}, ${rows[1][0]}`, `End: ${rows[0][1]}, ${rows[1][1]}`);
    }
  });
  if (dateBlocks.length === 0 && (bookingStart || bookingEnd)) {
    textLines.push(
      `Start: ${fmtDayTime(bookingStart, timeZone)}`,
      `End: ${fmtDayTime(bookingEnd, timeZone)}`
    );
  }
  textLines.push('');
  priceRows.forEach(([label, value]) => textLines.push(`${label}: ${value}`));
  if (earn) {
    textLines.push(`You'll earn: ${earn}`);
  }

  // ---- html ----
  const boxParts = [];
  if (priceVariantName) {
    boxParts.push(singleTable(priceVariantName, 'margin-bottom:1px'), HR);
  }
  boxParts.push(pairTable('Start', 'End', 'margin-top:1px;margin-bottom:1px'));
  dateBlocks.forEach(rows => {
    rows.forEach(([start, end]) =>
      boxParts.push(pairTable(start, end, 'font-weight:700;margin-top:1px;margin-bottom:1px'))
    );
  });
  priceRows.forEach(([label, value]) =>
    boxParts.push(pairTable(label, value, 'margin-bottom:1px'))
  );
  if (earn) {
    boxParts.push(HR, pairTable("You'll earn", earn, 'margin-top:1px;font-weight:700'));
  }

  const html =
    `<table style="color:#484848;font-size:16px;line-height:1.4;background-color:#FFF;padding:8px 24px;border-radius:8px;border:1px solid;border-color:#E1E1E1;margin:24px 0" align="center" border="0" cellPadding="0" cellSpacing="0" role="presentation" width="100%"><tbody><tr><td>` +
    boxParts.join('\n') +
    `</td></tr></tbody></table>`;

  return { textLines, html };
};

/**
 * Lender — New Booking Request.
 *
 * @param {Object} data
 * @param {string} [data.garmentTitle] - listing title
 * @param {string} [data.customerName] - customer display name
 * @param {string} [data.transactionId] - used for the /sale/<id>/ link
 * @param {string} [data.priceVariantName] - transaction.protectedData.priceVariantName
 * @param {Date|string|number} [data.bookingStart]
 * @param {Date|string|number} [data.bookingEnd]
 * @param {string} [data.timeZone] - listing.availabilityPlan.timezone, e.g. 'America/Mexico_City'
 * @param {Array<Object>} [data.lineItems] - transaction line items:
 *   { code, unitPrice:{amount,currency}, lineTotal:{amount,currency},
 *     quantity, units, seats, includeFor }  (amounts in minor units)
 * @param {{amount:number,currency:string}} [data.payoutTotal] - computed from the
 *   provider-visible line items when omitted
 * @param {number} [data.bookingWeeks] - transaction.protectedData.bookingWeeks
 * @param {Date|string|number} [data.acceptBy] - when the request expires
 * @param {string} [data.marketplaceName]
 * @param {string} [data.marketplaceUrl]
 * @param {string} [data.buttonColor]
 * @returns {{subject: string, text: string, html: string}}
 */
const bookingRequestNotification = ({
  garmentTitle,
  customerName,
  transactionId,
  priceVariantName,
  bookingStart,
  bookingEnd,
  timeZone,
  lineItems,
  payoutTotal,
  bookingWeeks,
  acceptBy,
  marketplaceName,
  marketplaceUrl,
  buttonColor,
} = {}) => {
  const name = resolveMarketplaceName(marketplaceName);
  const rootUrl = resolveMarketplaceUrl(marketplaceUrl);
  const color = buttonColor || DEFAULT_BUTTON_COLOR;
  const garment = garmentTitle || UNKNOWN_GARMENT;
  const customer = customerName || UNKNOWN_CUSTOMER;
  const items = Array.isArray(lineItems) ? lineItems : [];

  const title = `You have a new booking request for ${garment}`;
  const description = `${customer} requested to book ${garment} in ${name}.`;

  const breakdown = buildBreakdown({
    lineItems: items,
    bookingWeeks,
    bookingStart,
    bookingEnd,
    timeZone,
    priceVariantName,
    payoutTotal,
    marketplaceName: name,
  });

  const dropOffBy = subtractHours(bookingStart, DROP_OFF_HOURS_BEFORE_START);
  const acceptByDate = toDate(acceptBy);
  const dropOffText = dropOffBy
    ? dropOffBy.getTime() > Date.now()
      ? `drop off the item at the cleaners by ${fmtAcceptBy(dropOffBy, timeZone)}`
      : 'drop off the item at the cleaners as soon as possible'
    : null;

  let acceptText;
  if (acceptByDate && dropOffText) {
    acceptText = `You need to accept this request by ${fmtAcceptBy(acceptByDate, timeZone)} and ${dropOffText} so the item can be prepared in time for the rental start date.`;
  } else if (dropOffText) {
    acceptText = `You need to accept this request soon and ${dropOffText} so the item can be prepared in time for the rental start date.`;
  } else if (acceptByDate) {
    acceptText = `You need to accept the request by ${fmtAcceptBy(acceptByDate, timeZone)}. Otherwise the request will expire automatically and you won't get paid.`;
  } else {
    acceptText = `You need to accept the request soon. Otherwise the request will expire automatically and you won't get paid.`;
  }

  const declineText =
    "If the booked dates don't work for you, you can also choose to decline the request.";

  const link = transactionId
    ? `${rootUrl}/sale/${encodeURIComponent(transactionId)}/`
    : `${rootUrl}/inbox/sales`;

  // ---- plain text ---------------------------------------------------------
  const textLines = [
    title,
    '',
    description,
    '',
    ...(breakdown.textLines.length ? [...breakdown.textLines, ''] : []),
    acceptText,
    declineText,
    '',
    `Accept or Decline the booking: ${link}`,
    '',
    'Warmly,',
    `The ${name} Team`,
  ];

  const buttonStyle = `color:#FFF;background-color:${escapeHtml(
    color
  )};border-radius:4px;font-size:15px;text-decoration:none;text-align:center;display:inline-block;min-width:210px;padding:16px 32px;max-width:100%;line-height:120%`;

  const html = [
    `<table style="background-color:#FFF;margin:0 auto;padding:24px 12px 0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif" align="center" border="0" cellPadding="0" cellSpacing="0" role="presentation" width="100%"><tbody><tr><td>`,
    `<table align="center" role="presentation" cellSpacing="0" cellPadding="0" border="0" width="100%" style="max-width:600px;margin:0 auto">`,
    `<tr style="width:100%"><td style="padding-bottom:16px"><img src="${escapeHtml(
      rootUrl
    )}/static/images/cocloset-banner.jpg" alt="${escapeHtml(
      name
    )}" width="600" style="width:100%;max-width:600px;display:block;margin:0 auto;border:0;border-radius:8px" /></td></tr>`,
    `<tr style="width:100%"><td>`,
    `<h1 style="color:#484848;font-size:26px;line-height:1.3;font-weight:700">${escapeHtml(
      title
    )}</h1>`,
    `<p style="${P_STYLE}">${escapeHtml(description)}</p>`,
    breakdown.html,
    `<p style="${P_STYLE};font-weight:700">${escapeHtml(acceptText)}</p>`,
    `<p style="${P_STYLE}">${escapeHtml(declineText)}</p>`,
    `<table style="padding:16px 0 0" align="center" border="0" cellPadding="0" cellSpacing="0" role="presentation" width="100%"><tbody><tr><td>`,
    `<a href="${escapeHtml(
      link
    )}" target="_blank" style="${buttonStyle}">Accept or Decline the booking</a>`,
    `<div><p style="font-size:14px;line-height:1.5;margin:16px 0;color:#484848">Can't click the button? Here's a link for your convenience: <a target="_blank" style="color:${escapeHtml(
      color
    )};text-decoration:none" href="${escapeHtml(link)}">${escapeHtml(link)}</a></p></div>`,
    `</td></tr></tbody></table>`,
    `<p style="font-size:16px;line-height:1.4;margin:24px 0 0;color:#484848">Warmly,</p>`,
    `<p style="font-size:16px;line-height:1.4;margin:4px 0 0;color:#484848">The ${escapeHtml(
      name
    )} Team</p>`,
    `<div>${HR}<p style="font-size:12px;line-height:15px;margin:0 auto;color:#b7b7b7;text-align:left;margin-bottom:50px">You're a member of ${escapeHtml(
      name
    )}. If you no longer want to receive these emails, please contact ${escapeHtml(
      name
    )} team.</p></div>`,
    `</td></tr></table>`,
    `</td></tr></tbody></table>`,
  ].join('\n');

  return { subject: title, text: textLines.join('\n'), html };
};

module.exports = {
  bookingRequestNotification,
  // Exported for tests.
  escapeHtml,
  formatMoney,
};
