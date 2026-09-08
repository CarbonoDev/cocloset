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
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { bookingWeeksBetween } = require('../api-util/rentalWeeks');
const { isCoclosetBookingListing } = require('../api-util/coclosetBookingProcess');
const {
  assertInitialCleaningLeadTime,
  assertCleaningReadiness,
} = require('../api-util/bookingRules');
const {
  assertCleaningGapForListing,
  liveInitialCleaningDaysFrom,
} = require('../api-util/listingCleaningGaps');
const { assertRentalPeriodBooking } = require('../api-util/rentalPeriods');
const { ensureHandoverQr } = require('../api-util/handoverQr');
const log = require('../log');

const { Money } = sharetribeSdk.types;

// "El QR ... se debe generar al momento de crear la reservación."
//
// This endpoint IS that moment: `transition/request-payment` is privileged, so
// a `cocloset-booking` reservation cannot be created without coming through
// here. See the GENERATION TIMING section in api-util/handoverQr.js for why the
// accept-time hook (create-availability-buffer.js) was rejected.
//
// Fire-and-continue, deliberately, following the notifyPickupScheduled
// precedent in create-availability-buffer.js: the customer is waiting on this
// response to go and pay, and nothing downstream needs the record to exist yet
// (resolveHandoverQrPayload renders a correct QR without it). ensureHandoverQr
// never rejects and logs its own failures.
// Called after the response has already been sent, so it must not be able to
// throw: getIntegrationSdk() throws when the Integration API env vars are
// missing, and an escaping throw here would reach the trailing .catch() and
// try to respond twice.
const generateHandoverQrMaybe = (listing, transaction) => {
  if (!isCoclosetBookingListing(listing) || !transaction?.id) {
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
  // Kept for the post-response handover-QR step, which needs to know whether
  // this listing is on the cocloset-booking process.
  let listingEntity = null;

  Promise.all([listingPromise(sdk, bodyParams?.params?.listingId), fetchCommission(sdk)])
    .then(([showListingResponse, fetchAssetsResponse]) => {
      const listing = showListingResponse.data.data;
      listingEntity = listing;
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

      // The rental period, checked BEFORE anything is priced.
      //
      // A garment is rented for one of the fixed periods its owner priced, and the price
      // charged is that period's flat price. The dates and the period name both arrive
      // here as ordinary request parameters, so without this check a caller could pay the
      // 7-day price for a 90-day range: the line-item builder prices from the named period
      // and never looks at the dates. Sharetribe will not catch it for us either - booking
      // LENGTH is not part of the availability model. See api-util/rentalPeriods.js.
      //
      // Deliberately applied on the speculative path too. A preview that quotes a booking
      // the charge path will refuse is how a customer gets to the last step before finding
      // out.
      //
      // READ THROUGH `getFullOrderData`, NOT OFF `orderData`. The two client paths put
      // `priceVariantName` in DIFFERENT places: the speculative one
      // (CheckoutPage.duck.js `speculateTransaction`) destructures it into `orderData`, and
      // the real one (`initiateOrder`) does not, so it stays in `otherOrderParams` and
      // arrives inside `bodyParams.params`. Pricing has always been immune because
      // `getFullOrderData` merges the two; reading `orderData` alone here meant the name was
      // `undefined` on every real booking and this rule refused all of them. Resolving it the
      // same way the line-item builder does is what stops the gate and the price from ever
      // disagreeing about which period was chosen.
      const fullOrderData = getFullOrderData(orderData, bodyParams, currency);

      assertRentalPeriodBooking({
        listing,
        priceVariantName: fullOrderData?.priceVariantName,
        bookingStart: bodyParams?.params?.bookingStart,
        bookingEnd: bodyParams?.params?.bookingEnd,
      });

      // The initial cleaning turnaround, for a garment that has never reached its
      // laundry. Same argument as above for why it is here and not only in the calendar.
      // Applied on the speculative path too, for the same reason - a preview must not
      // quote dates the charge will refuse.
      //
      // WHY THIS NOW RESOLVES THE LAUNDRY'S LIVE TURNAROUND.
      // `metadata.initialCleaningDays` is a snapshot from assignment time. The booking
      // calendar was changed to consult the laundry's CURRENT number (per the client, so
      // that a studio changing its turnaround takes effect on garments already assigned
      // to it), and if this gate kept reading only the snapshot the two could disagree -
      // the calendar offering a date checkout then refuses, which is exactly what
      // src/components/OrderPanel/BookingDatesForm/initialCleaningAgreement.test.js was
      // written to prevent. So both sides resolve from the same input.
      //
      // A failed resolution returns null, which falls back to the SNAPSHOT rather than to
      // "no block": a read error must not open the gate.
      // The garment is in a wash RIGHT NOW, from a return the studio has already confirmed
      // and sized. Free (the value is on the listing entity above), and deliberately
      // checked alongside the first-cleaning gate rather than left to the availability
      // exception alone - see assertCleaningReadiness for why one best-effort calendar
      // write is not enough places to enforce this.
      assertCleaningReadiness({ listing, bookingStart: bodyParams?.params?.bookingStart });

      // THE CLEANING BETWEEN TWO RENTALS, which `readyAt` above cannot express: it only knows
      // about a wash that has already started. A garment out on a rental that ends on the
      // 24th still owes its studio a turnaround afterwards, and nothing on the calendar says
      // so until the accept-time buffer write lands - which, on Dev, it does not.
      //
      //   > "Sigue sin respetarse el buffer de dias de limpieza (Revisa los dias antes del
      //   >  booking y despues de que se regresa)"
      //
      // See api-util/cleaningGaps.js for the rule and for the evidence that the calendar
      // write alone was never holding it. This is the same argument as `readyAt`: the
      // authoritative copy of a rule has to live where it cannot silently do nothing.
      //
      // WHAT IT COSTS, STATED PLAINLY. Two Integration API reads on the checkout path - the
      // studio's turnaround and the listing's other bookings - where a previous change had
      // deliberately got that number down to one-on-the-first-rental-only. It buys the rule
      // an enforcement point that cannot silently do nothing, and the alternative has now
      // been reported three times. The turnaround read is SHARED with the initial-cleaning
      // gate below rather than repeated: one number, one fetch, no way for the two gates to
      // disagree. A read failure logs and lets the booking through rather than refusing it -
      // see resolveBookingConstraints.
      return assertCleaningGapForListing({
        listing,
        bookingStart: bodyParams?.params?.bookingStart,
        bookingEnd: bodyParams?.params?.bookingEnd,
      }).then(constraints => {
        assertInitialCleaningLeadTime({
          listing,
          bookingStart: bodyParams?.params?.bookingStart,
          liveInitialCleaningDays: liveInitialCleaningDaysFrom(listing, constraints),
        });

        return buildLineItemsForListing({
          listing,
          orderData: fullOrderData,
          providerCommission,
          customerCommission,
          currency,
        }).then(builtLineItems => {
          lineItems = builtLineItems;
          metadataMaybe = getMetadata(orderData, transitionName);

          return getTrustedSdk(req);
        });
      });
    })
    .then(trustedSdk => {
      const { params } = bodyParams;

      // HOW MANY WEEKS THIS RENTAL IS, written where the dates are authoritative.
      //
      //   > "en el correo (...) aun se ve x n days, cuando debe ser por 1 o 2 semanas"
      //   >   (Jonathan, 2026-09-08)
      //
      // The email templates cannot do arithmetic, so the count has to travel with the
      // transaction. It used to be computed in the browser from the checkout's session-stored
      // `bookingDates`; a real transaction on Dev came back with every other protectedData key
      // present and this one missing, which is what that indirection buys. `bookingStart` and
      // `bookingEnd` here are the dates the booking is about to be made from - the same ones
      // the line items and the cleaning gates above are computed from.
      //
      // Absent when the rental is not a whole number of weeks: the breakdown then falls back
      // to days, which is still true, where "3 weeks" for a 20-day rental would not be.
      //
      // Merged OVER whatever the client sent, and last, so there is one writer of this key.
      const bookingWeeks = bookingWeeksBetween(params?.bookingStart, params?.bookingEnd);
      const protectedDataMaybe = bookingWeeks
        ? { protectedData: { ...(params?.protectedData || {}), bookingWeeks } }
        : {};

      // Add lineItems to the body params
      const body = {
        ...bodyParams,
        params: {
          ...params,
          lineItems,
          ...protectedDataMaybe,
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

      // A speculative call builds a breakdown for the CheckoutPage and creates
      // no transaction, so there is nothing to attach a QR to.
      if (!isSpeculative) {
        generateHandoverQrMaybe(listingEntity, data?.data);
      }
    })
    .catch(e => {
      handleError(res, e);
    });
};
