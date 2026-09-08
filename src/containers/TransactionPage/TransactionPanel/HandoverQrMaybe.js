import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../../util/reactIntl';
import { HandoverQrCode, Heading } from '../../../components';
import {
  isHandoverQrVisibleState,
  states,
} from '../../../transactions/transactionProcessCoclosetBooking';
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
 * Shown to BOTH parties, but over DIFFERENT stretches of the rental.
 *
 *   > "El QR no debe poder verse hasta que el provider apruebe la transacción, esto aplica
 *   >  solo si la prenda no esta en una laundry, a su vez, si los pasos siguientes aplican
 *   >  para el customer, el provider no debe ver el QR"
 *
 * The RENTER has it from acceptance to the moment the garment is back - they are the one
 * standing at the counter, twice. The OWNER has it only while the rental is theirs to act on:
 * from their own approval until the studio marks it ready, plus the one earlier state where
 * the garment is already at a studio and their approval gates nothing.
 *
 * Both floors reverse earlier instructions, months apart. The rules live in
 * transactionProcessCoclosetBooking.js, which records each reversal rather than quietly
 * overwriting it.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className]
 * @param {string} [props.rootClassName]
 * @param {string} [props.processName] - stateData.processName
 * @param {string} [props.processState] - stateData.processState
 * @param {Object} [props.transactionId] - the transaction's UUID object
 * @param {Object} [props.metadata] - transaction.attributes.metadata
 * @param {boolean} [props.isCustomer] - is the viewer the customer rather than the owner?
 * @param {boolean} [props.isAtLaundry] - is the garment already in a studio's custody? Only
 *   affects the owner, and only before they have accepted - see isHandoverQrVisibleState.
 * @returns {JSX.Element|null}
 */
const HandoverQrMaybe = props => {
  const {
    className,
    rootClassName,
    processName,
    processState,
    transactionId,
    metadata,
    isCustomer = false,
    isAtLaundry = false,
  } = props;

  // Every other process in this template (booking, purchase, inquiry,
  // negotiation, download) has no laundry handover and no QR.
  if (processName !== COCLOSET_BOOKING_PROCESS) {
    return null;
  }

  if (!isHandoverQrVisibleState(processState, { isCustomer, isAtLaundry })) {
    return null;
  }

  const payload = resolveHandoverQrPayload(metadata, transactionId?.uuid);
  if (!payload) {
    return null;
  }

  const ticketCode = metadata?.ticketCode;
  const classes = classNames(rootClassName || css.root, className);

  // WHAT THIS CODE IS FOR, WHICH IS NOT THE SAME SENTENCE FOR EVERYONE.
  //
  //   > "La key TransactionPanel.handoverQr.descriptionWaiting se muestra a un provider aunque
  //   >  en ese momento no es necesario que se le muestre el QR" (Jonathan, 2026-09-08)
  //
  // `descriptionWaiting` is the RENTER's sentence - wait for the owner to drop it off and the
  // studio to clean it. An owner was reading it about their own garment, which they are the
  // one holding. The owner now has exactly two errands (see HANDOVER_QR_PROVIDER_*_STATES)
  // and each gets the sentence for the walk they are about to make.
  const isWaitingForGarment = [states.PREAUTHORIZED, states.ACCEPTED].includes(processState);
  const descriptionId = isCustomer
    ? isWaitingForGarment
      ? 'TransactionPanel.handoverQr.descriptionWaiting'
      : 'TransactionPanel.handoverQr.description'
    : isAtLaundry
    ? 'TransactionPanel.handoverQr.descriptionOwnerCollect'
    : 'TransactionPanel.handoverQr.descriptionOwnerDropOff';

  return (
    <section className={classes}>
      <Heading as="h3" rootClassName={css.heading}>
        <FormattedMessage id="TransactionPanel.handoverQr.heading" />
      </Heading>
      {/* The code appears before the garment has gone anywhere - for the owner from payment,
          for the customer from acceptance - so the copy has to change with the state rather
          than just exist:

            > "el QR debe mostrarse al cliente [...] pero con la instrucción de que debe
            >  esperar a que el provider entregue la prenda y la lavandería haga su proceso y
            >  que debe acudir a la lavandería por su prenda"

          Before the garment is at
          the studio the customer is told what has to happen first and that the code is not
          usable yet; from `ready-for-pickup` onwards it is the ordinary "show this at the
          counter". One sentence covering both would have to be vague enough to be useless at
          the moment it matters most - just after paying, which is exactly when the client
          says the customer needs to be told. */}
      <p className={css.description}>
        <FormattedMessage id={descriptionId} />
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
