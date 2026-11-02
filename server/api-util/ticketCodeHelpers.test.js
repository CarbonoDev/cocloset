const {
  DEFAULT_LAUNDRY_CODE,
  deriveLaundryCode,
  deriveTicketSequence,
  buildTicketCode,
} = require('./ticketCodeHelpers');

describe('deriveLaundryCode()', () => {
  it('takes the first 3 uppercased letters of the last word (matches the "PIG" mockup)', () => {
    expect(deriveLaundryCode('Studio Pigalle')).toBe('PIG');
  });

  it('handles a single-word studio name by using that word', () => {
    expect(deriveLaundryCode('Pigalle')).toBe('PIG');
  });

  it('handles more than two words by still using the last one', () => {
    expect(deriveLaundryCode('Le Petit Pressing')).toBe('PRE');
  });

  it('strips non-alphanumeric characters before deriving the code', () => {
    expect(deriveLaundryCode("Studio L'Étoile")) // apostrophe + accented char stripped
      .toBe(deriveLaundryCode('Studio LÉtoile'));
    expect(deriveLaundryCode('Studio 24/7!')).toBe('247');
  });

  it('is case-insensitive on input and always uppercases the result', () => {
    expect(deriveLaundryCode('studio pigalle')).toBe('PIG');
  });

  it('does not pad a short last word, just uses what is there', () => {
    expect(deriveLaundryCode('Studio Q')).toBe('Q');
  });

  it('falls back to the default code when studioName is missing or empty', () => {
    expect(deriveLaundryCode(undefined)).toBe(DEFAULT_LAUNDRY_CODE);
    expect(deriveLaundryCode(null)).toBe(DEFAULT_LAUNDRY_CODE);
    expect(deriveLaundryCode('')).toBe(DEFAULT_LAUNDRY_CODE);
    expect(deriveLaundryCode('   ')).toBe(DEFAULT_LAUNDRY_CODE);
  });

  it('falls back to the default code when the name has no alphanumeric characters', () => {
    expect(deriveLaundryCode('!!!')).toBe(DEFAULT_LAUNDRY_CODE);
  });

  it('ignores non-string input rather than throwing', () => {
    expect(deriveLaundryCode(42)).toBe(DEFAULT_LAUNDRY_CODE);
    expect(deriveLaundryCode({})).toBe(DEFAULT_LAUNDRY_CODE);
  });
});

describe('deriveTicketSequence()', () => {
  it('takes the last 6 hex characters of the transaction uuid, uppercased', () => {
    expect(deriveTicketSequence('5f9a3c21-88b4-4e11-9c2a-abcdef123456')).toBe('123456');
  });

  it('strips dashes before slicing', () => {
    const uuid = '11111111-2222-3333-4444-5555556789ab';
    expect(deriveTicketSequence(uuid)).toBe('6789AB');
  });

  it('is deterministic for the same input', () => {
    const uuid = '5f9a3c21-88b4-4e11-9c2a-abcdef123456';
    expect(deriveTicketSequence(uuid)).toBe(deriveTicketSequence(uuid));
  });

  it('throws when the transaction uuid is missing (this is not optional, unlike studioName)', () => {
    expect(() => deriveTicketSequence(undefined)).toThrow();
    expect(() => deriveTicketSequence(null)).toThrow();
    expect(() => deriveTicketSequence('')).toThrow();
  });
});

describe('buildTicketCode()', () => {
  it('joins the laundry code and sequence with a dash, matching the "PIG-2032" shape', () => {
    const uuid = '5f9a3c21-88b4-4e11-9c2a-abcdef123456';
    expect(buildTicketCode('Studio Pigalle', uuid)).toBe('PIG-123456');
  });

  it('falls back to the default laundry code when studioName is missing', () => {
    const uuid = '5f9a3c21-88b4-4e11-9c2a-abcdef123456';
    expect(buildTicketCode(undefined, uuid)).toBe(`${DEFAULT_LAUNDRY_CODE}-123456`);
  });
});
