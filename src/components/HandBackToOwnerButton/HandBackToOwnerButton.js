import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';

import Modal from '../Modal/Modal';
import { PrimaryButton, SecondaryButton } from '../Button/Button';

import css from './HandBackToOwnerButton.module.css';

/**
 * "Hand back to owner", with the question asked before the write happens.
 *
 *   > "Una vez que la laundry de click al button para devolver la prenda al provider, debe
 *   >  salir un prompt para confirmar la acción, de confirmarse el listing ya no debe aparecer
 *   >  en inventory" (Jonathan, 2026-09-08)
 *
 * WHY IT IS ONE COMPONENT AND NOT THREE BUTTONS
 * The studio does this from the inventory grid, from the orders worklist, and from the phone
 * at the counter, and the write is irreversible from the studio's side: once `onLaundry` is
 * false the garment leaves the inventory, and only the owner bringing it back puts it there
 * again. A confirmation that exists on two screens out of three is worse than none - it
 * teaches the operator that the click is guarded, on the screen where it is not.
 *
 * The dialog names the garment. "Are you sure?" over a table of forty coats is not a question
 * anybody can answer; "Hand back Camel hair wrap coat?" is.
 *
 * @param {Object} props
 * @param {string} props.id - unique per instance; rows share a page, so this cannot be static
 * @param {string} [props.garmentTitle] - shown in the question
 * @param {Function} props.onConfirm - called only after the operator confirms
 * @param {boolean} [props.inProgress] - true while the write is in flight
 * @param {Function} props.onManageDisableScrolling - the template's modal scroll lock
 * @param {string} [props.className] - class for the trigger button
 * @returns {JSX.Element}
 */
const HandBackToOwnerButton = props => {
  const { id, garmentTitle, onConfirm, inProgress, onManageDisableScrolling, className } = props;

  const [isOpen, setIsOpen] = useState(false);

  const close = () => setIsOpen(false);

  return (
    <>
      {/* A PLAIN <button>, not the template's Button: the three surfaces style this
          differently - a quiet pill on an inventory card, a block action on the phone - and
          they pass that in. The template Button's own root styles would have to be fought
          off in two of the three places. */}
      <button
        type="button"
        className={classNames(css.trigger, className)}
        disabled={inProgress}
        onClick={() => setIsOpen(true)}
      >
        <FormattedMessage id="HandBackToOwnerButton.trigger" />
      </button>
      <Modal
        id={id}
        isOpen={isOpen}
        onClose={close}
        onManageDisableScrolling={onManageDisableScrolling}
        usePortal
      >
        <div className={css.dialog}>
          <p className={css.question}>
            {garmentTitle ? (
              <FormattedMessage
                id="HandBackToOwnerButton.question"
                values={{ garment: garmentTitle }}
              />
            ) : (
              <FormattedMessage id="HandBackToOwnerButton.questionNoTitle" />
            )}
          </p>
          {/* What confirming actually does, said plainly. The consequence the operator
              cares about is not the metadata flag, it is that the garment leaves the list
              they work from. */}
          <p className={css.consequence}>
            <FormattedMessage id="HandBackToOwnerButton.consequence" />
          </p>
          <div className={css.actions}>
            <PrimaryButton
              type="button"
              inProgress={inProgress}
              disabled={inProgress}
              onClick={() => {
                // Closed here rather than on the response: the list this button sits in is
                // refetched on success and the row goes with it, so waiting for that would
                // leave a dialog hanging over a garment that is no longer there. A failure
                // is reported by the screen underneath, which is where the other errors for
                // this write already appear.
                close();
                onConfirm();
              }}
            >
              <FormattedMessage id="HandBackToOwnerButton.confirm" />
            </PrimaryButton>
            <SecondaryButton type="button" onClick={close}>
              <FormattedMessage id="HandBackToOwnerButton.cancel" />
            </SecondaryButton>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default HandBackToOwnerButton;
