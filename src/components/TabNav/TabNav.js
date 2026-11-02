import React from 'react';
import classNames from 'classnames';
import { NamedLink } from '../../components';

import css from './TabNav.module.css';

const Tab = props => {
  const {
    className,
    id,
    disabled,
    text,
    selected,
    linkProps,
    linkClassName,
    selectedLinkClassName,
  } = props;
  const linkClasses = classNames(linkClassName || css.link, {
    [selectedLinkClassName || css.selectedLink]: selected,
    [css.disabled]: disabled,
  });

  return (
    <div id={id} className={className}>
      <NamedLink className={linkClasses} {...linkProps}>
        {text}
      </NamedLink>
    </div>
  );
};

/**
 * @typedef {Object} TabConfig
 * @property {string} text - The text to be rendered in the tab
 * @property {boolean} disabled - Whether the tab is disabled
 * @property {boolean} selected - Whether the tab is selected
 * @property {Object} linkProps - The props to be passed to the link component
 * @property {string} linkProps.name - The name of the link
 * @property {string} linkProps.params - The path params to be passed to the link component
 * @property {string} linkProps.to - The rest of the URL params neede
 */

/**
 * A component that renders a tab navigation.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {string} [props.tabRootClassName] - Custom class that overrides the default class for the tab element
 * @param {string} [props.tabLinkClassName] - Custom class that overrides the default class for a tab's link
 * @param {string} [props.tabSelectedLinkClassName] - Custom class that overrides the default class for the selected tab's link
 * @param {React.ReactNode} [props.header] - Optional content rendered above the tabs inside the nav
 * @param {Array<TabConfig>} props.tabs - The tabs to render
 * @returns {JSX.Element}
 */
const TabNav = props => {
  const {
    className,
    rootClassName,
    tabRootClassName,
    tabLinkClassName,
    tabSelectedLinkClassName,
    header,
    tabs,
    ariaLabel,
  } = props;
  const classes = classNames(rootClassName || css.root, className);
  const tabClasses = tabRootClassName || css.tab;
  return (
    <nav className={classes} aria-label={ariaLabel}>
      {header}
      {tabs.map((tab, index) => {
        const id = typeof tab.id === 'string' ? tab.id : `${index}`;
        return (
          <Tab
            key={id}
            id={id}
            className={tabClasses}
            linkClassName={tabLinkClassName}
            selectedLinkClassName={tabSelectedLinkClassName}
            {...tab}
          />
        );
      })}
    </nav>
  );
};

export default TabNav;
