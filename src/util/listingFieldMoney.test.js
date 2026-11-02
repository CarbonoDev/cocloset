import { formatMoneyListingFieldValue, isMoneyListingField } from './listingFieldMoney';

// A real `intl` rather than a stub: the whole point of going through it is that it knows where
// the symbol goes and how the number is grouped, and a stub would test neither.
const intlFor = locale => {
  const formatter = {
    formatNumber: (value, opts) => new Intl.NumberFormat(locale, opts).format(value),
  };
  return formatter;
};

const intl = intlFor('en-US');

describe('isMoneyListingField', () => {
  it('knows the retail value is money', () => {
    expect(isMoneyListingField('retailValue')).toBe(true);
  });

  // The $ went missing a second time because the Console field's key drifted from `retailValue`
  // to `retail_value` underneath this hardcoded list - confirmed on a real published listing.
  // Both spellings are kept live so a drift back doesn't silently reopen the same report.
  it('also knows the snake_case spelling live listings actually use', () => {
    expect(isMoneyListingField('retail_value')).toBe(true);
  });

  // The other keys on a real Dev listing. A size or a colour formatted as currency would be
  // worse than the bare number this replaces.
  it('leaves every other field alone', () => {
    ['size', 'color', 'material', 'brand', 'occasion', 'categoryLevel1'].forEach(key => {
      expect(isMoneyListingField(key)).toBe(false);
    });
  });
});

describe('formatMoneyListingFieldValue', () => {
  it('puts the currency on a whole amount, without inventing cents', () => {
    expect(formatMoneyListingFieldValue(120, { intl, currency: 'USD' })).toBe('$120');
  });

  it('keeps the cents on an amount that has them', () => {
    expect(formatMoneyListingFieldValue(120.5, { intl, currency: 'USD' })).toBe('$120.50');
  });

  // "si es numérico" - taken literally. "120 USD" typed into the field must not become
  // "$120 USD", and a value this cannot read is one it has no business rewriting.
  it('returns a non-numeric value untouched', () => {
    ['120 USD', '', null, undefined, {}, NaN, Infinity].forEach(value => {
      expect(formatMoneyListingFieldValue(value, { intl, currency: 'USD' })).toBe(value);
    });
  });

  it('returns the value untouched when the marketplace currency is unknown', () => {
    expect(formatMoneyListingFieldValue(120, { intl, currency: undefined })).toBe(120);
  });

  // Not a hardcoded "$". Both currencies this marketplace might run in print `$`, so the
  // literal would look right and be wrong the first time that changes.
  it('uses the marketplace currency rather than assuming dollars', () => {
    expect(formatMoneyListingFieldValue(120, { intl, currency: 'EUR' })).toContain('€');
  });
});
