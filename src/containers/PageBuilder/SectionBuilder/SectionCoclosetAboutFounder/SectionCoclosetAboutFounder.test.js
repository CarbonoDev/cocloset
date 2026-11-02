import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';

import SectionCoclosetAboutFounder from './SectionCoclosetAboutFounder';

const { screen } = testingLibrary;

const founderProps = () => ({
  sectionId: 'our-team',
  blocks: [
    {
      blockName: 'founder-block',
      title: { content: 'Alison Friedman, Founder', fieldType: 'heading3' },
      text: { fieldType: 'markdown', content: 'I started CoCloset with a simple goal.' },
      media: {
        fieldType: 'image',
        image: { _ref: { id: 'img-2', type: 'imageAsset' } },
        alt: 'Alison Friedman, Founder',
      },
    },
  ],
  options: {},
});

describe('SectionCoclosetAboutFounder', () => {
  it("renders the founder's name and bio", () => {
    render(<SectionCoclosetAboutFounder {...founderProps()} />);

    expect(
      screen.getByRole('heading', { name: 'Alison Friedman, Founder' })
    ).toBeInTheDocument();
    expect(screen.getByText('I started CoCloset with a simple goal.')).toBeInTheDocument();
  });

  it('renders nothing where there is no block', () => {
    render(<SectionCoclosetAboutFounder sectionId="our-team" blocks={[]} options={{}} />);

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
