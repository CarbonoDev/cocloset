import React, { useEffect, useState } from 'react';
import { useLocation, useHistory } from 'react-router-dom';
import loadable from '@loadable/component';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import {
  displayDeliveryPickup,
  displayDeliveryShipping,
  displayPrice,
} from '../../util/configHelpers';
import {
  propTypes,
  AVAILABILITY_MULTIPLE_SEATS,
  LISTING_STATE_CLOSED,
  LINE_ITEM_NIGHT,
  LINE_ITEM_DAY,
  LINE_ITEM_HOUR,
  LINE_ITEM_FIXED,
  LINE_ITEM_ITEM,
  STOCK_MULTIPLE_ITEMS,
  STOCK_INFINITE_MULTIPLE_ITEMS,
  LISTING_STATE_PUBLISHED,
} from '../../util/types';
import { formatMoney } from '../../util/currency';
import { createSlug, parse, stringify } from '../../util/urlHelpers';
import { userDisplayNameAsString } from '../../util/data';
import { getRentalPeriods, usesFixedRentalPeriods } from '../../util/rentalPeriods';
import {
  OFFER,
  REQUEST,
  getSupportedProcessesInfo,
  isBookingProcess,
  isNegotiationProcess,
  isInquiryProcess,
  isPurchaseProcess,
  isDownloadProcess,
  resolveLatestProcessName,
} from '../../transactions/transaction';

import { ModalInMobile, PrimaryButton, AvatarSmall, H1, H2 } from '../../components';
import PriceVariantPicker from './PriceVariantPicker/PriceVariantPicker';
import SubmitFinePrint from './SubmitFinePrint/SubmitFinePrint';

import css from './OrderPanel.module.css';

const BookingTimeForm = loadable(() =>
  import(/* webpackChunkName: "BookingTimeForm" */ './BookingTimeForm/BookingTimeForm')
);
const BookingDatesForm = loadable(() =>
  import(/* webpackChunkName: "BookingDatesForm" */ './BookingDatesForm/BookingDatesForm')
);
const BookingRentalPeriodForm = loadable(() =>
  import(
    /* webpackChunkName: "BookingRentalPeriodForm" */ './BookingRentalPeriodForm/BookingRentalPeriodForm'
  )
);
const BookingFixedDurationForm = loadable(() =>
  import(
    /* webpackChunkName: "BookingFixedDurationForm" */ './BookingFixedDurationForm/BookingFixedDurationForm'
  )
);
const InquiryWithoutPaymentForm = loadable(() =>
  import(
    /* webpackChunkName: "InquiryWithoutPaymentForm" */ './InquiryWithoutPaymentForm/InquiryWithoutPaymentForm'
  )
);
const ProductOrderForm = loadable(() =>
  import(/* webpackChunkName: "ProductOrderForm" */ './ProductOrderForm/ProductOrderForm')
);

const DigitalDownloadForm = loadable(() =>
  import(/* webpackChunkName: "DigitalDownloadForm" */ './DigitalDownloadForm/DigitalDownloadForm')
);

const NegotiationForm = loadable(() =>
  import(/* webpackChunkName: "NegotiationForm" */ './NegotiationForm/NegotiationForm')
);

const NegotiationRequestQuoteForm = loadable(() =>
  import(
    /* webpackChunkName: "NegotiationRequestQuoteForm" */ './NegotiationRequestQuoteForm/NegotiationRequestQuoteForm'
  )
);

// This defines when ModalInMobile shows content as Modal
const MODAL_BREAKPOINT = 1023;
const TODAY = new Date();
const ORDER_PANEL_SUBMIT_BUTTON_ID = 'orderPanelSubmitButton';

const isPublishedListing = listing => {
  return listing.attributes.state === LISTING_STATE_PUBLISHED;
};

const priceData = (price, currency, intl) => {
  if (price && price.currency === currency) {
    const formattedPrice = formatMoney(intl, price);
    return { formattedPrice, priceTitle: formattedPrice };
  } else if (price) {
    return {
      formattedPrice: `(${price.currency})`,
      priceTitle: `Unsupported currency (${price.currency})`,
    };
  }
  return {};
};

const getCheapestPriceVariant = (priceVariants = []) => {
  return priceVariants.reduce((cheapest, current) => {
    return current.priceInSubunits < cheapest.priceInSubunits ? current : cheapest;
  }, priceVariants[0]);
};

const formatMoneyIfSupportedCurrency = (price, intl) => {
  try {
    return formatMoney(intl, price);
  } catch (e) {
    return `(${price.currency})`;
  }
};

const openOrderModal = (isOwnListing, isClosed, history, location) => {
  if (isOwnListing || isClosed) {
    window.scrollTo(0, 0);
  } else {
    const { pathname, search, state } = location;
    const searchString = `?${stringify({ ...parse(search), orderOpen: true })}`;
    history.push(`${pathname}${searchString}`, state);
  }
};

const closeOrderModal = (history, location) => {
  const { pathname, search, state } = location;
  const { orderOpen, ...searchParams } = parse(search);
  const searchString = `?${stringify(searchParams)}`;
  history.push(`${pathname}${searchString}`, state);
};

const handleSubmit = (isOwnListing, isClosed, isDirectSubmit, onSubmit, history, location) => {
  // TODO: currently, inquiry-process does not have any form to ask more order data.
  // We can submit without opening any inquiry/order modal.
  return isDirectSubmit
    ? () => onSubmit({})
    : () => openOrderModal(isOwnListing, isClosed, history, location);
};

const dateFormattingOptions = { month: 'short', day: 'numeric', weekday: 'short' };

const PriceMaybe = props => {
  const {
    price,
    publicData,
    validListingTypes,
    intl,
    marketplaceCurrency,
    showCurrencyMismatch = false,
  } = props;
  const { listingType, unitType } = publicData || {};

  const foundListingTypeConfig = validListingTypes.find(conf => conf.listingType === listingType);
  const showPrice = displayPrice(foundListingTypeConfig);
  const isPriceVariationsInUse = !!publicData?.priceVariationsEnabled;
  const hasMultiplePriceVariants = publicData?.priceVariants?.length > 1;

  if (!showPrice || !price || (isPriceVariationsInUse && hasMultiplePriceVariants)) {
    return null;
  }

  // Get formatted price or currency code if the currency does not match with marketplace currency
  const { formattedPrice, priceTitle } = priceData(price, marketplaceCurrency, intl);
  const priceValue = (
    <span className={css.priceValue}>{formatMoneyIfSupportedCurrency(price, intl)}</span>
  );
  const pricePerUnit = (
    <span className={css.perUnit}>
      <FormattedMessage id="OrderPanel.perUnit" values={{ unitType }} />
    </span>
  );

  // TODO: In CTA, we don't have space to show proper error message for a mismatch of marketplace currency
  //       Instead, we show the currency code in place of the price
  return showCurrencyMismatch ? (
    <div className={css.priceContainerInCTA}>
      <div className={css.priceValueInCTA} title={priceTitle}>
        <FormattedMessage
          id="OrderPanel.priceInMobileCTA"
          values={{ priceValue: formattedPrice }}
        />
      </div>
      <div className={css.perUnitInCTA}>
        <FormattedMessage id="OrderPanel.perUnit" values={{ unitType }} />
      </div>
    </div>
  ) : (
    <div className={css.priceContainer}>
      <p className={css.price}>
        <FormattedMessage id="OrderPanel.price" values={{ priceValue, pricePerUnit }} />
      </p>
    </div>
  );
};

const PriceMissing = () => {
  return (
    <p className={css.error}>
      <FormattedMessage id="OrderPanel.listingPriceMissing" />
    </p>
  );
};
const InvalidCurrency = () => {
  return (
    <p className={css.error}>
      <FormattedMessage id="OrderPanel.listingCurrencyInvalid" />
    </p>
  );
};

const InvalidPriceVariants = () => {
  return (
    <p className={css.error}>
      <FormattedMessage id="OrderPanel.listingPriceVariantsAreInvalid" />
    </p>
  );
};

const hasUniqueVariants = priceVariants => {
  const priceVariantsSlugs = priceVariants?.map(variant =>
    variant.name ? createSlug(variant.name) : 'no-name'
  );
  return new Set(priceVariantsSlugs).size === priceVariants.length;
};

const hasValidPriceVariants = priceVariants => {
  const isArray = Array.isArray(priceVariants);
  const hasItems = isArray && priceVariants.length > 0;
  const variantsHaveNames = hasItems && priceVariants.every(variant => variant.name);
  const namesAreUnique = hasItems && hasUniqueVariants(priceVariants);

  return variantsHaveNames && namesAreUnique;
};

/**
 * @typedef {Object} ListingTypeConfig
 * @property {string} listingType - The type of the listing
 * @property {string} transactionType - The type of the transaction
 * @property {string} transactionType.process - The process descriptionof the transaction
 * @property {string} transactionType.alias - The alias of the transaction process
 * @property {string} transactionType.unitType - The unit type of the transaction
 */

/**
 * OrderPanel is a component that renders a panel for making bookings, purchases, or inquiries for a listing.
 * It handles different transaction processes and displays appropriate forms based on the listing type.
 *
 * @param {Object} props
 * @param {string} [props.rootClassName] - Custom class that overwrites the default class for the root element
 * @param {string} [props.className] - Custom class that extends
 * @param {string} [props.titleClassName] - Custom class name for the title
 * @param {propTypes.listing} props.listing - The listing data (either regular or own listing)
 * @param {Array<ListingTypeConfig>} props.validListingTypes - Array of valid listing type configurations
 * @param {boolean} [props.isOwnListing=false] - Whether the listing belongs to the current user
 * @param {listingType.user|listingType.currentUser} props.author - The listing author's user data
 * @param {ReactNode} [props.authorLink] - Custom component for rendering the author link
 * @param {ReactNode} [props.payoutDetailsWarning] - Warning message about payout details
 * @param {Function} props.onSubmit - Handler for form submission
 * @param {ReactNode|string} props.title - Title of the panel
 * @param {ReactNode} [props.titleDesktop] - Alternative title for desktop view
 * @param {ReactNode|string} [props.subTitle] - Subtitle text
 * @param {Function} props.onManageDisableScrolling - Handler for managing scroll behavior
 * @param {Function} props.onFetchTimeSlots - Handler for fetching available time slots
 * @param {Object} [props.monthlyTimeSlots] - Available time slots by month
 * @param {Function} props.onFetchTransactionLineItems - Handler for fetching transaction line items
 * @param {Function} [props.onContactUser] - Handler for contacting the listing author
 * @param {Array} [props.lineItems] - Array of line items for the transaction
 * @param {boolean} props.fetchLineItemsInProgress - Whether line items are being fetched
 * @param {Object} [props.fetchLineItemsError] - Error object if line items fetch failed
 * @param {string} props.marketplaceCurrency - The currency used in the marketplace
 * @param {number} props.dayCountAvailableForBooking - Number of days available for booking
 * @param {string} props.marketplaceName - Name of the marketplace
 * @param {number} [props.liveInitialCleaningDays] - Cocloset: the assigned laundry's
 *   CURRENT initial-cleaning turnaround, resolved server-side at page load by
 *   ListingPage.duck.js. Takes precedence over the `metadata.initialCleaningDays`
 *   snapshot; null (not yet arrived, or any failure) falls back to it.
 * @param {Array<{start: Date, end: Date}>} [props.cleaningGaps] - Cocloset: day ranges that
 *   cannot be a rental start because another booking's wash is owed then, resolved by the
 *   same endpoint call. null means "not known" and is deliberately not the same as `[]`.
 *   Passed only to BookingRentalPeriodForm, which is the form a Cocloset garment is rented
 *   through. BookingDatesForm - the stock free-range picker - does not receive it: the rule
 *   is still enforced for it by the server gate, which is the authoritative copy either way.
 *
 * @returns {JSX.Element} Component that displays the order panel with appropriate form
 */
const OrderPanel = props => {
  const [mounted, setMounted] = useState(false);
  const intl = useIntl();
  const location = useLocation();
  const history = useHistory();

  useEffect(() => {
    setMounted(true);
  }, []);
  const {
    rootClassName,
    className,
    titleClassName,
    listing,
    validListingTypes,
    lineItemUnitType: lineItemUnitTypeMaybe,
    isOwnListing,
    onSubmit,
    title,
    titleDesktop,
    author,
    authorLink,
    onManageDisableScrolling,
    onFetchTimeSlots,
    monthlyTimeSlots,
    timeSlotsForDate,
    onFetchTransactionLineItems,
    onContactUser,
    lineItems,
    marketplaceCurrency,
    dayCountAvailableForBooking,
    marketplaceName,
    fetchLineItemsInProgress,
    fetchLineItemsError,
    payoutDetailsWarning,
    showListingImage,
    hideAuthorInfo,
    hidePrice,
    // Cocloset: see the JSDoc above. Resolved by the ListingPage duck through
    // /api/listing-initial-cleaning, because the number lives in the laundry user's
    // privateData and the browser cannot read it.
    liveInitialCleaningDays,
    // Cocloset: day ranges another rental's wash has already claimed. Resolved by the same
    // endpoint call, and passed straight through to the picker.
    cleaningGaps,
  } = props;

  const publicData = listing?.attributes?.publicData || {};
  const { listingType, unitType, transactionProcessAlias = '', priceVariants, startTimeInterval } =
    publicData || {};

  // Cocloset: garment custody, written ONLY by our server through the Integration
  // API (see server/api-util/listingCustody.js and
  // server/api/listing-laundry-assignment.js). Read from `metadata` and not
  // `publicData` on purpose - the same two values gate the booking server-side in
  // server/api-util/bookingRules.js, and `metadata` is the one kind of extended data
  // a listing's own owner cannot write.
  //
  //   onLaundry           - true once a laundry has physically received the garment
  //   initialCleaningDays - how long its FIRST wash takes, so the calendar can stop
  //                         offering tomorrow for a garment that is not there yet
  //   readyAt             - when the wash it is in RIGHT NOW finishes, written by the
  //                         studio at the counter from the days it asked for at the return
  //
  // `initialCleaningDays` here is a SNAPSHOT from the moment the laundry was assigned. It
  // is still read, and still needed, because it is the FALLBACK: `liveInitialCleaningDays`
  // is the studio's current number, and it is null until the page-load lookup returns and
  // for good after any failure. Both are handed to BookingDatesForm, which applies the
  // same precedence the server gate does (see resolveInitialCleaningDays there and
  // server/api-util/bookingRules.js `resolveInitialCleaningBlockDays`) - live first,
  // snapshot second, never "no block" just because a read failed.
  const { onLaundry, initialCleaningDays, readyAt } = listing?.attributes?.metadata || {};

  const processName = resolveLatestProcessName(transactionProcessAlias.split('/')[0]);
  const lineItemUnitType = lineItemUnitTypeMaybe || `line-item/${unitType}`;

  const price = listing?.attributes?.price;
  const isInquiry = isInquiryProcess(processName);
  const isBooking = isBookingProcess(processName);
  const isPurchase = isPurchaseProcess(processName);
  const isNegotiation = isNegotiationProcess(processName);
  const isDownload = isDownloadProcess(processName);
  const isPaymentProcess = isBooking || isPurchase || isNegotiation || isDownload;

  const showPriceMissing = isPaymentProcess && !isNegotiation && !price;
  const showInvalidCurrency =
    isPaymentProcess && !isNegotiation && price?.currency !== marketplaceCurrency;

  const timeZone = listing?.attributes?.availabilityPlan?.timezone;
  const isClosed = listing?.attributes?.state === LISTING_STATE_CLOSED;

  const shouldHaveFixedBookingDuration = isBooking && [LINE_ITEM_FIXED].includes(lineItemUnitType);
  const showBookingFixedDurationForm =
    mounted && shouldHaveFixedBookingDuration && !isClosed && timeZone && priceVariants?.length > 0;

  const shouldHaveBookingTime = isBooking && [LINE_ITEM_HOUR].includes(lineItemUnitType);
  const showBookingTimeForm = mounted && shouldHaveBookingTime && !isClosed && timeZone;

  // Cocloset: a garment rented by fixed period is day-based, so it satisfies this condition
  // too. `isFixedRentalPeriod` (resolved below, next to the listing type config) takes it
  // away again: rendering the stock date-range form for a garment would let a customer pick
  // an arbitrary range that the server then refuses, and would price it per day.
  const shouldHaveBookingDates =
    isBooking && [LINE_ITEM_DAY, LINE_ITEM_NIGHT].includes(lineItemUnitType);

  // The listing resource has a relationship: `currentStock`,
  // which you should include when making API calls.
  const shouldHavePurchase = isPurchase && lineItemUnitType === LINE_ITEM_ITEM;
  const currentStock = listing.currentStock?.attributes?.quantity;
  const isOutOfStock = shouldHavePurchase && !isClosed && currentStock === 0;

  // Show form only when stock is fully loaded. This avoids "Out of stock" UI by
  // default before all data has been downloaded.
  const showProductOrderForm =
    mounted && shouldHavePurchase && !isClosed && typeof currentStock === 'number';

  const showDownloadForm = mounted && !isClosed && isDownload;
  const showInquiryForm = mounted && !isClosed && isInquiry;
  // if listing is a request, we show the negotiation form (reverse negotiation). User (provider) needs to make an offer first.
  const showNegotiationForm = mounted && !isClosed && isNegotiation && unitType === REQUEST;
  // if listing is an offer, we show the "request a quote" form as user needs to ask for a quote first from the provider.
  const showRequestQuoteForm = mounted && !isClosed && isNegotiation && unitType === OFFER;

  const supportedProcessesInfo = getSupportedProcessesInfo();
  const isKnownProcess = supportedProcessesInfo.map(info => info.name).includes(processName);

  const { pickupEnabled, shippingEnabled } = listing?.attributes?.publicData || {};

  const listingTypeConfig = validListingTypes.find(conf => conf.listingType === listingType);

  // Cocloset: a garment is rented for one of two fixed periods (7 or 14 days) at a flat
  // price, not for an arbitrary range of days. That replaces the date-range form entirely —
  // see src/util/rentalPeriods.js and BookingRentalPeriodForm.
  //
  // `rentalPeriods` empty means the owner has priced nothing yet. The panel then falls
  // through to the "price missing" branch above, because `handleSubmitValuesForRentalPeriods`
  // only writes `listing.price` alongside the periods, so a listing with no periods has no
  // price either.
  const isFixedRentalPeriod = usesFixedRentalPeriods(listingTypeConfig);
  const rentalPeriods = isFixedRentalPeriod ? getRentalPeriods(publicData) : [];
  const showBookingRentalPeriodForm =
    mounted && isFixedRentalPeriod && !isClosed && timeZone && rentalPeriods.length > 0;
  // A garment whose owner has priced no period cannot be booked. `listing.price` may still
  // be set - a listing priced before this feature kept it - so the stock "price missing"
  // check does not catch this, and without it the panel would render nothing at all.
  const showRentalPeriodsMissing = isFixedRentalPeriod && rentalPeriods.length === 0;

  const showBookingDatesForm =
    mounted && shouldHaveBookingDates && !isFixedRentalPeriod && !isClosed && timeZone;

  const displayShipping = displayDeliveryShipping(listingTypeConfig);
  const displayPickup = displayDeliveryPickup(listingTypeConfig);
  const allowOrdersOfMultipleItems = [STOCK_MULTIPLE_ITEMS, STOCK_INFINITE_MULTIPLE_ITEMS].includes(
    listingTypeConfig?.stockType
  );

  const searchParams = parse(location.search);
  const isOrderOpen = !!searchParams.orderOpen;
  const preselectedPriceVariantSlug = searchParams.bookableOption;

  const seatsEnabled = [AVAILABILITY_MULTIPLE_SEATS].includes(listingTypeConfig?.availabilityType);

  // Note: publicData contains priceVariationsEnabled if listing is created with priceVariations enabled.
  const isPriceVariationsInUse = !!publicData?.priceVariationsEnabled;
  const preselectedPriceVariant =
    Array.isArray(priceVariants) && preselectedPriceVariantSlug && isPriceVariationsInUse
      ? priceVariants.find(pv => pv?.name && createSlug(pv?.name) === preselectedPriceVariantSlug)
      : null;

  const priceVariantsMaybe = isPriceVariationsInUse
    ? {
        isPriceVariationsInUse,
        priceVariants,
        priceVariantFieldComponent: PriceVariantPicker,
        preselectedPriceVariant,
        isPublishedListing: isPublishedListing(listing),
      }
    : !isPriceVariationsInUse && showBookingFixedDurationForm
    ? {
        isPriceVariationsInUse: false,
        priceVariants: [getCheapestPriceVariant(priceVariants)],
        priceVariantFieldComponent: PriceVariantPicker,
      }
    : {};

  const showInvalidPriceVariantsMessage =
    isPriceVariationsInUse && !hasValidPriceVariants(priceVariants);

  const sharedProps = {
    lineItemUnitType,
    onSubmit,
    price,
    marketplaceCurrency,
    listingId: listing.id,
    isOwnListing,
    marketplaceName,
    onFetchTransactionLineItems,
    lineItems,
    fetchLineItemsInProgress,
    fetchLineItemsError,
    payoutDetailsWarning,
  };

  const showClosedListingHelpText = listing.id && isClosed;

  const subTitleText = showClosedListingHelpText
    ? intl.formatMessage({ id: 'OrderPanel.subTitleClosedListing' })
    : null;

  const authorDisplayName = userDisplayNameAsString(author, '');

  const classes = classNames(rootClassName || css.root, className);
  const titleClasses = classNames(titleClassName || css.orderTitle);

  return (
    <div className={classes}>
      <ModalInMobile
        containerClassName={css.modalContainer}
        id="OrderFormInModal"
        isModalOpenOnMobile={isOrderOpen}
        onClose={() => {
          closeOrderModal(history, location);
          document.getElementById(ORDER_PANEL_SUBMIT_BUTTON_ID)?.focus();
        }}
        showAsModalMaxWidth={MODAL_BREAKPOINT}
        onManageDisableScrolling={onManageDisableScrolling}
        usePortal
      >
        <div className={css.modalHeading}>
          <H1 className={css.heading}>{title}</H1>
        </div>

        {showListingImage && (
          <div className={css.orderHeading}>
            {titleDesktop ? titleDesktop : <H2 className={titleClasses}>{title}</H2>}
            {subTitleText ? <div className={css.orderHelp}>{subTitleText}</div> : null}
          </div>
        )}
        {!hidePrice && (
          <PriceMaybe
            price={price}
            publicData={publicData}
            validListingTypes={validListingTypes}
            intl={intl}
            marketplaceCurrency={marketplaceCurrency}
          />
        )}

        {!hideAuthorInfo && (
          <div className={css.author}>
            <AvatarSmall user={author} className={css.providerAvatar} />
            <span className={css.providerNameLinked}>
              <FormattedMessage id="OrderPanel.author" values={{ name: authorLink }} />
            </span>
            <span className={css.providerNamePlain}>
              <FormattedMessage id="OrderPanel.author" values={{ name: authorDisplayName }} />
            </span>
          </div>
        )}

        {showPriceMissing || showRentalPeriodsMissing ? (
          <PriceMissing />
        ) : showInvalidCurrency ? (
          <InvalidCurrency />
        ) : showInvalidPriceVariantsMessage ? (
          <InvalidPriceVariants />
        ) : showBookingRentalPeriodForm ? (
          <BookingRentalPeriodForm
            className={css.bookingForm}
            formId="OrderPanelBookingRentalPeriodForm"
            rentalPeriods={rentalPeriods}
            onLaundry={onLaundry}
            initialCleaningDays={initialCleaningDays}
            liveInitialCleaningDays={liveInitialCleaningDays}
            readyAt={readyAt}
            cleaningGaps={cleaningGaps}
            dayCountAvailableForBooking={dayCountAvailableForBooking}
            monthlyTimeSlots={monthlyTimeSlots}
            onFetchTimeSlots={onFetchTimeSlots}
            timeZone={timeZone}
            finePrintComponent={SubmitFinePrint}
            {...sharedProps}
          />
        ) : showBookingFixedDurationForm ? (
          <BookingFixedDurationForm
            seatsEnabled={seatsEnabled}
            className={css.bookingForm}
            formId="OrderPanelBookingFixedDurationForm"
            dayCountAvailableForBooking={dayCountAvailableForBooking}
            monthlyTimeSlots={monthlyTimeSlots}
            timeSlotsForDate={timeSlotsForDate}
            onFetchTimeSlots={onFetchTimeSlots}
            startDatePlaceholder={intl.formatDate(TODAY, dateFormattingOptions)}
            startTimeInterval={startTimeInterval}
            timeZone={timeZone}
            finePrintComponent={SubmitFinePrint}
            {...priceVariantsMaybe}
            {...sharedProps}
          />
        ) : showBookingTimeForm ? (
          <BookingTimeForm
            seatsEnabled={seatsEnabled}
            className={css.bookingForm}
            formId="OrderPanelBookingTimeForm"
            dayCountAvailableForBooking={dayCountAvailableForBooking}
            monthlyTimeSlots={monthlyTimeSlots}
            timeSlotsForDate={timeSlotsForDate}
            onFetchTimeSlots={onFetchTimeSlots}
            startDatePlaceholder={intl.formatDate(TODAY, dateFormattingOptions)}
            endDatePlaceholder={intl.formatDate(TODAY, dateFormattingOptions)}
            timeZone={timeZone}
            finePrintComponent={SubmitFinePrint}
            {...priceVariantsMaybe}
            {...sharedProps}
          />
        ) : showBookingDatesForm ? (
          <BookingDatesForm
            seatsEnabled={seatsEnabled}
            className={css.bookingForm}
            formId="OrderPanelBookingDatesForm"
            onLaundry={onLaundry}
            initialCleaningDays={initialCleaningDays}
            liveInitialCleaningDays={liveInitialCleaningDays}
            readyAt={readyAt}
            dayCountAvailableForBooking={dayCountAvailableForBooking}
            monthlyTimeSlots={monthlyTimeSlots}
            onFetchTimeSlots={onFetchTimeSlots}
            timeZone={timeZone}
            finePrintComponent={SubmitFinePrint}
            {...priceVariantsMaybe}
            {...sharedProps}
          />
        ) : showProductOrderForm ? (
          <ProductOrderForm
            formId="OrderPanelProductOrderForm"
            currentStock={currentStock}
            allowOrdersOfMultipleItems={allowOrdersOfMultipleItems}
            pickupEnabled={pickupEnabled && displayPickup}
            shippingEnabled={shippingEnabled && displayShipping}
            displayDeliveryMethod={displayPickup || displayShipping}
            onContactUser={onContactUser}
            {...sharedProps}
          />
        ) : showDownloadForm ? (
          <DigitalDownloadForm
            formId="OrderPanelDigitalDownloadForm"
            finePrintComponent={SubmitFinePrint}
            isOwnListing={isOwnListing}
            {...sharedProps}
          />
        ) : showInquiryForm ? (
          <InquiryWithoutPaymentForm
            formId="OrderPanelInquiryForm"
            onSubmit={onSubmit}
            finePrintComponent={SubmitFinePrint}
            isOwnListing={isOwnListing}
          />
        ) : showNegotiationForm ? (
          <NegotiationForm
            formId="OrderPanelNegotiationForm"
            onSubmit={onSubmit}
            finePrintComponent={SubmitFinePrint}
            payoutDetailsWarning={payoutDetailsWarning}
            isOwnListing={isOwnListing}
          />
        ) : showRequestQuoteForm ? (
          <NegotiationRequestQuoteForm
            formId="OrderPanelRequestQuoteForm"
            onSubmit={onSubmit}
            finePrintComponent={SubmitFinePrint}
            payoutDetailsWarning={payoutDetailsWarning}
            isOwnListing={isOwnListing}
          />
        ) : !isKnownProcess ? (
          <p className={css.errorSidebar}>
            <FormattedMessage id="OrderPanel.unknownTransactionProcess" />
          </p>
        ) : null}
      </ModalInMobile>
      <div className={css.openOrderForm}>
        <PriceMaybe
          price={price}
          publicData={publicData}
          validListingTypes={validListingTypes}
          intl={intl}
          marketplaceCurrency={marketplaceCurrency}
          showCurrencyMismatch
        />

        {isClosed ? (
          <div className={css.closedListingButton}>
            <FormattedMessage id="OrderPanel.closedListingButtonText" />
          </div>
        ) : (
          <PrimaryButton
            id={ORDER_PANEL_SUBMIT_BUTTON_ID}
            onClick={handleSubmit(
              isOwnListing,
              isClosed,
              showInquiryForm || showNegotiationForm,
              onSubmit,
              history,
              location
            )}
            disabled={isOutOfStock}
          >
            {isBooking ? (
              <FormattedMessage id="OrderPanel.ctaButtonMessageBooking" />
            ) : isOutOfStock ? (
              <FormattedMessage id="OrderPanel.ctaButtonMessageNoStock" />
            ) : isPurchase ? (
              <FormattedMessage id="OrderPanel.ctaButtonMessagePurchase" />
            ) : showNegotiationForm ? (
              <FormattedMessage id="OrderPanel.ctaButtonMessageMakeOffer" />
            ) : showRequestQuoteForm ? (
              <FormattedMessage id="OrderPanel.ctaButtonMessageRequestAQuote" />
            ) : showDownloadForm ? (
              <FormattedMessage id="OrderPanel.ctaButtonMessageDownload" />
            ) : (
              <FormattedMessage id="OrderPanel.ctaButtonMessageInquiry" />
            )}
          </PrimaryButton>
        )}
      </div>
    </div>
  );
};

export default OrderPanel;
