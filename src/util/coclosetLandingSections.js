/**
 * WHICH CONSOLE SECTION BECOMES WHICH COMPONENT.
 *
 * The Pages editor in Console offers a fixed set of section TYPES - `columns`, `features`,
 * `carousel`, `hero`, `article`, `listings` - and the template's SectionBuilder dispatches on
 * exactly that. Cocloset's landing page needs layouts none of those types produce (a split
 * hero with an overlaid "how it works" card, numbered steps, a partner panel with a tile
 * grid), and there is no way to add a new type to the Console dropdown.
 *
 * What Console DOES let an operator set freely is the section's NAME. So the name is the
 * hook: the content stays authored and editable in Console exactly as it is today, and this
 * module is the single place that says which name gets which layout.
 *
 *   > "hay dos secciones que llamé ignore, esas deben permanecer tal cual"
 *
 * That instruction is why this is a lookup rather than a positional rule or a heuristic on
 * shape. A name that is not in the table below - `ignore`, or anything added later - is
 * returned untouched and renders through the stock component for its own `sectionType`,
 * which is the behaviour it has today. There is no fallback that could accidentally capture
 * a section nobody meant to restyle.
 *
 * WHY THIS IS A TRANSFORM AND NOT A `sectionComponents` KEY ON ITS OWN.
 * `options.sectionComponents` in PageBuilder is keyed by section TYPE, so a component cannot
 * be registered against a name. Rewriting the type here, before SectionBuilder sees the
 * sections, is what lets the stock dispatch keep working unchanged.
 */

// The `listings` section type is the stock one, and `noteworthy-section` is deliberately
// mapped ONTO it rather than to a Cocloset type of its own.
//
//   > "hay que integrar una llamada a una api que obtenga los ultimos 10 listings activos"
//
// That API call already exists: `src/ducks/featuredListings.duck.js` queries the 10 newest
// published listings for any section of type `listings` with `listingSelection: 'newest'`.
// Writing a second fetch would mean a second copy of the image-variant config, the entity
// normalisation and the per-section loading state - and the duck's own `newest` bookkeeping
// FILTERS `allSections` on `sectionType === 'listings'`, so a bespoke type would fetch and
// then store the result under no section at all. Reusing the type and overriding only the
// COMPONENT is what gets the Cocloset card without forking the data path.
const LISTINGS = 'listings';

/**
 * Console section name -> the section type to render it as.
 *
 * Keys are the names as they are spelled in Console, typos included: `tittle-section` is
 * what the asset actually contains, and matching it here is cheaper and less fragile than
 * asking for content to be renamed to suit the code.
 */
export const SECTION_TYPE_BY_NAME = {
  'tittle-section': 'coclosetHero',
  guide: 'coclosetSteps',
  'noteworthy-section': LISTINGS,
  'laundry-section': 'coclosetLaundry',
};

/**
 * DEFAULTS for fields Console may not have asked the operator for.
 *
 * `noteworthy-section` was originally authored as a `features` section, and `features` has no
 * listing selection or column count - those fields exist only on the `listings` type. The
 * duck reads `listingSelection` off the section and refuses to make a request for anything
 * that is not `newest`/`queryString`, so without a value the carousel would never fetch.
 *
 * These are FILLED IN, never overwritten. The section is a `listings` section in Console now,
 * with its own selection and column count, and an operator changing either of those in the
 * editor must see the change take effect - a table in the code quietly winning over the
 * editor is the thing that makes a hosted page stop feeling hosted. The defaults remain as a
 * floor for the case where the section type is reverted.
 */
const DEFAULT_PROPS_BY_NAME = {
  'noteworthy-section': { listingSelection: 'newest', numColumns: 4 },
};

// Console omits a field it never asked for, and writes '' for one left blank. Both mean "the
// operator did not choose", so both defer to the default.
const isUnset = value => value === undefined || value === null || value === '';

const withDefaults = (section, defaults = {}) =>
  Object.entries(defaults).reduce(
    (acc, [key, value]) => (isUnset(acc[key]) ? { ...acc, [key]: value } : acc),
    section
  );

/**
 * Is this a section this module claims?
 *
 * @param {Object} section - a section from the page asset
 * @returns {boolean}
 */
export const isCoclosetSection = section =>
  !!section?.sectionName && Object.hasOwn(SECTION_TYPE_BY_NAME, section.sectionName);

/**
 * Rewrite one section's type from its Console name.
 *
 * Returns the SAME object when the name is not claimed, so an untouched section is
 * identifiable by reference as well as by value - which is what the `ignore` test asserts.
 *
 * @param {Object} section
 * @returns {Object}
 */
export const mapCoclosetSection = section => {
  if (!isCoclosetSection(section)) {
    return section;
  }
  const { sectionName } = section;
  return {
    ...withDefaults(section, DEFAULT_PROPS_BY_NAME[sectionName]),
    sectionType: SECTION_TYPE_BY_NAME[sectionName],
  };
};

/**
 * Rewrite a whole page asset's sections.
 *
 * Takes and returns the `pageAssetsData` shape (`{ meta, sections }`) so it can wrap the
 * value a page container already hands to PageBuilder, and passes through untouched when
 * the asset is still loading, failed, or has no sections - a page that cannot render is not
 * this module's problem to report.
 *
 * @param {Object} [pageData] - the page asset's `data`
 * @returns {Object|undefined} the same shape, with claimed sections retyped
 */
export const mapCoclosetSections = pageData => {
  const sections = pageData?.sections;
  if (!Array.isArray(sections)) {
    return pageData;
  }
  return { ...pageData, sections: sections.map(mapCoclosetSection) };
};
