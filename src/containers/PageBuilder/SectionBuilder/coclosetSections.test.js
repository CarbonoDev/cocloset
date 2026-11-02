import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../util/testHelpers';

import SectionCoclosetHero from './SectionCoclosetHero';
import SectionCoclosetLaundry from './SectionCoclosetLaundry';
import SectionCoclosetSteps from './SectionCoclosetSteps';
import SectionCoclosetPartnerHero from './SectionCoclosetPartnerHero';
import SectionCoclosetPartnerBenefits from './SectionCoclosetPartnerBenefits';
import SectionCoclosetPartnerFaq from './SectionCoclosetPartnerFaq';
import SectionCoclosetLandingHero from './SectionCoclosetLandingHero';
import SectionCoclosetLandingFlow from './SectionCoclosetLandingFlow';
import SectionCoclosetLandingPayroll from './SectionCoclosetLandingPayroll';

const { screen } = testingLibrary;

// WHY THIS FILE EXISTS
//
// These three sections render CONTENT AN OPERATOR TYPES IN CONSOLE, through layouts the
// Console editor has no concept of. The layout is code; every word on the page is not. So
// what is worth asserting is not that the markup is right - it is that nothing an operator
// wrote gets dropped on the floor, and that a section they leave half-filled still renders.
//
// The fixtures below are the REAL landing-page asset, trimmed to the fields each component
// reads. Invented fixtures would have let the fenced-code tiles and the two-tone headline -
// both of which are operator conventions rather than schema - pass tests while failing on
// the actual content.

const defaultClasses = {
  sectionDetails: 'sectionDetails',
  title: 'title',
  description: 'description',
  ctaButton: 'ctaButton',
  blockContainer: 'blockContainer',
};

const renderSection = (Section, props) =>
  render(<Section sectionId="s1" defaultClasses={defaultClasses} options={{}} {...props} />);

describe('SectionCoclosetHero', () => {
  const heroProps = (overrides = {}) => ({
    title: { content: "A members' wardrobe · Paris", fieldType: 'heading2' },
    description: { fieldType: 'paragraph' },
    blocks: [
      {
        blockName: 'Borrow the dress.',
        blockType: 'defaultBlock',
        title: { content: 'Borrow the dress.\nSkip the dry cleaning.', fieldType: 'heading1' },
        text: {
          fieldType: 'markdown',
          content:
            'Cocloset is a designer rental wardrobe with a twist.\n\n' +
            '[Browse the wardrobe](/s)\n[Lend a piece](/l/new)',
        },
      },
      {
        blockName: 'How it works',
        blockType: 'defaultBlock',
        title: { content: 'How it works', fieldType: 'heading3' },
        text: { fieldType: 'markdown', content: 'Choose dates → pick a laundry → collect.' },
      },
    ],
    ...overrides,
  });

  it('renders the whole headline, both lines of it', () => {
    // The break is the operator's two-tone instruction, but it is still one sentence: a
    // reader (and a screen reader) has to get all of it.
    renderSection(SectionCoclosetHero, heroProps());

    expect(screen.getByText('Borrow the dress.')).toBeInTheDocument();
    expect(screen.getByText('Skip the dry cleaning.')).toBeInTheDocument();
  });

  it('keeps the headline as a single heading', () => {
    renderSection(SectionCoclosetHero, heroProps());
    const heading = screen.getByRole('heading', { level: 1 });

    expect(heading).toHaveTextContent('Borrow the dress.');
    expect(heading).toHaveTextContent('Skip the dry cleaning.');
  });

  it('turns the trailing markdown links into the two actions, in order', () => {
    renderSection(SectionCoclosetHero, heroProps());

    const browse = screen.getByRole('link', { name: 'Browse the wardrobe' });
    const lend = screen.getByRole('link', { name: 'Lend a piece' });

    expect(browse).toHaveAttribute('href', '/s');
    expect(lend).toHaveAttribute('href', '/l/new');
    // Order decides emphasis - first is the filled button - so it is worth pinning that the
    // component does not sort or reverse them.
    expect(browse.compareDocumentPosition(lend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not leave the raw link markdown in the prose', () => {
    renderSection(SectionCoclosetHero, heroProps());
    expect(screen.queryByText(/\[Browse the wardrobe\]/)).not.toBeInTheDocument();
  });

  it('renders the standfirst', () => {
    renderSection(SectionCoclosetHero, heroProps());
    expect(screen.getByText(/designer rental wardrobe with a twist/)).toBeInTheDocument();
  });

  it('renders the "how it works" card from the second block', () => {
    renderSection(SectionCoclosetHero, heroProps());

    expect(screen.getByText('How it works')).toBeInTheDocument();
    expect(screen.getByText(/Choose dates/)).toBeInTheDocument();
  });

  it('renders a type-only hero when there is no second block', () => {
    // Not hypothetical: a section is edited one block at a time in Console, and a hero with a
    // hole where the imagery goes is worse than one without it.
    renderSection(SectionCoclosetHero, heroProps({ blocks: [heroProps().blocks[0]] }));

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('How it works')).not.toBeInTheDocument();
  });

  it('renders nothing but survives an empty section', () => {
    expect(() => renderSection(SectionCoclosetHero, { blocks: [] })).not.toThrow();
  });
});

describe('SectionCoclosetSteps', () => {
  const stepsProps = () => ({
    blocks: [
      {
        blockId: 'lend-piece',
        blockName: 'Lend a piece you love',
        title: { content: '01', fieldType: 'heading3' },
        text: {
          fieldType: 'markdown',
          content: '#### Lend a piece you love\n\nDrop your garment at any partner laundry.',
        },
      },
      {
        blockId: 'rent-for-moment',
        blockName: 'Rent for the moment',
        // The asset really does say "2" here where the others say "01"/"03".
        title: { content: '2', fieldType: 'heading3' },
        text: { fieldType: 'markdown', content: '#### Rent for the moment\n\nPick a piece.' },
      },
    ],
  });

  it('shows the step name once, not twice', () => {
    // The name is in the markdown as an h4 AND the numeral is in the title field. Rendering
    // both fields as authored printed the name under a giant numeral.
    renderSection(SectionCoclosetSteps, stepsProps());
    expect(screen.getAllByText('Lend a piece you love')).toHaveLength(1);
  });

  it('renders the numeral and the body alongside it', () => {
    renderSection(SectionCoclosetSteps, stepsProps());

    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.getByText('Drop your garment at any partner laundry.')).toBeInTheDocument();
  });

  it('prints the numeral the operator typed, inconsistencies included', () => {
    // The blocks read "01" and "2". Numbering from the array index would tidy that up and, in
    // doing so, silently overrule the content - an operator reordering blocks would then see
    // numbers that disagree with what they typed.
    renderSection(SectionCoclosetSteps, stepsProps());

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('02')).not.toBeInTheDocument();
  });

  it('is an ordered list, because these are ordered steps', () => {
    renderSection(SectionCoclosetSteps, stepsProps());
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('falls back to the block name when the markdown has no heading', () => {
    renderSection(SectionCoclosetSteps, {
      blocks: [
        {
          blockName: 'Return, walk away',
          title: { content: '03', fieldType: 'heading3' },
          text: { fieldType: 'markdown', content: 'Drop the garment back at the same counter.' },
        },
      ],
    });

    expect(screen.getByText('Return, walk away')).toBeInTheDocument();
    expect(screen.getByText('Drop the garment back at the same counter.')).toBeInTheDocument();
  });

  // The provider landing page authors the same layout the other way round: the block title
  // is the step's NAME and there are no numbers at all. Fixture from the live
  // /p/provider_landing_page asset.
  describe('when the block title is a name rather than a numeral', () => {
    const providerProps = () => ({
      blocks: [
        {
          blockId: 'drop-off',
          blockName: 'Drop-Off',
          title: { content: 'Drop Off', fieldType: 'heading3' },
          text: {
            fieldType: 'markdown',
            content: 'Partners scan a QR code to pull up transaction details.',
          },
        },
      ],
    });

    it('sets it as the step title, not as the numeral', () => {
      renderSection(SectionCoclosetSteps, providerProps());

      // Once - as the title. Rendering it as the numeral AND falling back to the blockName
      // for the title printed "Drop Off" over "Drop-Off", which is how this was found.
      expect(screen.getAllByText('Drop Off')).toHaveLength(1);
      expect(screen.queryByText('Drop-Off')).not.toBeInTheDocument();
      expect(
        screen.getByText('Partners scan a QR code to pull up transaction details.')
      ).toBeInTheDocument();
    });

    it('draws no numeral marker at all rather than a made-up one', () => {
      // Numbering from the array index would be inventing content the operator did not
      // write, on a page where the steps are named rather than numbered.
      renderSection(SectionCoclosetSteps, providerProps());
      expect(screen.queryByText('01')).not.toBeInTheDocument();
      expect(screen.queryByText('1')).not.toBeInTheDocument();
    });
  });
});

describe('SectionCoclosetLaundry', () => {
  const laundryProps = (overrides = {}) => ({
    title: { content: 'For our laundry partners', fieldType: 'heading2' },
    description: { fieldType: 'paragraph' },
    blocks: [
      {
        blockId: 'laundry-partners',
        title: { content: 'A storefront for every neighborhood laundry.', fieldType: 'heading3' },
        text: {
          fieldType: 'markdown',
          content:
            'We bring foot traffic, repeat customers and a ticketed operations dashboard.\n\n' +
            '[Open the laundry dashboard](/laundry)',
        },
      },
      {
        blockId: 'live-titles',
        title: { fieldType: 'heading3' },
        text: {
          fieldType: 'markdown',
          content:
            '```text\nLIVE TILE\nIncoming garments\n```\n\n```text\nLIVE TILE\nPickups today\n```',
        },
      },
    ],
    ...overrides,
  });

  it('renders the fenced blocks as tiles, not as code', () => {
    // This is the visible bug on the page today: the marketplace's pitch to its partners,
    // printed as source.
    const { container } = renderSection(SectionCoclosetLaundry, laundryProps());

    expect(screen.getByText('Incoming garments')).toBeInTheDocument();
    expect(screen.getByText('Pickups today')).toBeInTheDocument();
    expect(container.querySelector('code')).toBeNull();
    expect(container.querySelector('pre')).toBeNull();
  });

  it('renders the headline, the pitch and the dashboard link', () => {
    renderSection(SectionCoclosetLaundry, laundryProps());

    expect(screen.getByText('A storefront for every neighborhood laundry.')).toBeInTheDocument();
    expect(screen.getByText(/ticketed operations dashboard/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the laundry dashboard' })).toHaveAttribute(
      'href',
      '/laundry'
    );
  });

  it('renders the pitch alone when the tiles block is missing', () => {
    renderSection(SectionCoclosetLaundry, laundryProps({ blocks: [laundryProps().blocks[0]] }));

    expect(screen.getByText('A storefront for every neighborhood laundry.')).toBeInTheDocument();
    expect(screen.queryByText('Incoming garments')).not.toBeInTheDocument();
  });

  it('does not invent a tile grid out of ordinary prose', () => {
    renderSection(
      SectionCoclosetLaundry,
      laundryProps({
        blocks: [
          laundryProps().blocks[0],
          { blockId: 'x', text: { fieldType: 'markdown', content: 'Just a sentence.' } },
        ],
      })
    );

    expect(screen.queryByText('LIVE TILE')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// /p/become-a-partner (2026-09-12 redesign). Fixtures below are trimmed from the live
// `become-a-partner` Console asset, fetched via the Asset Delivery API while building this
// page - same approach as the fixtures above.
// ===========================================================================

describe('SectionCoclosetPartnerHero', () => {
  const heroProps = (overrides = {}) => ({
    title: { content: 'Grow your business with CoCloset.', fieldType: 'heading2' },
    description: { fieldType: 'paragraph', content: 'Reach new dry cleaning customers at no cost.' },
    blocks: [
      {
        blockName: 'header-title',
        title: { fieldType: 'heading3' },
        text: { fieldType: 'markdown', content: 'DRY CLEANING PARTNERS' },
      },
    ],
    ...overrides,
  });

  it('renders the eyebrow label and the cream card headline + paragraph', () => {
    renderSection(SectionCoclosetPartnerHero, heroProps());

    expect(screen.getByText('DRY CLEANING PARTNERS')).toBeInTheDocument();
    expect(screen.getByText('Grow your business with CoCloset.')).toBeInTheDocument();
    expect(screen.getByText('Reach new dry cleaning customers at no cost.')).toBeInTheDocument();
  });

  it('survives an empty section', () => {
    expect(() => renderSection(SectionCoclosetPartnerHero, { blocks: [] })).not.toThrow();
  });
});

describe('SectionCoclosetPartnerBenefits', () => {
  const benefitsProps = () => ({
    // Console spells the title "Benefits" today; the screenshots say "Partner Benefits" -
    // a content mismatch this component renders verbatim rather than overriding.
    title: { content: 'Benefits', fieldType: 'heading2' },
    description: { fieldType: 'paragraph' },
    blocks: [
      {
        blockName: 'benefit',
        title: { content: 'Recurring Revenue', fieldType: 'heading3' },
        text: {
          fieldType: 'markdown',
          content: 'Every item is cleaned between rentals, generating added sales each week.',
        },
      },
      {
        blockName: 'benefit',
        title: { content: 'More Foot Traffic', fieldType: 'heading3' },
        text: {
          fieldType: 'markdown',
          content: 'New high-intent customers enter your shop to drop-off and pick up rentals.',
        },
      },
      {
        blockName: 'benefit',
        title: { content: 'Free Marketing', fieldType: 'heading3' },
        text: {
          fieldType: 'markdown',
          content: 'We handle customer acquisition and promote your business as a preferred partner.',
        },
      },
    ],
  });

  it('renders the section title verbatim, mismatch and all', () => {
    renderSection(SectionCoclosetPartnerBenefits, benefitsProps());
    expect(screen.getByText('Benefits')).toBeInTheDocument();
  });

  it('renders all three benefit cards, each with its title and text', () => {
    renderSection(SectionCoclosetPartnerBenefits, benefitsProps());

    expect(screen.getByText('Recurring Revenue')).toBeInTheDocument();
    expect(screen.getByText('More Foot Traffic')).toBeInTheDocument();
    expect(screen.getByText('Free Marketing')).toBeInTheDocument();
    expect(
      screen.getByText('We handle customer acquisition and promote your business as a preferred partner.')
    ).toBeInTheDocument();
  });

  it('survives an empty section', () => {
    expect(() => renderSection(SectionCoclosetPartnerBenefits, { blocks: [] })).not.toThrow();
  });
});

describe('SectionCoclosetPartnerFaq', () => {
  const faqProps = () => ({
    title: { fieldType: 'heading2' },
    description: { fieldType: 'paragraph' },
    blocks: [
      { title: { content: 'Q1', fieldType: 'heading3' }, text: { fieldType: 'markdown', content: 'A1' } },
      { title: { content: 'Q2', fieldType: 'heading3' }, text: { fieldType: 'markdown', content: 'A2' } },
      { title: { content: 'Q3', fieldType: 'heading3' }, text: { fieldType: 'markdown', content: 'A3' } },
      { title: { content: 'Q4', fieldType: 'heading3' }, text: { fieldType: 'markdown', content: 'A4' } },
      { title: { content: 'Q5', fieldType: 'heading3' }, text: { fieldType: 'markdown', content: 'A5' } },
    ],
  });

  it('renders every question and answer', () => {
    renderSection(SectionCoclosetPartnerFaq, faqProps());
    ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'].forEach(q => expect(screen.getByText(q)).toBeInTheDocument());
    ['A1', 'A2', 'A3', 'A4', 'A5'].forEach(a => expect(screen.getByText(a)).toBeInTheDocument());
  });

  it('splits an odd count top-to-bottom per column, not round-robin', () => {
    // 5 blocks -> ceil(5/2) = 3 down the left (Q1-Q3), the rest down the right (Q4-Q5).
    const { container } = renderSection(SectionCoclosetPartnerFaq, faqProps());
    const columns = container.querySelectorAll('.column');

    expect(columns).toHaveLength(2);
    expect(columns[0]).toHaveTextContent('Q1');
    expect(columns[0]).toHaveTextContent('Q2');
    expect(columns[0]).toHaveTextContent('Q3');
    expect(columns[0]).not.toHaveTextContent('Q4');
    expect(columns[1]).toHaveTextContent('Q4');
    expect(columns[1]).toHaveTextContent('Q5');
  });

  it('renders no heading when Console has not set the section title yet', () => {
    // The live asset's `faq` section has an empty title today - see the activity log.
    const { container } = renderSection(SectionCoclosetPartnerFaq, faqProps());
    expect(container.querySelector('h1,h2,h3')).toBeNull();
  });

  it('survives an empty section', () => {
    expect(() => renderSection(SectionCoclosetPartnerFaq, { blocks: [] })).not.toThrow();
  });
});

// ===========================================================================
// Main landing page (2026-09-13 visual refresh). Fixtures below are trimmed from the live
// `landing-page` Console asset, fetched via the Asset Delivery API while building this page -
// same approach as the fixtures above.
// ===========================================================================

describe('SectionCoclosetLandingHero', () => {
  const heroProps = (overrides = {}) => ({
    title: { content: 'The shared closet on your corner.', fieldType: 'heading2' },
    description: {
      fieldType: 'paragraph',
      content:
        'Rent standout looks from stylish neighbors, picked up fresh and clean at your local dry cleaner. No shipping, no scheduling meetups, and zero hassles.',
    },
    callToAction: { fieldType: 'internalButtonLink', content: 'BROWSE LISTINGS', href: '/s' },
    blocks: [
      { blockName: 'hero-img', media: { fieldType: 'none' } },
      { blockName: 'hero-img', media: { fieldType: 'none' } },
      { blockName: 'hero-img', media: { fieldType: 'none' } },
      { blockName: 'hero-img', media: { fieldType: 'none' } },
    ],
    ...overrides,
  });

  it('renders the headline, the standfirst and the CTA', () => {
    renderSection(SectionCoclosetLandingHero, heroProps());

    expect(screen.getByText('The shared closet on your corner.')).toBeInTheDocument();
    expect(screen.getByText(/zero hassles/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'BROWSE LISTINGS' })).toHaveAttribute('href', '/s');
  });

  it('survives an empty section', () => {
    expect(() =>
      renderSection(SectionCoclosetLandingHero, {
        title: { fieldType: 'heading2' },
        description: { fieldType: 'paragraph' },
        callToAction: { fieldType: 'none' },
        blocks: [],
      })
    ).not.toThrow();
  });
});

describe('SectionCoclosetLandingFlow', () => {
  const flowProps = () => ({
    title: { content: 'How it Works', fieldType: 'heading2' },
    description: { fieldType: 'paragraph' },
    blocks: [
      {
        blockName: 'flow-block',
        media: { fieldType: 'none' },
        title: { content: '1. Find your style', fieldType: 'heading3' },
        text: {
          fieldType: 'markdown',
          content: 'Browse closets in your area, filter by size, occasion, or vibe, and reserve.',
        },
      },
      {
        blockName: 'flow-block',
        media: { fieldType: 'none' },
        title: { content: '2. Pick up at the local dry cleaners', fieldType: 'heading3' },
        text: {
          fieldType: 'markdown',
          content: 'Collect your item —freshly cleaned & pressed— from a partner dry cleaner.',
        },
      },
      {
        blockName: 'flow-block',
        media: { fieldType: 'none' },
        title: { content: '3. Enjoy your outfit!', fieldType: 'heading3' },
        text: {
          fieldType: 'markdown',
          content: 'Live in it. Photograph it. Then drop it back off at the dry cleaner.',
        },
      },
    ],
  });

  it('renders the section title as a real heading, not a small eyebrow', () => {
    renderSection(SectionCoclosetLandingFlow, flowProps());
    expect(screen.getByRole('heading', { name: 'How it Works' })).toBeInTheDocument();
  });

  it('prints each step title exactly as authored, numeral included', () => {
    renderSection(SectionCoclosetLandingFlow, flowProps());

    expect(screen.getByText('1. Find your style')).toBeInTheDocument();
    expect(screen.getByText('2. Pick up at the local dry cleaners')).toBeInTheDocument();
    expect(screen.getByText('3. Enjoy your outfit!')).toBeInTheDocument();
  });

  it('renders all three step bodies', () => {
    renderSection(SectionCoclosetLandingFlow, flowProps());
    expect(screen.getByText(/filter by size, occasion, or vibe/)).toBeInTheDocument();
    expect(screen.getByText(/freshly cleaned & pressed/)).toBeInTheDocument();
    expect(screen.getByText(/drop it back off at the dry cleaner/)).toBeInTheDocument();
  });

  it('is an ordered list, because these are ordered steps', () => {
    renderSection(SectionCoclosetLandingFlow, flowProps());
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('survives an empty section', () => {
    expect(() => renderSection(SectionCoclosetLandingFlow, { blocks: [] })).not.toThrow();
  });
});

describe('SectionCoclosetLandingPayroll', () => {
  const payrollProps = (overrides = {}) => ({
    title: { content: 'Put your closet on payroll.', fieldType: 'heading2' },
    // The live asset really does duplicate the title here instead of the screenshot's own
    // subtitle - a Console content bug this component renders verbatim. See the activity log.
    description: { fieldType: 'paragraph', content: 'Put your closet on payroll.' },
    callToAction: { fieldType: 'internalButtonLink', content: 'START LISTING', href: '/l/new' },
    appearance: { fieldType: 'defaultAppearance' },
    blocks: [
      {
        blockName: 'step-block',
        title: { content: 'Recoup Your Retail Cost', fieldType: 'heading3' },
        text: {
          fieldType: 'markdown',
          content: 'Most pieces pay for themselves in just 3 rentals— everything after that is pure profit.',
        },
      },
      {
        blockName: 'step-block',
        title: { content: 'Expert Garment Care', fieldType: 'heading3' },
        text: {
          fieldType: 'markdown',
          content: 'Keep clothes in optimal condition with professional cleaning between rentals.',
        },
      },
      {
        blockName: 'step-block',
        title: { content: 'Hassle-Free Handoffs', fieldType: 'heading3' },
        text: {
          fieldType: 'markdown',
          content: 'Drop it off once—we handle every rental, cleaning, and handoff after that.',
        },
      },
    ],
    ...overrides,
  });

  it('renders the title band and the CTA', () => {
    renderSection(SectionCoclosetLandingPayroll, payrollProps());

    // The live asset duplicates "Put your closet on payroll." into both the title and the
    // description fields (see the fixture's own comment) - this component renders both
    // verbatim, so both appear, hence `getAllByText` rather than `getByText`.
    expect(screen.getAllByText('Put your closet on payroll.')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'START LISTING' })).toHaveAttribute('href', '/l/new');
  });

  it('renders all three benefit cards', () => {
    renderSection(SectionCoclosetLandingPayroll, payrollProps());

    expect(screen.getByText('Recoup Your Retail Cost')).toBeInTheDocument();
    expect(screen.getByText('Expert Garment Care')).toBeInTheDocument();
    expect(screen.getByText('Hassle-Free Handoffs')).toBeInTheDocument();
  });

  it('survives an empty section', () => {
    expect(() =>
      renderSection(SectionCoclosetLandingPayroll, {
        title: { fieldType: 'heading2' },
        description: { fieldType: 'paragraph' },
        callToAction: { fieldType: 'none' },
        blocks: [],
      })
    ).not.toThrow();
  });
});
