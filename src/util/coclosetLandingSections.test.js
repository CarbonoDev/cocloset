import {
  SECTION_NAMES_BY_TYPE,
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
  const everyClaimedName = Object.entries(SECTION_NAMES_BY_TYPE).flatMap(([sectionType, names]) =>
    names.map(name => [name, sectionType])
  );

  it.each(everyClaimedName)('maps %s to %s', (sectionName, sectionType) => {
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

// ===========================================================================
// The rename of 2026-09-02.
//
// The landing page was re-authored in Console: every section kept its content and got a
// new name, so every bespoke layout fell back to its stock component and the page stopped
// being the design - with no code change and nothing in any log to say why.
//
// These sections are the LIVE asset, read from the Asset Delivery API on the day, trimmed
// to the fields this module looks at. They are the regression test for that.
// ===========================================================================
describe('the landing page as Console holds it today', () => {
  const liveSections = () => [
    {
      sectionName: "tittle's section",
      sectionId: 'peer_to_peer_clothing_rental',
      sectionType: 'columns',
      numColumns: 2,
    },
    { sectionName: 'How it works', sectionId: '', sectionType: 'carousel', numColumns: 3 },
    {
      sectionName: 'In the wardrobe this week',
      sectionId: 'new-noteworthy-section',
      sectionType: 'listings',
      numColumns: 4,
      listingSelection: 'newest',
    },
    { sectionName: 'How lending works', sectionType: 'columns', numColumns: 3 },
    { sectionName: 'Partner with us', sectionType: 'article' },
  ];

  it('still gets the hero, the steps and the listings row', () => {
    const mapped = mapCoclosetSections({ sections: liveSections() });

    expect(mapped.sections.map(s => s.sectionType)).toEqual([
      'coclosetHero',
      'coclosetSteps',
      'listings',
      // Authored after the bespoke layouts existed and matching none of them: these render
      // through the stock component for their own type, in the Cocloset skin.
      'columns',
      'article',
    ]);
  });

  it('matches a name whose only change is punctuation or case', () => {
    // "tittle-section" -> "tittle's section" is the actual rename. Case and stray double
    // spaces are the ones that will happen next.
    ['tittle-section', "tittle's section", "Tittle's  Section", 'TITTLE SECTION'].forEach(
      sectionName =>
        expect(mapCoclosetSection({ sectionName, sectionType: 'columns' }).sectionType).toBe(
          'coclosetHero'
        )
    );
  });

  it('falls back to the sectionId when the name has moved on entirely', () => {
    // The anchor id survives edits the visible name does not, so it is tried first.
    const section = {
      sectionName: 'Something the operator renamed it to',
      sectionId: 'new-noteworthy-section',
      sectionType: 'features',
    };
    expect(mapCoclosetSection(section).sectionType).toBe('listings');
  });

  it('keeps the listings defaults attached to the type, not to the old name', () => {
    // The defaults used to be keyed by section NAME, so the rename would have taken them
    // with it - a `features` section retyped to `listings` with no listingSelection never
    // fetches, and the row spins forever.
    const mapped = mapCoclosetSection({
      sectionName: 'In the wardrobe this week',
      sectionType: 'features',
    });

    expect(mapped.sectionType).toBe('listings');
    expect(mapped.listingSelection).toBe('newest');
    expect(mapped.numColumns).toBe(4);
  });
});

describe('the provider landing page gets the same steps layout', () => {
  //   > "lo mismo para provider... ahi hay que integrar el mismo diseño"
  //
  // /p/provider_landing_page names its steps section "How it Works" too, so one entry
  // covers both pages. Its blocks are authored the other way round - the title is the step
  // NAME, not a numeral - which SectionCoclosetSteps handles; see the test beside it.
  it('claims "How it Works" wherever it appears', () => {
    expect(
      mapCoclosetSection({ sectionName: 'How it Works', sectionType: 'carousel' }).sectionType
    ).toBe('coclosetSteps');
  });

  it('leaves the two heroes to the stock components', () => {
    // There is no bespoke layout for these shapes. Claiming them would mean rendering
    // partner copy through a component built for different content, which is worse than
    // rendering it plainly in the Cocloset skin.
    ['Grow Your Dry Cleaning Business with CoCloset', 'Apply Now '].forEach(sectionName => {
      const section = { sectionName, sectionType: 'columns' };
      expect(mapCoclosetSection(section)).toBe(section);
    });
  });

  // `Benefits` USED to be in the list above. It no longer is: as of the become-a-partner
  // redesign (2026-09-12), `benefits`/`Benefits` is a claimed name (see
  // `describe('the become-a-partner page (2026-09-12 redesign)')` below), and this page's
  // own `Benefits` section - same shape, same three benefits, verbatim - is claimed right
  // along with it. See the long comment on `coclosetPartnerBenefits` in
  // coclosetLandingSections.js for why that is an accepted, deliberate side effect rather
  // than a bug.
  it('now also retypes this page\'s own "Benefits" section to the shared partner-benefits layout', () => {
    const section = { sectionName: 'Benefits', sectionType: 'columns' };
    expect(mapCoclosetSection(section).sectionType).toBe('coclosetPartnerBenefits');
  });
});

describe('the become-a-partner page (2026-09-12 redesign)', () => {
  // Fixture section names from the live `become-a-partner` Console asset, fetched via the
  // Asset Delivery API while building this page.
  it.each([
    ['partner-hero', 'coclosetPartnerHero'],
    ['brand-description', 'coclosetPartnerAbout'],
    ['benefits', 'coclosetPartnerBenefits'],
    ['faq', 'coclosetPartnerFaq'],
    ['form', 'coclosetPartnerForm'],
  ])('maps %s to %s', (sectionName, sectionType) => {
    expect(mapCoclosetSection({ sectionName, sectionType: 'article' }).sectionType).toBe(
      sectionType
    );
  });

  it('retypes the whole become-a-partner asset in one pass', () => {
    const sections = [
      { sectionName: 'partner-hero', sectionType: 'article' },
      { sectionName: 'brand-description', sectionType: 'columns', numColumns: 2 },
      { sectionName: 'benefits', sectionType: 'columns', numColumns: 3 },
      { sectionName: 'faq', sectionType: 'article' },
      { sectionName: 'form', sectionType: 'columns', numColumns: 2 },
    ];
    const mapped = mapCoclosetSections({ sections });

    expect(mapped.sections.map(s => s.sectionType)).toEqual([
      'coclosetPartnerHero',
      // `brand-description` was originally left to the stock `columns` renderer, but Jonathan
      // flagged (2026-09-12) that the block title it produces doesn't match the reference
      // screenshot's display-serif, brand-teal "What is CoCloset?" heading - so it now gets
      // its own layout too, same as the other four sections on this page.
      'coclosetPartnerAbout',
      'coclosetPartnerBenefits',
      'coclosetPartnerFaq',
      'coclosetPartnerForm',
    ]);
  });
});

describe('the about page (2026-09-21 redesign)', () => {
  // Fixture section names from the live `/p/about` Console asset, fetched via the Asset
  // Delivery API while building this page.
  it.each([
    ['Our story', 'coclosetAboutIntro'],
    ['Our team', 'coclosetAboutFounder'],
  ])('maps %s to %s', (sectionName, sectionType) => {
    expect(mapCoclosetSection({ sectionName, sectionType: 'features' }).sectionType).toBe(
      sectionType
    );
  });

  // "How we're different" is deliberately NOT in this list - it stays on the stock `article`
  // type, which the Cocloset skin (coclosetSkin.js) already styles with the same serif
  // heading the mockup shows for it, so no bespoke layout was needed.
  it("leaves 'How we're different' on the stock article type", () => {
    const section = { sectionName: "How we're different", sectionType: 'article' };
    expect(mapCoclosetSection(section)).toBe(section);
  });

  it('retypes the whole about-page asset in one pass', () => {
    const sections = [
      { sectionName: 'Our story', sectionType: 'features' },
      { sectionName: "How we're different", sectionType: 'article' },
      { sectionName: 'Our team', sectionType: 'features' },
    ];
    const mapped = mapCoclosetSections({ sections });

    expect(mapped.sections.map(s => s.sectionType)).toEqual([
      'coclosetAboutIntro',
      'article',
      'coclosetAboutFounder',
    ]);
  });
});

describe('the main landing page (2026-09-13 visual refresh)', () => {
  // Fixture section names from the live `landing-page` Console asset, fetched via the Asset
  // Delivery API while building this refresh.
  it.each([
    ['landing-hero', 'coclosetLandingHero'],
    ['flow-section', 'coclosetLandingFlow'],
    ['steps', 'coclosetLandingPayroll'],
    ['invite', 'coclosetLandingInvite'],
  ])('maps %s to %s', (sectionName, sectionType) => {
    expect(mapCoclosetSection({ sectionName, sectionType: 'columns' }).sectionType).toBe(
      sectionType
    );
  });

  // THE COLLISION THIS MODULE IS DELIBERATELY AVOIDING. Console's section is literally named
  // `steps`, which is also the exact word `coclosetSteps` (the numbered how-it-works list,
  // claimed by `guide`/`How it works`) answers to. If `steps` were ever added to that type's
  // name list instead of getting its own, the garment-owner payroll pitch would render
  // through a numbered-list component built for different content and lose its photo
  // entirely - see the long comment on `coclosetLandingPayroll` above.
  it('does NOT let the `steps` name collide with the numbered-steps component', () => {
    const mapped = mapCoclosetSection({ sectionName: 'steps', sectionType: 'columns' });
    expect(mapped.sectionType).toBe('coclosetLandingPayroll');
    expect(mapped.sectionType).not.toBe('coclosetSteps');
  });

  it('retypes the whole landing-page asset in one pass', () => {
    const sections = [
      { sectionName: 'landing-hero', sectionType: 'article' },
      { sectionName: 'flow-section', sectionType: 'columns', numColumns: 3 },
      { sectionName: 'listings', sectionType: 'listings' },
      { sectionName: 'steps', sectionType: 'columns', numColumns: 3 },
      { sectionName: 'invite', sectionType: 'columns', numColumns: 2 },
    ];
    const mapped = mapCoclosetSections({ sections });

    expect(mapped.sections.map(s => s.sectionType)).toEqual([
      'coclosetLandingHero',
      'coclosetLandingFlow',
      // `listings` is already its own type in Console and needs no entry in this module.
      'listings',
      'coclosetLandingPayroll',
      'coclosetLandingInvite',
    ]);
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
