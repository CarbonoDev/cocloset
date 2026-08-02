// Minimal Mailgun transport for the notifications Sharetribe cannot send.
//
// WHY THIS EXISTS:
// Sharetribe's process notifications can only be addressed to
// `:actor.role/customer` or `:actor.role/provider` - verified across every
// stock `ext/transaction-processes/*/process.edn` (all 130 `:to` values are
// one of those two, no exceptions). The Laundry Shop is a third party: it is
// neither the customer nor the provider of the transaction, so a laundry can
// never receive a native Sharetribe notification under any process design.
// Project Overview §3.12 requires four laundry-facing notifications
// (New Incoming Garment, Pickup Scheduled, Return Scheduled, Cleaning
// Required), and "New Incoming Garment" is worse still - it fires when no
// transaction exists at all. Those need a sender of our own; this is it.
// The message bodies live in ./laundryNotifications.js, deliberately kept
// separate from this transport so each is testable on its own.
//
// THE CLIENT'S EXPLICIT REQUIREMENT (Jonathan, 2026-08-01):
// "agreguemos un servicio de mailgun, si la key de mailgun no esta
// establecida simplemente se ignora el envío" - when MAILGUN_API_KEY is not
// set, sending is *silently skipped*, not attempted and not an error. Local
// dev, CI and the test suite all run without Mailgun credentials and must
// neither break nor emit noise. Hence: no throw, no console output, and no
// HTTP call at all on the unconfigured path (see sendMail below).
//
// NEVER REJECTS:
// Every caller is a notification side-effect hanging off a transaction flow.
// A mail failure must never fail a booking, a status update or an availability
// write, so sendMail() always resolves with a result object describing what
// happened. Callers *may* inspect it; ignoring it entirely is safe.
//
// NO NEW DEPENDENCY:
// Mailgun's messages endpoint is a plain form-encoded HTTPS POST with Basic
// auth, so it is done with Node's built-in global `fetch` (package.json
// engines: node ^22.22.0 || >=24, where fetch is stable). `axios` is present
// in node_modules only as a transitive dependency - it is NOT in
// package.json's dependencies, so importing it here would be depending on
// someone else's dependency tree. AGENTS.md is also explicit: ask before
// importing a new library.

const log = require('../log');

// Mailgun's US region. EU-hosted domains must set MAILGUN_API_BASE_URL to
// https://api.eu.mailgun.net - sending an EU domain's mail at the US host
// fails with a 401 that looks exactly like a bad API key, so this is worth
// having as an explicit knob rather than a surprise.
const DEFAULT_API_BASE_URL = 'https://api.mailgun.net';

// A hung mail call must not hold an Express request (or an Integration API
// retry loop) open indefinitely. AbortSignal.timeout()'s internal timer is
// unref'd, so this does not keep the event loop - or a jest worker - alive.
const DEFAULT_TIMEOUT_MS = 10000;

// Deliberately strict-but-simple: no whitespace, no comma/semicolon (which
// would smuggle extra recipients into Mailgun's `to` field), exactly one `@`,
// and a domain with at least one dot. This is not RFC 5322 - it is a sanity
// gate so a malformed address fails here, cheaply and diagnosably, instead of
// as an opaque 400 from Mailgun.
const EMAIL_REGEXP = /^[^\s@<>,;]+@[^\s@<>,;.]+(\.[^\s@<>,;.]+)+$/;

const readConfig = () => ({
  apiKey: (process.env.MAILGUN_API_KEY || '').trim(),
  domain: (process.env.MAILGUN_DOMAIN || '').trim(),
  fromEmail: (process.env.MAILGUN_FROM_EMAIL || '').trim(),
  apiBaseUrl: (process.env.MAILGUN_API_BASE_URL || '').trim() || DEFAULT_API_BASE_URL,
});

/**
 * True when Mailgun has enough configuration to attempt a send.
 *
 * Only the API key and the sending domain are required: without the domain
 * there is no URL to POST to. MAILGUN_FROM_EMAIL is optional and falls back
 * to `no-reply@<MAILGUN_DOMAIN>`.
 *
 * Exported so a caller can branch *before* doing expensive work to assemble
 * a message it would only throw away.
 *
 * @returns {boolean}
 */
const isMailgunConfigured = () => {
  const { apiKey, domain } = readConfig();
  return !!apiKey && !!domain;
};

/**
 * Accepts either a bare address (`a@b.com`) or a display form
 * (`Studio Pigalle <a@b.com>`), returning the original trimmed string when the
 * address part is valid, or null when it is not.
 *
 * @param {*} value
 * @returns {string|null}
 */
const parseAddress = value => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const displayForm = trimmed.match(/^[^<>]*<([^<>]+)>$/);
  const address = displayForm ? displayForm[1].trim() : trimmed;
  return EMAIL_REGEXP.test(address) ? trimmed : null;
};

/**
 * Splits `to` (a string or an array of strings) into valid and invalid
 * addresses.
 *
 * @param {string|string[]} to
 * @returns {{valid: string[], invalid: *[]}}
 */
const partitionRecipients = to => {
  const candidates = Array.isArray(to) ? to : [to];
  return candidates.reduce(
    (acc, candidate) => {
      const parsed = parseAddress(candidate);
      return parsed
        ? { ...acc, valid: [...acc.valid, parsed] }
        : { ...acc, invalid: [...acc.invalid, candidate] };
    },
    { valid: [], invalid: [] }
  );
};

/**
 * Send one email through Mailgun.
 *
 * **This promise never rejects.** It resolves with a result object:
 *
 *   { sent: true,  id }                              - accepted by Mailgun
 *   { sent: false, reason: 'not-configured' }        - no MAILGUN_API_KEY; silently skipped
 *   { sent: false, reason: 'misconfigured', error }  - key set but MAILGUN_DOMAIN missing
 *   { sent: false, reason: 'invalid-recipient', error, invalid }
 *   { sent: false, reason: 'invalid-content', error }
 *   { sent: false, reason: 'error', error, status? } - network error or non-2xx from Mailgun
 *
 * The unconfigured path is checked FIRST, before any validation, so that a
 * credential-less environment produces exactly one outcome ('not-configured'),
 * makes zero HTTP calls, and writes nothing to stdout/stderr. Everything after
 * that check is only reachable when Mailgun is actually wired up, which is
 * also the only situation in which a failure is an operational problem worth
 * logging loudly.
 *
 * @param {Object} params
 * @param {string|string[]} params.to - recipient address(es), bare or `Name <a@b.com>`
 * @param {string} params.subject
 * @param {string} [params.text] - plain-text body (at least one of text/html required)
 * @param {string} [params.html] - HTML body
 * @param {string} [params.from] - overrides MAILGUN_FROM_EMAIL
 * @param {number} [params.timeoutMs]
 * @returns {Promise<Object>} always resolves
 */
const sendMail = async ({ to, subject, text, html, from, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  try {
    const { apiKey, domain, fromEmail, apiBaseUrl } = readConfig();

    // ---- The client's requirement, first and cheapest ----------------------
    // No key => do nothing, tell nobody, touch no network. devLogger is used
    // rather than console.log on purpose: it prints only when
    // REACT_APP_ENV === 'development' AND VERBOSE === 'true' (see
    // server/log.js), so a developer who wants to know why no mail arrived can
    // opt in, while `yarn test` / `yarn test-server` / CI - which may call this
    // hundreds of times - stay completely silent. A bare console.log here
    // would turn every unconfigured send into test-suite noise.
    if (!apiKey) {
      log.devLogger('[mailgun] MAILGUN_API_KEY is not set - skipping email send.');
      return { sent: false, reason: 'not-configured' };
    }

    // Key set but no domain is a half-finished deployment, not the documented
    // "just skip it" case. Nothing can be sent, but somebody has to find out,
    // so this one IS logged.
    if (!domain) {
      const error = new Error('MAILGUN_API_KEY is set but MAILGUN_DOMAIN is missing.');
      log.error(error, 'mailgun-misconfigured', {});
      return { sent: false, reason: 'misconfigured', error };
    }

    const sender = parseAddress(from) || parseAddress(fromEmail) || `no-reply@${domain}`;

    const { valid: recipients, invalid } = partitionRecipients(to);
    if (invalid.length > 0 || recipients.length === 0) {
      // All-or-nothing: a partially valid recipient list is a caller bug, and
      // silently dropping one recipient of a two-recipient notification is a
      // worse failure mode than not sending at all.
      const error = new Error(
        `Refusing to send: ${invalid.length || 'no'} malformed recipient address(es).`
      );
      log.error(error, 'mailgun-invalid-recipient', { invalid });
      return { sent: false, reason: 'invalid-recipient', error, invalid };
    }

    const hasSubject = typeof subject === 'string' && subject.trim().length > 0;
    const hasBody =
      (typeof text === 'string' && text.length > 0) ||
      (typeof html === 'string' && html.length > 0);
    if (!hasSubject || !hasBody) {
      const error = new Error('Refusing to send: an email needs a subject and a text/html body.');
      log.error(error, 'mailgun-invalid-content', { hasSubject, hasBody });
      return { sent: false, reason: 'invalid-content', error };
    }

    // Mailgun's messages endpoint takes form-encoded fields; repeating `to`
    // is how multiple recipients are expressed. URLSearchParams as a fetch
    // body sets Content-Type: application/x-www-form-urlencoded for us.
    const form = new URLSearchParams();
    form.append('from', sender);
    recipients.forEach(recipient => form.append('to', recipient));
    form.append('subject', subject);
    if (typeof text === 'string' && text.length > 0) {
      form.append('text', text);
    }
    if (typeof html === 'string' && html.length > 0) {
      form.append('html', html);
    }

    const url = `${apiBaseUrl}/v3/${encodeURIComponent(domain)}/messages`;
    const authorization = `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: authorization },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      // Read the body for diagnostics - Mailgun explains 400s in it ("domain
      // not found", "not a valid address") - but never log the API key.
      const body = await response.text().catch(() => '');
      const error = new Error(`Mailgun rejected the message: HTTP ${response.status}.`);
      log.error(error, 'mailgun-send-failed', {
        status: response.status,
        recipients,
        subject,
        body: typeof body === 'string' ? body.slice(0, 500) : '',
      });
      return { sent: false, reason: 'error', status: response.status, error };
    }

    const payload = await response.json().catch(() => ({}));
    return { sent: true, id: payload && payload.id ? payload.id : null };
  } catch (error) {
    // Network error, DNS failure, timeout abort, or anything unforeseen above.
    // Configured-and-failing is an operational problem: log it loudly, but
    // still resolve, because the caller is a booking flow.
    log.error(error, 'mailgun-send-failed', { subject });
    return { sent: false, reason: 'error', error };
  }
};

module.exports = {
  sendMail,
  isMailgunConfigured,
  parseAddress,
  DEFAULT_API_BASE_URL,
};
