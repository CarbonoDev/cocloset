import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../util/testHelpers';

import SectionCoclosetHero from './SectionCoclosetHero';
import SectionCoclosetLaundry from './SectionCoclosetLaundry';
import SectionCoclosetSteps from './SectionCoclosetSteps';

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
});

describe('SectionCoclosetLaundry', () => {
  const laundryProps = (overrides = {}) => ({
    title: { content: 'For our laundry partners', fieldType: 'heading2' },
    description: { fieldType: 'paragraph' },
    blocks: [
      {
        blockId: 'laundry-partners',
        title: { content: 'A storefront for every neighbourhood laundry.', fieldType: 'heading3' },
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

    expect(screen.getByText('A storefront for every neighbourhood laundry.')).toBeInTheDocument();
    expect(screen.getByText(/ticketed operations dashboard/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the laundry dashboard' })).toHaveAttribute(
      'href',
      '/laundry'
    );
  });

  it('renders the pitch alone when the tiles block is missing', () => {
    renderSection(SectionCoclosetLaundry, laundryProps({ blocks: [laundryProps().blocks[0]] }));

    expect(screen.getByText('A storefront for every neighbourhood laundry.')).toBeInTheDocument();
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
