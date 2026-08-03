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

// Fetch the list of laundries (users flagged with metadata.isLaundry), used by
// the listing wizard's "Laundry Assignment" step. Requires an authenticated
// caller.
//
// Returns `{ data: [ { id, displayName, studioName, address, origin,
// businessHours, acceptedCategories, turnaroundHours } ], meta }` - a flat,
// explicitly allowlisted record per laundry, NOT the raw user publicData blob.
// Laundries with no usable address/origin are omitted (they can't be assigned:
// no geolocation would be written and the listing could never be published);
// `meta.incompleteProfileCount` says how many were dropped for that reason.
//
// See `server/api/laundries.js` for the full response shape and the reason the
// filtering happens server-side in JS rather than in the API query.
export const fetchLaundries = () => {
  return request('/api/laundries', { method: methods.GET });
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
