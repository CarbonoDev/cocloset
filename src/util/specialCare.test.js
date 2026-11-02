import {
  SPECIAL_CARE_HIGH_VALUE,
  SPECIAL_CARE_NOTE_MAX_LENGTH,
  SPECIAL_CARE_OPTIONS,
  specialCareFlags,
  specialCareForStorage,
  specialCareNote,
} from './specialCare';

describe('SPECIAL_CARE_OPTIONS', () => {
  it('is the four the client listed, in order', () => {
    expect(SPECIAL_CARE_OPTIONS).toEqual([
      'embellishments',
      'leatherSuedeTrim',
      'pressedPleats',
      'highValue',
    ]);
  });

  // A separate request asked for a standalone "High Value item" checkbox. Two controls meaning
  // the same thing can disagree, and nothing downstream could say which was right.
  it('carries the high-value flag itself, so there is only ever one of it', () => {
    expect(SPECIAL_CARE_OPTIONS).toContain(SPECIAL_CARE_HIGH_VALUE);
  });
});

describe('specialCareFlags', () => {
  it('returns what the garment carries, in the canonical order', () => {
    const privateData = { specialCare: { flags: ['highValue', 'embellishments'] } };

    expect(specialCareFlags(privateData)).toEqual(['embellishments', 'highValue']);
  });

  // "no se debe mostrar si está en false" - an unchecked box is not a fact about the garment.
  // "This dress has no sequins" is not something a studio needs told.
  it('never reports a flag that is not set', () => {
    expect(specialCareFlags({ specialCare: { flags: [] } })).toEqual([]);
    expect(specialCareFlags({ specialCare: {} })).toEqual([]);
    expect(specialCareFlags({})).toEqual([]);
    expect(specialCareFlags(undefined)).toEqual([]);
  });

  it('drops a flag it does not recognise rather than passing it through', () => {
    const privateData = { specialCare: { flags: ['highValue', 'somethingRemoved'] } };

    expect(specialCareFlags(privateData)).toEqual(['highValue']);
  });

  it('survives a malformed store', () => {
    [{ specialCare: { flags: 'highValue' } }, { specialCare: null }, null].forEach(pd => {
      expect(specialCareFlags(pd)).toEqual([]);
    });
  });
});

describe('specialCareNote', () => {
  it('trims the note', () => {
    expect(specialCareNote({ specialCare: { note: '  Loose hem  ' } })).toBe('Loose hem');
  });

  it('treats an empty or missing note as none', () => {
    ['', '   ', null, undefined, 42].forEach(note => {
      expect(specialCareNote({ specialCare: { note } })).toBeNull();
    });
  });

  it('caps a note that would otherwise be a novel', () => {
    const long = 'x'.repeat(SPECIAL_CARE_NOTE_MAX_LENGTH + 50);

    expect(specialCareNote({ specialCare: { note: long } })).toHaveLength(
      SPECIAL_CARE_NOTE_MAX_LENGTH
    );
  });
});

describe('specialCareForStorage', () => {
  it('keeps the recognised flags and the trimmed note', () => {
    expect(specialCareForStorage({ flags: ['highValue', 'nope'], note: '  Hand wash  ' })).toEqual({
      flags: ['highValue'],
      note: 'Hand wash',
    });
  });

  // null REMOVES the key. Sharetribe only drops extended data when it is explicitly null, and
  // an empty `specialCare` would read as "somebody considered this and said nothing" - a
  // different claim from "nobody has said".
  it('returns null when there is nothing to say', () => {
    [{ flags: [], note: '' }, { flags: [], note: '   ' }, {}, undefined].forEach(input => {
      expect(specialCareForStorage(input)).toBeNull();
    });
  });

  it('keeps a note with no flags, and flags with no note', () => {
    expect(specialCareForStorage({ flags: [], note: 'Do not tumble dry' })).toEqual({
      flags: [],
      note: 'Do not tumble dry',
    });
    expect(specialCareForStorage({ flags: ['pressedPleats'] })).toEqual({
      flags: ['pressedPleats'],
      note: null,
    });
  });
});
