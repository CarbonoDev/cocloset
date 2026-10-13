import React from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';

import { IconAlert, Modal, Button } from '../../../components';

import css from './CancelBookingModal.module.css';

/**
 * Confirmation modal for the customer's self-cancellation
 * (`transition/customer-cancel`, cocloset-booking only).
 *
 * This moves real money - a full refund - and must not fire on a single
 * accidental click, so it reuses this repo's existing "are you sure" pattern
 * (ManageListingsPage/DiscardDraftModal) rather than inventing a new one: a
 * plain confirm dialog with one destructive action button. The real
 * transition only fires from `onConfirm`, never from opening the modal.
 *
 * @param {Object} props
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {string} props.id - The id of the modal
 * @param {boolean} props.isOpen - Whether the modal is open
 * @param {function} props.onCloseModal - The function to close the modal
 * @param {function} props.onManageDisableScrolling - The function to manage disable scrolling
 * @param {function} props.onConfirm - The function that fires the real cancellation
 * @param {boolean} [props.inProgress] - Whether the cancellation transition is in progress
 * @returns {JSX.Element} Cancel booking confirmation modal component
 */
const CancelBookingModal = props => {
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
  } = props;
  const classes = classNames(rootClassName || css.root, className);

  return (
    <Modal
      id={id}
      containerClassName={classes}
      contentClassName={css.modalContent}
      isOpen={isOpen}
      onClose={onCloseModal}
      onManageDisableScrolling={onManageDisableScrolling}
      focusElementId={focusElementId}
      usePortal
      closeButtonMessage={intl.formatMessage({ id: 'CancelBookingModal.close' })}
    >
      <IconAlert className={css.modalIcon} />
      <p className={css.modalTitle}>
        <FormattedMessage id="CancelBookingModal.title" />
      </p>
      <p className={css.modalMessage}>
        <FormattedMessage id="CancelBookingModal.message" />
      </p>
      <Button onClick={onConfirm} inProgress={inProgress} className={css.submitButton}>
        <FormattedMessage id="CancelBookingModal.submit" />
      </Button>
    </Modal>
  );
};

export default CancelBookingModal;
