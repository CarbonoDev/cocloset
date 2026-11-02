import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';

import SectionCoclosetPartnerForm from './SectionCoclosetPartnerForm';

const { screen } = testingLibrary;

// WHY THIS IS A SEPARATE FILE FROM coclosetSections.test.js
//
// Every other bespoke become-a-partner section is plain and presentational, so
// coclosetSections.test.js renders them directly. This one is connect()-ed to the
// `partnerApplicationForm` slice (see SectionCoclosetPartnerForm.duck.js) for its submit
// state, so it needs the real Redux Provider `renderWithProviders` sets up - which is also
// why it is the default export under test here rather than a named presentational component.

const formProps = () => ({
  sectionId: 'form',
  blocks: [
    {
      blockName: 'form-info',
      title: { content: 'Learn more about partnership', fieldType: 'heading3' },
      text: {
        fieldType: 'markdown',
        content: 'Tell us a little about your business, and someone from our partnership team will get in touch.',
      },
    },
    // block 1 (`form-block`) is Console's placeholder for the form; its own title/text are
    // never read, which this fixture pins by leaving them empty.
    { blockName: 'form-block', title: { fieldType: 'heading3' }, text: { fieldType: 'markdown' } },
  ],
  options: {},
});

describe('SectionCoclosetPartnerForm', () => {
  it('renders the left-hand copy from block 0', () => {
    render(<SectionCoclosetPartnerForm {...formProps()} />);

    expect(screen.getByText('Learn more about partnership')).toBeInTheDocument();
    expect(
      screen.getByText(/someone from our partnership team will get in touch/)
    ).toBeInTheDocument();
  });

  it('renders the real PartnerApplicationForm inside the card, not the mockup fields', () => {
    render(<SectionCoclosetPartnerForm {...formProps()} />);

    expect(screen.getByLabelText('PartnerApplicationForm.studioNameLabel')).toBeInTheDocument();
    expect(screen.getByLabelText('PartnerApplicationForm.emailLabel')).toBeInTheDocument();
    expect(screen.queryByText('Preferred day(s) for assessment')).not.toBeInTheDocument();
  });

  it('renders the confirmation message instead of the form once submitted', () => {
    render(<SectionCoclosetPartnerForm {...formProps()} />, {
      initialState: {
        partnerApplicationForm: {
          submitInProgress: false,
          submitError: null,
          applicationSubmitted: true,
        },
      },
    });

    expect(
      screen.getByText('SectionCoclosetPartnerForm.submittedTitle')
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText('PartnerApplicationForm.studioNameLabel')
    ).not.toBeInTheDocument();
  });
});
