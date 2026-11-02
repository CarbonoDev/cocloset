import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';
import { createCurrentUser } from '../../../../util/testData';

import TopbarMobileMenu from './TopbarMobileMenu';

const { screen } = testingLibrary;

// The mobile twin of the desktop Borrow link. A topbar button that only exists on desktop is
// half a feature, and the mobile menu has TWO renders - anonymous and signed-in - which is
// exactly the kind of split where one of them quietly goes without.

const laundryUser = createCurrentUser('studio-1', {
  profile: { metadata: { isLaundry: true }, firstName: 'Pigalle' },
});

const renderMenu = (props = {}) =>
  render(
    <TopbarMobileMenu
      isAuthenticated={false}
      currentUser={null}
      currentPage="LandingPage"
      notificationCount={0}
      customLinks={[]}
      onLogout={() => null}
      showCreateListingsLink={false}
      inboxTab="orders"
      {...props}
    />
  );

const borrowLink = () => screen.queryByText('TopbarMobileMenu.borrowLink');

describe('TopbarMobileMenu: the Borrow link', () => {
  it('points at the search page', async () => {
    renderMenu();

    expect(borrowLink().closest('a')).toHaveAttribute('href', '/s');
  });

  // BOTH renders. An anonymous reader is exactly who a marketplace wants browsing, so a link
  // that only appeared after signing in would hide the shop from the people most likely to
  // want it.
  it('is there for an anonymous reader', async () => {
    renderMenu();

    expect(borrowLink()).toBeInTheDocument();
  });

  it('is there for a signed-in borrower', async () => {
    renderMenu({
      isAuthenticated: true,
      currentUser: createCurrentUser('renter-1', { profile: { firstName: 'Ana' } }),
    });

    expect(borrowLink()).toBeInTheDocument();
  });

  it('is absent for a studio', async () => {
    renderMenu({ isAuthenticated: true, currentUser: laundryUser });

    expect(borrowLink()).not.toBeInTheDocument();
  });
});
