import React from 'react';

import { FormattedMessage } from '../../util/reactIntl';
import { parse, stringify } from '../../util/urlHelpers';

import css from './PickupTodayFilterToggle.module.css';

/**
 * "Available today" - a plain checkbox, not one of the config-driven filters in
 * `availableFilters`.
 *
 *   > "hay que agregar un filtro en el search que nos permita filtrar por listings que
 *   >  esten disponibles para hoy" (Jonathan, 2026-09-11)
 *
 * WHY IT DOES NOT GO THROUGH FilterComponent / validURLParamForExtendedData. Every filter on
 * that path is either Console-hosted extended data with a real `flex-cli search` schema
 * (brand, category) or a synthesised listing field built the same way (pickup, neighbourhood -
 * see withLaundryPickupFilter). "Available today" has no stored field to index at all - it is
 * computed per-search from booking dates and a cleaning floor (SearchPage.duck.js reuses the
 * date filter's own machinery internally). Forcing a computed value through a system built for
 * indexed ones would mean either a fake schema for something that is not data, or a case in
 * every one of validURLParamForExtendedData's branches for a filter that behaves like none of
 * them. A plain URL param and a plain checkbox says exactly what this is.
 *
 * `pickupToday` naturally survives "Reset all": that button rebuilds the URL from
 * `urlQueryParams`, which only ever holds recognised filter params (see
 * validFilterParams/pickSearchParamsOnly) - this one is never among them, so a reset drops it
 * without needing to know it exists.
 *
 * @component
 * @param {Object} props
 * @param {Object} props.history - router history, for pushing the toggled search
 * @param {Object} props.location - router location, read for the current search string
 * @param {string} [props.className]
 * @returns {JSX.Element}
 */
const PickupTodayFilterToggle = props => {
  const { history, location, className } = props;
  const params = parse(location.search);
  const checked = params.pickupToday === 'true';

  const handleChange = () => {
    const { pickupToday, ...rest } = params;
    const nextParams = checked ? rest : { ...rest, pickupToday: 'true' };
    history.push({ search: stringify(nextParams) });
  };

  return (
    <label className={className || css.root}>
      <input
        type="checkbox"
        className={css.input}
        checked={checked}
        onChange={handleChange}
      />
      <FormattedMessage id="SearchPage.pickupTodayFilterLabel" />
    </label>
  );
};

export default PickupTodayFilterToggle;
