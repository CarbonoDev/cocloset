import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';

import css from './PickupTodayBadge.module.css';

/**
 * The "Pickup Today" pill (mockup: green fill, white text, rounded corner, top-right of the
 * card/listing image).
 *
 *   > "la tag debe ser mostrada para los listings que esten en laundry y que esten
 *   >  disponibles para hoy" (Jonathan, 2026-09-11)
 *
 * Presentational only - whether to show it at all is `util/searchCleaningFloor.js`'s
 * `isPickupTodayListing`, decided by the caller so this component has no data dependency of
 * its own and can sit on a card or a listing page alike.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className]
 * @param {string} [props.rootClassName]
 * @returns {JSX.Element}
 */
const PickupTodayBadge = props => {
  const { className, rootClassName } = props;
  const classes = classNames(rootClassName || css.root, className);

  return (
    <span className={classes}>
      <FormattedMessage id="PickupTodayBadge.label" />
    </span>
  );
};

export default PickupTodayBadge;
