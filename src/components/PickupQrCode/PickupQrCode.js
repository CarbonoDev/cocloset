import React from 'react';
import classNames from 'classnames';

import { useIntl } from '../../util/reactIntl';

import css from './PickupQrCode.module.css';

/**
 * The pickup QR code: a provider paused their listing to go collect a garment sitting at the
 * laundry with nothing renting it, and this is the code they show at the counter.
 *
 * UNLIKE HandoverQrCode, THERE IS NO PRINTED-TEXT FALLBACK.
 *
 *   > "quiza podamos empatar un pin ademas del id, la laundry no debe ingresar ningun dato
 *   >  adicional ni el provider, solo con el QR" (Jonathan, 2026-09-30)
 *
 * The handover QR's payload is a transaction id - not a secret, so printing it as selectable
 * text for a broken-scanner fallback costs nothing. This QR's payload embeds the pickup TOKEN
 * (see server/api-util/listingPickupQr.js), which is the entire credential - printing it next
 * to the image would hand anyone who can see the screen the same power as scanning it. A
 * studio whose scanner is broken still has the trust-based door (the ops dashboard's own hand
 * back button), which this feature adds alongside rather than replaces.
 *
 * The image is rendered SERVER-SIDE by /api/listing-pickup-qr (see that file's header - unlike
 * /api/transaction-qr this one is authenticated, since it MINTS a secret rather than echoing
 * back input), so this is a plain <img>: no fetch, no loading state.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className]
 * @param {string} [props.rootClassName]
 * @param {string} props.listingId - renders nothing without it
 * @returns {JSX.Element|null}
 */
const PickupQrCode = props => {
  const intl = useIntl();
  const { className, rootClassName, listingId } = props;

  if (!listingId) {
    return null;
  }

  const classes = classNames(rootClassName || css.root, className);
  const src = `/api/listing-pickup-qr?id=${encodeURIComponent(listingId)}`;

  return (
    <div className={classes}>
      <img
        className={css.image}
        src={src}
        alt={intl.formatMessage({ id: 'PickupQrCode.imageAlt' })}
        width={180}
        height={180}
      />
    </div>
  );
};

export default PickupQrCode;
