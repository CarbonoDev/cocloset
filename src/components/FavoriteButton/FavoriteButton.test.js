import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import FavoriteButton from './FavoriteButton';

const { screen, fireEvent } = testingLibrary;

//   > "el primero es para marcar como favorito (...) puede estar en listingCard, pero tambien
//   >  debe verse en listingPage" (Jonathan, 2026-09-08)
//
// The same garment can be on screen twice, so this button takes its state from the shared
// store rather than from the page around it. These pin that, and the two behaviours that are
// easy to get wrong: what a signed-out visitor gets, and that the heart does not navigate the
// card it is sitting on.

const LISTING_ID = 'aaaaaaaa-0000-0000-0000-000000000000';

const stateWith = ({ favorites = [], isAuthenticated = true, toggling = null } = {}) => ({
  user: {
    currentUser: {
      id: { uuid: 'user-1' },
      attributes: { profile: { privateData: { favoriteListingIds: favorites } } },
    },
  },
  auth: { isAuthenticated },
  favorites: { togglingListingId: toggling, toggleError: null },
});

const renderButton = (initialState, props = {}) =>
  render(<FavoriteButton listingId={LISTING_ID} {...props} />, { initialState });

describe('FavoriteButton', () => {
  it('reads its state from the store, not from a prop', () => {
    renderButton(stateWith({ favorites: [LISTING_ID] }));

    const button = screen.getByRole('button', { name: 'FavoriteButton.saved' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('is unpressed for a garment that is not saved', () => {
    renderButton(stateWith({ favorites: [] }));

    const button = screen.getByRole('button', { name: 'FavoriteButton.save' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('appears for a signed-out visitor', () => {
    // Hiding it is the easier thing and the wrong one: someone who cannot see the control
    // never learns that saving is possible, at the moment they most want to.
    renderButton(stateWith({ isAuthenticated: false }));

    expect(screen.getByRole('button', { name: 'FavoriteButton.save' })).toBeInTheDocument();
  });

  it('does not navigate the card it sits on', () => {
    // The heart is rendered over a link. Without stopping the event, saving a garment sends
    // the reader away from the list they are working through.
    renderButton(stateWith());
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    const button = screen.getByRole('button', { name: 'FavoriteButton.save' });

    fireEvent(button, click);

    expect(click.defaultPrevented).toBe(true);
  });

  it('shows only its own listing as busy', () => {
    // A page of forty cards must not grey out thirty-nine hearts because one is saving.
    renderButton(stateWith({ toggling: 'some-other-listing' }));

    expect(screen.getByRole('button', { name: 'FavoriteButton.save' })).toBeEnabled();
  });

  it('is disabled while its own write is in flight', () => {
    renderButton(stateWith({ toggling: LISTING_ID }));

    expect(screen.getByRole('button', { name: 'FavoriteButton.save' })).toBeDisabled();
  });
});
