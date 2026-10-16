// These helpers are calling this template's own server-side routes
// so, they are not directly calling Marketplace API or Integration API.
// You can find these api endpoints from 'server/api/...' directory

import appSettings from '../config/settings';
import { types as sdkTypes, transit } from './sdkLoader';
import Decimal from 'decimal.js';

export const apiBaseUrl = marketplaceRootURL => {
  const port = process.env.REACT_APP_DEV_API_SERVER_PORT;
  const useDevApiServer = process.env.NODE_ENV === 'development' && !!port;

  // In development, the dev API server is running in a different port
  if (useDevApiServer) {
    return `http://localhost:${port}`;
  }

  // Otherwise, use the given marketplaceRootURL parameter or the same domain and port as the frontend
  return marketplaceRootURL ? marketplaceRootURL.replace(/\/$/, '') : `${window.location.origin}`;
};

// Application type handlers for JS SDK.
//
// NOTE: keep in sync with `typeHandlers` in `server/api-util/sdk.js`
export const typeHandlers = [
  // Use Decimal type instead of SDK's BigDecimal.
  {
    type: sdkTypes.BigDecimal,
    customType: Decimal,
    writer: v => new sdkTypes.BigDecimal(v.toString()),
    reader: v => new Decimal(v.value),
  },
];

const serialize = data => {
  return transit.write(data, { typeHandlers, verbose: appSettings.sdk.transitVerbose });
};

const deserialize = str => {
  return transit.read(str, { typeHandlers });
};

const methods = {
  POST: 'POST',
  GET: 'GET',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
};

// If server/api returns data from SDK, you should set Content-Type to 'application/transit+json'
const request = (path, options = {}) => {
  const url = `${apiBaseUrl()}${path}`;
  const { credentials, headers, body, ...rest } = options;

  // If headers are not set, we assume that the body should be serialized as transit format.
  const shouldSerializeBody =
    (!headers || headers['Content-Type'] === 'application/transit+json') && body;
  const bodyMaybe = shouldSerializeBody ? { body: serialize(body) } : {};

  const fetchOptions = {
    credentials: credentials || 'include',
    // Since server/api mostly talks to Marketplace API using SDK,
    // we default to 'application/transit+json' as content type (as SDK uses transit).
    headers: headers || { 'Content-Type': 'application/transit+json' },
    ...bodyMaybe,
    ...rest,
  };

  return window.fetch(url, fetchOptions).then(res => {
    const contentTypeHeader = res.headers.get('Content-Type');
    const contentType = contentTypeHeader ? contentTypeHeader.split(';')[0] : null;

    if (res.status >= 400) {
      return res.json().then(data => {
        let e = new Error();
        e = Object.assign(e, data);

        throw e;
      });
    }
    if (contentType === 'application/transit+json') {
      return res.text().then(deserialize);
    } else if (contentType === 'application/json') {
      return res.json();
    }
    return res.text();
  });
};

// Keep the previous parameter order for the post method.
// For now, only POST has own specific function, but you can create more or use request directly.
const post = (path, body, options = {}) => {
  const requestOptions = {
    ...options,
    method: methods.POST,
    body,
  };

  return request(path, requestOptions);
};

// Fetch transaction line items from the local API endpoint.
//
// See `server/api/transaction-line-items.js` to see what data should
// be sent in the body.
export const transactionLineItems = body => {
  return post('/api/transaction-line-items', body);
};

// Initiate a privileged transaction.
//
// With privileged transitions, the transactions need to be created
// from the backend. This endpoint enables sending the order data to
// the local backend, and passing that to the Marketplace API.
//
// See `server/api/initiate-privileged.js` to see what data should be
// sent in the body.
export const initiatePrivileged = body => {
  return post('/api/initiate-privileged', body);
};

// Transition a transaction with a privileged transition.
//
// This is similar to the `initiatePrivileged` above. It will use the
// backend for the transition. The backend endpoint will add the
// payment line items to the transition params.
//
// See `server/api/transition-privileged.js` to see what data should
// be sent in the body.
export const transitionPrivileged = body => {
  return post('/api/transition-privileged', body);
};

// Create user with identity provider (e.g. Facebook or Google)
//
// If loginWithIdp api call fails and user can't authenticate to Marketplace API with idp
// we will show option to create a new user with idp.
// For that user needs to confirm data fetched from the idp.
// After the confirmation, this endpoint is called to create a new user with confirmed data.
//
// See `server/api/auth/createUserWithIdp.js` to see what data should
// be sent in the body.
export const createUserWithIdp = body => {
  return post('/api/auth/create-user-with-idp', body);
};

// Check if user can be deleted and then delete the user. Endpoint logic
// must be modified to accommodate the transaction processes used in
// the marketplace.
export const deleteUserAccount = body => {
  return post('/api/delete-account', body);
};

// Submit a laundry-partner application from the public PartnerLandingPage.
//
// This endpoint is unauthenticated on purpose — prospective partners do not have an
// account yet. It is also deliberately inert: the server only validates, length-caps
// and forwards the application, it never touches marketplace data.
//
// See `server/api/laundry-partner-application.js` for the accepted fields and limits.
export const submitLaundryPartnerApplication = body => {
  return post('/api/laundry-partner-application', body);
};

// The landing page's email-list signup ("CoCloset is coming soon to a city near you", the
// `invite` section). Separate, parallel endpoint from the laundry-partner application above -
// different fields, different destination. See server/api/email-signup.js for the accepted
// fields and limits.
export const submitEmailSignup = body => {
  return post('/api/email-signup', body);
};

// The laundries as a PUBLIC name/id list, for the search page's pickup filter.
//
// A DIFFERENT ENDPOINT from `fetchLaundries` below, not the same one without a session.
// That one carries each studio's address, coordinates, hours and turnaround for the listing
// wizard; this one is two strings for a dropdown, and the search page is public. See the
// header of server/api/laundry-options.js.
//
// Returns `{ data: [ { id, name } ] }`, sorted by name.
export const fetchLaundryOptions = () => {
  return request('/api/laundry-options', { method: methods.GET });
};

// The brands that exist on published listings, for the brand filter and the wizard's brand
// autocomplete.
//
// Brand is NOT a Console listing field - it was removed so the `pub_brand` search schema could
// be set by CLI, which is what makes exact-match filtering possible at all (a Console `text`
// field only feeds `keywords`, which also matches title and description). So the values have to
// come from the listings themselves; see the header of server/api/brands.js.
//
// Returns `{ data: [ { brand, count } ], meta: { truncated } }`, sorted by brand.
export const fetchBrands = () => {
  return request('/api/brands', { method: methods.GET });
};

// Fetch the list of laundries (users flagged with metadata.isLaundry), used by
// the listing wizard's "Laundry Assignment" step. Requires an authenticated
// caller.
//
// Returns `{ data: [ { id, displayName, studioName, address, origin,
// businessHours, acceptedCategories, turnaroundDays,
// turnaroundDaysIsCategorySpecific } ], meta }` - a flat, explicitly allowlisted
// record per laundry, NOT the raw user publicData blob.
// Laundries with no usable address/origin are omitted (they can't be assigned:
// no geolocation would be written and the listing could never be published);
// `meta.incompleteProfileCount` says how many were dropped for that reason.
//
// `listingCategoryValues` is the category chain of the garment being assigned
// (categoryLevel1/2/3, general -> specific). It is optional. Passing it makes each
// card's `turnaroundDays` the value that laundry set for THAT garment's top-level
// category rather than a studio-wide average, with
// `turnaroundDaysIsCategorySpecific` telling the card which it got. The resolution
// deliberately happens server-side: the underlying table is the laundry's privateData,
// which no other user is entitled to read wholesale.
//
// See `server/api/laundries.js` for the full response shape and the reason the
// filtering happens server-side in JS rather than in the API query.
export const fetchLaundries = (listingCategoryValues = []) => {
  const categories = (Array.isArray(listingCategoryValues) ? listingCategoryValues : [])
    .filter(value => typeof value === 'string' && value !== '')
    .join(',');
  const query = categories ? `?categories=${encodeURIComponent(categories)}` : '';
  return request(`/api/laundries${query}`, { method: methods.GET });
};

// Best-effort call, fired after a booking's `accept` transition succeeds, to
// create the availability-exception "buffer window" (pickup/cleaning/return
// turnaround) around the booking's rental dates on the garment owner's
// listing. Uses the Integration API server-side since it needs to act on a
// listing regardless of which party (customer/operator) triggered `accept`.
//
// See `server/api/create-availability-buffer.js` for the request/response
// shape. Callers should treat failures here as non-fatal (see the call site
// in TransactionPage.duck.js) - the booking itself is not affected.
export const createAvailabilityBuffer = body => {
  return post('/api/create-availability-buffer', body);
};

// Advance a transaction through the laundry custody chain, e.g. after a
// laundry scans a QR code for pickup/return, or updates cleaning progress from
// the ops dashboard.
//
// This fires a REAL `cocloset-booking` process transition server-side (it used
// to write `transaction.metadata.laundryStatus` instead), so Sharetribe
// enforces the ordering: an out-of-order request comes back 409 rather than
// silently succeeding. `status` is the step to advance to - one of
// `LAUNDRY_ACTION_STATUSES` in `src/util/laundryStatuses.js` - and the server
// maps it to the right transition, which for `returned` depends on whether the
// garment is currently `picked-up` or `overdue`.
// Best-effort call, fired right after a successful email/password signup (once
// the follow-up login has authenticated the new user), to stamp the explicit
// `metadata.isLaundry = false` default onto them. An administrator flips it to
// `true` from Console; a user can never write their own metadata, so this has
// to be a server-side Integration API write.
//
// Takes NO arguments on purpose: the server derives the target user from the
// caller's own session and hard-codes the value, so there is nothing a client
// can influence. It is idempotent and will never overwrite an existing value
// (it cannot demote a user an admin has already promoted).
//
// Callers must treat failures as non-fatal - see the call site in
// src/ducks/auth.duck.js and `server/api/init-user-role.js` for the response
// shape. The IdP signup path does not need this: it is handled server-side in
// server/api/auth/createUserWithIdp.js.
export const initUserRole = () => {
  return post('/api/init-user-role', {});
};

// Advance a transaction's granular laundry sub-phase
// (`transaction.metadata.laundryStatus`), e.g. after a laundry scans a QR
// code for pickup/return, or updates cleaning progress from the ops
// dashboard. This is metadata layered on top of the existing, unmodified
// transaction process - NOT a real Sharetribe process transition. `status`
// must be one of the values exported as `LAUNDRY_STATUSES` in
// `server/api-util/laundryStatusHelpers.js`.
//
// See `server/api/laundry-transaction-status.js` for the full request/
// response shape, including the optional `damaged`/`damageNote` fields
// (only meaningful when `status === 'returned'`).
export const updateLaundryTransactionStatus = body => {
  return post('/api/laundry-transaction-status', body);
};

// Accept a paid booking on the operator's behalf when the garment is already at its laundry.
//
// The SERVER decides whether to: it reads the listing's `metadata.onLaundry`, which is
// Integration-API-only and therefore the only trustworthy copy. This call is a trigger, not an
// instruction - it carries no argument that changes the outcome, and it is idempotent, so a
// reload or a retry costs nothing.
//
// Returns `{ data: { accepted: true, ... } }`, or `{ data: null, reason }` when there was
// nothing to do (garment not at the studio, already accepted, not a cocloset booking).
// See `server/api/auto-accept-booking.js`.
export const autoAcceptBooking = body => {
  return post('/api/auto-accept-booking', body);
};

// The laundry-side effect of a customer's self-cancellation (`transition/customer-cancel`).
// That transition is not privileged and is already fired directly through the SDK by the
// generic transition thunk - this call is ONLY the Mailgun notification the EDN cannot send
// (Sharetribe's own notifications can address the customer or the provider, never a laundry).
// Fire-and-continue: see the call site in TransactionPage.duck.js, which never lets a failure
// here affect the cancellation that has already succeeded.
// See `server/api/customer-cancel-notify-laundry.js`.
export const customerCancelNotifyLaundry = body => {
  return post('/api/customer-cancel-notify-laundry', body);
};

// What a scanned handover QR resolves to: the next step at the laundry counter, who it is
// with, and whether THIS caller may confirm it.
//
// Authenticated, and answers only the assigned laundry, the customer and the provider. The
// laundry is not a party to the transaction in the Sharetribe sense, so it cannot read it
// through the SDK at all - which is why the scan page reads through our server rather than
// through `transactions.show`. See `server/api/handover-status.js`.
//
// Returns `{ data: { processState, viewerRole, canConfirm, step, listingTitle, ... } }`.
export const fetchHandoverStatus = transactionId => {
  return request(`/api/handover-status?transactionId=${encodeURIComponent(transactionId)}`, {
    method: methods.GET,
  });
};

// Update a listing's physical readiness state
// (`listing.metadata.readinessStatus`, `listing.privateData.currentRack`),
// independent of any specific booking - e.g. a garment just shipped in by
// its owner and sitting in laundry inventory.
//
// See `server/api/listing-readiness-status.js` for the full request/
// response shape and the `READINESS_STATUSES` enum.
export const updateListingReadinessStatus = body => {
  return post('/api/listing-readiness-status', body);
};

// Hand a garment over: set `listing.metadata.onLaundry` (true = the garment is
// physically at the laundry, false = it is back with its owner).
//
// Callable by EITHER the assigned laundry or the listing's owner, and only while
// the listing has no active transaction - a 409 comes back otherwise. See
// `server/api/listing-custody-status.js`, which explains why this is a separate
// endpoint from listing-readiness-status rather than a branch inside it.
//
// Body: { listingId, onLaundry }
// The studio taking a garment IN from its owner at the start of a rental: ticket, then the
// wash. Its own endpoint rather than a status on /api/laundry-transaction-status, because it
// fires no transition at all - the transaction stays `accepted` until the garment is ready.
// See server/api/laundry-receive-garment.js.
export const receiveGarmentAtLaundry = body => {
  return post('/api/laundry-receive-garment', body);
};

export const updateListingCustodyStatus = body => {
  return post('/api/listing-custody-status', body);
};

// What a scanned pickup QR resolves to: whose garment it is, and whether THIS caller may
// confirm the hand-back. Mirrors fetchHandoverStatus, with a token added - a pickup has no
// transaction to authorize against, so the token carried in the QR itself is part of the
// answer. See `server/api/listing-pickup-status.js`.
//
// Returns `{ data: { listingId, listingTitle, ownerName, onLaundry, viewerRole, tokenValid,
//   canConfirm } }`.
export const fetchListingPickupStatus = ({ listingId, token }) => {
  const params = new URLSearchParams({ id: listingId, token });
  return request(`/api/listing-pickup-status?${params.toString()}`, { method: methods.GET });
};

// The confirm action a scanned pickup QR's page fires. A second, token-gated door onto the
// same hand-back write updateListingCustodyStatus performs - see
// `server/api/listing-pickup-confirm.js` for why both doors exist.
//
// Body: { listingId, token }
export const confirmListingPickup = body => {
  return post('/api/listing-pickup-confirm', body);
};

// Assign a laundry to a listing. THIS IS THE WRITE, not a precondition check.
//
// `assignedLaundryId` lives in the listing's `metadata`, which the Marketplace API
// refuses to let an owner write (400 `validation-disallowed-key`), so the browser
// cannot do this itself - by design. The server validates that the caller owns the
// listing, that it has no active transaction, and that `metadata.onLaundry !== true`,
// then writes the id together with the four fields derived from the chosen laundry
// (`publicData.assignedLaundryName`, `publicData.pickupAddress`, the listing's
// top-level `geolocation`, and `metadata.initialCleaningDays` - the turnaround for
// this garment's FIRST wash, which is what stops the booking calendar offering
// tomorrow before the garment has ever reached a studio) in one Integration API call.
//
// So the wizard must NOT also write those fields through `ownListings.update()`.
// Read the header of `server/api/listing-laundry-assignment.js` before changing
// this call or what the panel does with its result.
//
// Rejects with 409 when the garment is at the laundry or a transaction is in
// flight, and 422 when the chosen laundry is unusable.
//
// Body: { listingId, assignedLaundryId }
export const assignListingLaundry = body => {
  return post('/api/listing-laundry-assignment', body);
};

// May a listing be paused right now? Session-gated (owner only), Integration-API-
// backed - see server/api/listing-pause-eligibility.js for why: the only thing
// worth checking (an active transaction) is a field the browser cannot read
// itself. `metadata.onLaundry` is NOT the right signal - it is true for most idle
// garments, since "stored at the laundry between rentals" is this marketplace's
// resting state.
//
// Rejects with 409 when a transaction is still active for this listing (or
// could not be verified) - callers should treat ANY rejection as "do not pause".
// On success, the actual pause still goes through the ordinary
// `sdk.ownListings.close()` call - this endpoint only answers the question, it
// does not perform the write.
//
// Body: { listingId }
export const checkListingPauseEligibility = body => {
  return post('/api/listing-pause-eligibility', body);
};

// Which of these listings have a genuinely active transaction right now? The bulk,
// UI-only twin of checkListingPauseEligibility above - for showing an "Active rental"
// badge (and hiding "Pause Listing") on every card on ManageListingsPage at once,
// rather than only finding out from a 409 after the provider clicks.
//
// NOT authoritative: a missing key in the response means "could not determine", not
// "not active" - treat both as "don't show the badge". The real gate a pause click is
// checked against is still checkListingPauseEligibility, every time.
//
// Returns `{ data: { active: { [listingId]: boolean } } }`.
export const fetchListingsActiveTransactions = listingIds => {
  const params = new URLSearchParams({ ids: listingIds.join(',') });
  return request(`/api/listings-active-transactions?${params.toString()}`, {
    method: methods.GET,
  });
};

// How many days must pass before this garment can be rented, according to its
// assigned laundry's CURRENT turnaround.
//
// `listing.metadata.initialCleaningDays` is only a snapshot from the moment the
// owner picked a laundry, so a studio that has since changed its turnaround is
// not reflected there. The live number cannot be resolved in the browser: it
// lives in the laundry USER's `privateData`, which no other user may read. Hence
// this endpoint.
//
// Returns `{ data: { initialCleaningDays } }`, or `{ data: {} }` when no block
// applies (the garment is already at its laundry, none is assigned, or the
// laundry's profile could not be read). Callers must treat a missing key and any
// failure as "use the `metadata.initialCleaningDays` snapshot" - see
// ListingPage.duck.js. Never as "no block".
//
// See `server/api/listing-initial-cleaning.js`. It is public and rate limited,
// and it returns one integer and nothing else: per-category cleaning FEES live in
// the same laundry privateData and must not reach the browser.
// Ask the server to give back the days a finished booking is still blocking. Fired on listing
// page load and deliberately not awaited: it is a cleanup, and a page that renders is worth
// more than a calendar that is right on this particular load rather than the next one.
// Ask the server to re-stamp this studio's name and address onto its garments. No arguments:
// the session is the studio, and the server writes what the profile already says. See
// server/api/laundry-listings-refresh.js.
export const refreshLaundryListings = () => {
  return post('/api/laundry-listings-refresh', {});
};

export const sweepListingAvailability = listingId => {
  return post('/api/listing-availability-sweep', { listingId });
};

export const fetchListingInitialCleaning = listingId => {
  return request(`/api/listing-initial-cleaning?listingId=${encodeURIComponent(listingId)}`, {
    method: methods.GET,
  });
};

// Fetch everything the laundry ops dashboard renders, for the calling laundry
// user: the design doc §8 union of "transactions on listings assigned to me"
// and "assigned listings with no transaction", plus a per-garment inventory
// list. Takes no arguments - the caller's own user id is the laundry filter,
// resolved server-side from their session.
//
// Rows come back already denormalized (customer/owner display names, listing
// image url, rack, statuses), so the dashboard renders them directly with no
// `included` resolution or follow-up lookups.
//
// See `server/api/laundry-orders.js` for the full response shape.
export const fetchLaundryOrders = () => {
  return request('/api/laundry-orders', { method: methods.GET });
};

// Save the CALLING laundry's own address, and propagate it to every listing
// assigned to that studio.
//
// A separate call from the rest of the studio profile on purpose: everything else on
// LaundryProfilePage still saves straight from the browser with
// `sdk.currentUser.updateProfile`, and only the address comes through our server.
// Two reasons, both server-side:
//   * the change is GATED. Once a studio has a usable address, changing it needs
//     `metadata.addressChangeAllowed === true`, which an admin grants and which a
//     user cannot write for themselves. Rejects 403 with `data.code`
//     'change-not-allowed' - switch the message on that code, never on statusText.
//   * it PROPAGATES. Every listing assigned to this studio has its
//     `publicData.pickupAddress`, `publicData.assignedLaundryName` and top-level
//     `geolocation` rewritten in the same request, which needs the Integration API.
//
// Takes NO laundry id - the target is the caller's own session.
//
// The address itself stays in owner-writable `publicData`, so this call is the
// sanctioned path, not the only possible one. Read the header of
// `server/api/laundry-address.js` before describing it as protected anywhere.
//
// Body: { address, origin: { lat, lng } }
export const updateLaundryAddress = body => {
  return post('/api/laundry-address', body);
};

// Tell the lender a customer has requested their garment, but only when the garment is NOT
// at a laundry (the server decides; when it is, auto-accept already handles the booking).
// A trigger, not an instruction: the body carries only the transaction id, and the server
// reads the recipient, garment, dates and amounts itself. Idempotent, so a retry costs nothing.
//
// Returns `{ data: { notified, reason? } }`. Callers must treat failures as non-fatal.
// See `server/api/lender-new-request.js`.
export const lenderNewRequest = body => {
  return post('/api/lender-new-request', body);
};

// Customer self-cancellation AFTER the garment has reached the laundry for its first wash
// (state/initial-cleaning) - cocloset-booking only. UNLIKE a plain transition, this is a
// multi-step server call (verify eligibility, compute the withheld cleaning fee, refund
// directly against Stripe, write an audit record, THEN fire the Sharetribe transition), so it
// is deliberately NOT routed through the generic transition thunk
// (TransactionPage.duck.js's makeTransitionThunk) - see partialRefundCancelThunk there, which
// calls this directly rather than dispatching a transition name through the SDK.
//
// Every response is a DEFINITIVE answer about what happened to the customer's money and the
// booking - there is no "fire and continue" here, because the client shows a non-dismissible
// loading state while this is in flight. Possible shapes of `data`:
//   - `{ refunded: true, cancelled: true, requiresManualFollowUp: false, refundAmount,
//      refundCurrency, transition, transaction }` - full success.
//   - `{ refunded: true, cancelled: false, requiresManualFollowUp: true, refundAmount,
//      refundCurrency }` - the refund succeeded but the Sharetribe transition failed; the
//      money moved, the booking has not yet been marked cancelled, and this needs a human or
//      a retry (which will resume safely rather than refunding twice).
//   - a non-2xx rejection with `error`/`reason` fields such as `not-eligible` (wrong state),
//     `no-payment-intent-on-record` (transaction predates the payment-intent ledger), or
//     `stripe-refund-failed` (Stripe itself rejected the refund - nothing moved).
// See `server/api/customer-partial-refund-cancel.js` for the authoritative list.
export const customerPartialRefundCancel = body => {
  return post('/api/customer-partial-refund-cancel', body);
};