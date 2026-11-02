import { brandComparisonKey, cleanBrandInput, normalizeBrandForStorage } from './brandValue';

// The same cases as server/api-util/brandDirectory.test.js. The two modules live apart - one is
// ESM in the browser, the other CommonJS on the server - and they have to agree, so they are
// tested against the same brands.
const existing = [
  { brand: 'ZARA', count: 3 },
  { brand: "Lulu's", count: 1 },
  { brand: 'Belle Étoile Atelier', count: 1 },
];

describe('cleanBrandInput', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanBrandInput('  Club   Monaco ')).toBe('Club Monaco');
  });

  // The question the client asked - lowercase, title case or uppercase - answered with none of
  // them. Every one of the three is wrong for some real clothing brand.
  it('never changes the case', () => {
    ['ZARA', 'agnès b.', 'H&M', "Lulu's", 'rag & bone', 'COS'].forEach(brand => {
      expect(cleanBrandInput(brand)).toBe(brand);
    });
  });

  it('treats an empty or non-string value as no brand', () => {
    [null, undefined, '', '   ', 42, {}].forEach(value => {
      expect(cleanBrandInput(value)).toBeNull();
    });
  });
});

describe('brandComparisonKey', () => {
  it('folds case and accents', () => {
    expect(brandComparisonKey('Belle Étoile')).toBe(brandComparisonKey('belle etoile'));
    expect(brandComparisonKey('ZARA')).toBe(brandComparisonKey('Zara'));
  });
});

describe('normalizeBrandForStorage', () => {
  // THE WHOLE POINT. Consistency comes from converging on a spelling that exists, not from
  // rewriting what the owner typed into some house style.
  it('snaps a typed brand onto the spelling that already exists', () => {
    expect(normalizeBrandForStorage('zara', existing)).toBe('ZARA');
    expect(normalizeBrandForStorage('Zara', existing)).toBe('ZARA');
    expect(normalizeBrandForStorage('  zaRA  ', existing)).toBe('ZARA');
  });

  it('matches through accents, so a keyboard without them still converges', () => {
    expect(normalizeBrandForStorage('belle etoile atelier', existing)).toBe('Belle Étoile Atelier');
  });

  // The first person to list a brand is the one person who knows how it is written. A rule that
  // "corrected" them would be wrong exactly where it matters most.
  it('stores a brand nobody has used yet exactly as typed, trimmed', () => {
    expect(normalizeBrandForStorage('  Bella  Barnett ', existing)).toBe('Bella Barnett');
    expect(normalizeBrandForStorage('agnès b.', existing)).toBe('agnès b.');
  });

  // null, not undefined: Sharetribe only removes a publicData key when it is explicitly set to
  // null, so an owner clearing the field has to send one.
  it('returns null when there is nothing to store', () => {
    [null, undefined, '', '    '].forEach(value => {
      expect(normalizeBrandForStorage(value, existing)).toBeNull();
    });
  });

  it('works with no list to snap onto', () => {
    expect(normalizeBrandForStorage('Reformation', [])).toBe('Reformation');
    expect(normalizeBrandForStorage('Reformation', null)).toBe('Reformation');
    expect(normalizeBrandForStorage('Reformation', undefined)).toBe('Reformation');
  });

  it('ignores a malformed option rather than throwing on it', () => {
    expect(normalizeBrandForStorage('Reformation', [{}, null, { brand: null }])).toBe(
      'Reformation'
    );
  });
});
