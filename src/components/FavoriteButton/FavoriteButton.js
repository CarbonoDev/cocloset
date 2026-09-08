import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useHistory, useLocation } from 'react-router-dom';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { createResourceLocatorString } from '../../util/routes';
import { useRouteConfiguration } from '../../context/routeConfigurationContext';
import { isFavoriteSelector, toggleFavorite } from '../../ducks/favorites.duck';

import IconHeart from '../IconHeart/IconHeart';
import css from './FavoriteButton.module.css';

/**
 * Save a garment, or take it off the list.
 *
 *   > "el primero es para marcar como favorito (...) puede estar en listingCard, pero tambien
 *   >  debe verse en listingPage" (Jonathan, 2026-09-08)
 *
 * WIRED TO THE STORE ITSELF, not through props. Every other button on this project takes its
 * state from the page around it, and that is right when the page owns the state. This one does
 * not: the same garment can be on screen twice - a card in search and the listing page behind
 * a modal, or a card on the favourites page - and a heart that took `isFavorite` from its
 * parent would leave those copies disagreeing after a click. Reading the shared duck means
 * every heart for a listing is the same heart.
 *
 * SIGNED OUT, IT STILL APPEARS. Hiding it would be the easier thing and the wrong one: a
 * visitor who cannot see the control does not learn that saving is possible, and this is
 * precisely the moment they want to. Clicking sends them to log in and brings them back to the
 * page they were on - the favourite itself is not applied, because guessing at an action
 * across a login is how people end up with things they did not choose.
 *
 * @component
 * @param {Object} props
 * @param {string} props.listingId - the listing's UUID string
 * @param {string?} props.className
 * @param {string?} props.rootClassName
 * @returns {JSX.Element}
 */
const FavoriteButton = props => {
  const { listingId, className, rootClassName } = props;

  const intl = useIntl();
  const dispatch = useDispatch();
  const history = useHistory();
  const location = useLocation();
  const routeConfiguration = useRouteConfiguration();

  const isFavorite = useSelector(state => isFavoriteSelector(state, listingId));
  const isAuthenticated = useSelector(state => state.auth.isAuthenticated);
  const inProgress = useSelector(state => state.favorites.togglingListingId === listingId);

  const label = intl.formatMessage({
    id: isFavorite ? 'FavoriteButton.saved' : 'FavoriteButton.save',
  });

  const handleClick = e => {
    // The heart sits on top of a card that is itself a link. Without this, saving a garment
    // navigates away from the list the person is working through.
    e.preventDefault();
    e.stopPropagation();

    if (!isAuthenticated) {
      const from = `${location.pathname}${location.search}${location.hash}`;
      history.push(
        createResourceLocatorString('LoginPage', routeConfiguration, {}, {}),
        // The template's own convention for coming back after a login (see AuthenticationPage).
        { from }
      );
      return;
    }

    dispatch(toggleFavorite(listingId));
  };

  return (
    <button
      type="button"
      className={classNames(rootClassName || css.root, className, {
        [css.isFavorite]: isFavorite,
      })}
      onClick={handleClick}
      disabled={inProgress}
      // The label is the STATE, not the action: a screen reader user pressing a control
      // labelled "Save" that is already saved has no way to know what will happen. `aria-pressed`
      // carries the toggle, the label carries what it is.
      aria-pressed={isFavorite}
      aria-label={label}
      title={label}
    >
      <IconHeart className={css.icon} isFilled={isFavorite} />
      {/* Visible text only where a caller asks for it - the cards are image-first and would be
          cluttered by a word. The accessible name above is there either way. */}
      <span className={css.label}>
        <FormattedMessage id={isFavorite ? 'FavoriteButton.saved' : 'FavoriteButton.save'} />
      </span>
    </button>
  );
};

export default FavoriteButton;
