import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../../util/reactIntl';
import { Heading } from '../../../components';

import css from './CloseListingGuidanceMaybe.module.css';

const COCLOSET_BOOKING_PROCESS = 'cocloset-booking';
const PROVIDER = 'provider';

/**
 * Provider-only guidance: the steps to close a listing, and the laundry-pickup-first rule.
 *
 * Jonathan (2026-09-29): providers need the steps to close a listing surfaced inside the
 * transaction, not just discovered by trial on ManageListingsPage. The rule that matters most
 * is ordering: closing a listing never touches an in-progress transaction or the garment's
 * physical custody (`ownListings.close` only affects marketplace visibility), so a provider who
 * closes while their garment is still at the laundry partner (`onLaundry === true`) strands it
 * there with no listing left to release it from. ManageListingsPage.js enforces this by
 * blocking the close action itself; this panel states the same rule in words, next to the
 * transaction whose garment/laundry status the provider is already looking at.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className]
 * @param {string} [props.rootClassName]
 * @param {string} [props.processName] - stateData.processName
 * @param {'provider'|'customer'} [props.transactionRole]
 * @param {boolean} [props.isAtLaundry] - listing.attributes.metadata.onLaundry === true
 * @returns {JSX.Element|null}
 */
const CloseListingGuidanceMaybe = props => {
  const { className, rootClassName, processName, transactionRole, isAtLaundry } = props;

  // No other process in this template routes a garment through a laundry partner.
  if (processName !== COCLOSET_BOOKING_PROCESS || transactionRole !== PROVIDER) {
    return null;
  }

  const classes = classNames(rootClassName || css.root, className);

  return (
    <section className={classes}>
      <Heading as="h3" rootClassName={css.heading}>
        <FormattedMessage id="TransactionPanel.closeListingGuidance.heading" />
      </Heading>
      <ol className={css.steps}>
        <li>
          <FormattedMessage id="TransactionPanel.closeListingGuidance.step1" />
        </li>
        <li>
          <FormattedMessage id="TransactionPanel.closeListingGuidance.step2" />
        </li>
        <li>
          <FormattedMessage id="TransactionPanel.closeListingGuidance.step3" />
        </li>
      </ol>
      {isAtLaundry ? (
        <p className={css.laundryWarning}>
          <FormattedMessage id="TransactionPanel.closeListingGuidance.laundryWarning" />
        </p>
      ) : null}
    </section>
  );
};

export default CloseListingGuidanceMaybe;
