import React from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';

import css from './HandoverQrCode.module.css';

const SMALL_PX = 48;
const LARGE_PX = 180;

/**
 * The handover QR code for a Cocloset rental.
 *
 * ONE CODE, BOTH HANDOVERS. The same image is scanned when the laundry gives the
 * garment to the customer and when it takes it back; the component takes no
 * "which event" prop, because there is nothing to switch on. See
 * server/api-util/handoverQr.js for the payload scheme, and
 * src/transactions/transactionProcessCoclosetBooking.js
 * (`isHandoverQrVisibleState`) for when it should be rendered at all - this
 * component deliberately does NOT decide that, so the two callers cannot end up
 * with different answers.
 *
 * The image is rendered SERVER-SIDE by /api/transaction-qr (see that file for
 * why it serves PNG bytes rather than a data URL), so this is a plain <img> with
 * no fetch, no loading state, and correct output on the first server-rendered
 * paint.
 *
 * WHAT `payload` IS, AND WHAT THE CODE ACTUALLY ENCODES. `payload` is the transaction id -
 * that is what this component sends to the endpoint and what it prints as selectable text.
 * The endpoint encodes something slightly different: the handover URL built from that id
 * (server/api-util/handoverQr.js `buildHandoverQrScanUrl`), so that scanning the code opens
 * the handover page rather than yielding a string a phone can do nothing with.
 *
 * The two are deliberately not the same. The printed text is the MANUAL fallback for a
 * studio whose scanner is down, and what that studio needs to type is the id - it is what
 * the ops search box matches on. A URL printed under the image would be long, unreadable
 * aloud, and useless in that box.
 *
 * ACCESSIBILITY
 * A QR code is a picture of a string: useless to a screen reader, and useless to
 * a laundry whose scanner is broken - which still has to be able to process the
 * garment. So:
 *   - the <img> always carries a translated `alt` saying what it is. Never "",
 *     and never the raw payload (a screen reader spelling out a UUID is noise).
 *   - `showPayload` renders the payload as SELECTABLE text in a <code>. That is
 *     the manual fallback: it can be read aloud, copied, or typed into the ops
 *     search box, which already matches on the transaction id.
 *   - the payload text is tied to the image with `aria-describedby`, so the two
 *     are announced as one unit rather than an image beside an unexplained hex
 *     string.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className] - extends css.root
 * @param {string} [props.rootClassName] - replaces css.root
 * @param {string} props.payload - the QR payload (the transaction id); renders
 *   nothing without it
 * @param {'small'|'large'} [props.size='large'] - 'small' is for a dense list; the only
 *   caller today is the transaction panel, which uses 'large'
 * @param {boolean} [props.showPayload=false] - also render the payload as
 *   selectable text
 * @param {string} [props.id] - DOM id prefix, needed when several are on one page
 * @returns {JSX.Element|null}
 */
const HandoverQrCode = props => {
  const intl = useIntl();
  const { className, rootClassName, payload, size = 'large', showPayload = false, id } = props;

  if (!payload) {
    return null;
  }

  const isSmall = size === 'small';
  const pixels = isSmall ? SMALL_PX : LARGE_PX;
  const payloadId = `${id || 'handoverQr'}-payload`;
  const src = `/api/transaction-qr?id=${encodeURIComponent(payload)}`;

  const classes = classNames(rootClassName || css.root, className, {
    [css.small]: isSmall,
    [css.large]: !isSmall,
  });

  return (
    <div className={classes}>
      <img
        className={css.image}
        src={src}
        alt={intl.formatMessage({ id: 'HandoverQrCode.imageAlt' })}
        aria-describedby={showPayload ? payloadId : undefined}
        width={pixels}
        height={pixels}
        // No reason to fetch one that is below
        // the fold.
        loading="lazy"
      />
      {showPayload ? (
        <span className={css.payload} id={payloadId}>
          <FormattedMessage
            id="HandoverQrCode.payloadLabel"
            values={{ payload: <code className={css.payloadValue}>{payload}</code> }}
          />
        </span>
      ) : null}
    </div>
  );
};

export default HandoverQrCode;
