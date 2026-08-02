import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';
import { NamedLink } from '../../components';

import css from './LaundryOpsPage.module.css';

// Sidebar shared by every ops screen (visible in all of mockups 03-09).
// "Settings" deliberately points at the existing LaundryProfilePage rather
// than re-implementing mockup 03.jpg - that screen is already built.
const NAV_ITEMS = [
  { name: 'LaundryOpsDashboardPage', labelId: 'LaundryOpsPage.nav.dashboard' },
  { name: 'LaundryOpsOrdersPage', labelId: 'LaundryOpsPage.nav.orders' },
  { name: 'LaundryOpsPickupsPage', labelId: 'LaundryOpsPage.nav.pickups' },
  { name: 'LaundryOpsReturnsPage', labelId: 'LaundryOpsPage.nav.returns' },
  { name: 'LaundryOpsCleaningPage', labelId: 'LaundryOpsPage.nav.cleaning' },
  { name: 'LaundryOpsInventoryPage', labelId: 'LaundryOpsPage.nav.inventory' },
  { name: 'LaundryProfilePage', labelId: 'LaundryOpsPage.nav.settings' },
];

/**
 * LaundryOpsNav
 *
 * @param {Object} props
 * @param {string} props.currentPage - route name of the active screen
 * @param {string} [props.studioName] - laundry's studio name, shown as a subtitle
 * @returns {JSX.Element}
 */
const LaundryOpsNav = props => {
  const { currentPage, studioName } = props;

  return (
    <nav className={css.opsNav}>
      <div className={css.opsNavHeader}>
        <span className={css.opsNavTitle}>
          <FormattedMessage id="LaundryOpsPage.nav.title" />
        </span>
        {studioName ? <span className={css.opsNavStudio}>{studioName}</span> : null}
      </div>
      <ul className={css.opsNavList}>
        {NAV_ITEMS.map(item => (
          <li key={item.name}>
            <NamedLink
              name={item.name}
              className={classNames(css.opsNavLink, {
                [css.opsNavLinkActive]: currentPage === item.name,
              })}
            >
              <FormattedMessage id={item.labelId} />
            </NamedLink>
          </li>
        ))}
      </ul>
      <p className={css.opsNavHint}>
        <FormattedMessage id="LaundryOpsPage.nav.scanHint" />
      </p>
    </nav>
  );
};

export default LaundryOpsNav;
