import SectionArticle from './SectionBuilder/SectionArticle';
import SectionCarousel from './SectionBuilder/SectionCarousel';
import SectionColumns from './SectionBuilder/SectionColumns';
import SectionFeatures from './SectionBuilder/SectionFeatures';
import SectionHero from './SectionBuilder/SectionHero';

import SectionCoclosetHero from './SectionBuilder/SectionCoclosetHero';
import SectionCoclosetLaundry from './SectionBuilder/SectionCoclosetLaundry';
import SectionCoclosetSteps from './SectionBuilder/SectionCoclosetSteps';
import SectionCoclosetPartnerHero from './SectionBuilder/SectionCoclosetPartnerHero';
import SectionCoclosetPartnerAbout from './SectionBuilder/SectionCoclosetPartnerAbout';
import SectionCoclosetPartnerBenefits from './SectionBuilder/SectionCoclosetPartnerBenefits';
import SectionCoclosetPartnerFaq from './SectionBuilder/SectionCoclosetPartnerFaq';
import SectionCoclosetPartnerForm from './SectionBuilder/SectionCoclosetPartnerForm';
import SectionCoclosetLandingHero from './SectionBuilder/SectionCoclosetLandingHero';
import SectionCoclosetLandingFlow from './SectionBuilder/SectionCoclosetLandingFlow';
import SectionCoclosetLandingPayroll from './SectionBuilder/SectionCoclosetLandingPayroll';
import SectionCoclosetLandingInvite from './SectionBuilder/SectionCoclosetLandingInvite';
import SectionCoclosetAboutIntro from './SectionBuilder/SectionCoclosetAboutIntro';
import SectionCoclosetAboutFounder from './SectionBuilder/SectionCoclosetAboutFounder';
import { withCoclosetSkin } from './SectionBuilder/coclosetSkin';

/**
 * THE COCLOSET SKIN FOR EVERY HOSTED PAGE.
 *
 * PageBuilder takes an `options` object that reaches every section it renders. This is the
 * one Cocloset passes, and it is deliberately shared by all the hosted pages - the landing
 * page, `/p/about`, `/p/provider_landing_page` - rather than assembled per page:
 *
 *   > "usa la misma inspiración para adecuar el sitio provider_landing_page"
 *
 * A page that opts in individually is a page somebody can forget to opt in. Sharing the
 * object means a section added to any hosted page tomorrow is already in the same visual
 * language as the rest, with nothing to remember.
 *
 * WHAT IS IN HERE, AND WHAT IS NOT
 * Only rendering choices. Which sections exist, what they say and what order they come in
 * are Console's business and stay there; this file cannot add, remove or reword anything.
 *
 * `sectionComponents` is keyed by section TYPE, and the three types below do not exist in
 * Console's editor - they are produced by `util/coclosetLandingSections.js`, which retypes a
 * section from the NAME the operator gave it. The two files are halves of one mechanism:
 * that one decides which section gets a bespoke layout, this one says what the layout is.
 */
export const coclosetPageOptions = {
  sectionComponents: {
    coclosetHero: { component: SectionCoclosetHero },
    coclosetSteps: { component: SectionCoclosetSteps },
    coclosetLaundry: { component: SectionCoclosetLaundry },

    // /p/become-a-partner (2026-09-12 redesign). See coclosetLandingSections.js for which
    // Console section names claim each of these.
    coclosetPartnerHero: { component: SectionCoclosetPartnerHero },
    coclosetPartnerAbout: { component: SectionCoclosetPartnerAbout },
    coclosetPartnerBenefits: { component: SectionCoclosetPartnerBenefits },
    coclosetPartnerFaq: { component: SectionCoclosetPartnerFaq },
    coclosetPartnerForm: { component: SectionCoclosetPartnerForm },

    // Main landing page (2026-09-13 visual refresh). See coclosetLandingSections.js for
    // which Console section names claim each of these, including the `steps`/`coclosetSteps`
    // name collision this deliberately avoids.
    coclosetLandingHero: { component: SectionCoclosetLandingHero },
    coclosetLandingFlow: { component: SectionCoclosetLandingFlow },
    coclosetLandingPayroll: { component: SectionCoclosetLandingPayroll },
    coclosetLandingInvite: { component: SectionCoclosetLandingInvite },

    // /p/about (2026-09-21 redesign). See coclosetLandingSections.js for which Console
    // section names claim each of these.
    coclosetAboutIntro: { component: SectionCoclosetAboutIntro },
    coclosetAboutFounder: { component: SectionCoclosetAboutFounder },

    // Every OTHER section type - the ones with no bespoke layout, including the two the
    // client asked to leave alone - keeps its stock component and gets the Cocloset voice
    // around it. `listings` is deliberately absent: its own component already reads
    // `listingCardVariant` below, and its header is styled by the carousel.
    article: { component: withCoclosetSkin(SectionArticle) },
    carousel: { component: withCoclosetSkin(SectionCarousel) },
    columns: { component: withCoclosetSkin(SectionColumns) },
    features: { component: withCoclosetSkin(SectionFeatures) },
    hero: { component: withCoclosetSkin(SectionHero) },
  },

  // The listing card layout for any `listings` section on a hosted page: brand, garment,
  // then size and collection point, with the price set against the title.
  //
  // Applied to hosted pages ONLY. It reaches ListingCard through SectionListings, so the
  // search page and the map - which render the same component through a different path -
  // keep the stock card. That is on purpose: a browsing grid puts the price first because
  // the reader is comparing, and an editorial row does not because the reader is being
  // shown something.
  listingCardVariant: 'editorial',
};

export default coclosetPageOptions;
