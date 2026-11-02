import React from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';

import { Modal, PickupQrCode } from '../../../components';

import css from './PickupQrModal.module.css';

/**
 * The modal a provider opens from their own ManageListingsPage card to see the pickup QR
 * for a listing that is already paused and still sitting at the laundry partner.
 *
 * Jonathan (2026-10-12): ManageListingsPage shows one card per listing, so there is no
 * single place to show a QR inline the way LaundryPickupNotice does on ListingPage (one
 * listing, one notice) - a modal keyed to whichever card's button was tapped is the only
 * way to show the right listing's code without rendering N QR images up front.
 *
 * @param {Object} props
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {string} props.id - The id of the modal
 * @param {boolean} props.isOpen - Whether the modal is open
 * @param {function} props.onCloseModal - The function to close the modal
 * @param {function} props.onManageDisableScrolling - The function to manage disable scrolling
 * @param {string} [props.listingId] - The listing whose QR to show
 * @param {string} [props.listingTitle] - Interpolated into the body copy
 * @returns {JSX.Element} Pickup QR modal component
 */
const PickupQrModal = props => {
  const intl = useIntl();
  const {
    className,
    rootClassName,
    id,
    isOpen,
    onCloseModal,
    onManageDisableScrolling,
    listingId,
    listingTitle,
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
      usePortal
      closeButtonMessage={intl.formatMessage({ id: 'PickupQrModal.close' })}
    >
      <p className={css.modalTitle}>
        <FormattedMessage id="PickupQrModal.title" />
      </p>
      <p className={css.modalMessage}>
        <FormattedMessage id="PickupQrModal.body" values={{ listingTitle }} />
      </p>
      <PickupQrCode className={css.qr} listingId={listingId} />
    </Modal>
  );
};

export default PickupQrModal;
