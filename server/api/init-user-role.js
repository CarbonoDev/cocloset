const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { getSdk, handleError } = require('../api-util/sdk');
const { ensureLaundryRoleDefault } = require('../api-util/laundryRoleDefaults');
const log = require('../log');

// Same cookie key the SDK's own cookie stores derive (`st-<clientId>-token`), used only
// to tell a missing session apart from a rejected one when reporting a failure.
const CLIENT_ID = process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID;

// Gives the CALLING user an explicit `metadata.isLaundry = false`, if they
// don't have the key yet.
//
// Client requirement (Jonathan): "todos los usuarios se crean con
// isLaundry=false y es un administrador desde consola quien cambia esta
// propiedad a true". Today nothing writes the key, so a new user is
// `metadata: {}` and an operator has to know the key name to promote them.
//
// Signup itself (src/ducks/auth.duck.js `signupThunk`) calls
// `sdk.currentUser.create()` straight from the browser and never touches this
// server, and a user cannot write their own metadata anyway (verified:
// `400 validation-disallowed-key`), so the default has to be applied by a
// server-side Integration API write immediately after signup. This endpoint is
// that write. See server/api-util/laundryRoleDefaults.js for the read-first,
// never-demote rule.
//
// ---------------------------------------------------------------------------
// AUTHORIZATION - why this is not an escalation vector
// ---------------------------------------------------------------------------
// This endpoint writes user metadata with full-admin Integration API
// credentials, i.e. with the same power that grants the laundry role. Three
// properties keep it inert:
//
//   1. THE TARGET IS ALWAYS THE CALLER. The user id comes exclusively from the
//      caller's own cookie-scoped session (`getSdk(req, res).currentUser
//      .show()`, the caller-identity pattern used by
//      create-availability-buffer.js and api-util/laundryAuth.js). The request
//      body is never read - the handler does not reference `req.body` at all,
//      so there is no id, key or value a client can supply. Unauthenticated
//      callers get a 401 and no write happens.
//   2. THE VALUE IS ALWAYS `false`. `ensureLaundryRoleDefault` hard-codes both
//      the metadata key and the value; neither is a parameter anywhere in the
//      call chain. There is no request shape that makes this write `true`.
//   3. IT CANNOT DEMOTE. If the key already has a value the endpoint is a
//      no-op, so a user who has been promoted to laundry by an admin cannot
//      strip their own role (or have it stripped) by calling this repeatedly.
//
// The worst a hostile authenticated caller can do is spam a read plus, at
// most, one idempotent write of a value they already effectively have.
//
// ---------------------------------------------------------------------------
// Request body: none (any body is ignored).
// Success response (200): { data: { userId, isLaundry, updated, reason } }
//   - `{ updated: true,  reason: 'defaulted' }`   - the key was absent, `false` written.
//   - `{ updated: false, reason: 'already-set' }` - the key existed, untouched.
// Failure response: standard handleError() shape (see api-util/sdk.js).
//
// Callers must treat failures as non-fatal: a user left without the key still
// behaves exactly as a non-laundry everywhere (every consumer tests `=== true`),
// so the only cost is that an operator sees an absent key in Console. The
// client call site (src/ducks/auth.duck.js) is fire-and-continue for that
// reason, and scripts/backfill-laundry-role.js can repair any gaps in bulk.

module.exports = (req, res) => {
  const sdk = getSdk(req, res);

  // Identity comes from the session, never from the request. Note there is
  // deliberately no `req.body` read anywhere in this handler.
  const hasSessionCookie = !!req.cookies?.[`st-${CLIENT_ID}-token`];

  sdk.currentUser
    .show()
    .catch(e => {
      // Only a genuine 401 from the Marketplace API means "not signed in". Relabelling
      // every failure as an auth problem sends whoever is debugging this straight down
      // the wrong path — a proxy error, an unreachable API, or a malformed cookie all
      // look identical to a missing session, and the real cause never reaches the log.
      const isUnauthorized = e?.status === 401;

      if (!isUnauthorized) {
        log.error(e, 'init-user-role-currentuser-failed', {
          status: e?.status,
          // Distinguishes "the browser sent no session" from "the session was rejected",
          // which is the first thing you want to know and cannot otherwise tell apart.
          hasSessionCookie,
        });
        throw e;
      }

      const error = new Error(
        hasSessionCookie
          ? 'Session cookie was present but rejected by the Marketplace API.'
          : 'No session cookie reached the server. In development the app runs on a ' +
            'different port to the API server, so this usually means the request was ' +
            'sent without credentials, or REACT_APP_MARKETPLACE_ROOT_URL does not match ' +
            'the origin the browser is actually on (CORS is pinned to that value).'
      );
      error.status = 401;
      error.statusText = error.message;
      error.data = {};
      throw error;
    })
    .then(currentUserResponse => {
      const currentUserId = currentUserResponse?.data?.data?.id?.uuid;

      if (!currentUserId) {
        const error = new Error('Could not resolve the calling user.');
        error.status = 401;
        error.statusText = 'Could not resolve the calling user.';
        error.data = {};
        throw error;
      }

      // Read the CURRENT value through the Integration API rather than trusting
      // the currentUser payload we just fetched: this read is what protects an
      // already-promoted laundry from being demoted, so it is taken from the
      // authoritative source that also performs the write.
      return ensureLaundryRoleDefault(getIntegrationSdk(), currentUserId);
    })
    .then(result => {
      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: result })
        .end();
    })
    .catch(e => {
      // Client-side this call is fire-and-continue, so this log is the only
      // signal that users are being created without the flag.
      log.error(e, 'init-user-role-failed', { status: e?.status, message: e?.message });
      handleError(res, e);
    });
};
