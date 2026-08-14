import {
  SECTION_TYPE_BY_NAME,
  isCoclosetSection,
  mapCoclosetSection,
  mapCoclosetSections,
} from './coclosetLandingSections';

// This module decides which Console sections get a bespoke Cocloset layout and which keep
// the stock one. The client's instruction is a NEGATIVE one -
//
//   > "hay dos secciones que llamé ignore, esas deben permanecer tal cual"
//
// - so most of what is worth testing here is what this does NOT touch. A mapper that only
// ever maps is indistinguishable from one with no table at all.

// The real landing-page asset, trimmed to the fields this module reads. Names are spelled as
// Console spells them, `tittle-section` typo and all.
const sectionsFromConsole = () => [
  { sectionName: 'tittle-section', sectionType: 'columns', numColumns: 2 },
  { sectionName: 'guide', sectionType: 'columns', numColumns: 3 },
  { sectionName: 'noteworthy-section', sectionType: 'features', sectionId: '' },
  { sectionName: 'laundry-section', sectionType: 'columns', numColumns: 2 },
  { sectionName: 'ignore', sectionType: 'columns', numColumns: 2 },
  { sectionName: 'ignore', sectionType: 'carousel', numColumns: 3 },
];

const byName = (sections, name) => sections.filter(s => s.sectionName === name);

describe('the sections named `ignore` are left completely alone', () => {
  it('returns the very same object, not a copy', () => {
    // Reference equality, deliberately: a copy would still render identically today, but it
    // would mean this module had an opinion about the section, and the next field added to
    // the spread would silently start applying to it.
    const [section] = byName(sectionsFromConsole(), 'ignore');
    expect(mapCoclosetSection(section)).toBe(section);
  });

  it.each([['columns'], ['carousel']])('keeps the authored %s type', sectionType => {
    const mapped = mapCoclosetSection({ sectionName: 'ignore', sectionType });
    expect(mapped.sectionType).toBe(sectionType);
  });

  it('leaves both of them alone in a whole-page pass', () => {
    const mapped = mapCoclosetSections({ sections: sectionsFromConsole() });
    expect(byName(mapped.sections, 'ignore').map(s => s.sectionType)).toEqual([
      'columns',
      'carousel',
    ]);
  });
});

describe('a section this module has never heard of', () => {
  it('is passed through untouched', () => {
    // Whatever the operator adds next must render as whatever they authored it as. There is
    // no positional rule and no shape heuristic that could capture it by accident.
    const section = { sectionName: 'a-section-added-next-year', sectionType: 'article' };
    expect(mapCoclosetSection(section)).toBe(section);
  });

  it.each([[undefined], [null], ['']])('survives a missing section name (%p)', sectionName => {
    const section = { sectionName, sectionType: 'columns' };
    expect(mapCoclosetSection(section)).toBe(section);
  });

  it('is not captured by a name that merely inherits from Object.prototype', () => {
    // `sectionName: 'constructor'` would find a value through prototype lookup and retype the
    // section to a function. Object.hasOwn is what stops it; this pins that.
    const section = { sectionName: 'constructor', sectionType: 'columns' };
    expect(isCoclosetSection(section)).toBe(false);
    expect(mapCoclosetSection(section)).toBe(section);
  });
});

describe('the four Cocloset sections are retyped', () => {
  it.each(Object.entries(SECTION_TYPE_BY_NAME))('maps %s to %s', (sectionName, sectionType) => {
    expect(mapCoclosetSection({ sectionName, sectionType: 'columns' }).sectionType).toBe(
      sectionType
    );
  });

  it('keeps every other authored field', () => {
    // The content is still Console's. This module changes how a section is rendered, never
    // what it says.
    const section = {
      sectionName: 'laundry-section',
      sectionType: 'columns',
      title: { content: 'For our laundry partners', fieldType: 'heading2' },
      blocks: [{ blockName: 'live-tiles' }],
      appearance: { fieldType: 'defaultAppearance' },
    };
    const mapped = mapCoclosetSection(section);

    expect(mapped.title).toBe(section.title);
    expect(mapped.blocks).toBe(section.blocks);
    expect(mapped.appearance).toBe(section.appearance);
  });
});

describe('the noteworthy section is handed to the stock listings machinery', () => {
  //   > "hay que integrar una llamada a una api que obtenga los ultimos 10 listings activos"
  //
  // The fetch already exists in featuredListings.duck.js. These assertions are what make it
  // fire for a section Console authored as `features`.
  const noteworthy = () =>
    mapCoclosetSection(byName(sectionsFromConsole(), 'noteworthy-section')[0]);

  it('becomes a `listings` section, which is what the duck filters on', () => {
    // The duck's `newest` bookkeeping selects sections by `sectionType === 'listings'`. A
    // Cocloset-specific type here would fetch and then store the result against no section,
    // and the carousel would spin forever.
    expect(noteworthy().sectionType).toBe('listings');
  });

  it('carries the listing selection the duck demands', () => {
    // Anything other than 'newest'/'queryString' is rejected before a request is made, and
    // Console never asked for this field because the section is authored as `features`.
    expect(noteworthy().listingSelection).toBe('newest');
  });

  it('asks for four columns, as in the design', () => {
    expect(noteworthy().numColumns).toBe(4);
  });

  it('never overrides a choice the operator actually made in Console', () => {
    // The section IS a `listings` section in Console now, with its own selection and column
    // count. A table in the code winning over the editor is what makes a hosted page stop
    // behaving like a hosted page - the operator changes a value, nothing happens, and there
    // is nothing on screen to say why.
    const authored = {
      sectionName: 'noteworthy-section',
      sectionType: 'listings',
      listingSelection: 'queryString',
      listingSearchQuery: { pub_brand: 'Galvan' },
      numColumns: 3,
    };
    const mapped = mapCoclosetSection(authored);

    expect(mapped.listingSelection).toBe('queryString');
    expect(mapped.listingSearchQuery).toBe(authored.listingSearchQuery);
    expect(mapped.numColumns).toBe(3);
  });

  it.each([[undefined], [null], ['']])('fills in a %p the editor left blank', value => {
    const mapped = mapCoclosetSection({
      sectionName: 'noteworthy-section',
      sectionType: 'listings',
      listingSelection: value,
    });
    expect(mapped.listingSelection).toBe('newest');
  });
});

describe('mapCoclosetSections over a whole asset', () => {
  it('retypes exactly the four claimed sections and no others', () => {
    const mapped = mapCoclosetSections({
      meta: { pageTitle: {} },
      sections: sectionsFromConsole(),
    });

    expect(mapped.sections.map(s => s.sectionType)).toEqual([
      'coclosetHero',
      'coclosetSteps',
      'listings',
      'coclosetLaundry',
      'columns',
      'carousel',
    ]);
  });

  it('keeps the rest of the asset, so page metadata still reaches PageBuilder', () => {
    const meta = { pageTitle: { content: 'Cocloset' } };
    expect(mapCoclosetSections({ meta, sections: [] }).meta).toBe(meta);
  });

  it.each([[undefined], [null], [{}], [{ sections: null }]])(
    'passes %p straight through rather than inventing a page',
    pageData => {
      // The asset is still loading, or failed, or is malformed. PageBuilder already has an
      // in-progress and an error state; manufacturing an empty page here would replace a
      // spinner with a blank screen.
      expect(mapCoclosetSections(pageData)).toBe(pageData);
    }
  );
});
