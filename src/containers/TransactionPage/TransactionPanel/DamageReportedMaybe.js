import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../../util/reactIntl';
import { Heading } from '../../../components';

import css from './DamageReportedMaybe.module.css';

const COCLOSET_BOOKING_PROCESS = 'cocloset-booking';

const PROVIDER = 'provider';
const CUSTOMER = 'customer';

/**
 * The laundry's damage report, on the transaction detail page.
 *
 * WHY THIS EXISTS. The laundry records damage at
 * `transition/laundry-confirm-return` (or `-late`) as
 * `transaction.metadata.damageReported = { flag, note }` - design §10, written
 * by server/api/laundry-transaction-status.js. Until this component, that field
 * had NO surface for either party to the transaction: it was read only by the
 * laundry's own ops dashboard (LaundryOpsPage / GET /api/laundry-orders). The
 * owner of a garment that came back destroyed and the owner of one that came
 * back pristine saw exactly the same transaction page.
 *
 * WHY IT IS NOT ONLY AN EMAIL. The two return transitions do send mail, and that
 * mail is now damage-aware. But `{{t}}` in those templates resolves from the
 * hosted Console asset `content/email-texts.json`, and delivery depends on
 * Mailgun credentials that do not exist in Dev yet. This panel depends on
 * neither: it renders from metadata the server already wrote.
 *
 * SHOWN TO BOTH PARTIES ("Sobre los daños, avisa a los dos", Jonathan
 * 2026-08-10). The owner needs to know their asset is damaged. The renter needs
 * to know a report was filed about a garment they handed back - and needs it
 * WHILE the garment is still at the laundry and can be re-checked, which is the
 * only window in which they can meaningfully dispute it. Showing the owner a
 * note about the renter while hiding it from the renter would mean the person
 * who may be asked to pay learns about the claim last.
 *
 * THE COPY IS PER-ROLE, THE DATA IS NOT. Both roles see the laundry's note
 * verbatim - it is the evidence, and paraphrasing it per audience would be
 * dishonest. Only the framing differs: the owner is told what it means for their
 * garment and their payout, the renter is told explicitly that a report is not a
 * charge. Neither string promises a compensation outcome, because the
 * marketplace has not yet defined how compensation is settled between the
 * owner, the renter and the marketplace.
 *
 * NOT STATE-GATED, unlike HandoverQrMaybe. Damage outlives the state it was
 * recorded in: the flag is set on the way into `returned` and stays true through
 * `cleaning`, `delivered` and every terminal state. Gating on state would hide
 * the report the moment the laundry opened the cleaning ticket. The presence of
 * the flag IS the condition.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className]
 * @param {string} [props.rootClassName]
 * @param {string} [props.processName] - stateData.processName
 * @param {'provider'|'customer'} [props.transactionRole]
 * @param {Object} [props.metadata] - transaction.attributes.metadata
 * @returns {JSX.Element|null}
 */
const DamageReportedMaybe = props => {
  const { className, rootClassName, processName, transactionRole, metadata } = props;

  // No other process in this template has a laundry inspection step.
  if (processName !== COCLOSET_BOOKING_PROCESS) {
    return null;
  }

  // Deliberately `=== true`, matching LaundryOpsPage.helpers `isDamaged`: the
  // laundry writes `{ flag: false }` when it inspects and finds nothing, and a
  // truthiness check on the object would then announce damage on every clean
  // return.
  if (metadata?.damageReported?.flag !== true) {
    return null;
  }

  const isProvider = transactionRole === PROVIDER;
  const isCustomer = transactionRole === CUSTOMER;

  // Any other role has no standing in this transaction, so it gets nothing.
  if (!isProvider && !isCustomer) {
    return null;
  }

  const note = metadata.damageReported.note;
  const classes = classNames(rootClassName || css.root, className);
  const roleKey = isProvider ? PROVIDER : CUSTOMER;

  return (
    <section className={classes}>
      <Heading as="h3" rootClassName={css.heading}>
        <FormattedMessage id={`TransactionPanel.damageReported.${roleKey}.heading`} />
      </Heading>
      <p className={css.description}>
        <FormattedMessage id={`TransactionPanel.damageReported.${roleKey}.description`} />
      </p>
      <div className={css.note}>
        <p className={css.noteLabel}>
          <FormattedMessage id="TransactionPanel.damageReported.noteLabel" />
        </p>
        {/* The laundry can flag damage without writing anything (the note is
            optional on their form). Say so, rather than rendering an empty box
            that reads as a loading failure. */}
        <p className={css.noteBody}>
          {note ? note : <FormattedMessage id="TransactionPanel.damageReported.noteMissing" />}
        </p>
      </div>
      {/* The marketplace's own position on the report, identical for both
          roles because it is a statement about what CoCloset will do, not
          about what either party did. It supersedes the "no compensation
          outcome is defined" caveat in the header comment: the client stated
          one on 2026-09-02. */}
      <p className={css.coclosetUpdate}>
        <FormattedMessage id="TransactionPanel.damageReported.coclosetUpdate" />
      </p>
      <p className={css.nextSteps}>
        <FormattedMessage id={`TransactionPanel.damageReported.${roleKey}.nextSteps`} />
      </p>
    </section>
  );
};

export default DamageReportedMaybe;
