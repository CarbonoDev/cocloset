import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';

import SectionCoclosetAboutIntro from './SectionCoclosetAboutIntro';

const { screen } = testingLibrary;

const introProps = () => ({
  sectionId: 'our-story',
  title: { content: 'Welcome to CoCloset', fieldType: 'heading2' },
  blocks: [
    {
      blockName: 'our-story-block',
      title: {
        content: 'Better for you, better for your community',
        fieldType: 'heading2',
      },
      text: { fieldType: 'markdown', content: 'CoCloset was built on a simple premise.' },
      media: {
        fieldType: 'image',
        image: { _ref: { id: 'img-1', type: 'imageAsset' } },
        alt: 'Clothing rack',
      },
    },
  ],
  options: {},
});

describe('SectionCoclosetAboutIntro', () => {
  it("renders the section's own title as the page heading", () => {
    render(<SectionCoclosetAboutIntro {...introProps()} />);

    expect(screen.getByRole('heading', { name: 'Welcome to CoCloset' })).toBeInTheDocument();
  });

  it("renders the block's own headline and body", () => {
    render(<SectionCoclosetAboutIntro {...introProps()} />);

    expect(
      screen.getByRole('heading', { name: 'Better for you, better for your community' })
    ).toBeInTheDocument();
    expect(screen.getByText('CoCloset was built on a simple premise.')).toBeInTheDocument();
  });

  it('renders nothing extra when there is no section title', () => {
    const props = introProps();
    props.title = { content: '', fieldType: 'heading2' };

    render(<SectionCoclosetAboutIntro {...props} />);

    expect(screen.queryByRole('heading', { name: 'Welcome to CoCloset' })).not.toBeInTheDocument();
  });
});
