import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';

import SectionCoclosetLandingInvite from './SectionCoclosetLandingInvite';

const { screen } = testingLibrary;

// WHY THIS IS A SEPARATE FILE
//
// Like SectionCoclosetPartnerForm, this section is connect()-ed to its own duck
// (SectionCoclosetLandingInvite.duck.js) for submit state, so it needs the real Redux
// Provider `renderWithProviders` sets up.

const inviteProps = () => ({
  sectionId: 'invite',
  blocks: [
    {
      blockName: 'invite-text',
      title: { content: 'CoCloset is coming soon to a city near you. ', fieldType: 'heading3' },
      text: {
        fieldType: 'markdown',
        content: 'Sign up for our email list to receive the latest news and announcements.',
      },
    },
    // block 1 (`invite-form`) is Console's empty placeholder for the form; its own title/text
    // are never read, which this fixture pins by leaving them empty.
    { blockName: 'invite-form', title: { fieldType: 'heading3' }, text: { fieldType: 'markdown' } },
  ],
  options: {},
});

describe('SectionCoclosetLandingInvite', () => {
  it('renders the left-hand copy from block 0', () => {
    render(<SectionCoclosetLandingInvite {...inviteProps()} />);

    expect(
      screen.getByText('CoCloset is coming soon to a city near you.')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/latest news and announcements/)
    ).toBeInTheDocument();
  });

  it('renders the real EmailSignupForm inside the card', () => {
    render(<SectionCoclosetLandingInvite {...inviteProps()} />);

    expect(screen.getByLabelText('EmailSignupForm.nameLabel')).toBeInTheDocument();
    expect(screen.getByLabelText('EmailSignupForm.emailLabel')).toBeInTheDocument();
    expect(screen.getByLabelText('EmailSignupForm.zipCodeLabel')).toBeInTheDocument();
  });

  it('renders the confirmation message instead of the form once submitted', () => {
    render(<SectionCoclosetLandingInvite {...inviteProps()} />, {
      initialState: {
        landingInviteForm: {
          submitInProgress: false,
          submitError: null,
          signupSubmitted: true,
        },
      },
    });

    expect(screen.getByText('SectionCoclosetLandingInvite.submittedTitle')).toBeInTheDocument();
    expect(screen.queryByLabelText('EmailSignupForm.nameLabel')).not.toBeInTheDocument();
  });
});
