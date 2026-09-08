import React, { Component } from 'react';
import classNames from 'classnames';

import { FormattedMessage, injectIntl, intlShape } from '../../../util/reactIntl';
import { propTypes } from '../../../util/types';
import { userDisplayNameAsString } from '../../../util/data';
import { createSlug } from '../../../util/urlHelpers';
import { displayPrice } from '../../../util/configHelpers';

import { AvatarLarge, NamedLink, UserDisplayName } from '../../../components';

import { stateDataShape } from '../TransactionPage.stateData';
// These are internal components that make this file more readable.
import BreakdownMaybe from './BreakdownMaybe';
import DetailCardHeadingsMaybe from './DetailCardHeadingsMaybe';
import DetailCardImage from './DetailCardImage';
import DeliveryInfoMaybe from './DeliveryInfoMaybe';
import BookingLocationMaybe from './BookingLocationMaybe';
import FeedSection from './FeedSection';
import DiminishedActionButtonMaybe from './DiminishedActionButtonMaybe';
import PanelHeading from './PanelHeading';

import HandoverQrMaybe from './HandoverQrMaybe';
import DamageReportedMaybe from './DamageReportedMaybe';

import css from './TransactionPanel.module.css';

// Helper function to get display names for different roles
const displayNames = (currentUser, provider, customer, intl) => {
  const authorDisplayName = <UserDisplayName user={provider} intl={intl} />;
  const customerDisplayName = <UserDisplayName user={customer} intl={intl} />;

  let otherUserDisplayName = '';
  let otherUserDisplayNameString = '';
  const currentUserIsCustomer =
    currentUser.id && customer?.id && currentUser.id.uuid === customer?.id?.uuid;
  const currentUserIsProvider =
    currentUser.id && provider?.id && currentUser.id.uuid === provider?.id?.uuid;

  if (currentUserIsCustomer) {
    otherUserDisplayName = authorDisplayName;
    otherUserDisplayNameString = userDisplayNameAsString(provider, '');
  } else if (currentUserIsProvider) {
    otherUserDisplayName = customerDisplayName;
    otherUserDisplayNameString = userDisplayNameAsString(customer, '');
  }

  return {
    authorDisplayName,
    customerDisplayName,
    otherUserDisplayName,
    otherUserDisplayNameString,
  };
};

const allowShowingExtraInfo = (showExtraInfo, transactionPartyInfo) => {
  const {
    isCustomer,
    isCustomerBanned,
    isCustomerDeleted,
    isProvider,
    isProviderBanned,
    isProviderDeleted,
  } = transactionPartyInfo;
  return (
    !!showExtraInfo &&
    ((isProvider && !isCustomerBanned && !isCustomerDeleted) ||
      (isCustomer && !isProviderBanned && !isProviderDeleted))
  );
};

/**
 * Transaction panel
 *
 * @component
 * @param {Object} props - The props
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that extends the default class for the root element
 * @param {propTypes.currentUser} props.currentUser - The current user
 * @param {string} props.transactionRole - The transaction role
 * @param {propTypes.listing} props.listing - The listing
 * @param {propTypes.user} props.customer - The customer
 * @param {propTypes.user} props.provider - The provider
 * @param {boolean} props.hasTransitions - Whether the transitions are shown
 * @param {propTypes.uuid} props.transactionId - The transaction id
 * @param {Object} [props.metadata] - transaction.attributes.metadata
 * @param {Array<propTypes.message>)} props.messages - The messages
 * @param {boolean} props.savePaymentMethodFailed - Whether the save payment method failed
 * @param {propTypes.error} props.fetchMessagesError - The fetch messages error
 * @param {Function} props.onOpenDisputeModal - The on open dispute modal function
 * @param {React.ReactNode} props.sendMessageForm - Pre-rendered SendMessageForm (or null when messaging is not allowed)
 * @param {stateDataShape} props.stateData - The state data
 * @param {boolean} props.showBookingLocation - Whether the booking location is shown
 * @param {React.ReactNode} props.activityFeed - The activity feed
 * @param {Function} props.actionButtons - The action buttons function
 * @param {React.ReactNode} props.orderBreakdown - The order breakdown
 * @param {React.ReactNode} props.orderPanel - The order panel
 * @param {object} props.config - The config
 * @param {intlShape} props.intl - The intl
 * @returns {JSX.Element} The TransactionPanel component
 */
export class TransactionPanelComponent extends Component {
  render() {
    const {
      rootClassName,
      className,
      currentUser,
      transactionRole,
      listing,
      customer,
      provider,
      transitions,
      processName,
      protectedData,
      // transaction.attributes.metadata. Carries `handoverQr` (the QR record
      // written when the reservation was created) and `ticketCode`.
      metadata,
      transactionId,
      marketplaceName,
      messages,
      savePaymentMethodFailed = false,
      fetchMessagesError,
      onOpenDisputeModal,
      onOpenReportModal,
      showListingImage,
      intl,
      stateData = {},
      showBookingLocation = false,
      requestQuote,
      offer,
      fileAttachments,
      activityFeed,
      actionButtons,
      isInquiryProcess,
      orderBreakdown,
      orderPanel,
      config,
      hasViewingRights,
      transactionFieldsComponent,
      sendMessageForm,
    } = this.props;

    const hasTransitions = transitions.length > 0;
    const isCustomer = transactionRole === 'customer';
    const isProvider = transactionRole === 'provider';

    const listingDeleted = !!listing?.attributes?.deleted;
    const isCustomerBanned = !!customer?.attributes?.banned;
    const isCustomerDeleted = !!customer?.attributes?.deleted;
    const isProviderBanned = !!provider?.attributes?.banned;
    const isProviderDeleted = !!provider?.attributes?.deleted;

    const transactionPartyInfo = {
      isCustomer,
      isCustomerBanned,
      isCustomerDeleted,
      isProvider,
      isProviderBanned,
      isProviderDeleted,
    };

    const { authorDisplayName, customerDisplayName, otherUserDisplayNameString } = displayNames(
      currentUser,
      provider,
      customer,
      intl
    );

    const deletedListingTitle = intl.formatMessage({
      id: 'TransactionPanel.deletedListingTitle',
    });

    const listingTitle = listingDeleted ? deletedListingTitle : listing?.attributes?.title;
    const firstImage = listing?.images?.length > 0 ? listing?.images[0] : null;

    const listingType = listing?.attributes?.publicData?.listingType;
    const listingTypeConfigs = config.listing.listingTypes;
    const listingTypeConfig = listingTypeConfigs.find(conf => conf.listingType === listingType);
    const showPrice = isInquiryProcess && displayPrice(listingTypeConfig);
    const showBreakDown = stateData.showBreakDown !== false; // NOTE: undefined defaults to true due to historical reasons.

    // Only show order panel for users who have listing viewing rights, otherwise
    // show the detail card heading.
    const showOrderPanel = stateData.showOrderPanel && hasViewingRights;
    const showDetailCardHeadings = stateData.showDetailCardHeadings || !hasViewingRights;

    const deliveryMethod = protectedData?.deliveryMethod || 'none';
    const priceVariantName = protectedData?.priceVariantName;

    const classes = classNames(rootClassName || css.root, className);

    const showDiminishedButton = stateData.showDispute || stateData.showReport;
    const onOpenDiminishedModal = stateData.showReport ? onOpenReportModal : onOpenDisputeModal;
    const diminishedButtonMessage = stateData.showReport ? (
      <FormattedMessage id="TransactionPanel.reportOrder" />
    ) : (
      <FormattedMessage id="TransactionPanel.disputeOrder" />
    );

    return (
      <div className={classes}>
        <div className={css.container}>
          <div className={css.txInfo}>
            <DetailCardImage
              rootClassName={css.imageWrapperMobile}
              avatarWrapperClassName={css.avatarWrapperMobile}
              listingTitle={listingTitle}
              image={firstImage}
              provider={provider}
              isCustomer={isCustomer}
              showListingImage={showListingImage}
              listingImageConfig={config.layout.listingImage}
            />
            {isProvider ? (
              <div className={css.avatarWrapperProviderDesktop}>
                <AvatarLarge user={customer} className={css.avatarDesktop} />
              </div>
            ) : null}

            <PanelHeading
              processName={stateData.processName}
              processState={stateData.processState}
              showExtraInfo={allowShowingExtraInfo(stateData.showExtraInfo, transactionPartyInfo)}
              showPriceOnMobile={showPrice}
              price={listing?.attributes?.price}
              intl={intl}
              deliveryMethod={deliveryMethod}
              isPendingPayment={!!stateData.isPendingPayment}
              transactionRole={transactionRole}
              providerName={authorDisplayName}
              customerName={customerDisplayName}
              marketplaceName={marketplaceName}
              listingId={listing?.id?.uuid}
              listingTitle={listingTitle}
              listingDeleted={listingDeleted}
            />

            {requestQuote}
            {offer}
            {transactionFieldsComponent}

            {/* The handover QR (mockups 16/17). Placed high in the main column,
                above the message feed, because its whole job is to be found
                quickly by someone standing at a laundry counter. It renders
                nothing outside `cocloset-booking` and nothing once both
                handovers are done - see HandoverQrMaybe. */}
            {/* CUSTODY, from the flag that means custody.
                  > "Yo como provider tengo la prenda en mi poder (onLaundry = false)"
                  >   (Jonathan, 2026-09-08)

                `isAtLaundry` read `readinessStatus`, which is the studio's ops vocabulary for
                what it intends to do with a garment on its rack. `onLaundry` is the answer to
                "is it on the rack at all", it is what the owner's two errands turn on, and it
                is the one the client named. They agree in the ordinary case and come apart
                exactly where it matters: a garment handed back keeps whatever readiness it
                had, and only this flag is cleared. */}
            <HandoverQrMaybe
              processName={stateData.processName}
              processState={stateData.processState}
              transactionId={transactionId}
              metadata={metadata}
              isCustomer={isCustomer}
              isAtLaundry={listing?.attributes?.metadata?.onLaundry === true}
            />

            {/* The laundry's damage report (design §10). Sits directly below the
                QR because it replaces it in practice: the QR disappears on entry
                to `returned` and this is what the same spot then carries. Shown
                to both parties, and only when damage was actually reported - see
                DamageReportedMaybe. */}
            <DamageReportedMaybe
              processName={stateData.processName}
              transactionRole={transactionRole}
              metadata={metadata}
            />

            {fileAttachments}

            {!isInquiryProcess ? (
              <div className={css.orderDetails}>
                <div className={css.orderDetailsMobileSection}>
                  {showBreakDown ? (
                    <BreakdownMaybe
                      orderBreakdown={orderBreakdown}
                      processName={stateData.processName}
                      priceVariantName={priceVariantName}
                    />
                  ) : null}
                  <DiminishedActionButtonMaybe
                    id="mobile_disputeOrderButton"
                    showButton={showDiminishedButton}
                    onOpenModal={onOpenDiminishedModal}
                    buttonMessage={diminishedButtonMessage}
                  />
                </div>

                {savePaymentMethodFailed ? (
                  <p className={css.genericError}>
                    <FormattedMessage
                      id="TransactionPanel.savePaymentMethodFailed"
                      values={{
                        paymentMethodsPageLink: (
                          <NamedLink name="PaymentMethodsPage">
                            <FormattedMessage id="TransactionPanel.paymentMethodsPageLink" />
                          </NamedLink>
                        ),
                      }}
                    />
                  </p>
                ) : null}
                <DeliveryInfoMaybe
                  className={css.deliveryInfoSection}
                  protectedData={protectedData}
                  listing={listing}
                  locale={config.localization.locale}
                />
                <BookingLocationMaybe
                  className={css.deliveryInfoSection}
                  listing={listing}
                  showBookingLocation={showBookingLocation}
                />
              </div>
            ) : null}
            <FeedSection
              rootClassName={css.feedContainer}
              hasMessages={messages.length > 0}
              hasTransitions={hasTransitions}
              fetchMessagesError={fetchMessagesError}
              activityFeed={activityFeed}
              isConversation={isInquiryProcess}
            />
            {sendMessageForm || (
              <div className={css.sendingMessageNotAllowed}>
                <FormattedMessage id="TransactionPanel.sendingMessageNotAllowed" />
              </div>
            )}

            {stateData.showActionButtons ? (
              <>
                <div className={css.mobileActionButtonSpacer}></div>
                <div className={css.mobileActionButtons}>{actionButtons('mobile')}</div>
              </>
            ) : null}
          </div>

          <div className={css.asideDesktop}>
            <div
              className={classNames(css.stickySection, { [css.noListingImage]: !showListingImage })}
            >
              <div className={css.detailCard}>
                <DetailCardImage
                  avatarWrapperClassName={css.avatarWrapperDesktop}
                  listingTitle={listingTitle}
                  image={firstImage}
                  provider={provider}
                  isCustomer={isCustomer}
                  showListingImage={showListingImage}
                  listingImageConfig={config.layout.listingImage}
                />

                <DetailCardHeadingsMaybe
                  showDetailCardHeadings={showDetailCardHeadings}
                  showListingImage={showListingImage}
                  listingTitle={
                    listingDeleted ? (
                      listingTitle
                    ) : (
                      <NamedLink
                        name="ListingPage"
                        params={{ id: listing.id?.uuid, slug: createSlug(listingTitle) }}
                      >
                        {listingTitle}
                      </NamedLink>
                    )
                  }
                  showPrice={showPrice}
                  price={listing?.attributes?.price}
                  intl={intl}
                />
                {showOrderPanel ? orderPanel : null}
                {showBreakDown ? (
                  <BreakdownMaybe
                    className={css.breakdownContainer}
                    orderBreakdown={orderBreakdown}
                    processName={stateData.processName}
                    priceVariantName={priceVariantName}
                  />
                ) : null}

                {stateData.showActionButtons ? (
                  <div className={css.desktopActionButtons}>{actionButtons('desktop')}</div>
                ) : null}
              </div>
              <DiminishedActionButtonMaybe
                id="desktop_disputeOrderButton"
                showButton={showDiminishedButton}
                onOpenModal={onOpenDiminishedModal}
                buttonMessage={diminishedButtonMessage}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }
}

const TransactionPanel = injectIntl(TransactionPanelComponent);

export default TransactionPanel;
