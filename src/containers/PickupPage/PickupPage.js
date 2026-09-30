import React from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { FormattedMessage, useIntl } from '../../util/reactIntl';

import { isScrollingDisabled } from '../../ducks/ui.duck';

import { H3, Page, PickupQrCode, PrimaryButton, LayoutSingleColumn } from '../../components';

import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import { confirmPickup } from './PickupPage.duck';
import css from './PickupPage.module.css';

/**
 * THE PAGE A SCANNED PICKUP QR OPENS.
 *
 *   > "quiza podamos empatar un pin ademas del id, la laundry no debe ingresar ningun dato
 *   >  adicional ni el provider, solo con el QR" (Jonathan, 2026-09-30)
 *
 * Two audiences, and unlike HandoverPage's three, the difference here is not just a button:
 *
 *   - the OWNER sees their own QR and a "waiting" message - they are the one who generated
 *     it, from ManageListingsPage/ListingPage (LaundryPickupNotice), and this page is what
 *     they'd see if they followed their own link, not the normal way they use the feature;
 *   - the assigned LAUNDRY, with a valid token, sees who is collecting what and a confirm
 *     button;
 *   - anyone else - a wrong token, an expired one, a stranger - gets no action and no listing
 *     details beyond what /api/listing-pickup-status already decided is safe to disclose.
 *
 * `canConfirm` and `tokenValid` both come from the SERVER. Exactly like HandoverPage, this
 * component never re-derives who may act - the browser's copy of that rule is the one an
 * attacker can edit, and the real gate is server/api/listing-pickup-confirm.js re-checking
 * both the session and the token on the write itself.
 */
export const PickupPageComponent = props => {
  const intl = useIntl();
  const {
    scrollingDisabled,
    listingId,
    token,
    pickupStatus,
    fetchInProgress,
    fetchError,
    confirmInProgress,
    confirmError,
    justConfirmed,
    onConfirm,
  } = props;

  const title = intl.formatMessage({ id: 'PickupPage.title' });

  const body = (() => {
    if (fetchInProgress) {
      return (
        <p className={css.status}>
          <FormattedMessage id="PickupPage.loading" />
        </p>
      );
    }

    if (fetchError) {
      // 403 from the server means "not a party to this pickup" - anything else (401, network)
      // reads as a plain load failure. Neither discloses more than the status endpoint itself
      // already decided was safe.
      const messageId =
        fetchError?.status === 403 ? 'PickupPage.forbidden' : 'PickupPage.notFound';
      return (
        <p className={css.status}>
          <FormattedMessage id={messageId} />
        </p>
      );
    }

    if (!pickupStatus) {
      return (
        <p className={css.status}>
          <FormattedMessage id="PickupPage.notFound" />
        </p>
      );
    }

    const { viewerRole, listingTitle, ownerName, onLaundry, tokenValid, canConfirm } =
      pickupStatus;

    // A token that no longer matches - already used, or the garment left some other way - is
    // shown the SAME expired state to both roles. There is nothing left for either of them to
    // do with this particular QR; the owner's fix is to generate a fresh one, which
    // LaundryPickupNotice offers the next time they load their listing.
    if (!onLaundry || !tokenValid) {
      return (
        <div className={css.status}>
          <H3 as="h2" className={css.statusHeading}>
            <FormattedMessage id="PickupPage.expired.heading" />
          </H3>
          <p>
            <FormattedMessage id="PickupPage.expired.body" />
          </p>
        </div>
      );
    }

    if (viewerRole === 'owner') {
      return (
        <div className={css.status}>
          <H3 as="h2" className={css.statusHeading}>
            <FormattedMessage id="PickupPage.owner.heading" />
          </H3>
          <p>
            <FormattedMessage id="PickupPage.owner.body" values={{ listingTitle }} />
          </p>
          <PickupQrCode listingId={listingId} />
        </div>
      );
    }

    // viewerRole === 'laundry'
    if (justConfirmed) {
      return (
        <p className={css.status}>
          <FormattedMessage
            id="PickupPage.laundry.confirmed"
            values={{ listingTitle, ownerName }}
          />
        </p>
      );
    }

    return (
      <div className={css.confirmBlock}>
        <H3 as="h2" className={css.statusHeading}>
          <FormattedMessage id="PickupPage.laundry.heading" />
        </H3>
        <p>
          <FormattedMessage id="PickupPage.laundry.body" values={{ ownerName, listingTitle }} />
        </p>
        {confirmError ? (
          <p className={css.error}>
            <FormattedMessage
              id={
                confirmError?.status === 409
                  ? 'PickupPage.expired.body'
                  : 'PickupPage.laundry.confirmFailed'
              }
            />
          </p>
        ) : null}
        {canConfirm ? (
          <PrimaryButton
            className={css.confirmButton}
            inProgress={confirmInProgress}
            disabled={confirmInProgress}
            onClick={() => onConfirm({ listingId, token })}
          >
            <FormattedMessage id="PickupPage.laundry.confirmButton" />
          </PrimaryButton>
        ) : null}
      </div>
    );
  })();

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn
        topbar={<TopbarContainer currentPage="PickupPage" />}
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          <H3 as="h1" className={css.heading}>
            <FormattedMessage id="PickupPage.title" />
          </H3>
          {body}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => {
  const {
    listingId,
    token,
    pickupStatus,
    fetchInProgress,
    fetchError,
    confirmInProgress,
    confirmError,
    justConfirmed,
  } = state.PickupPage;

  return {
    scrollingDisabled: isScrollingDisabled(state),
    listingId,
    token,
    pickupStatus,
    fetchInProgress,
    fetchError,
    confirmInProgress,
    confirmError,
    justConfirmed,
  };
};

const mapDispatchToProps = dispatch => ({
  onConfirm: params => dispatch(confirmPickup(params)),
});

const PickupPage = compose(connect(mapStateToProps, mapDispatchToProps))(PickupPageComponent);

export default PickupPage;
