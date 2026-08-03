import React from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { statusLabelKey } from '../../util/laundryStatuses';
import { H4, NamedLink } from '../../components';

import {
  DASHBOARD_TILES,
  TILE_TONES,
  dashboardCounts,
  incomingNext48h,
  needsAttention,
  statusTone,
} from './LaundryOpsPage.helpers';
import css from './LaundryOpsPage.module.css';

const PanelRow = props => {
  const intl = useIntl();
  const { row } = props;
  const labelKey = statusLabelKey(row);
  const pickup = row.bookingStart
    ? intl.formatDate(new Date(row.bookingStart), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : intl.formatMessage({ id: 'LaundryOpsPage.table.noBooking' });

  return (
    <li className={css.panelRow}>
      <div className={css.panelRowMain}>
        <span className={css.primaryText}>{row.title || '—'}</span>
        <span className={css.secondaryText}>
          {[row.ticketCode, row.currentRack, pickup].filter(Boolean).join(' · ')}
        </span>
      </div>
      {labelKey ? (
        <span className={classNames(css.statusBadge, css[`tone${statusTone(row)}`])}>
          <FormattedMessage id={labelKey} />
        </span>
      ) : null}
    </li>
  );
};

/**
 * "Today at the studio" dashboard (mockup 09.jpg): eight stat tiles plus the
 * "Incoming next 48h" and "Needs your attention" panels.
 *
 * @param {Object} props
 * @param {Array} props.rows - all rows from the /api/laundry-orders response
 * @returns {JSX.Element}
 */
const LaundryDashboard = props => {
  const { rows } = props;

  const counts = dashboardCounts(rows);
  const incoming = incomingNext48h(rows);
  const attention = needsAttention(rows);

  return (
    <div className={css.dashboard}>
      <div className={css.tiles}>
        {DASHBOARD_TILES.map(tile => (
          <div key={tile} className={css.tile}>
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
          </div>
        ))}
      </div>

      <div className={css.panels}>
        <section className={css.panel}>
          <H4 as="h2" className={css.panelTitle}>
            <FormattedMessage id="LaundryOpsPage.panel.incoming" />
          </H4>
          {incoming.length === 0 ? (
            <p className={css.emptyState}>
              <FormattedMessage id="LaundryOpsPage.panel.incomingEmpty" />
            </p>
          ) : (
            <ul className={css.panelList}>
              {incoming.map(row => (
                <PanelRow key={row.id} row={row} />
              ))}
            </ul>
          )}
        </section>

        <section className={css.panel}>
          <H4 as="h2" className={css.panelTitle}>
            <FormattedMessage id="LaundryOpsPage.panel.attention" />
          </H4>
          {attention.length === 0 ? (
            <p className={css.emptyState}>
              <FormattedMessage id="LaundryOpsPage.panel.attentionEmpty" />
            </p>
          ) : (
            <ul className={css.panelList}>
              {attention.map(row => (
                <li key={row.id} className={css.panelRow}>
                  <div className={css.panelRowMain}>
                    <span className={css.primaryText}>{row.title || '—'}</span>
                    <span className={css.detailDamage}>{row.damageReported?.note || ''}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <NamedLink name="LaundryOpsOrdersPage" className={css.dashboardLink}>
        <FormattedMessage id="LaundryOpsPage.openOrders" />
      </NamedLink>
    </div>
  );
};

export default LaundryDashboard;
