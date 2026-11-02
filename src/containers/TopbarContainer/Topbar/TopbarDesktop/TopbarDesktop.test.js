import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';
import { createCurrentUser, fakeIntl } from '../../../../util/testData';

import TopbarDesktop from './TopbarDesktop';

const { screen } = testingLibrary;

// ---------------------------------------------------------------------------
//   > "Puedes agregar un button con label 'Borrow' en el topbar, debe llevar a /s, no debe ser
//   >  visible para laundries"
//
// The interesting part is not that the link exists - it is WHO does not get it, and that an
// anonymous reader still does. So the rule is keyed on being a laundry rather than on being
// signed in, and these say so.
// ---------------------------------------------------------------------------

const laundryUser = createCurrentUser('studio-1', {
  profile: { metadata: { isLaundry: true } },
});

const renderTopbar = (props = {}) =>
  render(
    <TopbarDesktop
      config={{ marketplaceName: 'Cocloset', topbar: {} }}
      customLinks={[]}
      currentUser={null}
      currentPage="LandingPage"
      notificationCount={0}
      intl={fakeIntl}
      isAuthenticated={false}
      onLogout={() => null}
      onSearchSubmit={() => null}
      showSearchForm={false}
      showCreateListingsLink={false}
      inboxTab="orders"
      {...props}
    />
  );

const borrowLink = () => screen.queryByText('TopbarDesktop.borrow');

describe('TopbarDesktop: the Borrow link', () => {
  it('points at the search page', async () => {
    renderTopbar();

    expect(borrowLink().closest('a')).toHaveAttribute('href', '/s');
  });

  // Anonymous readers are exactly who a marketplace wants browsing, so this is NOT gated on
  // being signed in - which is the mistake the rule invites.
  it('is there for an anonymous reader', async () => {
    renderTopbar();

    expect(borrowLink()).toBeInTheDocument();
  });

  it('is there for a signed-in borrower', async () => {
    renderTopbar({ isAuthenticated: true, currentUser: createCurrentUser('renter-1') });

    expect(borrowLink()).toBeInTheDocument();
  });

  // A studio does not borrow. Its topbar already carries the panel where its work lives, and
  // one more link to a shop it has no use for is one more thing between it and that panel.
  it('is absent for a studio', async () => {
    renderTopbar({ isAuthenticated: true, currentUser: laundryUser });

    expect(borrowLink()).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
//   > "puedes cambiar el label, si el usuario no está logeado, entonces debe decir 'Partner'"
//   >   (Jonathan, 2026-09-21)
//
// Same link (the partner pitch, for anonymous; the ops dashboard, for a signed-in studio),
// different words depending on who is reading - "Laundry" reads as a filter/category to
// someone who has never heard of the studio side, "Partner" reads as an invitation.
// ---------------------------------------------------------------------------
describe('TopbarDesktop: the Laundry/Partner link label', () => {
  it('says "Partner" for an anonymous reader', async () => {
    renderTopbar();

    expect(screen.getByText('TopbarDesktop.becomePartner')).toBeInTheDocument();
    expect(screen.queryByText('TopbarDesktop.laundry')).not.toBeInTheDocument();
  });

  it('still says "Laundry" for a signed-in studio', async () => {
    renderTopbar({ isAuthenticated: true, currentUser: laundryUser });

    expect(screen.getByText('TopbarDesktop.laundry')).toBeInTheDocument();
    expect(screen.queryByText('TopbarDesktop.becomePartner')).not.toBeInTheDocument();
  });

  it('renders neither label for a signed-in non-laundry user', async () => {
    renderTopbar({ isAuthenticated: true, currentUser: createCurrentUser('renter-1') });

    expect(screen.queryByText('TopbarDesktop.laundry')).not.toBeInTheDocument();
    expect(screen.queryByText('TopbarDesktop.becomePartner')).not.toBeInTheDocument();
  });
});
