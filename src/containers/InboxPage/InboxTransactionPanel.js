import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { subtractTime } from '../../util/dates';
import { getProcess, resolveLatestProcessName } from '../../transactions/transaction';
import { isHandoverQrVisibleState } from '../../transactions/transactionProcessCoclosetBooking';
import { isGarmentAtLaundry } from '../../util/laundryStatuses';
import {
  RENTAL_TIMELINE_STEPS,
  STEP_CURRENT,
  STEP_DONE,
  timelineStatusFor,
  timelineStepMessageId,
} from '../../util/rentalTimeline';

import { HandoverQrCode, Modal, NamedLink, ResponsiveImage } from '../../components';

import css from './InboxPage.module.css';

const DATE_FORMAT = { year: 'numeric', month: 'short', day: 'numeric' };

/**
 * ONE RENTAL, IN FULL, BESIDE THE LIST IT WAS PICKED FROM.
 *
 *   > "al seleccionar uno, abre el detalle de la transacción sin ocultar el listado"
 *
 * ── WHY THIS IS NOT THE TRANSACTION PAGE ───────────────────────────────────
 * TransactionPage exists and shows a rental in more depth: the message thread, the price
 * breakdown, the action buttons that advance it. This panel deliberately does not. What the
 * client's design asks for here is an AT-A-GLANCE answer - where is my garment, where do I
 * collect it, what happens next - for a reader scanning several rentals in turn. Reproducing
 * the action buttons in a panel that sits beside a list would also mean two places to confirm
 * the same step, and two places to keep in step with the process.
 *
 * So this reads and does not act. Anything that changes a transaction stays on TransactionPage
 * and on the handover page, which is where the studio and the parties already do it.
 *
 * WHICH IS WHY THE LINK AT THE BOTTOM IS NOT OPTIONAL. The list row used to BE that link: it
 * navigated to the transaction page, and that is where a lender accepts a booking. Turning the
 * row into a selector - which is what "open the detail without hiding the list" requires -
 * takes that route away, so the panel has to give it back. Without it this redesign would have
 * quietly removed the only way to accept a rental from the inbox.
 *
 * ── EVERYTHING HERE COMES FROM THE LIST QUERY ──────────────────────────────
 * No fetch of its own. The inbox already loads each transaction with its listing, booking,
 * both users and its transitions, so selecting a row costs nothing and the panel paints
 * immediately. The two Cocloset fields it needs beyond that - the ticket and the studio's own
 * code - are on the transaction's `metadata`, which had to be added to that query's
 * `fields.transaction` allowlist: without it they would have rendered blank on every rental,
 * with nothing anywhere saying why.
 *
 * @component
 * @param {Object} props
 * @param {Object} props.transaction - a denormalised transaction from the inbox query
 * @param {Object} [props.stateData] - from InboxPage.stateData, for the status pill
 * @param {string} props.transactionRole - 'customer' or 'provider'; the status strings are
 *   written per role ("you are waiting" vs "they are waiting")
 * @param {Function} [props.onManageDisableScrolling] - required by Modal
 * @returns {JSX.Element|null}
 */
// Every other process in this template has no laundry handover and therefore no QR.
const COCLOSET_BOOKING_PROCESS = 'cocloset-booking';

const InboxTransactionPanel = props => {
  const { transaction, stateData, transactionRole } = props;
  const intl = useIntl();
  const [isQrModalOpen, setQrModalOpen] = useState(false);

  if (!transaction) {
    return null;
  }

  const listing = transaction.listing;
  const booking = transaction.booking;
  const publicData = listing?.attributes?.publicData || {};
  const metadata = transaction.attributes?.metadata || {};

  const processName = resolveLatestProcessName(transaction.attributes?.processName);
  const process = getProcess(processName);
  // `getState` is the process's own reading of `lastTransition`. Asking the process rather
  // than mapping transitions here is what keeps this panel correct when the EDN changes.
  const processState = process?.getState ? process.getState(transaction) : null;
  // WHOSE STORY THIS IS. The renter does not see the laundry's work after the garment goes
  // back, and both parties see a review step - see util/rentalTimeline.js. The panel already
  // knows the role for its status strings, so this costs nothing but passing it along.
  const steps = timelineStatusFor(processState, { audience: transactionRole });

  // WHETHER THIS VIEWER GETS THE CODE AT ALL.
  //
  //   > "Cuando se renta, a partir de ese momento aparece el QR, puedes ocultarlo a menos que
  //   >  el provider acepte o que se autoacepte la transacción? El provider si puede ver el QR"
  //
  // The transaction detail panel and this one are two doors to the same code, so gating only
  // the other one would have hidden the QR from the customer in one place and left it in the
  // other - the requirement half-met, in the way that reads as a bug rather than as a policy.
  //
  // The rule itself lives in transactions/transactionProcessCoclosetBooking.js so the two
  // doors cannot drift apart. It also means this panel now shows no code before the payment
  // is confirmed, which was never intended here and simply had no gate.
  const showQr =
    processName === COCLOSET_BOOKING_PROCESS &&
    isHandoverQrVisibleState(processState, {
      isCustomer: transactionRole === 'customer',
      isAtLaundry: isGarmentAtLaundry(listing?.attributes?.metadata?.readinessStatus),
    });

  const laundryName = publicData.assignedLaundryName;
  const pickupAddress = publicData.pickupAddress;

  // Written by the studio at the return step (server/api/laundry-transaction-status.js).
  // `=== true` rather than truthiness, matching every other reader of this flag: the shape is
  // `{ flag, note }`, and the object's mere presence is not a report of damage.
  const damageReported = metadata.damageReported?.flag === true;

  // THE LISTING'S TIMEZONE, NOT THE READER'S. A day booking is stored as midnight-to-midnight
  // in the marketplace's zone; formatting it in the browser's zone moves it to the previous day
  // for anyone west of it. The row beside this panel already reads the dates this way, so
  // getting it wrong here showed the SAME rental as "Aug 14 – 20" in the list and "Aug 13" in
  // the detail - which is how it shipped, and why this goes through the same helpers the row
  // uses rather than through raw Date arithmetic.
  const timeZone = listing?.attributes?.availabilityPlan?.timezone || 'Etc/UTC';
  const bookingStart = booking?.attributes?.displayStart || booking?.attributes?.start;
  const bookingEnd = booking?.attributes?.displayEnd || booking?.attributes?.end;
  // The last day the customer HAS the garment, not the exclusive end the API stores. Same
  // convention as the listing page and the price breakdown, so the three agree.
  const inclusiveEnd = bookingEnd ? subtractTime(bookingEnd, 1, 'days', timeZone) : null;

  const formatDate = date =>
    date ? intl.formatDate(new Date(date), { ...DATE_FORMAT, timeZone }) : null;

  // The identifiers a counter goes by. Assembled from what exists rather than from a fixed
  // template, so a rental that has not reached the studio yet reads as one line rather than
  // as a row of empty separators.
  const identifiers = [
    metadata.ticketCode
      ? intl.formatMessage({ id: 'InboxPage.panel.ticket' }, { code: metadata.ticketCode })
      : null,
    metadata.laundryCode
      ? intl.formatMessage({ id: 'InboxPage.panel.laundryCode' }, { code: metadata.laundryCode })
      : null,
  ].filter(Boolean);

  const firstImage = listing?.images?.[0];

  return (
    <section className={css.panel}>
      <header className={css.panelHeader}>
        <div className={css.panelThumb}>
          <ResponsiveImage
            rootClassName={css.panelThumbImage}
            alt={listing?.attributes?.title || ''}
            image={firstImage}
            variants={['listing-card', 'listing-card-2x']}
          />
        </div>

        <div className={css.panelHeading}>
          {publicData.brand ? <p className={css.panelBrand}>{publicData.brand}</p> : null}
          <h2 className={css.panelTitle}>{listing?.attributes?.title}</h2>
          {identifiers.length > 0 ? (
            <p className={css.panelIdentifiers}>{identifiers.join(' · ')}</p>
          ) : null}
          {/* The same status label the row in the list carries, from the same source, so a
              reader who clicked "Ready for pickup" is not shown a different phrase for the
              same rental. */}
          {stateData?.processName && stateData?.processState ? (
            <span
              className={classNames(css.panelStatus, {
                [css.panelStatusAction]: stateData.actionNeeded && !stateData.tone,
                [css.panelStatusFinal]: stateData.isFinal && !stateData.tone,
                [css.panelStatusPositive]: stateData.tone === 'positive',
                [css.panelStatusNegative]: stateData.tone === 'negative',
              })}
            >
              <FormattedMessage
                id={`InboxPage.${stateData.processName}.${stateData.processState}.status`}
                values={{ transactionRole }}
              />
            </span>
          ) : null}
        </div>

        {/* THE QR, SMALL, AS A BUTTON.
              > "hay un qr chiquito, es el qr de la transacción, al dar click en el se debe
              >  abrir un modal donde el qr sea mas grande y legible"

            A <button> rather than a clickable <div>: it is keyboard-reachable and announces
            itself, and the modal it opens is the whole point of the small one existing - a
            48px code is a thumbnail, not something a scanner at a counter can read. */}
        {showQr ? (
          <button
            className={css.panelQrButton}
            type="button"
            onClick={() => setQrModalOpen(true)}
            aria-label={intl.formatMessage({ id: 'InboxPage.panel.openQr' })}
          >
            <HandoverQrCode payload={transaction.id?.uuid} size="small" />
            <span className={css.panelQrLabel}>
              <FormattedMessage id="InboxPage.panel.qrLabel" />
            </span>
          </button>
        ) : null}
      </header>

      <div className={css.panelCards}>
        <div className={css.panelCard}>
          <h3 className={css.panelCardTitle}>
            <FormattedMessage id="InboxPage.panel.pickupTitle" />
          </h3>
          {laundryName ? <p className={css.panelCardStrong}>{laundryName}</p> : null}
          {pickupAddress ? (
            <address className={css.panelCardAddress}>{pickupAddress}</address>
          ) : null}
          {bookingStart ? <p className={css.panelCardValue}>{formatDate(bookingStart)}</p> : null}
          <p className={css.panelCardBody}>
            <FormattedMessage id="InboxPage.panel.pickupBody" />
          </p>
        </div>

        <div className={css.panelCard}>
          <h3 className={css.panelCardTitle}>
            <FormattedMessage id="InboxPage.panel.returnTitle" />
          </h3>
          {laundryName ? <p className={css.panelCardStrong}>{laundryName}</p> : null}
          {inclusiveEnd ? <p className={css.panelCardValue}>{formatDate(inclusiveEnd)}</p> : null}
          <p className={css.panelCardBody}>
            <FormattedMessage id="InboxPage.panel.returnBody" />
          </p>
        </div>
      </div>

      <div className={css.panelCard}>
        <h3 className={css.panelCardTitle}>
          <FormattedMessage id="InboxPage.panel.timelineTitle" />
        </h3>
        <ol className={css.panelTimeline}>
          {steps.map(step => (
            <li
              key={step.key}
              className={classNames(css.panelStep, {
                [css.panelStepDone]: step.status === STEP_DONE,
                [css.panelStepCurrent]: step.status === STEP_CURRENT,
              })}
            >
              <span className={css.panelStepMarker} aria-hidden="true" />
              {/* The return step reads "…- reported" when the studio flagged damage. Which
                  step can say that, and what it says, is decided in util/rentalTimeline.js -
                  see the note there. */}
              <FormattedMessage id={timelineStepMessageId(step.key, { damageReported })} />
              {/* The state is carried as text too, not by the marker's colour alone: this is
                  the one thing the panel exists to communicate. */}
              <span className={css.srOnly}>
                {intl.formatMessage({ id: `InboxPage.panel.step.${step.status}` })}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* The way back to the page that can ACT on this rental - accept it, decline it, message
          the other party. See the note at the top of this file: the row that used to be this
          link is now a selector, so this is the only route left to it. */}
      <NamedLink
        className={css.panelFullLink}
        name={transactionRole === 'customer' ? 'OrderDetailsPage' : 'SaleDetailsPage'}
        params={{ id: transaction.id?.uuid }}
      >
        <FormattedMessage id="InboxPage.panel.openFull" />
      </NamedLink>

      <Modal
        id="InboxTransactionPanel.qr"
        isOpen={isQrModalOpen}
        onClose={() => setQrModalOpen(false)}
        onManageDisableScrolling={props.onManageDisableScrolling}
        usePortal
      >
        <div className={css.qrModalContent}>
          <h2 className={css.qrModalTitle}>
            <FormattedMessage id="InboxPage.panel.qrModalTitle" />
          </h2>
          <p className={css.qrModalBody}>
            <FormattedMessage id="InboxPage.panel.qrModalBody" />
          </p>
          {/* `showPayload` is the manual fallback: a studio whose scanner is down needs the
              id it can type into its own search box, and that is what this prints. */}
          <HandoverQrCode payload={transaction.id?.uuid} size="large" showPayload />
        </div>
      </Modal>
    </section>
  );
};

export default InboxTransactionPanel;

// The steps this panel names are the SAME eight the listing page describes - see
// util/rentalTimeline.js. Exported for the tests that hold the two together.
export { RENTAL_TIMELINE_STEPS };
