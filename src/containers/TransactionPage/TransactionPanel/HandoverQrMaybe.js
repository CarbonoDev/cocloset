import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../../util/reactIntl';
import { HandoverQrCode, Heading } from '../../../components';
import { isHandoverQrVisibleState } from '../../../transactions/transactionProcessCoclosetBooking';
import { resolveHandoverQrPayload } from '../../../util/handoverQr';

import css from './HandoverQrMaybe.module.css';

const COCLOSET_BOOKING_PROCESS = 'cocloset-booking';

/**
 * The handover QR panel on the transaction detail page (mockups 16/17: a QR
 * image in the detail panel, above the PICKUP and RETURN boxes).
 *
 * This is the screen the client's complaint was about - "el QR que se debe
 * mostrar al cliente, nunca se genera". Nothing rendered a QR before this.
 *
 * THREE THINGS IT GETS RIGHT ON PURPOSE
 *
 * 1. ONE QR, BOTH DIRECTIONS. There is a single <HandoverQrCode>, and the copy
 *    says so ("the same code is scanned when you collect the garment and when
 *    you bring it back"). The customer is never shown a second code for the
 *    return, and no code path here could produce one - which is the point of
 *    the requirement "este mismo qr debe funcionar para recibir la prenda, como
 *    para entregarla".
 *
 * 2. IT DISAPPEARS, DERIVED FROM STATE. Visibility comes from
 *    `isHandoverQrVisibleState(processState)` - the transaction's real
 *    `cocloset-booking` state - and from nothing else. There is no
 *    `metadata.qrUsed` flag, because entering `returned` already means both
 *    handovers happened (the only ways in are the two return transitions). A
 *    flag would be a second source of truth that could disagree with the state
 *    machine. See the comment on HANDOVER_QR_VISIBLE_STATES.
 *
 * 3. THE DATA IS NOT WHAT DISAPPEARS. `metadata.handoverQr` is never deleted;
 *    this component just stops rendering it. "Debe desaparecer despues de este
 *    evento" is about the screen, "la información del qr debe permanecer en la
 *    metadata" about the record, and those are not in conflict.
 *
 * Shown to BOTH parties. The customer is the one who carries it to the counter,
 * but the owner sees the same detail view (mockup 17 confirms the structure is
 * shared), and an owner being able to read out the code when a customer phones
 * them is useful rather than harmful - it is an identifier, not a credential.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className]
 * @param {string} [props.rootClassName]
 * @param {string} [props.processName] - stateData.processName
 * @param {string} [props.processState] - stateData.processState
 * @param {Object} [props.transactionId] - the transaction's UUID object
 * @param {Object} [props.metadata] - transaction.attributes.metadata
 * @returns {JSX.Element|null}
 */
const HandoverQrMaybe = props => {
  const { className, rootClassName, processName, processState, transactionId, metadata } = props;

  // Every other process in this template (booking, purchase, inquiry,
  // negotiation, download) has no laundry handover and no QR.
  if (processName !== COCLOSET_BOOKING_PROCESS) {
    return null;
  }

  if (!isHandoverQrVisibleState(processState)) {
    return null;
  }

  const payload = resolveHandoverQrPayload(metadata, transactionId?.uuid);
  if (!payload) {
    return null;
  }

  const ticketCode = metadata?.ticketCode;
  const classes = classNames(rootClassName || css.root, className);

  return (
    <section className={classes}>
      <Heading as="h3" rootClassName={css.heading}>
        <FormattedMessage id="TransactionPanel.handoverQr.heading" />
      </Heading>
      <p className={css.description}>
        <FormattedMessage id="TransactionPanel.handoverQr.description" />
      </p>
      <div className={css.body}>
        <HandoverQrCode
          payload={payload}
          size="large"
          showPayload={true}
          id={`handoverQr-${payload}`}
        />
        {/* The cosmetic per-laundry ticket code (design §11, e.g. "PIG-A3F91C").
            It is written at transition/laundry-mark-ready, so it is absent while
            the transaction is still `accepted` - the row is dropped rather than
            shown empty. */}
        {ticketCode ? (
          <p className={css.ticket}>
            <FormattedMessage
              id="TransactionPanel.handoverQr.ticketCode"
              values={{ code: <span className={css.ticketCode}>{ticketCode}</span> }}
            />
          </p>
        ) : null}
      </div>
    </section>
  );
};

export default HandoverQrMaybe;
