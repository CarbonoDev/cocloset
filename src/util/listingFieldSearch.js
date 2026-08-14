import { SCHEMA_TYPE_ENUM, SCHEMA_TYPE_MULTI_ENUM, SCHEMA_TYPE_TEXT } from './types';

/**
 * TURNING A LISTING FIELD'S VALUE INTO A SEARCH.
 *
 *   > "puedes integrar un link en la página de listing page de manera que al dar click a la
 *   >  brand, me lleve a un result de search donde filtre por esa brand, por ahora es un texto
 *   >  libre pero puede cambiar a multiselect, considera ambos"
 *
 * The two shapes need DIFFERENT queries, and the difference is not cosmetic:
 *
 *   - an ENUM / MULTI-ENUM field is filterable, so the link can be a real filter:
 *     `?pub_brand=chanel` (multi-enum needs `has_any:`, which is how the template's own
 *     multi-select filters serialise a single selection).
 *   - FREE TEXT is not. Sharetribe cannot filter on an unindexed text key at all - the
 *     parameter would simply be ignored and the customer would get every listing in the
 *     marketplace, which reads as "the link is broken" rather than "there is no filter".
 *     So a text field falls back to `?keywords=`, the full-text search that DOES cover
 *     title and description-style content.
 *
 * WHICH ONE IS DECIDED FROM THE FIELD CONFIG, not hardcoded, so the day `brand` becomes a
 * multi-select in Console the link starts filtering properly with no code change. That is the
 * whole of "considera ambos".
 *
 * AND IT IS GATED ON `indexForSearch`. A field can be an enum and still have no search schema
 * pushed (`flex-cli search`), in which case `pub_brand=` is silently ignored - the same
 * fail-open behaviour documented in server/api/laundry-orders.js. An unindexed enum therefore
 * falls back to keywords too: a keyword search that finds roughly the right listings beats a
 * filter that quietly finds everything.
 */

/**
 * The search query params that find other listings sharing this field's value.
 *
 * @param {Object} fieldConfig - a merged listing field config (schemaType, key, filterConfig)
 * @param {*} value - the listing's value for that field
 * @returns {Object|null} params for SearchPage, or null when there is nothing to search for
 */
export const listingFieldSearchParams = (fieldConfig, value) => {
  const { key, schemaType, filterConfig } = fieldConfig || {};

  // Only a single, non-empty, scalar value makes a meaningful link. A multi-enum listing
  // holding several values has no one thing the reader clicked.
  const searchValue = typeof value === 'string' ? value.trim() : null;
  if (!key || !searchValue) {
    return null;
  }

  const isIndexed = filterConfig?.indexForSearch === true;

  if (isIndexed && schemaType === SCHEMA_TYPE_ENUM) {
    return { [`pub_${key}`]: searchValue };
  }
  if (isIndexed && schemaType === SCHEMA_TYPE_MULTI_ENUM) {
    // `has_any:` is how the template's own multi-select filter serialises a selection; a bare
    // value would be read as "has_all" by some filters and match nothing.
    return { [`pub_${key}`]: `has_any:${searchValue}` };
  }
  if (schemaType === SCHEMA_TYPE_TEXT || schemaType === SCHEMA_TYPE_ENUM || !schemaType) {
    return { keywords: searchValue };
  }

  return null;
};

/**
 * The listing fields whose value is rendered as a link to a filtered search.
 *
 * A list rather than "every field", because most of them are not things a customer would want
 * to browse by - a size or a retail value clicking through to a search would be noise. Adding
 * one here is all it takes.
 */
export const SEARCHABLE_LISTING_FIELD_KEYS = ['brand'];

/**
 * Should this field's value link to a search?
 *
 * @param {string} key - the listing field key
 * @returns {boolean}
 */
export const isSearchableListingField = key => SEARCHABLE_LISTING_FIELD_KEYS.includes(key);
