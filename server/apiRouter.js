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
const laundries = require('./api/laundries');
const createAvailabilityBuffer = require('./api/create-availability-buffer');
const laundryTransactionStatus = require('./api/laundry-transaction-status');
const listingReadinessStatus = require('./api/listing-readiness-status');
const listingCustodyStatus = require('./api/listing-custody-status');
const listingLaundryAssignment = require('./api/listing-laundry-assignment');
const laundryOrders = require('./api/laundry-orders');
const transactionQr = require('./api/transaction-qr');
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
router.post('/create-availability-buffer', createAvailabilityBuffer);
router.post('/laundry-transaction-status', laundryTransactionStatus);
router.post('/listing-readiness-status', listingReadinessStatus);
// Garment custody (`listing.metadata.onLaundry`) - writable by the assigned
// laundry OR the listing's owner, and only while the listing has no active
// transaction. See server/api/listing-custody-status.js.
router.post('/listing-custody-status', listingCustodyStatus);
// The assigned-laundry guard: may this owner change the listing's laundry right
// now? Read the header of server/api/listing-laundry-assignment.js before relying
// on it - it is a server-side DECISION, not a write gate.
router.post('/listing-laundry-assignment', listingLaundryAssignment);
router.get('/laundry-orders', laundryOrders);

// Renders the handover QR for a transaction as a PNG, for a plain <img src>.
// Unauthenticated by design - it echoes back only the transaction id it was
// given. See the header of server/api/transaction-qr.js before changing that.
router.get('/transaction-qr', transactionQr);

// Applies the `metadata.isLaundry = false` default to the CALLING user, right
// after signup. Takes no request parameters at all - the target is the
// caller's own session and the value is hard-coded. See
// server/api/init-user-role.js.
router.post('/init-user-role', initUserRole);

// Public, unauthenticated: laundry-partner applications from PartnerLandingPage.
// The handler never builds a Marketplace or Integration API SDK, so it cannot touch
// marketplace data. See server/api/laundry-partner-application.js.
router.post('/laundry-partner-application', laundryPartnerApplication);

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
