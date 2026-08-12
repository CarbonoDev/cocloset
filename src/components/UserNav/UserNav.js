import React from 'react';
import { FormattedMessage, useIntl } from '../../util/reactIntl';
import classNames from 'classnames';
import { ACCOUNT_SETTINGS_PAGES, LAUNDRY_OPS_PAGES } from '../../routing/routeConfiguration';
import { LinkTabNavHorizontal } from '../../components';

import css from './UserNav.module.css';

/**
 * A component that renders a navigation bar for a user-specific pages.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {string} props.currentPage - The current page (e.g. 'ManageListingsPage')
 * @param {boolean} [props.showManageListingsLink] - Whether to show the "Your listings" tab
 * @param {boolean} [props.showLaundryProfileLink] - Whether to show the "Studio profile" tab.
 *   Callers pass isLaundryUser(currentUser); this component stays presentational, matching
 *   how showManageListingsLink is already threaded through from each page.
 * @returns {JSX.Element} User navigation component
 */
const UserNav = props => {
  const {
    className,
    rootClassName,
    currentPage,
    showManageListingsLink,
    showLaundryProfileLink,
  } = props;
  const intl = useIntl();
  const classes = classNames(rootClassName || css.root, className);

  // Sits first so the ops section reads as the laundry's primary home, ahead of the
  // generic account tabs. Non-laundry users never get this tab.
  const laundryProfileTabMaybe = showLaundryProfileLink
    ? [
        {
          text: <FormattedMessage id="UserNav.laundryProfile" />,
          selected: LAUNDRY_OPS_PAGES.includes(currentPage),
          linkProps: {
            name: 'LaundryProfilePage',
          },
        },
      ]
    : [];

  const manageListingsTabMaybe = showManageListingsLink
    ? [
        {
          text: <FormattedMessage id="UserNav.yourListings" />,
          selected: currentPage === 'ManageListingsPage',
          linkProps: {
            name: 'ManageListingsPage',
          },
        },
      ]
    : [];

  const tabs = [
    ...laundryProfileTabMaybe,
    ...manageListingsTabMaybe,
    {
      text: <FormattedMessage id="UserNav.profileSettings" />,
      selected: currentPage === 'ProfileSettingsPage',
      disabled: false,
      linkProps: {
        name: 'ProfileSettingsPage',
      },
    },
    {
      text: <FormattedMessage id="UserNav.accountSettings" />,
      selected: ACCOUNT_SETTINGS_PAGES.includes(currentPage),
      disabled: false,
      linkProps: {
        name: 'ContactDetailsPage',
      },
    },
  ];

  return (
    <LinkTabNavHorizontal
      className={classes}
      tabRootClassName={css.tab}
      tabs={tabs}
      skin="dark"
      ariaLabel={intl.formatMessage({ id: 'UserNav.screenreader.userNav' })}
    />
  );
};

export default UserNav;
