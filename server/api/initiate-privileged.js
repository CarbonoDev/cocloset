const sharetribeSdk = require('sharetribe-flex-sdk');
const { buildLineItemsForListing } = require('../api-util/lineItems');
const { isIntentionToMakeOffer } = require('../api-util/negotiation');
const {
  getSdk,
  getTrustedSdk,
  handleError,
  serialize,
  fetchCommission,
} = require('../api-util/sdk');

const { Money } = sharetribeSdk.types;

const listingPromise = (sdk, id) => sdk.listings.show({ id });

const getFullOrderData = (orderData, bodyParams, currency) => {
  const { offerInSubunits } = orderData || {};
  const transitionName = bodyParams.transition;

  return isIntentionToMakeOffer(offerInSubunits, transitionName)
    ? {
        ...orderData,
        ...bodyParams.params,
        currency,
        offer: new Money(offerInSubunits, currency),
      }
    : { ...orderData, ...bodyParams.params };
};

const getMetadata = (orderData, transition) => {
  const { actor, offerInSubunits } = orderData || {};
  // NOTE: for now, the actor is always "provider".
  const hasActor = ['provider', 'customer'].includes(actor);
  const by = hasActor ? actor : null;

  return isIntentionToMakeOffer(offerInSubunits, transition)
    ? {
        metadata: {
          offers: [
            {
              offerInSubunits,
              by,
              transition,
            },
          ],
        },
      }
    : {};
};

module.exports = (req, res) => {
  const { isSpeculative, orderData, bodyParams, queryParams } = req.body || {};
  const transitionName = bodyParams.transition;
  const sdk = getSdk(req, res);
  let lineItems = null;
  let metadataMaybe = {};

  Promise.all([listingPromise(sdk, bodyParams?.params?.listingId), fetchCommission(sdk)])
    .then(([showListingResponse, fetchAssetsResponse]) => {
      const listing = showListingResponse.data.data;
      const commissionAsset = fetchAssetsResponse.data.data[0];

      const currency = listing.attributes.price?.currency || orderData.currency;
      const { providerCommission, customerCommission } =
        commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

      // This is the NORMAL booking path ("Request to book" from the listing
      // page): both the speculative breakdown shown on CheckoutPage and the
      // real charge come through here. The cleaning fee must be resolved here
      // too, or the customer sees a fee on the listing page, sees it vanish at
      // checkout, and the laundry never gets paid. Same shared builder as
      // transition-privileged.js and transaction-line-items.js so preview and
      // charge cannot drift apart again.
      return buildLineItemsForListing({
        listing,
        orderData: getFullOrderData(orderData, bodyParams, currency),
        providerCommission,
        customerCommission,
        currency,
      }).then(builtLineItems => {
        lineItems = builtLineItems;
        metadataMaybe = getMetadata(orderData, transitionName);

        return getTrustedSdk(req);
      });
    })
    .then(trustedSdk => {
      const { params } = bodyParams;

      // Add lineItems to the body params
      const body = {
        ...bodyParams,
        params: {
          ...params,
          lineItems,
          ...metadataMaybe,
        },
      };

      if (isSpeculative) {
        return trustedSdk.transactions.initiateSpeculative(body, queryParams);
      }
      return trustedSdk.transactions.initiate(body, queryParams);
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
    })
    .catch(e => {
      handleError(res, e);
    });
};
