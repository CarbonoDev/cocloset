import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';
import { Heading } from '..';
import { InlineTextButton } from '../Button/Button';

import css from './LaundryPickupNotice.module.css';

/**
 * "Need to pick up your item from the dry cleaners?" - the provider-only notice
 * telling an owner how to pause a listing to go collect their garment.
 *
 * Jonathan (2026-09-30): moved off the transaction panel onto ManageListingsPage and
 * ListingPage only - those are where a provider actually decides to pause a listing,
 * not inside a specific rental's detail page. Exact copy is his, verbatim.
 *
 * `collapsible` is for ListingPage, where the notice competes for space with the
 * booking calendar and rental timeline; ManageListingsPage renders it as an
 * always-expanded banner instead.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className]
 * @param {string} [props.rootClassName]
 * @param {boolean} [props.collapsible] - start collapsed, behind a toggle
 * @param {string} [props.id] - unique id for the collapsible region, for aria-controls
 * @returns {JSX.Element}
 */
const LaundryPickupNotice = props => {
  const { className, rootClassName, collapsible = false, id = 'laundryPickupNotice' } = props;
  const [isOpen, setIsOpen] = useState(!collapsible);

  const classes = classNames(rootClassName || css.root, className);
  const contentId = `${id}-content`;

  const content = (
    <div className={css.content} id={contentId}>
      <Heading as="h3" rootClassName={css.heading}>
        <FormattedMessage id="LaundryPickupNotice.heading" />
      </Heading>
      <p className={css.body}>
        <FormattedMessage id="LaundryPickupNotice.body" />
      </p>
      <p className={css.stepsHeading}>
        <FormattedMessage id="LaundryPickupNotice.stepsHeading" />
      </p>
      <ol className={css.steps}>
        <li>
          <FormattedMessage id="LaundryPickupNotice.step1" />
        </li>
        <li>
          <FormattedMessage id="LaundryPickupNotice.step2" />
        </li>
        <li>
          <FormattedMessage id="LaundryPickupNotice.step3" />
        </li>
        <li>
          <FormattedMessage id="LaundryPickupNotice.step4" />
        </li>
      </ol>
    </div>
  );

  if (!collapsible) {
    return <div className={classes}>{content}</div>;
  }

  return (
    <div className={classes}>
      <InlineTextButton
        type="button"
        rootClassName={css.toggle}
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setIsOpen(open => !open)}
      >
        <FormattedMessage
          id={isOpen ? 'LaundryPickupNotice.toggleHide' : 'LaundryPickupNotice.toggleShow'}
        />
      </InlineTextButton>
      {isOpen ? content : null}
    </div>
  );
};

export default LaundryPickupNotice;
