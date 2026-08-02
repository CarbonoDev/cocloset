import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import { PartnerLandingPageComponent, hostedMetaContent } from './PartnerLandingPage';
import { ASSET_NAME } from './PartnerLandingPage.duck';

const { screen } = testingLibrary;

const noop = () => null;

const defaultProps = {
  scrollingDisabled: false,
  onSubmitApplication: noop,
  onFormChange: noop,
};

const hostedPage = sections => ({
  [ASSET_NAME]: {
    path: `content/pages/${ASSET_NAME}.json`,
    data: {
      sections,
      meta: { pageTitle: { fieldType: 'metaTitle', content: 'Hosted title' } },
    },
  },
});

describe('PartnerLandingPageComponent', () => {
  describe('without a hosted Console page', () => {
    it('falls back to the built-in marketing copy', () => {
      render(<PartnerLandingPageComponent {...defaultProps} />);

      expect(
        screen.getByRole('heading', { name: 'PartnerLandingPage.heroTitle', level: 1 })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'PartnerLandingPage.responsibilitiesTitle', level: 2 })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'PartnerLandingPage.howItWorksTitle', level: 2 })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'PartnerLandingPage.faqTitle', level: 2 })
      ).toBeInTheDocument();
    });

    it('renders the business information the client asked for', () => {
      render(<PartnerLandingPageComponent {...defaultProps} />);

      // What partnering involves, grounded in Project Overview 2.3.
      expect(
        screen.getByText('PartnerLandingPage.responsibility.receiveFromOwners')
      ).toBeInTheDocument();
      expect(
        screen.getByText('PartnerLandingPage.responsibility.cleanAndPrepare')
      ).toBeInTheDocument();
      // How partners get paid.
      expect(
        screen.getByRole('heading', { name: 'PartnerLandingPage.commercialTitle', level: 2 })
      ).toBeInTheDocument();
      expect(screen.getByText('PartnerLandingPage.commercial.payouts')).toBeInTheDocument();
    });

    it('renders every FAQ entry as a question and an answer', () => {
      render(<PartnerLandingPageComponent {...defaultProps} />);

      [
        'whatIsTheRole',
        'payments',
        'turnaround',
        'categories',
        'damage',
        'orders',
        'cost',
        'afterApplying',
      ].forEach(key => {
        expect(
          screen.getByRole('heading', {
            name: `PartnerLandingPage.faq.${key}.question`,
            level: 3,
          })
        ).toBeInTheDocument();
        expect(screen.getByText(`PartnerLandingPage.faq.${key}.answer`)).toBeInTheDocument();
      });
    });

    it('anchors the hero call to action at the application form', () => {
      const { container } = render(<PartnerLandingPageComponent {...defaultProps} />);

      const cta = screen.getByRole('link', { name: 'PartnerLandingPage.heroCta' });
      expect(cta).toHaveAttribute('href', '#apply');
      expect(container.querySelector('#apply')).not.toBeNull();
    });
  });

  it('renders the hosted sections instead of the built-in copy when the page exists', () => {
    render(
      <PartnerLandingPageComponent
        {...defaultProps}
        pageAssetsData={hostedPage([
          { sectionType: 'article', sectionId: 'intro', sectionName: 'intro' },
        ])}
      />
    );

    expect(screen.queryByText('PartnerLandingPage.heroSubtitle')).not.toBeInTheDocument();
    expect(screen.queryByText('PartnerLandingPage.faq.cost.answer')).not.toBeInTheDocument();
  });

  it('always renders the application form, hosted copy or not', () => {
    const { unmount } = render(<PartnerLandingPageComponent {...defaultProps} />);
    expect(
      screen.getByRole('button', { name: 'PartnerApplicationForm.submit' })
    ).toBeInTheDocument();
    unmount();

    render(
      <PartnerLandingPageComponent
        {...defaultProps}
        pageAssetsData={hostedPage([{ sectionType: 'article', sectionId: 'intro' }])}
      />
    );
    expect(
      screen.getByRole('button', { name: 'PartnerApplicationForm.submit' })
    ).toBeInTheDocument();
  });

  it('offers a contact route by email instead of a second form', () => {
    // The default test messages map every key to itself, which drops the
    // {contactLink} placeholder, so this one message is supplied for real.
    render(<PartnerLandingPageComponent {...defaultProps} />, {
      messages: {
        'PartnerLandingPage.contactText': 'Email us at {contactLink}',
        'PartnerLandingPage.contactEmail': 'partners@example.com',
      },
    });

    expect(
      screen.getByRole('heading', { name: 'PartnerLandingPage.contactTitle', level: 2 })
    ).toBeInTheDocument();
    const mailLink = screen.getByRole('link', { name: 'partners@example.com' });
    expect(mailLink).toHaveAttribute('href', 'mailto:partners@example.com');

    // No second, near-identical enquiry form: exactly one form on the page.
    expect(screen.getAllByRole('button', { name: 'PartnerApplicationForm.submit' })).toHaveLength(
      1
    );
  });

  it('replaces the form with a confirmation once an application is submitted', () => {
    render(<PartnerLandingPageComponent {...defaultProps} applicationSubmitted />);

    expect(screen.getByText('PartnerLandingPage.submittedTitle')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'PartnerApplicationForm.submit' })
    ).not.toBeInTheDocument();
  });

  it('surfaces a submit error on the form', () => {
    render(<PartnerLandingPageComponent {...defaultProps} submitError={new Error('nope')} />);

    expect(screen.getByText('PartnerApplicationForm.submitFailed')).toBeInTheDocument();
  });

  it('uses exactly one h1 so the heading hierarchy stays valid', () => {
    render(<PartnerLandingPageComponent {...defaultProps} />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('hostedMetaContent', () => {
  it('returns the content of a meta field', () => {
    expect(hostedMetaContent({ meta: { pageTitle: { content: 'Hi' } } }, 'pageTitle')).toBe('Hi');
  });

  it('returns null for missing, blank or non-string content', () => {
    expect(hostedMetaContent(undefined, 'pageTitle')).toBeNull();
    expect(hostedMetaContent({ meta: {} }, 'pageTitle')).toBeNull();
    expect(hostedMetaContent({ meta: { pageTitle: { content: '  ' } } }, 'pageTitle')).toBeNull();
    expect(hostedMetaContent({ meta: { pageTitle: { content: 12 } } }, 'pageTitle')).toBeNull();
  });
});
