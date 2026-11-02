import React from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { formatMoney } from '../../../util/currency';
import { types as sdkTypes } from '../../../util/sdkLoader';

import { IconAlert, IconSpinner, Modal, Button } from '../../../components';

import css from './PartialRefundCancelModal.module.css';

const { Money } = sdkTypes;

// The distinct, user-facing failure modes this modal has to tell apart - see
// server/api/customer-partial-refund-cancel.js for the authoritative list these mirror.
// "Not eligible anymore" (someone else already moved the booking on), "refund failed, nothing
// was charged" (Stripe itself rejected it) and the rare manual-follow-up case all need
// DIFFERENT copy, not one generic "something went wrong".
const ERROR_KIND = {
  NOT_ELIGIBLE: 'not-eligible',
  NO_PAYMENT_INTENT: 'no-payment-intent-on-record',
  STRIPE_FAILED: 'stripe-refund-failed',
  UNKNOWN: 'unknown',
};

/**
 * Classify a rejected `customerPartialRefundCancel` call (see util/api.js) into one of
 * ERROR_KIND. `error` here is whatever TransactionPage.duck.js's partialRefundCancelThunk
 * stored via `storableError(e)` - the server's `error`/`reason` fields survive onto it.
 *
 * @param {Object} [error]
 * @returns {string} one of ERROR_KIND
 */
export const classifyPartialRefundCancelError = error => {
  const code = error?.error;
  if (code === 'not-eligible') {
    return ERROR_KIND.NOT_ELIGIBLE;
  }
  if (code === 'no-payment-intent-on-record') {
    return ERROR_KIND.NO_PAYMENT_INTENT;
  }
  if (code === 'stripe-refund-failed') {
    return ERROR_KIND.STRIPE_FAILED;
  }
  return ERROR_KIND.UNKNOWN;
};

// Names the specific amount being withheld WHEN it is available, as an extra line under the
// generic message below - never a replacement for it. A transaction without a cleaning-fee
// line item (the server's own documented fallback: nothing to withhold, full refund instead)
// renders no amount here at all, and the generic sentence alone still reads correctly either
// way - see PartialRefundCancelModal.message.
const CleaningFeeAmountMaybe = ({ cleaningFeeLineItem, intl }) => {
  const money = cleaningFeeLineItem?.lineTotal;
  if (!(money instanceof Money)) {
    return null;
  }
  try {
    return (
      <p className={css.modalMessage}>
        <FormattedMessage
          id="PartialRefundCancelModal.cleaningFeeAmount"
          values={{ amount: formatMoney(intl, money) }}
        />
      </p>
    );
  } catch (e) {
    // formatMoney throws for anything that isn't a real Money instance - already guarded
    // above, but a malformed currency code inside a real Money instance can still throw from
    // the Intl machinery, and this is cosmetic copy, not something worth failing the modal over.
    return null;
  }
};

/**
 * Confirmation + non-dismissible progress modal for the customer's PARTIAL-refund
 * self-cancellation (`transition/partial-refund-cancel-from-initial-cleaning`,
 * cocloset-booking's `initial-cleaning` state only).
 *
 * Unlike CancelBookingModal (the earlier, full-refund self-cancel at `accepted` - a different,
 * already-merged feature), this one moves money through a SEPARATE multi-step server call
 * (server/api/customer-partial-refund-cancel.js), not a plain SDK transition, and the client
 * asked for an "invasive loader" while it's in flight: the customer must not be able to
 * navigate away or dismiss the dialog mid-refund. So this component has FOUR sub-states
 * instead of CancelBookingModal's one:
 *
 *   1. CONFIRM  - "are you sure", names the cleaning fee being withheld. Dismissible.
 *   2. LOADING  - `inProgress` is true. Reuses the same Modal primitive for visual
 *      consistency, but `onClose` is a no-op here and there is nothing to click: this is the
 *      literal "cannot be dismissed" state the client asked for.
 *   3. ERROR    - a rejected call. Three DIFFERENT messages depending on
 *      classifyPartialRefundCancelError, because "not eligible any more", "nothing was
 *      charged, try again" and an unknown failure are not the same fact for a customer to
 *      read. Dismissible - the attempt is over.
 *   4. MANUAL FOLLOW-UP - the rare `requiresManualFollowUp` case: the refund succeeded but
 *      the booking itself did not get marked cancelled. Honest about both halves. Dismissible
 *      - retrying is safe (the server resumes rather than re-charging), but this modal does
 *      not auto-retry on its own.
 *
 * On a clean success (`result.cancelled === true`, no error, not in progress) the caller
 * (TransactionPage.js) closes this modal itself rather than this component rendering a fifth
 * "success" sub-state - the page's own transaction refresh already shows the new cancelled
 * state once closed.
 *
 * @param {Object} props
 * @param {string} props.id
 * @param {boolean} props.isOpen
 * @param {string} [props.focusElementId]
 * @param {Function} props.onCloseModal
 * @param {Function} props.onManageDisableScrolling
 * @param {Function} props.onConfirm
 * @param {boolean} [props.inProgress]
 * @param {Object} [props.error] - storableError shape, with `.error`/`.reason` from the server
 * @param {Object} [props.result] - last successful response, `{ cancelled, requiresManualFollowUp, ... }`
 * @param {Object} [props.cleaningFeeLineItem] - the `line-item/cleaning-fee` entry off
 *   `transaction.attributes.lineItems`, if present, so the confirm step can name the amount
 * @returns {JSX.Element} Partial-refund cancel confirmation + progress modal
 */
const PartialRefundCancelModal = props => {
  const intl = useIntl();
  const {
    className,
    rootClassName,
    id,
    isOpen,
    focusElementId,
    onCloseModal,
    onManageDisableScrolling,
    onConfirm,
    inProgress,
    error,
    result,
    cleaningFeeLineItem,
  } = props;
  const classes = classNames(rootClassName || css.root, className);

  const errorKind = error ? classifyPartialRefundCancelError(error) : null;
  const requiresManualFollowUp = !!result?.requiresManualFollowUp && !error;

  // While the call is in flight, the dialog cannot be dismissed - no escape key, no close
  // button click does anything. There is nothing to click through TO: no form, no secondary
  // action, just the spinner.
  const handleClose = inProgress ? () => {} : onCloseModal;

  return (
    <Modal
      id={id}
      containerClassName={classes}
      contentClassName={css.modalContent}
      isOpen={isOpen}
      onClose={handleClose}
      onManageDisableScrolling={onManageDisableScrolling}
      focusElementId={focusElementId}
      usePortal
    >
      {inProgress ? (
        <div className={css.loadingState}>
          <IconSpinner className={css.loadingSpinner} />
          <p className={css.modalTitle}>
            <FormattedMessage id="PartialRefundCancelModal.loadingTitle" />
          </p>
          <p className={css.modalMessage}>
            <FormattedMessage id="PartialRefundCancelModal.loadingMessage" />
          </p>
        </div>
      ) : requiresManualFollowUp ? (
        <>
          <IconAlert className={css.modalIcon} />
          <p className={css.modalTitle}>
            <FormattedMessage id="PartialRefundCancelModal.manualFollowUpTitle" />
          </p>
          <p className={css.modalMessage}>
            <FormattedMessage id="PartialRefundCancelModal.manualFollowUpMessage" />
          </p>
          <Button onClick={onCloseModal} className={css.submitButton}>
            <FormattedMessage id="PartialRefundCancelModal.close" />
          </Button>
        </>
      ) : errorKind === ERROR_KIND.NOT_ELIGIBLE ? (
        <>
          <IconAlert className={css.modalIcon} />
          <p className={css.modalTitle}>
            <FormattedMessage id="PartialRefundCancelModal.notEligibleTitle" />
          </p>
          <p className={css.modalMessage}>
            <FormattedMessage id="PartialRefundCancelModal.notEligibleMessage" />
          </p>
          <Button onClick={onCloseModal} className={css.submitButton}>
            <FormattedMessage id="PartialRefundCancelModal.close" />
          </Button>
        </>
      ) : errorKind === ERROR_KIND.NO_PAYMENT_INTENT ? (
        <>
          <IconAlert className={css.modalIcon} />
          <p className={css.modalTitle}>
            <FormattedMessage id="PartialRefundCancelModal.noPaymentIntentTitle" />
          </p>
          <p className={css.modalMessage}>
            <FormattedMessage id="PartialRefundCancelModal.noPaymentIntentMessage" />
          </p>
          <Button onClick={onCloseModal} className={css.submitButton}>
            <FormattedMessage id="PartialRefundCancelModal.close" />
          </Button>
        </>
      ) : errorKind === ERROR_KIND.STRIPE_FAILED ? (
        <>
          <IconAlert className={css.modalIcon} />
          <p className={css.modalTitle}>
            <FormattedMessage id="PartialRefundCancelModal.refundFailedTitle" />
          </p>
          <p className={css.modalMessage}>
            <FormattedMessage id="PartialRefundCancelModal.refundFailedMessage" />
          </p>
          <Button onClick={onConfirm} className={css.submitButton}>
            <FormattedMessage id="PartialRefundCancelModal.tryAgain" />
          </Button>
        </>
      ) : errorKind === ERROR_KIND.UNKNOWN ? (
        <>
          <IconAlert className={css.modalIcon} />
          <p className={css.modalTitle}>
            <FormattedMessage id="PartialRefundCancelModal.genericErrorTitle" />
          </p>
          <p className={css.modalMessage}>
            <FormattedMessage id="PartialRefundCancelModal.genericErrorMessage" />
          </p>
          <Button onClick={onCloseModal} className={css.submitButton}>
            <FormattedMessage id="PartialRefundCancelModal.close" />
          </Button>
        </>
      ) : (
        <>
          <IconAlert className={css.modalIcon} />
          <p className={css.modalTitle}>
            <FormattedMessage id="PartialRefundCancelModal.title" />
          </p>
          <p className={css.modalMessage}>
            <FormattedMessage id="PartialRefundCancelModal.message" />
          </p>
          <CleaningFeeAmountMaybe cleaningFeeLineItem={cleaningFeeLineItem} intl={intl} />
          <Button onClick={onConfirm} className={css.submitButton}>
            <FormattedMessage id="PartialRefundCancelModal.submit" />
          </Button>
        </>
      )}
    </Modal>
  );
};

export default PartialRefundCancelModal;
