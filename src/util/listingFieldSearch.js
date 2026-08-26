import {
  SCHEMA_TYPE_ENUM,
  SCHEMA_TYPE_MULTI_ENUM,
  SCHEMA_TYPE_SHORT_TEXT,
  SCHEMA_TYPE_TEXT,
} from './types';

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
 * FREE TEXT IS TWO SCHEMA TYPES, NOT ONE. Console offers a short (70 char) and a long free
 * text field, and they arrive in the hosted asset as `shortText` and `text`. The first
 * version of this module handled only `text`, which is why the brand link never appeared:
 * Cocloset's `brand` is configured as `shortText`, fell past every branch below, and
 * returned null - so `CustomListingFields` was handed no search params and rendered the
 * value as plain text, exactly as it did before the feature. Both are free text and both
 * take the keyword fallback; they are listed explicitly rather than defaulted to, because
 * a future schema type that is NOT text (a date, say) must not silently become a keyword
 * search for its own raw value.
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
  if (
    schemaType === SCHEMA_TYPE_TEXT ||
    schemaType === SCHEMA_TYPE_SHORT_TEXT ||
    schemaType === SCHEMA_TYPE_ENUM ||
    !schemaType
  ) {
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

/**
 * FIELDS THAT ARE FILTERABLE WITHOUT BEING CONSOLE FIELDS.
 *
 * `brand` was REMOVED from Console so that `flex-cli` could own the `pub_brand` search schema -
 * Console owns the schema for the fields it defines, and a Console `text` field cannot produce
 * a filterable parameter at all (it only feeds `keywords`). The filter exists precisely because
 * the field left.
 *
 * The consequence lands here. Callers resolve a field's config by looking it up in the hosted
 * listing fields, and brand is no longer in them - so the lookup returned undefined and the
 * brand on the listing page silently stopped being a link. It degraded to plain text, which is
 * why nothing broke visibly and why this needs to be written down.
 *
 * This is the config that Console would have held. `enum` + `indexForSearch` describes the
 * schema that was actually pushed and verified against Dev, so the link produces the same
 * `pub_brand=<value>` the search page's own filter does. Keep the two in step: this and
 * `withBrandFilter` in containers/SearchPage/SearchPage.shared.js describe one thing.
 */
const CONFIGLESS_SEARCHABLE_FIELDS = {
  brand: {
    key: 'brand',
    scope: 'public',
    schemaType: SCHEMA_TYPE_ENUM,
    filterConfig: { indexForSearch: true },
  },
};

/**
 * The config to search a field by: the hosted one when Console has it, otherwise the built-in
 * fallback above.
 *
 * Console WINS when both exist. If brand is ever added back as a Console field, whatever the
 * operator configured there is the truth, and this stops applying on its own.
 *
 * @param {string} key - the listing field key
 * @param {Array<Object>} listingFieldConfigs - the merged (hosted) listing field configs
 * @returns {Object|undefined}
 */
export const listingFieldSearchConfig = (key, listingFieldConfigs = []) => {
  const hosted = (listingFieldConfigs || []).find(config => config.key === key);
  return hosted || CONFIGLESS_SEARCHABLE_FIELDS[key];
};
