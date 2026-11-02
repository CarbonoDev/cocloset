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
 * ONE LAYOUT, SEVERAL NAMES - BECAUSE THE NAMES CHANGE.
 *
 * This started as a plain map keyed on the exact Console name. On 2026-09-02 the landing
 * page was re-authored in Console and every section was renamed - `tittle-section` became
 * `tittle's section`, `guide` became `How it works` - and every bespoke layout silently
 * fell back to its stock component. The page was still there, still editable, and no
 * longer the design. Nothing in the code had changed.
 *
 * A name is content, and content moves. So a layout now claims a LIST of names, matched
 * after normalising away the things an editor changes without meaning to (case, hyphens,
 * apostrophes, double spaces), plus the section's `sectionId` where the operator has set
 * a stable one. Old names are kept alongside new ones: an asset that has not been
 * re-authored yet - Test and Live, until Console is pushed - must keep working.
 *
 * When this breaks again, the fix is to add the new name here, not to ask for the content
 * to be renamed back.
 */
const normalizeName = value =>
  typeof value === 'string'
    ? value
        .toLowerCase()
        .replace(/['‘’]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    : '';

/**
 * Section type -> every Console name or sectionId that should render as it.
 *
 * Spellings are listed as they appear in Console, typos included (`tittle`), and
 * normalised on both sides at lookup time.
 */
export const SECTION_NAMES_BY_TYPE = {
  // The landing page's opening split. Two blocks: type on the left, image with a card
  // floated over it on the right.
  coclosetHero: ['tittle-section', "tittle's section", 'peer_to_peer_clothing_rental'],
  // The numbered steps. On the landing page they are the renter's three; on
  // /p/provider_landing_page they are the studio's (Drop Off / Clean / Pick Up), which is
  // the same layout for the same kind of content - the client asked for "el mismo diseño"
  // on that page.
  coclosetSteps: ['guide', 'How it works'],
  // The partner panel with the tile grid.
  coclosetLaundry: ['laundry-section'],
  [LISTINGS]: ['noteworthy-section', 'In the wardrobe this week', 'new-noteworthy-section'],

  // /p/become-a-partner (2026-09-12 redesign). Four sections with layouts none of the stock
  // types produce - see the SectionCoclosetPartner* components for what each renders.
  //
  //   > "make /p/become-a-partner render identical to the screenshots" (Jonathan)
  //
  // KNOWN CROSS-PAGE OVERLAP: `benefits` is also, by coincidence, the exact section name
  // /p/provider_landing_page uses for its own three-tile benefits row (same shape: a title
  // plus three image+title+text blocks, in fact the same three benefits verbatim). Name
  // matching here is case-insensitive and page-agnostic by design (see normalizeName above),
  // so that page's `Benefits` section now ALSO renders through SectionCoclosetPartnerBenefits
  // instead of the stock `columns` component. Given the identical shape and content, this is
  // a strict visual upgrade rather than a regression - but it is a real, deliberate side
  // effect of this change, not an oversight. If a future edit gives the two pages' benefits
  // sections different shapes, this single shared name will need to become two.
  coclosetPartnerHero: ['partner-hero'],
  coclosetPartnerAbout: ['brand-description'],
  coclosetPartnerBenefits: ['benefits'],
  coclosetPartnerFaq: ['faq'],
  coclosetPartnerForm: ['form'],

  // Main landing page (2026-09-13 visual refresh). Five sections; `listings` (New Arrivals)
  // already renders correctly through the stock `listings` type/component above and needs no
  // entry here.
  //
  // NAME VS CONCEPT, ONE MORE TIME. `steps` is the Console NAME of the "Put your closet on
  // payroll." garment-owner pitch (screenshots: cream title band, then a full-bleed photo of
  // a closet with three cards and a CTA overlaid on it) - it is NOT the numbered how-it-works
  // list, despite the name being exactly the word `coclosetSteps` above answers to. Mapping
  // it to `coclosetSteps` would render a garment-owner pitch through a numbered-list
  // component and lose the photo entirely. It gets its own type,
  // `coclosetLandingPayroll`, so the two can never collide even if a future Console rename
  // makes the coincidence worse.
  //
  // `flow-section` (the icon-illustrated "How it Works") is ALSO deliberately its own type,
  // `coclosetLandingFlow`, rather than added to `coclosetSteps`'s name list. `coclosetSteps`
  // (below, claimed by `guide`/`How it works`) renders a numeral-in-title, no-media, small-
  // eyebrow-header shape still live on /p/provider_landing_page; `flow-section`'s content
  // shape is different in every dimension that component assumes (a real icon image per
  // block, the numeral folded into the title text itself, a large centered display heading
  // rather than a small eyebrow). Bending one component to both shapes risked breaking the
  // page that already depends on the old one for a saving that is one lookup entry.
  coclosetLandingHero: ['landing-hero'],
  coclosetLandingFlow: ['flow-section'],
  coclosetLandingPayroll: ['steps'],
  coclosetLandingInvite: ['invite'],

  // /p/about (2026-09-21 redesign): "Welcome to CoCloset" + one photo/text block, then a
  // text-only section ('How we're different', left on the stock `article` type - it already
  // renders full-width text with the Cocloset skin's own serif heading, which is what the
  // reference screenshots show for it), then the founder bio band.
  coclosetAboutIntro: ['Our story'],
  coclosetAboutDifference: ["How we're different"],
  coclosetAboutFounder: ['Our team'],
};

// A Map rather than an object, and not only for taste: a plain object would answer
// `TYPE_BY_NORMALIZED_NAME['constructor']` from Object.prototype and retype a section named
// "constructor" to a function. A Map has no inherited keys, so the lookup can stay a plain
// `get` instead of an `Object.hasOwn` dance.
const TYPE_BY_NORMALIZED_NAME = new Map(
  Object.entries(SECTION_NAMES_BY_TYPE).flatMap(([sectionType, names]) =>
    names.map(name => [normalizeName(name), sectionType])
  )
);

/**
 * The section type to render a section as, or undefined if this module does not claim it.
 *
 * `sectionId` is tried first: it is the anchor id, so an operator who changes the visible
 * name is less likely to have changed it in the same edit.
 *
 * @param {Object} section
 * @returns {string|undefined}
 */
const claimedTypeOf = section =>
  TYPE_BY_NORMALIZED_NAME.get(normalizeName(section?.sectionId)) ||
  TYPE_BY_NORMALIZED_NAME.get(normalizeName(section?.sectionName));

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
// Keyed by the TYPE the section is claimed as rather than by its name, so a rename cannot
// take the defaults with it - which is the same failure this module was rewritten for.
const DEFAULT_PROPS_BY_TYPE = {
  [LISTINGS]: { listingSelection: 'newest', numColumns: 4 },
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
export const isCoclosetSection = section => !!claimedTypeOf(section);

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
  const sectionType = claimedTypeOf(section);
  if (!sectionType) {
    return section;
  }
  return {
    ...withDefaults(section, DEFAULT_PROPS_BY_TYPE[sectionType]),
    sectionType,
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
