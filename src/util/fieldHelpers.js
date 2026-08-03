// This util file is about user and listing fields.
// I.e. These are custom fields to data entities. They are added through the Marketplace Console.
// In the codebase, we also have React Final Form fields, which are wrapper around user inputs.

import {
  isPurchaseProcessAlias,
  isBookingProcessAlias,
  isNegotiationProcessAlias,
  isDownloadProcessAlias,
} from '../transactions/transaction';
import {
  EXTENDED_DATA_SCHEMA_TYPES,
  SCHEMA_TYPE_MULTI_ENUM,
  SCHEMA_TYPE_TEXT,
  SCHEMA_TYPE_YOUTUBE,
} from './types';
import appSettings from '../config/settings';
import { addScopePrefix } from './userHelpers';

const { stripeSupportedCurrencies, subUnitDivisors } = appSettings;

const keyMapping = {
  userType: {
    wrapper: 'userTypeConfig',
    limitTo: 'limitToUserTypeIds',
    ids: 'userTypeIds',
  },
  listingType: {
    wrapper: 'listingTypeConfig',
    limitTo: 'limitToListingTypeIds',
    ids: 'listingTypeIds',
  },
  category: {
    wrapper: 'categoryConfig',
    limitTo: 'limitToCategoryIds',
    ids: 'categoryIds',
  },
};

const getEntityTypeRestrictions = (entityTypeKey, config) => {
  const { wrapper, limitTo, ids } = keyMapping[entityTypeKey];
  const isLimited = config && config[wrapper] && config[wrapper][limitTo];
  const limitToIds = config && config[wrapper] && config[wrapper][ids];

  return { isLimited, limitToIds };
};

const isCustomFieldRelevantForEntityType = (entityTypeKey, publicData, config) => {
  if (entityTypeKey == null) {
    return true;
  }

  const entityType = publicData && publicData[entityTypeKey];
  return isFieldFor(entityTypeKey, entityType, config);
};

/**
 * Get a snake-cased key with the specified prefix, e.g. customer_options
 * @param {String} prefix the prefix to append to the key, e.g. 'customer'
 * @param {String} key the original key, e.g. 'options'
 * @returns string
 */
export const getPrefixedKey = (prefix, key) => `${prefix}_${key}`;

/**
 * Check if the given listing type is allowed according to the given listing field config.
 *
 * @param {String} entityTypeKey entity type key (e.g. 'listingType', 'userType')
 * @param {String|Array<String>} entityType entity type to be checked (e.g. 'amenities'). Accepts an array too.
 * @param {*} fieldConfig the config of a custom listing field
 * @returns true if listingTypeConfig allows the listingType
 */
export const isFieldFor = (entityTypeKey, entityType, fieldConfig) => {
  const { isLimited, limitToIds } = getEntityTypeRestrictions(entityTypeKey, fieldConfig);

  if (Array.isArray(entityType)) {
    return !isLimited || limitToIds.some(cid => entityType.includes(cid));
  }
  return !isLimited || limitToIds.includes(entityType);
};

export const isFieldForUserType = (userType, fieldConfig) =>
  isFieldFor('userType', userType, fieldConfig);
export const isFieldForListingType = (listingType, fieldConfig) =>
  isFieldFor('listingType', listingType, fieldConfig);
export const isFieldForCategory = (categories, fieldConfig) =>
  isFieldFor('category', categories, fieldConfig);

/**
 * Returns the value of the attribute in extended data.
 * @param {*} data extended data containing the value
 * @param {*} key attribute key in extended data
 * @returns
 */
export const getFieldValue = (data, key) => {
  const value = data?.[key];
  return value != null ? value : null;
};

/**
 * Picks current values for listing categories based on provided public data and configuration.
 * This function validates if the initial values match with the configuration received via assets.
 * If a categoryLevel value doesn't match with the category configuration, it is not passed on to the form.
 *
 * @param {*} data publicData or some other set where category-related nested data is available
 * @param {String} prefix prefix used for storing nested values.
 * @param {Number} level refers to nesting level (starts from 1)
 * @param {Array} categoryLevelOptions array of nested category structure
 * @returns pick valid prefixed properties
 */
export const pickCategoryFields = (data, prefix, level, categoryLevelOptions = []) => {
  const currentCategoryKey = `${prefix}${level}`;
  const currentCategoryValue = data[currentCategoryKey];
  const isCategoryLevelSet = typeof currentCategoryValue !== 'undefined';

  // Validate the value against category options
  const categoryOptionConfig = categoryLevelOptions.find(
    category => category.id === currentCategoryValue
  );
  const isValidCategoryValue = !!categoryOptionConfig;
  const nextLevelOptions = categoryOptionConfig?.subcategories || [];

  // Return category level property if it's found from the data and the value is one of the valid options.
  // Go through all the nested levels.
  return isCategoryLevelSet && isValidCategoryValue
    ? {
        [currentCategoryKey]: currentCategoryValue,
        ...pickCategoryFields(data, prefix, ++level, nextLevelOptions),
      }
    : {};
};

// Console writes a listing's category into fixed, numbered keys — categoryLevel1,
// categoryLevel2, categoryLevel3 — never a single `category` key. See the
// "Don't change!" note on the category configuration above: the search schema is
// pinned to these names.
const CATEGORY_LEVEL_KEYS = ['categoryLevel1', 'categoryLevel2', 'categoryLevel3'];

/**
 * Read a listing's selected category values out of its public data, most general first.
 *
 * A listing can carry up to three nested levels (e.g. `dresses` > `maxi_dress`), and code
 * comparing a listing against a category list generally wants to match any of them rather
 * than guess a level.
 *
 * @param {Object} publicData a listing's publicData (may be undefined)
 * @returns {Array<String>} the set category values, in level order, with gaps removed
 */
export const getListingCategoryValues = publicData =>
  CATEGORY_LEVEL_KEYS.map(key => publicData?.[key]).filter(
    value => typeof value === 'string' && value !== ''
  );

/**
 * Flatten Console's nested category tree into a depth-first list, keeping each node's
 * depth and its chain of ancestor names.
 *
 * The tree from `config.categoryConfiguration.categories` nests via `subcategories`, which
 * may be absent, empty, or populated (up to three levels). Anything that renders the whole
 * tree as a flat control — a checkbox group, a `<select>` — needs it in this shape, plus
 * enough context to show the hierarchy ("Dresses › Maxi Dress" or an indent per level).
 *
 * @param {Array<Object>} categories nested category configuration
 * @param {number} [level] 1-based nesting level of `categories` (used by the recursion)
 * @param {Array<String>} [ancestorNames] names of the nodes above `categories`
 * @returns {Array<{id: String, name: String, level: Number, path: Array<String>, hasSubcategories: Boolean}>}
 */
export const flattenCategoryTree = (categories = [], level = 1, ancestorNames = []) => {
  if (!Array.isArray(categories)) {
    return [];
  }
  return categories.reduce((flattened, category) => {
    const { id, name, subcategories } = category || {};
    // A node without an id can't be stored or matched against, so it is not an option.
    // Its children still can be, so keep walking rather than pruning the branch.
    const label = typeof name === 'string' && name !== '' ? name : id;
    const path = typeof id === 'string' && id !== '' ? [...ancestorNames, label] : ancestorNames;
    const children = Array.isArray(subcategories) ? subcategories : [];
    const selfMaybe =
      typeof id === 'string' && id !== ''
        ? [{ id, name: label, level, path, hasSubcategories: children.length > 0 }]
        : [];

    return [...flattened, ...selfMaybe, ...flattenCategoryTree(children, level + 1, path)];
  }, []);
};

/**
 * Build an id -> node lookup over the flattened category tree.
 *
 * @param {Array<Object>} categories nested category configuration
 * @returns {Map<String, Object>} keyed by category id
 */
export const buildCategoryIndex = (categories = []) =>
  new Map(flattenCategoryTree(categories).map(entry => [entry.id, entry]));

/**
 * Turn stored category values into something a human can read.
 *
 * Console category ids (`midi_dress`) are what we store and match on, but they are not
 * words — showing them raw in a warning or on a laundry card tells the reader nothing.
 * Values that aren't known ids are passed through unchanged: they are the free-text
 * entries laundries typed before the picker existed ("Eveningwear"), and those already
 * read as labels.
 *
 * @param {Array<Object>} categories nested category configuration
 * @param {Array<String>} values stored values (category ids and/or legacy free text)
 * @param {Object} [options]
 * @param {boolean} [options.withPath] render the full branch, e.g. "Dresses › Maxi Dress"
 * @returns {Array<String>} labels, one per input value, in input order
 */
export const getCategoryLabels = (categories, values = [], options = {}) => {
  const { withPath = false } = options;
  const index = buildCategoryIndex(categories);
  return (Array.isArray(values) ? values : []).map(value => {
    const entry = index.get(value);
    if (!entry) {
      return value;
    }
    return withPath ? entry.path.join(' › ') : entry.name;
  });
};

/**
 * Split a laundry's stored `acceptedCategories` into values the current Console
 * configuration recognises and values it doesn't.
 *
 * The second bucket is not junk to be thrown away: it is what a laundry typed into the
 * old free-text field. Callers keep it so a migration never silently narrows which
 * garments a studio says it takes.
 *
 * @param {Array<Object>} categories nested category configuration
 * @param {Array<String>} values stored `acceptedCategories`
 * @returns {{known: Array<String>, legacy: Array<String>}}
 */
export const splitAcceptedCategories = (categories, values = []) => {
  const index = buildCategoryIndex(categories);
  return (Array.isArray(values) ? values : [])
    .filter(value => typeof value === 'string' && value.trim() !== '')
    .reduce(
      (split, value) => {
        const bucket = index.has(value) ? 'known' : 'legacy';
        return { ...split, [bucket]: [...split[bucket], value] };
      },
      { known: [], legacy: [] }
    );
};

/**
 * Decide whether a laundry accepts a listing, given both sides' category values.
 *
 * HIERARCHY RULE: a listing is accepted if ANY level of its category chain is accepted.
 * A listing filed under `dresses` > `midi_dress` carries both ids (see
 * getListingCategoryValues), so a laundry that ticks the parent `dresses` accepts the
 * whole branch without ticking every child, and a laundry that ticks only `midi_dress`
 * accepts just that leaf. Both directions fall out of a single `some`.
 *
 * Comparison is by exact id. It used to be a case-insensitive string compare, which was
 * the only thing that could be done while the laundry side was free text — and it matched
 * nothing, because the two sides never shared a vocabulary.
 *
 * @param {Array<String>} listingCategoryValues the listing's ids, general -> specific
 * @param {Array<String>} acceptedCategories the laundry's stored accepted values
 * @returns {boolean} true if accepted (also true when either side says nothing)
 */
export const isCategoryAcceptedByLaundry = (
  listingCategoryValues = [],
  acceptedCategories = []
) => {
  const listingValues = Array.isArray(listingCategoryValues) ? listingCategoryValues : [];
  const accepted = Array.isArray(acceptedCategories) ? acceptedCategories : [];
  // No opinion from either side is not a mismatch — an uncategorised listing or a laundry
  // that hasn't configured its list yet must not be flagged.
  if (listingValues.length === 0 || accepted.length === 0) {
    return true;
  }
  const acceptedSet = new Set(accepted);
  return listingValues.some(value => acceptedSet.has(value));
};

/* ================ Per-category laundry pricing (form plumbing) ================ */

// A laundry's per-category configuration is stored as an OBJECT keyed by Console
// category id, on its own profile privateData:
//
//   privateData.categoryPricing = {
//     dresses:    { turnaroundHours: 72, cleaningFee: 15 },
//     midi_dress: { cleaningFee: 22 },
//   }
//
// The RESOLUTION rule (which of those applies to a given listing) lives server-side in
// server/api-util/categoryPricing.js and is deliberately NOT duplicated here — the
// helpers below are only about getting values in and out of the form. In short:
// cleaningFee is settable at any level and the HIGHEST match on the listing's chain
// wins; turnaroundHours is settable on TOP-LEVEL categories only.

export const CATEGORY_PRICING_FIELDS = ['turnaroundHours', 'cleaningFee'];

// Form field names are FLAT, not `categoryPricing.dresses.cleaningFee`.
//
// React Final Form parses dots and brackets in a field name as a path into the values
// object. A Console category id is free-form operator input, so an id containing `.`
// or `[` would silently write to the wrong place — the studio would type a price, see
// it accepted, and save nothing. A flat name with a separator final-form treats as
// ordinary text sidesteps that entirely; the nested object is assembled at submit time
// by categoryPricingFromFormValues.
const CATEGORY_PRICING_SEPARATOR = '__';
const CATEGORY_PRICING_PREFIX = `categoryPricing${CATEGORY_PRICING_SEPARATOR}`;

/**
 * Build the form field name holding one field of one category's pricing.
 *
 * @param {String} field 'turnaroundHours' or 'cleaningFee'
 * @param {String} categoryId Console category id
 * @returns {String} a flat form field name
 */
export const categoryPricingFieldName = (field, categoryId) =>
  `${CATEGORY_PRICING_PREFIX}${field}${CATEGORY_PRICING_SEPARATOR}${categoryId}`;

// Parse a flat field name back into { field, categoryId }, or null if it isn't one.
// The id is everything after the SECOND separator, so an id that itself contains the
// separator round-trips unharmed.
const parseCategoryPricingFieldName = name => {
  if (typeof name !== 'string' || !name.startsWith(CATEGORY_PRICING_PREFIX)) {
    return null;
  }
  const rest = name.slice(CATEGORY_PRICING_PREFIX.length);
  const field = CATEGORY_PRICING_FIELDS.find(
    candidate => rest === candidate || rest.startsWith(`${candidate}${CATEGORY_PRICING_SEPARATOR}`)
  );
  if (!field) {
    return null;
  }
  const categoryId = rest.slice(field.length + CATEGORY_PRICING_SEPARATOR.length);
  return categoryId ? { field, categoryId } : null;
};

/**
 * Turn a stored `categoryPricing` object into flat form initialValues.
 *
 * @param {Object} categoryPricing stored table, keyed by category id
 * @returns {Object} flat field-name -> number pairs, blanks omitted
 */
export const categoryPricingToFormValues = categoryPricing => {
  const table =
    categoryPricing && typeof categoryPricing === 'object' && !Array.isArray(categoryPricing)
      ? categoryPricing
      : {};

  return Object.entries(table).reduce((values, [categoryId, entry]) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return values;
    }
    return CATEGORY_PRICING_FIELDS.reduce((acc, field) => {
      const value = entry[field];
      return typeof value === 'number' && Number.isFinite(value)
        ? { ...acc, [categoryPricingFieldName(field, categoryId)]: value }
        : acc;
    }, values);
  }, {});
};

/**
 * Collect the flat per-category fields out of a form's submitted values and rebuild
 * the nested `categoryPricing` object to store.
 *
 * Blank inputs are DROPPED rather than stored as null: an empty box means "no specific
 * value, use the studio-wide one", and that is expressed by the key's absence. Storing
 * nulls would fill the table with rows that mean nothing and have to be skipped on
 * every read. A category left with no usable value at all contributes no entry.
 *
 * @param {Object} values the form's submitted values
 * @returns {Object} `categoryPricing`, keyed by category id
 */
export const categoryPricingFromFormValues = values => {
  return Object.entries(values || {}).reduce((table, [name, value]) => {
    const parsed = parseCategoryPricingFieldName(name);
    if (!parsed || typeof value !== 'number' || !Number.isFinite(value)) {
      return table;
    }
    const { field, categoryId } = parsed;
    return { ...table, [categoryId]: { ...table[categoryId], [field]: value } };
  }, {});
};

/**
 * Which categories does this studio have a stored per-category value for that it can
 * no longer see or edit — because it un-ticked the category, or Console dropped it?
 *
 * Stored entries are retained rather than pruned (an entry for a category no listing
 * can be filed under is unreachable, while pruning on a hosted-asset fetch that came
 * back empty would destroy a whole fee table). Retained-but-invisible is the part that
 * needs surfacing: money the studio configured and can no longer find is exactly how a
 * "why are we charging that?" bug survives for months.
 *
 * @param {Object} categoryPricing stored table, keyed by category id
 * @param {Array<String>} visibleCategoryIds ids the form is currently rendering rows for
 * @returns {Array<String>} ids with stored values but no visible row, in stored order
 */
export const getOrphanedPricingCategories = (categoryPricing, visibleCategoryIds = []) => {
  const table =
    categoryPricing && typeof categoryPricing === 'object' && !Array.isArray(categoryPricing)
      ? categoryPricing
      : {};
  const visible = new Set(Array.isArray(visibleCategoryIds) ? visibleCategoryIds : []);

  return Object.keys(table).filter(categoryId => {
    if (visible.has(categoryId)) {
      return false;
    }
    const entry = table[categoryId];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return false;
    }
    // Only entries that actually hold a number are worth reporting; an empty `{}` is
    // debris, not configuration.
    return CATEGORY_PRICING_FIELDS.some(
      field => typeof entry[field] === 'number' && Number.isFinite(entry[field])
    );
  });
};

// Walk one branch of the category tree depth-first, recording each node's depth and
// the chain of ancestor names. Kept local (rather than reusing flattenCategoryTree)
// because the grouping below needs to know which TOP-LEVEL branch a node belongs to,
// and flattenCategoryTree's `path` records ancestor names, not ids.
const collectBranchNodes = (subcategories, level, ancestorNames) =>
  (Array.isArray(subcategories) ? subcategories : []).reduce((nodes, node) => {
    const { id, name, subcategories: children } = node || {};
    const label = typeof name === 'string' && name !== '' ? name : id;
    // A node with no id can't be stored against or matched, so it is not editable —
    // but its children still can be, so keep walking rather than pruning the branch.
    const isUsable = typeof id === 'string' && id !== '';
    const path = isUsable ? [...ancestorNames, label] : ancestorNames;
    const selfMaybe = isUsable ? [{ id, name: label, level, path }] : [];
    return [...nodes, ...selfMaybe, ...collectBranchNodes(children, level + 1, path)];
  }, []);

/**
 * Group a laundry's accepted categories into the rows its pricing form should render.
 *
 * The two fields are configured at different granularities, which is what shapes this:
 *   - turnaroundHours is set on the TOP-LEVEL category only ("las horas estan bien por
 *     categoría grande"), so it belongs to the group header.
 *   - cleaningFee is set on any accepted node, so it belongs to the rows inside.
 *
 * A group is emitted whenever the studio accepts anything in that branch — including
 * when it accepts only a subcategory. Accepting `midi_dress` but not `dresses` still
 * needs a `Dresses` hours input, because a midi-dress listing resolves its turnaround
 * from its top-level category regardless of which level the studio ticked.
 *
 * @param {Array<Object>} categories nested category configuration from Console
 * @param {Array<String>} acceptedCategories the laundry's stored accepted values
 * @returns {Array<{id: String, name: String, priceCategories: Array<{id, name, level, path}>}>}
 *   one entry per relevant top-level category, in Console's own order
 */
export const getCategoryPricingGroups = (categories, acceptedCategories = []) => {
  const accepted = new Set(
    (Array.isArray(acceptedCategories) ? acceptedCategories : []).filter(
      value => typeof value === 'string' && value !== ''
    )
  );

  return (Array.isArray(categories) ? categories : []).reduce((groups, topLevel) => {
    const { id, name, subcategories } = topLevel || {};
    if (typeof id !== 'string' || id === '') {
      return groups;
    }
    const label = typeof name === 'string' && name !== '' ? name : id;

    const priceCategories = [
      ...(accepted.has(id) ? [{ id, name: label, level: 1, path: [label] }] : []),
      ...collectBranchNodes(subcategories, 2, [label]).filter(node => accepted.has(node.id)),
    ];

    return priceCategories.length > 0 ? [...groups, { id, name: label, priceCategories }] : groups;
  }, []);
};

/**
 * Pick props for SectionMultiEnum and SectionText display components.
 *
 * @param {*} extendedData the different entity extended data containing the value(s) to be displayed:
 * publicData, metadata, protectedData.
 * @param {Array<Object>} fieldConfigs array of custom field configuration objects
 * @param {String} entityTypeKey the name of the key denoting the entity type in publicData.
 * E.g. 'listingType', 'userType', or 'category'
 * @param {function} shouldPickFn an optional function to add extra check before including the field props
 * @returns an object with attributes 'schemaType', 'key', and 'heading', as well as either
 * - 'options' and 'selectedOptions' for SCHEMA_TYPE_MULTI_ENUM
 * - or 'text' for SCHEMA_TYPE_TEXT
 */
export const pickCustomFieldProps = (extendedData, fieldConfigs, entityTypeKey, shouldPickFn) => {
  const { publicData, metadata, protectedData } = extendedData;
  return fieldConfigs?.reduce((pickedElements, config) => {
    const { key, enumOptions, schemaType, scope = 'public', showConfig } = config;
    const { label, unselectedOptions: showUnselectedOptions } = showConfig || {};
    const isTargetEntityType = isCustomFieldRelevantForEntityType(
      entityTypeKey,
      publicData,
      config
    );

    const createFilterOptions = options =>
      options.map(o => ({ key: `${o.option}`, label: o.label }));

    const shouldPick = shouldPickFn ? shouldPickFn(config) : true;

    const value =
      scope === 'public'
        ? getFieldValue(publicData, key)
        : scope === 'protected'
        ? getFieldValue(protectedData, key)
        : scope === 'metadata'
        ? getFieldValue(metadata, key)
        : null;

    return isTargetEntityType && schemaType === SCHEMA_TYPE_MULTI_ENUM && shouldPick
      ? [
          ...pickedElements,
          {
            schemaType,
            key,
            heading: label,
            options: createFilterOptions(enumOptions),
            selectedOptions: value || [],
            showUnselectedOptions: scope !== 'metadata' && showUnselectedOptions !== false,
          },
        ]
      : isTargetEntityType && !!value && config.schemaType === SCHEMA_TYPE_TEXT && shouldPick
      ? [
          ...pickedElements,
          {
            schemaType,
            key,
            heading: label,
            text: value,
          },
        ]
      : isTargetEntityType && schemaType === SCHEMA_TYPE_YOUTUBE && shouldPick
      ? [
          ...pickedElements,
          {
            schemaType,
            key,
            videoUrl: value,
            heading: label,
          },
        ]
      : pickedElements;
  }, []);
};

/**
 * Validates if the specified currency is compatible with the transaction process
 * and the payment processor being used.
 *
 * @param {string} transactionProcessAlias - The alias of the transaction process. Expected to be in the format
 *                               of "PROCESS_NAME/version" (e.g., "booking-default/release-1").
 * @param {string} listingCurrency - A currency code (e.g., "USD", "EUR").
 * @param {string|null} paymentProcessor - (Optional) The name of the payment processor, such as "stripe".
 *                                         Defaults to null if no payment processor is specified.
 *
 * @returns {boolean} - Returns true if the currency is valid for the specified transaction process
 *                      and payment processor, otherwise false.
 *
 * Notes:
 * - The function checks if the specified currency is compatible with Stripe (for booking or purchase processes).
 * - Stripe only supports certain currencies. You can use other currencies on your marketplace for transactions that
 * - don't utilise Stripe. This function performs a check that the currency and transaction process provided are compatible
 * - with each other.
 * - When the paymentProcessor flag is passed as null, this function ensures either:
 *    a) the currency is listed in the subUnitDivisors list (in settingsCurrency.js)
 *    b) The process is Stripe-compatible with a Stripe-supported currency.
 */
export const isValidCurrencyForTransactionProcess = (
  transactionProcessAlias,
  listingCurrency,
  paymentProcessor = null
) => {
  // booking and purchase processes use Stripe actions.
  const isStripeRelatedProcess =
    isPurchaseProcessAlias(transactionProcessAlias) ||
    isBookingProcessAlias(transactionProcessAlias) ||
    isNegotiationProcessAlias(transactionProcessAlias) ||
    isDownloadProcessAlias(transactionProcessAlias);

  // Determine if the listing currency is supported by Stripe
  const isStripeSupportedCurrency = stripeSupportedCurrencies.includes(listingCurrency);

  if (paymentProcessor === 'stripe') {
    // If using Stripe, only return true if both process and currency are compatible with Stripe
    return isStripeRelatedProcess && isStripeSupportedCurrency;
  } else if (paymentProcessor === null) {
    // If payment processor is not specified, allow any non-stripe related process with valid subunits or Stripe-related processes with supported currency
    return (
      (isStripeRelatedProcess && isStripeSupportedCurrency) ||
      (!isStripeRelatedProcess && Object.keys(subUnitDivisors).includes(listingCurrency))
    );
  }
};

/**
 * Return props for custom transaction fields
 * @param {Object} transactionFieldConfigs Configuration for transaction fields
 * @param {Boolean} isCustomer Flag to determine whether the target context
 * is a set of fields related to the customer
 * @returns an array of props for CustomExtendedDataField: key, name,
 * fieldConfig
 */
export const getPropsForCustomTransactionFieldInputs = (transactionFieldConfigs, isCustomer) => {
  return (
    transactionFieldConfigs?.reduce((pickedFields, fieldConfig) => {
      const { key, showTo, schemaType, scope } = fieldConfig || {};
      const namespacedKey = addScopePrefix(scope, key);
      const isKnownSchemaType = EXTENDED_DATA_SCHEMA_TYPES.includes(schemaType);
      const isTransactionScope = scope === 'protected';
      const showToCustomer = showTo === 'customer';
      const isCorrectRole = showToCustomer === isCustomer;

      return isKnownSchemaType && isTransactionScope && isCorrectRole
        ? [
            ...pickedFields,
            {
              key: namespacedKey,
              name: namespacedKey,
              fieldConfig: fieldConfig,
            },
          ]
        : pickedFields;
    }, []) || []
  );
};

/**
 * Pick extended data fields from given form data.
 * Picking is based on extended data configuration for the transaction and target user role.
 *
 * This expects submit data to be namespaced (e.g. 'prot_') and it returns the field without that namespace.
 * This function is used when form submit values are restructured for the actual API endpoint.
 *
 * @param {Object} data values to look through against transaction field configuration
 * @param {String} targetScope Check that the scope of extended data in the config matches this scope
 * @param {Boolean} isCustomer Flag to determine whether the data relates to a customer of a transaction
 * @param {Object} transactionFieldConfigs Field configurations
 * @returns an object with field data as key-value pairs
 */
export const pickTransactionFieldsData = (
  data,
  targetScope = 'protected',
  isCustomer,
  transactionFieldConfigs = []
) => {
  return transactionFieldConfigs.reduce((fields, field) => {
    const { key, schemaType, scope = 'protected', showTo } = field || {};
    const namespacedKey = addScopePrefix(scope, key);

    const isKnownSchemaType = EXTENDED_DATA_SCHEMA_TYPES.includes(schemaType);
    const isTargetScope = scope === targetScope;
    const showToCustomer = showTo === 'customer';
    const isCorrectRole = showToCustomer === isCustomer;
    const roleKey = getPrefixedKey(showTo, key);

    if (isKnownSchemaType && isTargetScope && isCorrectRole) {
      const fieldValue = getFieldValue(data, namespacedKey);
      return { ...fields, [roleKey]: fieldValue };
    }
    return fields;
  }, {});
};

/**
 * Returns a value for an enum, boolean, or long custom extended data field
 * @param {Array} enumOptions an array of enum options related to the field
 * @param {String | Number} value field value in extended data
 * @param {String} schemaType field schema type
 * @param {String} key field key
 * @param {*} label field label
 * @param {*} intl intl
 * @param {*} page the context where the details is being used
 * @returns an object with the detail information: key, value, label
 */
export const getDetailCustomFieldValue = (
  enumOptions,
  value,
  schemaType,
  key,
  label,
  intl,
  page
) => {
  const findSelectedOption = enumValue => enumOptions?.find(o => enumValue === `${o.option}`);
  const getBooleanMessage = value =>
    value
      ? intl.formatMessage({ id: `${page}.detailYes` })
      : intl.formatMessage({ id: `${page}.detailNo` });
  const optionConfig = findSelectedOption(value);

  return schemaType === 'enum'
    ? { key, value: optionConfig?.label, label }
    : schemaType === 'boolean'
    ? { key, value: getBooleanMessage(value), label }
    : schemaType === 'long'
    ? { key, value, label }
    : schemaType === 'shortText'
    ? { key, value, label }
    : null;
};

/**
 * Pick extended data fields from transaction protected data.
 * Picking is based on transaction fields configuration.
 *
 * This returns namespaced (e.g. 'prot_') initial values for the form.
 *
 * @param {Object} data extended data values to look through against userConfig.js and util/configHelpers.js
 * @param {String} targetScope Check that the scope of extended data the config matches
 * @param {String} targetUserType Check that the extended data is relevant for this user type.
 * @param {Object} userFieldConfigs Extended data configurations for user fields.
 * @returns Array of picked extended data fields
 */
export const initialValuesForTransactionFields = (data, transactionFieldConfigs) => {
  return transactionFieldConfigs?.reduce((fields, field) => {
    const { key, scope = 'protected', schemaType, showTo } = field || {};
    const namespacedKey = addScopePrefix(scope, key);
    // Fields are saved in extended data with a role prefix corresponding to
    // the author of the fields, so we need to use the same prefix when
    // fetching them from protected data
    const roleKey = getPrefixedKey(showTo, key);

    const isKnownSchemaType = EXTENDED_DATA_SCHEMA_TYPES.includes(schemaType);

    if (isKnownSchemaType) {
      const fieldValue = getFieldValue(data, roleKey);
      return { ...fields, [namespacedKey]: fieldValue };
    }
    return fields;
  }, {});
};
