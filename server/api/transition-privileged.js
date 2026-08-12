const sharetribeSdk = require('sharetribe-flex-sdk');
const { buildLineItemsForListing } = require('../api-util/lineItems');
const { assertInitialCleaningLeadTime } = require('../api-util/bookingRules');
const { assertRentalPeriodBooking } = require('../api-util/rentalPeriods');
const { resolveLiveInitialCleaningDays } = require('../api-util/liveInitialCleaning');
const {
  addOfferToMetadata,
  getAmountFromPreviousOffer,
  isIntentionToMakeCounterOffer,
  isIntentionToMakeOffer,
  isIntentionToRevokeCounterOffer,
  isIntentionToUpdateOffer,
  throwErrorIfNegotiationOfferHasInvalidHistory,
} = require('../api-util/negotiation');
const {
  getSdk,
  getTrustedSdk,
  handleError,
  serialize,
  fetchCommission,
} = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { TRANSITIONS, isCoclosetBookingListing } = require('../api-util/coclosetBookingProcess');
const { ensureHandoverQr } = require('../api-util/handoverQr');
const log = require('../log');

const { Money } = sharetribeSdk.types;

// The second way a reservation is created: a customer who started with an
// inquiry books through `transition/request-payment-after-inquiry` instead of
// `request-payment`. The transaction already exists (the `inquire` created it),
// but the RESERVATION is created here, so this is the same moment as
// initiate-privileged.js and gets the same treatment. See the GENERATION TIMING
// section in api-util/handoverQr.js.
//
// Gated on the transition as well as the process, because this endpoint also
// carries every default-negotiation offer transition; those must not mint a QR.
//
// `ensureHandoverQr` is idempotent, so having two call sites cannot produce two
// codes - which is the point of requirement (2), "este mismo qr".
//
// Called after the response is sent, so it must never throw: getIntegrationSdk()
// throws on missing env vars, and an escaping throw would reach the trailing
// .catch() and try to respond twice.
const generateHandoverQrMaybe = (transitionName, listing, transaction) => {
  const isReservationCreation = transitionName === TRANSITIONS.REQUEST_PAYMENT_AFTER_INQUIRY;

  if (!isReservationCreation || !isCoclosetBookingListing(listing) || !transaction?.id) {
    return;
  }

  try {
    ensureHandoverQr({
      integrationSdk: getIntegrationSdk(),
      transactionId: transaction.id,
      existingMetadata: transaction.attributes?.metadata,
      log,
    });
  } catch (e) {
    log.error(e, 'handover-qr-write-failed', { txId: transaction.id?.uuid || 'unknown' });
  }
};

const transactionPromise = (sdk, id) => sdk.transactions.show({ id, include: ['listing'] });
const getListingRelationShip = transactionShowAPIData => {
  const { data, included } = transactionShowAPIData;
  const { relationships } = data;
  const { listing: listingRef } = relationships;
  return included.find(i => i.id.uuid === listingRef.data.id.uuid);
};

// When a provider is making an offer, make sure that customer related
// protected data is not being saved
const getRoleBasedBodyParams = (orderData, bodyParams) => {
  const { offerInSubunits } = orderData || {};
  const transitionName = bodyParams?.transition;
  const isProviderOffer =
    isIntentionToMakeOffer(offerInSubunits, transitionName) ||
    isIntentionToUpdateOffer(offerInSubunits, transitionName);

  if (!isProviderOffer) {
    return bodyParams;
  } else {
    const protectedData = bodyParams?.params?.protectedData || {};

    const filteredProtectedData = Object.entries(protectedData).reduce(
      (validEntries, [key, value]) => {
        if (key === 'customerDefaultMessage' || key.startsWith('customer_')) {
          return validEntries;
        } else {
          return { ...validEntries, [key]: value };
        }
      },
      {}
    );

    return {
      ...bodyParams,
      params: {
        ...bodyParams.params,
        protectedData: filteredProtectedData,
      },
    };
  }
};

const getFullOrderData = (orderData, bodyParams, currency, offers) => {
  const { offerInSubunits } = orderData || {};
  const transitionName = bodyParams.transition;

  const roleBasedBodyParams = getRoleBasedBodyParams(orderData, bodyParams);
  const orderDataAndParams = { ...orderData, ...roleBasedBodyParams.params, currency };

  const isNewOffer =
    isIntentionToMakeOffer(offerInSubunits, transitionName) ||
    isIntentionToMakeCounterOffer(offerInSubunits, transitionName) ||
    isIntentionToUpdateOffer(offerInSubunits, transitionName);

  return isNewOffer
    ? {
        ...orderDataAndParams,
        offer: new Money(offerInSubunits, currency),
      }
    : isIntentionToRevokeCounterOffer(transitionName)
    ? {
        ...orderDataAndParams,
        offer: new Money(getAmountFromPreviousOffer(offers), currency),
      }
    : orderDataAndParams;
};

const getUpdatedMetadata = (orderData, transition, existingMetadata) => {
  const { actor, offerInSubunits } = orderData || {};
  // NOTE: for default-negotiation process, the actor is always "provider" when making an offer.
  const hasActor = ['provider', 'customer'].includes(actor);
  const by = hasActor ? actor : null;

  const isNewOffer =
    isIntentionToMakeOffer(offerInSubunits, transition) ||
    isIntentionToMakeCounterOffer(offerInSubunits, transition) ||
    isIntentionToUpdateOffer(offerInSubunits, transition);

  return isNewOffer
    ? addOfferToMetadata(existingMetadata, {
        offerInSubunits,
        by,
        transition,
      })
    : isIntentionToRevokeCounterOffer(transition)
    ? addOfferToMetadata(existingMetadata, {
        offerInSubunits: getAmountFromPreviousOffer(existingMetadata.offers),
        by,
        transition,
      })
    : addOfferToMetadata(existingMetadata, null);
};

module.exports = (req, res) => {
  const { isSpeculative, orderData, bodyParams, queryParams } = req.body || {};

  const sdk = getSdk(req, res);
  const transitionName = bodyParams.transition;
  let lineItems = null;
  let metadataMaybe = {};
  // Kept for the post-response handover-QR step, which needs to know whether
  // this listing is on the cocloset-booking process.
  let listingEntity = null;

  Promise.all([transactionPromise(sdk, bodyParams?.id), fetchCommission(sdk)])
    .then(responses => {
      const [showTransactionResponse, fetchAssetsResponse] = responses;
      const transaction = showTransactionResponse.data.data;
      const listing = getListingRelationShip(showTransactionResponse.data);
      listingEntity = listing;
      const commissionAsset = fetchAssetsResponse.data.data[0];

      const existingMetadata = transaction?.attributes?.metadata;
      const existingOffers = existingMetadata?.offers || [];
      const transitions = transaction.attributes.transitions;

      // Check if the transition is related to negotiation offers and if the offers are valid
      throwErrorIfNegotiationOfferHasInvalidHistory(transitionName, existingOffers, transitions);

      const currency =
        transaction.attributes.payinTotal?.currency ||
        listing.attributes.price?.currency ||
        orderData.currency;
      const { providerCommission, customerCommission } =
        commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

      // The rental period. A no-op unless this transition actually carries booking
      // dates (most do not - they act on a booking that already exists), but this
      // endpoint is one of the two that can CREATE a reservation, so it needs the
      // same gate as initiate-privileged.js: the period name decides the price, and
      // nothing else checks that the dates match it.
      //
      // `listing` here comes from the transaction's `include: ['listing']`, and
      // that included resource does carry `publicData`: the line-item builder
      // below already reads `publicData.unitType` off this very object and
      // refuses to price the booking when it is missing. So this check cannot
      // silently skip for want of the field.
      //
      // Read through `getFullOrderData`, not off `orderData`: the two client paths put
      // `priceVariantName` in different places (see the same note in
      // initiate-privileged.js), and pricing has always read the merged view. Resolving it
      // the same way is what stops the gate and the price from disagreeing about which
      // period was chosen.
      const fullOrderData = getFullOrderData(orderData, bodyParams, currency, existingOffers);

      assertRentalPeriodBooking({
        listing,
        priceVariantName: fullOrderData?.priceVariantName,
        bookingStart: bodyParams?.params?.bookingStart,
        bookingEnd: bodyParams?.params?.bookingEnd,
      });

      // The initial cleaning turnaround, for a garment that has never reached its
      // laundry. Same "no-op unless this transition carries booking dates" caveat as
      // the rule above, and the same reason it still has to be here:
      // `request-payment-after-inquiry` creates a reservation, so this endpoint is
      // the second door into the same booking.
      //
      // It reads `metadata` (`onLaundry`, `initialCleaningDays`) off the included
      // listing. `include: ['listing']` returns the full listing resource - no
      // `fields.listing` restriction is sent here - so `metadata` is present for the
      // same reason `publicData` is, which the line-item builder below already
      // depends on. It also needs `publicData` for the garment's category chain, which
      // the live turnaround is resolved against.
      //
      // The live resolution is here for the same reason it is in
      // initiate-privileged.js: the calendar now honours the laundry's CURRENT
      // turnaround, and a gate reading the stale snapshot could refuse a date the
      // calendar offered. It costs an Integration API call only while
      // `metadata.onLaundry !== true` (first rental only - see
      // api-util/liveInitialCleaning.js), and a failed read falls back to the snapshot
      // rather than to "no block".
      return resolveLiveInitialCleaningDays({ listing }).then(liveInitialCleaningDays => {
        assertInitialCleaningLeadTime({
          listing,
          bookingStart: bodyParams?.params?.bookingStart,
          liveInitialCleaningDays,
        });

        // Cleaning fee is sourced from the assigned laundry's privateData
        // (Integration API only), so it has to be resolved before the
        // (synchronous) line items array can be built - see
        // lineItems.buildLineItemsForListing, which all three line-item
        // endpoints share so preview and charge cannot drift apart.
        return buildLineItemsForListing({
          listing,
          orderData: fullOrderData,
          providerCommission,
          customerCommission,
          currency,
        }).then(builtLineItems => {
          lineItems = builtLineItems;

          metadataMaybe = getUpdatedMetadata(orderData, transitionName, existingMetadata);

          return getTrustedSdk(req);
        });
      });
    })
    .then(trustedSdk => {
      // Pass role based params to make sure that protectedData only contains protected data
      // for the correct role.
      // - For the default-negotiation process, this removes any customer
      //   related protected data fields if the transition is from a provider
      // - If you customize the transaction process to allow customers to update protected data
      //   after a provider's offer, you can add that logic in this same function.
      const roleBasedBodyParams = getRoleBasedBodyParams(orderData, bodyParams);
      // Omit listingId from params (transition/request-payment-after-inquiry does not need it)
      const { listingId, ...restParams } = roleBasedBodyParams?.params || {};

      // Add lineItems to the body params
      const body = {
        ...bodyParams,
        params: {
          ...restParams,
          lineItems,
          ...metadataMaybe,
        },
      };

      if (isSpeculative) {
        return trustedSdk.transactions.transitionSpeculative(body, queryParams);
      }
      return trustedSdk.transactions.transition(body, queryParams);
    })
    .then(apiResponse => {
      const { status, statusText, data } = apiResponse;
      res
        .status(status)
        .set('Content-Type', 'application/transit+json')
        .send(
          serialize({
            status,
            statusText,
            data,
          })
        )
        .end();

      // A speculative transition builds a breakdown only; nothing was created.
      if (!isSpeculative) {
        generateHandoverQrMaybe(transitionName, listingEntity, data?.data);
      }
    })
    .catch(e => {
      handleError(res, e);
    });
};
