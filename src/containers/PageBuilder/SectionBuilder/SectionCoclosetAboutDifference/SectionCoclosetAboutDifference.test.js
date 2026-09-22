import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';

import SectionCoclosetAboutDifference from './SectionCoclosetAboutDifference';

const { screen } = testingLibrary;

const differenceProps = () => ({
  sectionId: 'how-were-different',
  blocks: [
    {
      blockName: 'how-were-different-block',
      title: {
        content: "The 'hassle-free handoff'",
        fieldType: 'heading2',
      },
      text: {
        fieldType: 'markdown',
        content:
          "We've reimagined the rental experience by partnering with trusted professionals.",
      },
    },
  ],
  options: {},
});

describe('SectionCoclosetAboutDifference', () => {
  it('renders the headline and body', () => {
    render(<SectionCoclosetAboutDifference {...differenceProps()} />);

    expect(
      screen.getByRole('heading', { name: "The 'hassle-free handoff'" })
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        "We've reimagined the rental experience by partnering with trusted professionals."
      )
    ).toBeInTheDocument();
  });

  it('renders nothing where there is no block', () => {
    render(
      <SectionCoclosetAboutDifference
        sectionId="how-were-different"
        blocks={[]}
        options={{}}
      />
    );

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});