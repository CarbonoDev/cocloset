const {
  MAX_CODE_LENGTH,
  buildListingCodeRecord,
  currentLaundryCodeFor,
  takesLaundryCode,
  validateLaundryCode,
} = require('./laundryCode');

// THE STUDIO'S OWN CODE FOR A GARMENT.
//
//   > "cuando laundry recibe la prenda desde el provider, debe aparecer un input para que
//   >  laundry pueda ingresar un código interno para esa prenda (...) si el listing regresa a
//   >  su dueño y se lo envia a otra laundry, este código va a cambiar, por lo que puede haber
//   >  varios códigos o reemplazar el mismo, toma la mejor opción"
//
// The option taken: ONE code on the listing, stamped with the studio that issued it. These
// tests pin the part that makes that choice safe - a code whose studio no longer holds the
// garment is not shown at all, because it names a shelf in a building nobody is going to.

const listingWith = ({ code, laundryId, assignedLaundryId }) => ({
  id: { uuid: 'listing-1' },
  attributes: {
    metadata: {
      ...(assignedLaundryId ? { assignedLaundryId } : {}),
      ...(code ? { laundryCode: { code, laundryId, updatedAt: '2026-08-17T12:00:00.000Z' } } : {}),
    },
  },
});

describe('validateLaundryCode', () => {
  it('takes a trimmed string', () => {
    expect(validateLaundryCode('  A-04  ')).toEqual({ valid: true, value: 'A-04' });
  });

  it('treats absent and blank as "not given" rather than as an error', () => {
    // The reception step should ask for a code, but a studio that has not decided on one yet
    // must still be able to advance the garment - refusing the transition would leave it
    // physically at the counter and stuck in the app. A blank box is what an untouched input
    // posts, and storing that would store an empty code.
    [undefined, null, '', '   '].forEach(value => {
      expect(validateLaundryCode(value)).toEqual({ valid: true, value: null });
    });
  });

  it('rejects a non-string and an over-long one', () => {
    [42, {}, [], true].forEach(value => {
      expect(validateLaundryCode(value).valid).toBe(false);
    });
    expect(validateLaundryCode('x'.repeat(MAX_CODE_LENGTH + 1)).valid).toBe(false);
    expect(validateLaundryCode('x'.repeat(MAX_CODE_LENGTH)).valid).toBe(true);
  });
});

describe('currentLaundryCodeFor', () => {
  it('returns the code while the studio that issued it still holds the garment', () => {
    const listing = listingWith({ code: 'A-04', laundryId: 'l1', assignedLaundryId: 'l1' });
    expect(currentLaundryCodeFor(listing)).toBe('A-04');
  });

  it('HIDES a code issued by a studio that no longer holds the garment', () => {
    // THE WHOLE REASON THE RECORD CARRIES AN ISSUER. The garment went home and was sent to
    // another studio; "A-04" now names a shelf in a building nobody is going to, and showing
    // it would send somebody to the wrong place - worse than showing nothing.
    const listing = listingWith({ code: 'A-04', laundryId: 'l1', assignedLaundryId: 'l2' });
    expect(currentLaundryCodeFor(listing)).toBeNull();
  });

  it('hides a code when no studio is assigned at all', () => {
    // The garment is with its owner. There is no shelf.
    const listing = listingWith({ code: 'A-04', laundryId: 'l1' });
    expect(currentLaundryCodeFor(listing)).toBeNull();
  });

  it('hides a record from a shape that carries no issuer', () => {
    // Nothing writes this today, and if something ever did we could not tell live from dead.
    const listing = listingWith({ code: 'A-04', assignedLaundryId: 'l1' });
    expect(currentLaundryCodeFor(listing)).toBeNull();
  });

  it('is null, not a crash, for a garment that has never been given one', () => {
    expect(currentLaundryCodeFor(listingWith({ assignedLaundryId: 'l1' }))).toBeNull();
    expect(currentLaundryCodeFor(undefined)).toBeNull();
    expect(currentLaundryCodeFor({})).toBeNull();
  });
});

describe('buildListingCodeRecord', () => {
  it('stamps the code with its issuer and the moment', () => {
    const record = buildListingCodeRecord({
      code: 'A-04',
      laundryId: 'l1',
      now: new Date('2026-08-17T12:00:00.000Z'),
    });
    expect(record).toEqual({
      code: 'A-04',
      laundryId: 'l1',
      // An ISO string rather than a Date: the SDK would encode a Date as a transit timestamp,
      // and this record is read back by plain JSON consumers.
      updatedAt: '2026-08-17T12:00:00.000Z',
    });
  });
});

describe('takesLaundryCode', () => {
  it('is the reception from the owner, and only that', () => {
    // The one moment the garment is on the counter about to go onto a shelf. Every step after
    // it only reads the code.
    expect(takesLaundryCode('ready-for-pickup')).toBe(true);
    ['picked-up', 'returned', 'cleaning', 'available', undefined].forEach(status => {
      expect(takesLaundryCode(status)).toBe(false);
    });
  });
});
