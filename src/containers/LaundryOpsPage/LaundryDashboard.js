import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { useRouteConfiguration } from '../../context/routeConfigurationContext';
import { pathByRouteName } from '../../util/routes';
import { stringify } from '../../util/urlHelpers';
import { NamedLink } from '../../components';

import {
  DASHBOARD_TILES,
  TILE_ROUTES,
  TILE_TONES,
  dashboardCounts,
} from './LaundryOpsPage.helpers';
import css from './LaundryOpsPage.module.css';

/**
 * "Lookup ticket #" - the 8th card in the tile grid (2026-09-11: "solo
 * tenemos que tener esas 8 cards"), replacing the old panels and the button
 * that used to sit below them. Typing an internal ticket code and submitting
 * jumps straight to the Orders screen pre-filtered to it, via the same
 * `?search=` param LaundryOrdersTable already reads for its own search box.
 */
const TicketLookupTile = () => {
  const intl = useIntl();
  const history = useHistory();
  const routeConfiguration = useRouteConfiguration();
  const [value, setValue] = useState('');

  const handleSubmit = e => {
    e.preventDefault();
    const query = value.trim();
    if (!query) {
      return;
    }
    history.push({
      pathname: pathByRouteName('LaundryOpsOrdersPage', routeConfiguration),
      search: stringify({ search: query }),
    });
  };

  return (
    <form className={classNames(css.tile, css.ticketLookupTile)} onSubmit={handleSubmit}>
      <span className={css.tileLabel}>
        <FormattedMessage id="LaundryOpsPage.ticketLookup.placeholder" />
      </span>
      <div className={css.ticketLookup}>
        <input
          type="search"
          className={css.search}
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={intl.formatMessage({ id: 'LaundryOpsPage.ticketLookup.placeholder' })}
          aria-label={intl.formatMessage({ id: 'LaundryOpsPage.ticketLookup.placeholder' })}
        />
        <button type="submit" className={css.dashboardLink}>
          <FormattedMessage id="LaundryOpsPage.ticketLookup.submit" />
        </button>
      </div>
    </form>
  );
};

/**
 * "Today at the studio" dashboard: exactly 8 cards (2026-09-11) - the 7 stat
 * tiles plus the ticket lookup card, nothing else.
 *
 * @param {Object} props
 * @param {Array} props.rows - all rows from the /api/laundry-orders response
 * @param {Array} [props.inventory] - per-garment rows from the same response
 * @returns {JSX.Element}
 */
const LaundryDashboard = props => {
  const { rows, inventory = [] } = props;

  const counts = dashboardCounts(rows, inventory);

  return (
    <div className={css.dashboard}>
      <div className={css.tiles}>
        {DASHBOARD_TILES.map(tile => (
          <NamedLink key={tile} name={TILE_ROUTES[tile]} className={css.tile}>
            <span className={css.tileLabel}>
              <FormattedMessage id={`LaundryOpsPage.tile.${tile}`} />
            </span>
            <span
              className={classNames(css.tileValue, {
                [css[`tileValue${TILE_TONES[tile]}`]]: !!TILE_TONES[tile],
              })}
            >
              {counts[tile]}
            </span>
          </NamedLink>
        ))}
        <TicketLookupTile />
      </div>
    </div>
  );
};

export default LaundryDashboard;
