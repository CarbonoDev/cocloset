import React from 'react';
import classNames from 'classnames';

import css from './IconHeart.module.css';

/**
 * The favourite mark.
 *
 * A HEART RATHER THAN A BOOKMARK, and the choice is not decoration. A bookmark reads as "put
 * this aside to deal with later" - the verb is remembering. A heart reads as "I want this",
 * which is what a renter is doing when they save a garment they cannot borrow this weekend.
 * It is also the convention wherever clothes are rented or resold, so it needs no explaining.
 *
 * ONE PATH, TWO STATES. Filled and outlined are the same shape with a different `fill`, so the
 * mark does not move or resize when it is toggled - a shape that shifts under the cursor makes
 * a list feel unstable while somebody works down it.
 *
 * @component
 * @param {Object} props
 * @param {string?} props.className add more style rules in addition to the component's own css.root
 * @param {string?} props.rootClassName overwrite the component's own css.root
 * @param {boolean?} props.isFilled is this listing already a favourite
 * @returns {JSX.Element} SVG icon
 */
const IconHeart = props => {
  const { className, rootClassName, isFilled } = props;
  const classes = classNames(rootClassName || css.root, className, {
    [css.filled]: isFilled,
  });

  return (
    <svg
      className={classes}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      // Decorative: every caller wraps this in a button that carries the real label, and the
      // label changes with the state ("Save" / "Saved"). An `aria-label` here would be read
      // out as well, twice for one control.
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 20.25 4.6 13.1a4.6 4.6 0 0 1 0-6.55 4.72 4.72 0 0 1 6.62 0l.78.77.78-.77a4.72 4.72 0 0 1 6.62 0 4.6 4.6 0 0 1 0 6.54L12 20.25Z"
        fill={isFilled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default IconHeart;
