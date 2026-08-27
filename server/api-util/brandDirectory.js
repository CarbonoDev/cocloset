/**
 * THE BRANDS THAT ACTUALLY EXIST ON LISTINGS.
 *
 *   > "Podemos usar brand como un autocomplete de todas las brands que existen ... este
 *   >  autocomplete debe tener la propiedad de guardar datos bien escritos"
 *
 * Sharetribe has no aggregation API, so "every brand" has to be assembled by walking the
 * listings. This module is the walk and the tidying; the two endpoints that need the list are
 * thin wrappers over it, the way api-util/laundryDirectory.js serves both laundry endpoints.
 *
 * ── THE SPELLING RULE ──────────────────────────────────────────────────────
 * Trim, collapse internal whitespace, and NEVER recase. The brands already on Dev are why:
 *
 *     Reformation · Lulu's · Bella Barnett · Belle Étoile Atelier · Club Monaco · Unbranded
 *
 * Naive title case turns `Lulu's` into `Lulu'S`; lowercasing destroys a `ZARA`; and
 * `Belle Étoile` needs accent-aware folding before any of it works. Clothing brands are
 * trademarks with deliberate capitalisation - H&M, COS, agnès b., rag & bone - so any rule that
 * rewrites them is wrong for some real brand. The consistency the client asked for is bought a
 * different way: the autocomplete offers what is already stored, so picking `Reformation` off
 * the list is what stops a second listing inventing `reformation`.
 *
 * Casing is still folded for GROUPING, so `Zara` and `ZARA` count as one brand rather than two
 * options a step apart in the dropdown. When both spellings exist, the more common one wins,
 * and ties break alphabetically so the answer does not depend on listing order.
 */

// Dev has `Dres the Population`, a typo of `Dress the Population`, sitting next to correctly
// spelled brands - which is the case this whole feature exists to stop repeating. It is NOT
// filtered out here: a brand somebody typed is a brand some listing is filed under, and hiding
// it from the dropdown would hide those listings from the filter. The fix for a typo is to edit
// the listing, not to make the option invisible.

/**
 * Fold a brand for comparison only. Never stored, never shown.
 *
 * Accents are folded too, so `Belle Étoile` and `Belle Etoile` group together - somebody
 * typing without accents is the same failure the autocomplete exists to catch.
 *
 * @param {string} brand
 * @returns {string}
 */
const brandComparisonKey = brand =>
  String(brand)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Tidy a stored brand: trim, collapse runs of whitespace. Case is left alone.
 *
 * @param {*} brand
 * @returns {string|null} the cleaned brand, or null if there is nothing left
 */
const cleanBrand = brand => {
  if (typeof brand !== 'string') {
    return null;
  }
  const cleaned = brand.trim().replace(/\s+/g, ' ');
  return cleaned === '' ? null : cleaned;
};

/**
 * The distinct brands across a set of listings, best spelling first.
 *
 * @param {Array<Object>} listings - listing entities
 * @returns {Array<{brand: string, count: number}>} sorted alphabetically by brand
 */
const buildBrandDirectory = (listings = []) => {
  const groups = new Map();

  (Array.isArray(listings) ? listings : []).forEach(listing => {
    const brand = cleanBrand(listing?.attributes?.publicData?.brand);
    if (!brand) {
      return;
    }

    const key = brandComparisonKey(brand);
    const group = groups.get(key) || { spellings: new Map(), count: 0 };
    group.spellings.set(brand, (group.spellings.get(brand) || 0) + 1);
    group.count += 1;
    groups.set(key, group);
  });

  return [...groups.values()]
    .map(({ spellings, count }) => {
      // The most-used spelling represents the group. Ties break alphabetically rather than by
      // insertion order, so the same data always produces the same answer no matter which page
      // of listings happened to come back first.
      const best = [...spellings.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
      )[0][0];
      return { brand: best, count };
    })
    .sort((a, b) => a.brand.localeCompare(b.brand));
};

// listings.query returns one page at a time. MAX_PAGES bounds the Integration API quota a
// single request can burn; when it is hit, `truncated` says so rather than pretending the list
// is complete - the same contract as fetchAllUsers in api-util/laundryDirectory.js.
//
// A truncated brand list is not cosmetic: it is an autocomplete, so a missing brand means the
// next person types their own spelling of it and the fragmentation this prevents starts anyway.
// The caller is expected to surface `truncated`, not swallow it.
const PER_PAGE = 100;
const MAX_PAGES = 20;

const fetchListingsPage = (integrationSdk, page, collected) =>
  integrationSdk.listings
    .query({ page, perPage: PER_PAGE, states: ['published'] })
    .then(response => {
      const { data = [], meta = {} } = response.data || {};
      const listings = collected.concat(data);
      const totalPages = Number.isFinite(meta.totalPages) ? meta.totalPages : page;

      if (page < totalPages && page < MAX_PAGES) {
        return fetchListingsPage(integrationSdk, page + 1, listings);
      }
      return { listings, truncated: page < totalPages };
    });

/**
 * Every published listing, paged.
 *
 * PUBLISHED ONLY. A draft's brand is not on anything a reader can reach, and offering it in a
 * filter would produce a search that returns nothing.
 *
 * @param {Object} integrationSdk
 * @returns {Promise<{listings: Array<Object>, truncated: boolean}>}
 */
const fetchAllPublishedListings = integrationSdk => fetchListingsPage(integrationSdk, 1, []);

module.exports = {
  cleanBrand,
  brandComparisonKey,
  buildBrandDirectory,
  fetchAllPublishedListings,
};
