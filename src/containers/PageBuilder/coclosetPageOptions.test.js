import fs from 'fs';
import path from 'path';

import { coclosetPageOptions } from './coclosetPageOptions';

// WHY THIS IS A SOURCE-LEVEL TEST
//
// The skin reaches a section through `options` on PageBuilder, and PageBuilder is a
// `loadable()` chunk in all four pages that render it. Asserting on rendered output would
// mean asserting on the async chunk rather than on the thing that actually breaks, which is
// a page whose author forgot to pass the options at all - exactly what had happened to
// /privacy-policy and /terms-of-service before 2026-09-02, while every `/p/*` page went
// through CMSPage and got them.
//
// So: every entry point that renders a hosted page asset must opt in, and the test is over
// the list of entry points rather than over a hand-written list of "the ones we remembered".
const CONTAINERS = path.resolve(__dirname, '..');

const HOSTED_PAGE_ENTRY_POINTS = [
  'CMSPage/CMSPage.js',
  'LandingPage/LandingPage.js',
  'PrivacyPolicyPage/PrivacyPolicyPage.js',
  'TermsOfServicePage/TermsOfServicePage.js',
];

const sourceOf = file => fs.readFileSync(path.join(CONTAINERS, file), 'utf8');

describe('the Cocloset skin reaches every hosted page', () => {
  it.each(HOSTED_PAGE_ENTRY_POINTS)('%s passes the shared page options', file => {
    const source = sourceOf(file);

    expect(source).toContain('coclosetPageOptions');
    // Not `options={{ ... }}` assembled per page: a page with its own object is a page that
    // drifts from the others the next time a section type is added.
    expect(source).toMatch(/options=\{(\{\s*\.\.\.)?coclosetPageOptions/);
  });

  it.each(HOSTED_PAGE_ENTRY_POINTS)('%s retypes sections by their Console name', file => {
    // mapCoclosetSections is the other half of the mechanism - without it a section named
    // `guide` renders as stock `features` on one page and as coclosetSteps on another.
    expect(sourceOf(file)).toContain('mapCoclosetSections');
  });

  it('keeps one options object, so there is nothing per page to forget', () => {
    // The bespoke types plus the stock types that get the skin. If a type is added here it
    // is added for every hosted page at once, which is the whole point. The five
    // `coclosetPartner*` types are the become-a-partner redesign (2026-09-12; `About` added
    // the same day once the stock `columns` render of "What is CoCloset?" turned out not to
    // match the reference screenshot's typography). The four `coclosetLanding*` types are the
    // main landing page's 2026-09-13 visual refresh. The two `coclosetAbout*` types are
    // /p/about's own 2026-09-21 redesign - see coclosetLandingSections.js for which Console
    // section names claim each of them.
    expect(Object.keys(coclosetPageOptions.sectionComponents).sort()).toEqual([
      'article',
      'carousel',
      'coclosetAboutFounder',
      'coclosetAboutIntro',
      'coclosetHero',
      'coclosetLandingFlow',
      'coclosetLandingHero',
      'coclosetLandingInvite',
      'coclosetLandingPayroll',
      'coclosetLaundry',
      'coclosetPartnerAbout',
      'coclosetPartnerBenefits',
      'coclosetPartnerFaq',
      'coclosetPartnerForm',
      'coclosetPartnerHero',
      'coclosetSteps',
      'columns',
      'features',
      'hero',
    ]);
    expect(coclosetPageOptions.listingCardVariant).toEqual('editorial');
  });
});
