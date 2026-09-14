/**
 * Validation, normalization and delivery for the landing page's public email-list signup.
 *
 * Backs `server/api/email-signup.js`, the second unauthenticated write-ish endpoint in the
 * app (the first is `laundry-partner-application.js`, which this module deliberately mirrors
 * in shape). Same conservative posture:
 *
 * - Never touches the Marketplace API or the Integration API. It cannot create, read or
 *   mutate a single marketplace record — a signup is an inert blob of text until a human (or
 *   a mailing-list tool downstream of the webhook) reads it.
 * - Only the fields listed in `FIELD_SPECS`, plus `consent`, are read off the request body.
 *   Unknown keys are dropped.
 * - Every string field has a hard length cap, mirrored on the client
 *   (`EmailSignupForm.js`'s `MAX_LENGTHS`).
 *
 * THIS IS SEPARATE, PARALLEL INFRASTRUCTURE FROM `laundryPartnerApplication.js` — different
 * fields (name/email/zip vs the laundry's business details), different destination env vars,
 * different section of the site (the landing page's `invite` section vs
 * `/p/become-a-partner`). Do not merge the two; a laundry application and a marketing signup
 * are different kinds of submission with different consumers on the other end.
 */

const log = require('../log');
const { sendMail } = require('./mailgun');

// Deliberately loose: this is a spam/length guard, not an address book. Real
// verification happens when a human (or the mailing-list tool on the other end of the
// webhook) reads the signup.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Zip/postal codes vary by country - Cocloset's launch cities are not fixed yet (see the
// landing page's own "coming soon to a city near you" copy), so this is intentionally not a
// US-only 5-digit pattern. It accepts alphanumeric codes with spaces/dashes (covers US ZIP,
// ZIP+4, and Canadian/UK-style postal codes) and simply bounds the length.
const ZIP_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\- ]{1,10}$/;

const FIELD_SPECS = {
  name: { required: true, maxLength: 120 },
  email: { required: true, maxLength: 160, pattern: EMAIL_PATTERN },
  zipCode: { required: true, maxLength: 12, pattern: ZIP_PATTERN },
};

/**
 * Name of the hidden honeypot input rendered by EmailSignupForm. This form has no
 * `website` field of its own (unlike the laundry-partner application, where `website`
 * became a real field and the trap had to move to `homepage`), so `website` is free to use
 * here and reads as plausibly-real to a bot filling every input it can find. Must stay in
 * sync with the client's own `HONEYPOT_FIELD` in `EmailSignupForm.js`.
 */
const HONEYPOT_FIELD = 'website';

const invalid = message => ({ valid: false, error: message });

/**
 * Validate and normalize an email-list signup submitted by an anonymous visitor.
 *
 * @param {Object} body raw request body (may be undefined)
 * @returns {Object} `{ valid: true, signup }`, `{ valid: true, isSpam: true }` when the
 *   honeypot was filled, or `{ valid: false, error }` with a human-readable message.
 */
const validateSignup = body => {
  const source = body && typeof body === 'object' ? body : {};

  // Honeypot: report success to the client but never deliver.
  const honeypotValue = source[HONEYPOT_FIELD];
  if (typeof honeypotValue === 'string' && honeypotValue.trim() !== '') {
    return { valid: true, isSpam: true };
  }

  const signup = {};

  for (const [name, spec] of Object.entries(FIELD_SPECS)) {
    const rawValue = source[name];

    if (rawValue == null || rawValue === '') {
      if (spec.required) {
        return invalid(`Missing required "${name}" in request body.`);
      }
      continue;
    }
    if (typeof rawValue !== 'string') {
      return invalid(`Invalid "${name}" in request body: expected a string.`);
    }

    const value = rawValue.trim();

    if (value === '') {
      if (spec.required) {
        return invalid(`Missing required "${name}" in request body.`);
      }
      continue;
    }
    if (value.length > spec.maxLength) {
      return invalid(`Invalid "${name}" in request body: max length is ${spec.maxLength}.`);
    }
    if (spec.pattern && !spec.pattern.test(value)) {
      return invalid(`Invalid "${name}" in request body.`);
    }

    signup[name] = value;
  }

  // Consent is a legal opt-in checkbox, not free text - it must be exactly `true`, not merely
  // truthy ("yes"/1/"on" are not what the checkbox sends, and accepting them would accept a
  // typo'd client payload as consent).
  if (source.consent !== true) {
    return invalid('Missing required "consent" in request body.');
  }
  signup.consent = true;

  return { valid: true, signup };
};

// Human-readable labels for the notification email, in the order an operator would read them.
const EMAIL_FIELD_LABELS = [['name', 'Name'], ['email', 'Email'], ['zipCode', 'Zip code']];

const escapeHtml = value =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Inline styles, not a <style> block - see the identical note in laundryPartnerApplication.js;
// this is a work email read in Gmail/Outlook, not a designed page.
const TABLE_STYLE =
  'border-collapse:collapse;width:100%;max-width:640px;font-family:Arial,Helvetica,sans-serif;font-size:14px;';
const LABEL_CELL_STYLE =
  'border:1px solid #ddd;padding:8px 12px;text-align:left;vertical-align:top;background:#f7f4ef;font-weight:bold;white-space:nowrap;';
const VALUE_CELL_STYLE =
  'border:1px solid #ddd;padding:8px 12px;text-align:left;vertical-align:top;';

// The signup is written by an anonymous member of the public, so every value here is
// untrusted input landing in an operator's inbox - escape it for the HTML part.
const buildSignupEmail = signup => {
  const rows = EMAIL_FIELD_LABELS.filter(([key]) => {
    const value = signup[key];
    return value != null && value !== '';
  }).map(([key, label]) => [label, String(signup[key])]);

  const subject = `Cocloset: new landing page signup — ${signup.name || signup.email || 'unnamed'}`;

  const text = [
    'A new landing page email-list signup was submitted.',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
  ].join('\n');

  const html = [
    '<p>A new landing page email-list signup was submitted.</p>',
    `<table role="presentation" cellpadding="0" cellspacing="0" style="${TABLE_STYLE}">`,
    '<tbody>',
    ...rows.map(
      ([label, value]) =>
        `<tr><th scope="row" style="${LABEL_CELL_STYLE}">${escapeHtml(label)}</th>` +
        `<td style="${VALUE_CELL_STYLE}">${escapeHtml(value)}</td></tr>`
    ),
    '</tbody>',
    '</table>',
  ].join('');

  return { subject, text, html };
};

/**
 * Deliver a validated signup.
 *
 * Sinks, in order - same pattern and same guarantees as `laundryPartnerApplication.js`'s
 * `deliverApplication`:
 *
 *   1. A structured stdout line prefixed with `[email-signup]`.
 *   2. An email to `SERVER_EMAIL_SIGNUP_EMAIL` via Mailgun (skipped silently when unset).
 *   3. An optional outbound webhook (`SERVER_EMAIL_SIGNUP_WEBHOOK_URL`) - the natural home for
 *      this one is a mailing-list tool's catch hook (Mailchimp/Zapier/etc.), not a human inbox,
 *      since a launch waitlist is expected to grow past what anyone reads by hand.
 *
 * Never rejects - a delivery problem must not turn into an error page for someone who just
 * asked to be notified when Cocloset reaches their city.
 *
 * @param {Object} signup validated signup from `validateSignup`
 * @returns {Promise<Object>} delivery outcome per sink
 */
const deliverSignup = signup => {
  const webhookUrl = process.env.SERVER_EMAIL_SIGNUP_WEBHOOK_URL;
  const recipient = process.env.SERVER_EMAIL_SIGNUP_EMAIL;
  const record = { receivedAt: new Date().toISOString(), signup };

  // Sink 1 - always, and always first, so a delivery outage cannot lose the submission.
  console.log(`[email-signup] ${JSON.stringify(record)}`);

  // Sink 2 - email to the operator.
  const emailPromise = !recipient
    ? Promise.resolve({ configured: false, delivered: false, reason: 'no-recipient' })
    : sendMail({ to: recipient, ...buildSignupEmail(signup) }).then(result => {
        if (!result.sent && result.reason !== 'not-configured') {
          log.error(result.error || new Error(`Mailgun did not send: ${result.reason}`), 'email-signup-email-failed', {
            record,
          });
        }
        return { configured: true, delivered: !!result.sent, reason: result.reason };
      });

  // Sink 3 - optional webhook.
  const webhookPromise = !webhookUrl
    ? Promise.resolve({ configured: false, delivered: false })
    : fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
        signal: AbortSignal.timeout(10000),
      })
        .then(response => {
          if (!response.ok) {
            const error = new Error(`Email signup webhook responded with ${response.status}.`);
            error.status = response.status;
            throw error;
          }
          return { configured: true, delivered: true };
        })
        .catch(e => {
          log.error(e, 'email-signup-delivery-failed', { record });
          return { configured: true, delivered: false };
        });

  return Promise.all([emailPromise, webhookPromise]).then(([email, webhook]) => {
    if (!email.configured && !webhook.configured) {
      console.warn(
        '[email-signup] Neither SERVER_EMAIL_SIGNUP_EMAIL nor SERVER_EMAIL_SIGNUP_WEBHOOK_URL ' +
          'is set. The signup above exists only in this log stream - configure one so signups ' +
          'reach a mailing list.'
      );
    }
    return {
      loggedToStdout: true,
      emailConfigured: email.configured,
      emailDelivered: email.delivered,
      webhookConfigured: webhook.configured,
      webhookDelivered: webhook.delivered,
    };
  });
};

module.exports = {
  validateSignup,
  deliverSignup,
  FIELD_SPECS,
  HONEYPOT_FIELD,
};
