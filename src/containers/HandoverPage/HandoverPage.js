import React from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { propTypes } from '../../util/types';
import {
  HANDOVER_COUNTERPARTY_CUSTOMER,
  HANDOVER_COUNTERPARTY_PROVIDER,
  handoverStepMessageId,
} from '../../util/handoverSteps';

import { isScrollingDisabled } from '../../ducks/ui.duck';

import { H3, Page, PrimaryButton, LayoutSingleColumn, NamedLink } from '../../components';

import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import { confirmHandover } from './HandoverPage.duck';
import css from './HandoverPage.module.css';

/**
 * THE PAGE A SCANNED HANDOVER QR OPENS.
 *
 *   > "al escanear debe llevar al paso siguiente con un button para confirmar y avanzar"
 *   > "El qr solo debe poder leerse si eres laundry, si otro actor lo lee solo debe mostrarle
 *   >  indicaciones"
 *
 * One screen, three audiences, and the difference between them is ONE button:
 *
 *   - the assigned LAUNDRY sees the step and a confirm button;
 *   - the CUSTOMER and the PROVIDER see the same step, described as what they have to do or
 *     wait for, and no button;
 *   - anyone else never gets here - /api/handover-status answers 403 and the page says so.
 *
 * `canConfirm` comes from the SERVER, and this component does not second-guess it. Deriving
 * "am I the laundry" in the browser would put the rule in two places, and the browser's copy
 * is the one an attacker can edit. The button is a convenience on top of an authorization
 * that `server/api-util/laundryAuth.js` performs again on the write itself.
 */

const CounterpartyLine = props => {
  const { step } = props;
  if (!step) {
    return null;
  }

  const id =
    step.counterparty === HANDOVER_COUNTERPARTY_PROVIDER
      ? 'HandoverPage.counterparty.provider'
      : 'HandoverPage.counterparty.customer';

  return (
    <p className={css.counterparty}>
      <FormattedMessage id={id} />
    </p>
  );
};

/**
 * What the viewer is told, when they cannot act.
 *
 * The message depends on BOTH the step and who is reading, because "wait for the studio to
 * finish" and "take the garment to the studio" are the same step seen from two sides. A
 * single "please wait" would be wrong for whichever of them is actually holding the garment.
 */
const instructionMessageId = (step, viewerRole) => {
  if (!step) {
    return 'HandoverPage.instruction.nothingDue';
  }
  const isMyTurn =
    (viewerRole === 'customer' && step.counterparty === HANDOVER_COUNTERPARTY_CUSTOMER) ||
    (viewerRole === 'provider' && step.counterparty === HANDOVER_COUNTERPARTY_PROVIDER);

  return isMyTurn
    ? handoverStepMessageId(step, 'yourTurn')
    : handoverStepMessageId(step, 'waiting');
};

export const HandoverPageComponent = props => {
  const intl = useIntl();
  const {
    scrollingDisabled,
    handover,
    fetchInProgress,
    fetchError,
    confirmInProgress,
    confirmError,
    onConfirm,
  } = props;

  const title = intl.formatMessage({ id: 'HandoverPage.title' });

  const body = (() => {
    if (fetchInProgress) {
      return (
        <p className={css.status}>
          <FormattedMessage id="HandoverPage.loading" />
        </p>
      );
    }

    if (fetchError) {
      // 403 is by far the most likely: someone scanned a code for a rental they have nothing
      // to do with. It gets its own sentence, because "you are not part of this rental" and
      // "something went wrong" send the reader to do different things.
      const isForbidden = fetchError?.status === 403;
      const isUnauthorized = fetchError?.status === 401;
      const errorId = isForbidden
        ? 'HandoverPage.error.forbidden'
        : isUnauthorized
        ? 'HandoverPage.error.unauthorized'
        : 'HandoverPage.error.generic';

      return (
        <div className={css.errorBlock}>
          <p className={css.error}>
            <FormattedMessage id={errorId} />
          </p>
          {isUnauthorized ? (
            <NamedLink name="LoginPage" className={css.link}>
              <FormattedMessage id="HandoverPage.error.signIn" />
            </NamedLink>
          ) : null}
        </div>
      );
    }

    if (!handover) {
      return null;
    }

    const { step, viewerRole, canConfirm, listingTitle, ticketCode } = handover;

    return (
      <div className={css.card}>
        {listingTitle ? <p className={css.garment}>{listingTitle}</p> : null}
        {ticketCode ? (
          <p className={css.ticket}>
            <FormattedMessage
              id="HandoverPage.ticketCode"
              values={{ code: <span className={css.ticketCode}>{ticketCode}</span> }}
            />
          </p>
        ) : null}

        {step ? (
          <>
            <H3 as="h2" className={css.stepTitle}>
              <FormattedMessage id={handoverStepMessageId(step, 'title')} />
            </H3>
            <CounterpartyLine step={step} />
            {step.isLate ? (
              <p className={css.late}>
                <FormattedMessage id="HandoverPage.lateReturn" />
              </p>
            ) : null}
          </>
        ) : (
          <H3 as="h2" className={css.stepTitle}>
            <FormattedMessage id="HandoverPage.nothingDue.title" />
          </H3>
        )}

        {canConfirm ? (
          <>
            <p className={css.instruction}>
              <FormattedMessage id={handoverStepMessageId(step, 'laundry')} />
            </p>
            {confirmError ? (
              <p className={css.error}>
                <FormattedMessage id="HandoverPage.error.confirmFailed" />
              </p>
            ) : null}
            <PrimaryButton
              className={css.confirmButton}
              type="button"
              inProgress={confirmInProgress}
              disabled={confirmInProgress}
              onClick={() =>
                onConfirm({ transactionId: handover.transactionId, status: step.status })
              }
            >
              <FormattedMessage id={handoverStepMessageId(step, 'confirm')} />
            </PrimaryButton>
          </>
        ) : (
          <p className={css.instruction}>
            <FormattedMessage id={instructionMessageId(step, viewerRole)} />
          </p>
        )}
      </div>
    );
  })();

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn
        topbar={<TopbarContainer currentPage="HandoverPage" />}
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          <H3 as="h1" className={css.heading}>
            <FormattedMessage id="HandoverPage.heading" />
          </H3>
          {body}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => {
  const {
    handover,
    fetchInProgress,
    fetchError,
    confirmInProgress,
    confirmError,
  } = state.HandoverPage;

  return {
    scrollingDisabled: isScrollingDisabled(state),
    handover,
    fetchInProgress,
    fetchError,
    confirmInProgress,
    confirmError,
  };
};

const mapDispatchToProps = dispatch => ({
  onConfirm: params => dispatch(confirmHandover(params)),
});

const HandoverPage = compose(
  connect(
    mapStateToProps,
    mapDispatchToProps
  )
)(HandoverPageComponent);

export default HandoverPage;
