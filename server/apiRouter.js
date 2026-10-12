/**
 * This file contains server side endpoints that can be used to perform backend
 * tasks that can not be handled in the browser.
 *
 * The endpoints should not clash with the application routes. Therefore, the
 * endpoints are prefixed in the main server where this file is used.
 */

const express = require('express');
const bodyParser = require('body-parser');
const { deserialize } = require('./api-util/sdk');

const initiateLoginAs = require('./api/initiate-login-as');
const loginAs = require('./api/login-as');
const transactionLineItems = require('./api/transaction-line-items');
const initiatePrivileged = require('./api/initiate-privileged');
const transitionPrivileged = require('./api/transition-privileged');
const deleteAccount = require('./api/delete-account');
const laundryPartnerApplication = require('./api/laundry-partner-application');
const emailSignup = require('./api/email-signup');
const laundries = require('./api/laundries');
const laundryOptions = require('./api/laundry-options');
const brands = require('./api/brands');
const createAvailabilityBuffer = require('./api/create-availability-buffer');
const laundryTransactionStatus = require('./api/laundry-transaction-status');
const listingReadinessStatus = require('./api/listing-readiness-status');
const listingCustodyStatus = require('./api/listing-custody-status');
const laundryReceiveGarment = require('./api/laundry-receive-garment');
const listingAvailabilitySweep = require('./api/listing-availability-sweep');
const laundryListingsRefresh = require('./api/laundry-listings-refresh');
const listingLaundryAssignment = require('./api/listing-laundry-assignment');
const listingInitialCleaning = require('./api/listing-initial-cleaning');
const lenderNewRequest = require('./api/lender-new-request');
const laundryAddress = require('./api/laundry-address');
const laundryOrders = require('./api/laundry-orders');
const transactionQr = require('./api/transaction-qr');
const handoverStatus = require('./api/handover-status');
const listingPickupQr = require('./api/listing-pickup-qr');
const listingPickupStatus = require('./api/listing-pickup-status');
const listingPickupConfirm = require('./api/listing-pickup-confirm');
const autoAcceptBooking = require('./api/auto-accept-booking');
const initUserRole = require('./api/init-user-role');

const createUserWithIdp = require('./api/auth/createUserWithIdp');

const { authenticateFacebook, authenticateFacebookCallback } = require('./api/auth/facebook');
const { authenticateGoogle, authenticateGoogleCallback } = require('./api/auth/google');

const router = express.Router();

// ================ API router middleware: ================ //

// Parse Transit body first to a string
router.use(
  bodyParser.text({
    type: 'application/transit+json',
  })
);

// Deserialize Transit body string to JS data
router.use((req, res, next) => {
  if (req.get('Content-Type') === 'application/transit+json' && typeof req.body === 'string') {
    try {
      req.body = deserialize(req.body);
    } catch (e) {
      console.error('Failed to parse request body as Transit:');
      console.error(e);
      res.status(400).send('Invalid Transit in request body.');
      return;
    }
  }
  next();
});

// ================ API router endpoints: ================ //

router.get('/initiate-login-as', initiateLoginAs);
router.get('/login-as', loginAs);
router.post('/transaction-line-items', transactionLineItems);
router.post('/initiate-privileged', initiatePrivileged);
router.post('/transition-privileged', transitionPrivileged);
router.post('/delete-account', deleteAccount);
router.get('/laundries', laundries);
// PUBLIC, and deliberately a different endpoint from the one above rather than the same one
// with its session requirement removed: this returns a studio's name and id and nothing else,
// for the search page's pickup filter. See the header of server/api/laundry-options.js for
// what that distinction is protecting.
router.get('/laundry-options', laundryOptions);
// PUBLIC for the same reason: the brand autocomplete feeds a search filter anonymous visitors
// use. Returns brands that are already printed on published listings, nothing more. See the
// header of server/api/brands.js.
router.get('/brands', brands);
router.post('/create-availability-buffer', createAvailabilityBuffer);
router.post('/laundry-transaction-status', laundryTransactionStatus);
router.post('/listing-readiness-status', listingReadinessStatus);
// The studio taking a garment IN from its owner at the start of a rental: the step that used
// to be fused onto "ready for the renter", which announced a coat as collectable before it
// had been washed. See server/api/laundry-receive-garment.js.
router.post('/laundry-receive-garment', laundryReceiveGarment);
// Give back the days a booking blocked once that booking is over. Fired by the listing page
// on load, because a cancellation from Console runs no code of ours. See
// server/api/listing-availability-sweep.js for what it will and will not delete.
router.post('/listing-availability-sweep', listingAvailabilitySweep);
// Re-stamp a studio's name and address onto its garments. Fired after the studio saves its
// profile: the address path has always propagated, an ordinary profile save never did.
router.post('/laundry-listings-refresh', laundryListingsRefresh);
// Garment custody (`listing.metadata.onLaundry`) - writable by the assigned
// laundry OR the listing's owner, and only while the listing has no active
// transaction. See server/api/listing-custody-status.js.
router.post('/listing-custody-status', listingCustodyStatus);
// The assigned-laundry guard: may this owner change the listing's laundry right
// now? Read the header of server/api/listing-laundry-assignment.js before relying
// on it - it is a server-side DECISION, not a write gate.
router.post('/listing-laundry-assignment', listingLaundryAssignment);
router.get('/laundry-orders', laundryOrders);

// A laundry's OWN address, and only the address - the rest of the studio profile
// still saves straight from the browser. Gated on an admin-granted
// `metadata.addressChangeAllowed` once an address exists, and propagates the change
// to every listing assigned to that studio. Read the header of
// server/api/laundry-address.js before relying on the gate: the address stays in
// owner-writable `publicData`, so this gates OUR path, not every path.
router.post('/laundry-address', laundryAddress);

// The assigned laundry's CURRENT initial-cleaning turnaround for one listing, as a
// single integer. PUBLIC and rate limited - ListingPage is public, and the customer who
// needs the number has no session yet. Read the header of
// server/api/listing-initial-cleaning.js before widening the response: the same laundry
// privateData blob holds per-category cleaning fees, which must never reach the browser.
router.get('/listing-initial-cleaning', listingInitialCleaning);

// Renders the handover QR for a transaction as a PNG, for a plain <img src>.
// Unauthenticated by design - it echoes back only the transaction id it was
// given. See the header of server/api/transaction-qr.js before changing that.
router.get('/transaction-qr', transactionQr);

// What a scanned handover QR resolves to. Authenticated, and answers only the three roles
// that have business with the garment - the assigned laundry (which alone gets an action),
// the customer and the provider. The laundry is not a party to the transaction, so it cannot
// read it through the Marketplace API at all; see the header of
// server/api/handover-status.js.
router.get('/handover-status', handoverStatus);

// The pickup QR: a provider pauses a listing to collect a garment sitting at the laundry
// with no active rental. Owner-only (mints a real credential, the pickup token - see the
// header of server/api/listing-pickup-qr.js for why that differs from the transaction QR
// above, which is deliberately unauthenticated).
router.get('/listing-pickup-qr', listingPickupQr);
// What a scanned pickup QR resolves to - both the owner and the assigned laundry may read
// it, only the laundry ever gets canConfirm. See server/api/listing-pickup-status.js.
router.get('/listing-pickup-status', listingPickupStatus);
// The confirm action a scanned pickup QR's page fires. A second, token-gated door onto the
// SAME hand-back write listing-custody-status.js performs - see
// server/api/listing-pickup-confirm.js for why both doors exist rather than one replacing
// the other.
router.post('/listing-pickup-confirm', listingPickupConfirm);

//
router.post('/lender-new-request', lenderNewRequest);

// Accept a paid booking on the operator's behalf when the garment is already at its laundry -
// there is nobody to wait for. Uses `transition/operator-accept`, which the process has always
// had; no EDN change was needed. Does nothing, loudly, for a garment that is not at its studio.
// See the header of server/api/auto-accept-booking.js.
router.post('/auto-accept-booking', autoAcceptBooking);

// Applies the `metadata.isLaundry = false` default to the CALLING user, right
// after signup. Takes no request parameters at all - the target is the
// caller's own session and the value is hard-coded. See
// server/api/init-user-role.js.
router.post('/init-user-role', initUserRole);

// Public, unauthenticated: laundry-partner applications from PartnerLandingPage.
// The handler never builds a Marketplace or Integration API SDK, so it cannot touch
// marketplace data. See server/api/laundry-partner-application.js.
router.post('/laundry-partner-application', laundryPartnerApplication);

// Public, unauthenticated: the landing page's email-list signup form (the `invite` section).
// Same shape as laundry-partner-application above, own rate limiter, own delivery channel.
// See server/api/email-signup.js.
router.post('/email-signup', emailSignup);

// Create user with identity provider (e.g. Facebook or Google)
// This endpoint is called to create a new user after user has confirmed
// they want to continue with the data fetched from IdP (e.g. name and email)
router.post('/auth/create-user-with-idp', createUserWithIdp);

// Facebook authentication endpoints

// This endpoint is called when user wants to initiate authenticaiton with Facebook
router.get('/auth/facebook', authenticateFacebook);

// This is the route for callback URL the user is redirected after authenticating
// with Facebook. In this route a Passport.js custom callback is used for calling
// loginWithIdp endpoint in Sharetribe Auth API to authenticate user to the marketplace
router.get('/auth/facebook/callback', authenticateFacebookCallback);

// Google authentication endpoints

// This endpoint is called when user wants to initiate authenticaiton with Google
router.get('/auth/google', authenticateGoogle);

// This is the route for callback URL the user is redirected after authenticating
// with Google. In this route a Passport.js custom callback is used for calling
// loginWithIdp endpoint in Sharetribe Auth API to authenticate user to the marketplace
router.get('/auth/google/callback', authenticateGoogleCallback);

module.exports = router;
