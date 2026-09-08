import React from 'react';
import classNames from 'classnames';

import css from './IconShare.module.css';

/**
 * The share mark: a node with two branches, the platform-neutral shape.
 *
 * Deliberately NOT the iOS "box with an arrow": that glyph means "share" only to people who
 * already read it as an iOS convention, and it means "upload" or "export" to everyone else.
 * This one is what Android, and most of the web, use.
 *
 * @component
 * @param {Object} props
 * @param {string?} props.className add more style rules in addition to the component's own css.root
 * @param {string?} props.rootClassName overwrite the component's own css.root
 * @returns {JSX.Element} SVG icon
 */
const IconShare = props => {
  const { className, rootClassName } = props;
  const classes = classNames(rootClassName || css.root, className);

  return (
    <svg
      className={classes}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      // Decorative - the button around it carries the label, and that label changes to
      // "Link copied" after a copy.
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <circle cx="18" cy="5.5" r="2.6" />
        <circle cx="6" cy="12" r="2.6" />
        <circle cx="18" cy="18.5" r="2.6" />
        <path d="m8.3 10.7 7.4-3.9M8.3 13.3l7.4 3.9" />
      </g>
    </svg>
  );
};

export default IconShare;
