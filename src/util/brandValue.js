/**
 * THE BRAND THE OWNER TYPED, TIDIED AND SNAPPED ONTO A SPELLING THAT ALREADY EXISTS.
 *
 *   > "este autocomplete debe tener la propiedad de guardar datos bien escritos, ya sea que
 *   >  todo en minusculas, o primer letra en mayuscula o todo en mayuscula, considera lo mas
 *   >  apropiado para marcas de ropa"
 *
 * The answer to "which case" is NONE OF THEM. Clothing brands are trademarks with deliberate
 * capitalisation - ZARA, H&M, COS, agnès b., rag & bone - so every one of the three options
 * offered is wrong for some real brand. The brands already on Dev make the point without
 * needing hypotheticals: title case turns `Lulu's` into `Lulu'S`, and `Belle Étoile Atelier`
 * needs accent-aware folding before any rule works at all.
 *
 * So consistency is bought a different way. The autocomplete offers what is already stored, and
 * anything the owner types that MATCHES an existing brand is snapped onto that brand's
 * spelling. Typing `zara` where `ZARA` exists stores `ZARA`; the data converges without any
 * spelling ever being invented.
 *
 * A brand nobody has used yet is stored as typed, trimmed. That is deliberate: the first person
 * to list a brand is the one person who knows how it is written, and a rule that "corrects"
 * them would be wrong exactly when it matters most.
 *
 * MIRRORS server/api-util/brandDirectory.js, which does the same folding to decide which
 * spellings are one brand. The two live apart because one is ESM in the browser and the other
 * CommonJS on the server; they must agree, and the tests on both sides use the same cases.
 */

/**
 * Fold a brand for comparison only. Never stored, never shown.
 *
 * @param {string} brand
 * @returns {string}
 */
export const brandComparisonKey = brand =>
  String(brand)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Tidy a typed brand: trim and collapse runs of whitespace. Case is left alone.
 *
 * @param {*} brand
 * @returns {string|null} the cleaned brand, or null if there is nothing left
 */
export const cleanBrandInput = brand => {
  if (typeof brand !== 'string') {
    return null;
  }
  const cleaned = brand.trim().replace(/\s+/g, ' ');
  return cleaned === '' ? null : cleaned;
};

/**
 * What to STORE for a typed brand.
 *
 * @param {*} typed - the raw input value
 * @param {Array<{brand: string}>} brandOptions - the brands that already exist
 * @returns {string|null} the brand to store, or null to store nothing
 */
export const normalizeBrandForStorage = (typed, brandOptions = []) => {
  const cleaned = cleanBrandInput(typed);
  if (!cleaned) {
    return null;
  }

  const key = brandComparisonKey(cleaned);
  const existing = (Array.isArray(brandOptions) ? brandOptions : []).find(
    option => option?.brand && brandComparisonKey(option.brand) === key
  );

  return existing ? existing.brand : cleaned;
};
