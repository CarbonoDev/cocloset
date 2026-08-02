const {
  newIncomingGarmentNotification,
  pickupScheduledNotification,
  returnScheduledNotification,
  cleaningRequiredNotification,
  escapeHtml,
  formatDateTime,
} = require('./laundryNotifications');

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.REACT_APP_MARKETPLACE_NAME;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

const ALL_BUILDERS = [
  ['newIncomingGarmentNotification', newIncomingGarmentNotification],
  ['pickupScheduledNotification', pickupScheduledNotification],
  ['returnScheduledNotification', returnScheduledNotification],
  ['cleaningRequiredNotification', cleaningRequiredNotification],
];

describe('escapeHtml()', () => {
  it('escapes the characters that could break out of the email body', () => {
    expect(escapeHtml('<script>alert("x") & \'y\'</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;'
    );
  });

  it('returns an empty string for null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('stringifies non-strings', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('formatDateTime()', () => {
  it('formats an ISO string as a short UTC stamp', () => {
    expect(formatDateTime('2026-08-03T10:00:00.000Z')).toBe('Mon 3 Aug 2026, 10:00 UTC');
  });

  it('formats a Date the same way', () => {
    expect(formatDateTime(new Date('2026-12-25T23:05:00.000Z'))).toBe('Fri 25 Dec 2026, 23:05 UTC');
  });

  it('formats epoch millis', () => {
    expect(formatDateTime(Date.UTC(2026, 0, 1, 0, 0))).toBe('Thu 1 Jan 2026, 00:00 UTC');
  });

  it('falls back rather than throwing on missing or unparseable input', () => {
    expect(formatDateTime(undefined)).toBe('to be confirmed');
    expect(formatDateTime(null)).toBe('to be confirmed');
    expect(formatDateTime('')).toBe('to be confirmed');
    expect(formatDateTime('not a date')).toBe('to be confirmed');
    expect(formatDateTime(new Date('nope'))).toBe('to be confirmed');
  });
});

// Properties every §3.12 laundry notification must hold, whatever the data.
describe.each(ALL_BUILDERS)('%s() — shared contract', (name, build) => {
  it('returns a subject and both bodies', () => {
    const email = build({ laundryName: 'Studio Pigalle', garmentTitle: 'Blue Silk Dress' });
    expect(typeof email.subject).toBe('string');
    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.text.length).toBeGreaterThan(0);
    expect(email.html.length).toBeGreaterThan(0);
  });

  // These are side effects of a transaction flow: a missing display name must
  // never throw inside a notification.
  it('does not throw with no data at all', () => {
    expect(() => build()).not.toThrow();
    expect(() => build({})).not.toThrow();
  });

  it('never renders "undefined" or "null" into the copy', () => {
    const email = build({});
    expect(email.subject).not.toMatch(/undefined|null/);
    expect(email.text).not.toMatch(/undefined|null/);
    expect(email.html).not.toMatch(/undefined|null/);
  });

  it('greets generically when the studio name is unknown', () => {
    expect(build({}).text).toContain('Hi there,');
  });

  // Listing titles and display names are user-authored. Interpolating them
  // raw would let a listing title rewrite an email sent to a third party.
  it('escapes user-authored values in the HTML body', () => {
    const email = build({
      laundryName: 'Studio <b>Pigalle</b>',
      // Every builder interpolates the garment title, so putting both an
      // injection attempt and an ampersand here covers all four.
      garmentTitle: '<img src=x onerror=alert(1)> & co',
      customerName: 'A & B',
      ownerName: 'A & B',
    });
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain('&lt;img src=x');
    expect(email.html).toContain('&amp;');
  });

  it('uses REACT_APP_MARKETPLACE_NAME when set, and an explicit override wins', () => {
    process.env.REACT_APP_MARKETPLACE_NAME = 'Testplace';
    expect(build({}).subject).toContain('Testplace');
    expect(build({ marketplaceName: 'Override' }).subject).toContain('Override');
  });

  it('defaults the marketplace name when the env var is absent', () => {
    expect(build({}).subject).toContain('Cocloset');
  });
});

describe('newIncomingGarmentNotification()', () => {
  const email = newIncomingGarmentNotification({
    laundryName: 'Studio Pigalle',
    garmentTitle: 'Blue Silk Dress',
    ownerName: 'Marie D.',
    listingId: '68a1b2c3-0000-4000-8000-000000000001',
    category: 'dresses',
    marketplaceName: 'Cocloset',
  });

  it('names the garment in the subject', () => {
    expect(email.subject).toBe('Cocloset: new incoming garment — Blue Silk Dress');
  });

  it('lists the owner, category and listing id', () => {
    expect(email.text).toContain('Garment: Blue Silk Dress');
    expect(email.text).toContain('Owner: Marie D.');
    expect(email.text).toContain('Category: dresses');
    expect(email.text).toContain('Listing ID: 68a1b2c3-0000-4000-8000-000000000001');
  });

  it('asks the laundry to confirm receipt', () => {
    expect(email.text).toMatch(/mark it as received/i);
  });

  // This one fires before any transaction exists (design doc §8), so it must
  // not imply a booking, a ticket or a customer.
  it('carries no ticket code, booking date or customer - there is no transaction yet', () => {
    expect(email.text).not.toMatch(/Ticket|Customer|Pickup|Transaction/);
  });

  it('omits detail rows whose data is missing', () => {
    const sparse = newIncomingGarmentNotification({ garmentTitle: 'Red Coat' });
    expect(sparse.text).toContain('Garment: Red Coat');
    expect(sparse.text).not.toContain('Owner:');
    expect(sparse.text).not.toContain('Category:');
  });
});

describe('pickupScheduledNotification()', () => {
  const email = pickupScheduledNotification({
    laundryName: 'Studio Pigalle',
    garmentTitle: 'Blue Silk Dress',
    ticketCode: 'PIG-2032',
    customerName: 'Alex R.',
    pickupDate: '2026-08-03T10:00:00.000Z',
    rack: 'Rack A-04',
    transactionId: 'tx-1',
    marketplaceName: 'Cocloset',
  });

  it('puts the garment and ticket code in the subject', () => {
    expect(email.subject).toBe('Cocloset: pickup scheduled — Blue Silk Dress (PIG-2032)');
  });

  it('lists ticket, customer, formatted pickup time and rack', () => {
    expect(email.text).toContain('Ticket: PIG-2032');
    expect(email.text).toContain('Customer: Alex R.');
    expect(email.text).toContain('Pickup: Mon 3 Aug 2026, 10:00 UTC');
    expect(email.text).toContain('Rack: Rack A-04');
    expect(email.text).toContain('Transaction: tx-1');
  });

  it('drops the ticket suffix from the subject when no code was generated', () => {
    const noTicket = pickupScheduledNotification({
      garmentTitle: 'Blue Silk Dress',
      marketplaceName: 'Cocloset',
    });
    expect(noTicket.subject).toBe('Cocloset: pickup scheduled — Blue Silk Dress');
  });

  it('says the date is to be confirmed rather than omitting it', () => {
    const noDate = pickupScheduledNotification({ garmentTitle: 'Blue Silk Dress' });
    expect(noDate.text).toContain('Pickup: to be confirmed');
  });
});

describe('returnScheduledNotification()', () => {
  const email = returnScheduledNotification({
    laundryName: 'Studio Pigalle',
    garmentTitle: 'Blue Silk Dress',
    ticketCode: 'PIG-2032',
    customerName: 'Alex R.',
    returnDate: '2026-08-07T17:30:00.000Z',
    transactionId: 'tx-1',
    marketplaceName: 'Cocloset',
  });

  it('puts the garment and ticket code in the subject', () => {
    expect(email.subject).toBe('Cocloset: return scheduled — Blue Silk Dress (PIG-2032)');
  });

  it('gives the due-back time, not the pickup time', () => {
    expect(email.text).toContain('Return due: Fri 7 Aug 2026, 17:30 UTC');
    expect(email.text).not.toContain('Pickup:');
  });

  it('names the customer bringing it back', () => {
    expect(email.text).toContain('Customer: Alex R.');
  });
});

describe('cleaningRequiredNotification()', () => {
  const email = cleaningRequiredNotification({
    laundryName: 'Studio Pigalle',
    garmentTitle: 'Blue Silk Dress',
    ticketCode: 'PIG-2032',
    returnedAt: '2026-08-07T18:00:00.000Z',
    transactionId: 'tx-1',
    marketplaceName: 'Cocloset',
  });

  it('puts the garment and ticket code in the subject', () => {
    expect(email.subject).toBe('Cocloset: cleaning required — Blue Silk Dress (PIG-2032)');
  });

  it('gives the return time and asks for status updates', () => {
    expect(email.text).toContain('Returned: Fri 7 Aug 2026, 18:00 UTC');
    expect(email.text).toMatch(/update its status/i);
  });

  it('says nothing about damage when none was reported', () => {
    expect(email.text).not.toMatch(/[Dd]amage/);
  });

  // Design doc §10: a damage flag can ride along with the return, and it
  // changes how the laundry handles the garment.
  it('surfaces a reported damage note', () => {
    const damaged = cleaningRequiredNotification({
      garmentTitle: 'Blue Silk Dress',
      damageReported: true,
      damageNote: 'Tear on the left sleeve',
    });
    expect(damaged.text).toContain('Damage reported: Tear on the left sleeve');
    expect(damaged.text).toMatch(/inspect the garment before cleaning/i);
  });

  it('still flags damage when no note was written', () => {
    const damaged = cleaningRequiredNotification({
      garmentTitle: 'Blue Silk Dress',
      damageReported: true,
    });
    expect(damaged.text).toContain('Damage reported: Yes — no details given');
  });
});
