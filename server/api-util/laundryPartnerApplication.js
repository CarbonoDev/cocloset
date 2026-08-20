/**
 * Validation, normalization and delivery for public laundry-partner applications.
 *
 * This module backs `server/api/laundry-partner-application.js`, which is the only
 * *unauthenticated* write-ish endpoint in the app. Everything here is deliberately
 * conservative:
 *
 * - The endpoint never touches the Marketplace API or the Integration API. It cannot
 *   create, read or mutate a single marketplace record. An application is an inert
 *   blob of text until a human reads it and creates the laundry account by hand.
 * - Only the fields listed in `FIELD_SPECS` are read off the request body. Unknown
 *   keys are dropped, so an attacker cannot use the endpoint to amplify arbitrary
 *   payloads into the configured webhook.
 * - Every string field has a hard length cap, mirrored on the client.
 *
 * Field names intentionally match `src/containers/LaundryProfilePage/LaundryProfileForm`
 * where they overlap (`studioName`, `businessHours`, `turnaroundDays`,
 * `acceptedCategories`) so an approved application maps onto a real laundry profile
 * without a translation layer. That parity is the reason turnaround is stated in DAYS
 * here: the profile field it maps onto is `privateData.turnaroundDays`, and an
 * application quoting hours would need an operator to convert it by hand — which is
 * exactly the sort of silent unit mismatch this codebase has none of.
 */

const log = require('../log');
const { sendMail } = require('./mailgun');

// Max days a laundry could plausibly claim as turnaround. A month is already
// implausible; beyond it the number is a typo, not a service.
const MAX_TURNAROUND_DAYS = 30;

// Comma-separated garment categories are split into an array, matching the
// convention already used by LaundryProfilePage.
const MAX_CATEGORIES = 20;
const MAX_CATEGORY_LENGTH = 60;

// Deliberately loose: this is a spam/length guard, not an address book. Real
// verification happens when a human reviews the application.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+\-()\s.]+$/;

const FIELD_SPECS = {
  studioName: { required: true, maxLength: 120 },
  contactName: { required: true, maxLength: 120 },
  email: { required: true, maxLength: 160, pattern: EMAIL_PATTERN },
  phone: { required: true, maxLength: 40, minLength: 5, pattern: PHONE_PATTERN },
  address: { required: true, maxLength: 300 },
  businessHours: { required: true, maxLength: 200 },
  acceptedCategories: { required: true, maxLength: 300 },
  notes: { required: false, maxLength: 2000 },
};

// Name of the hidden honeypot input rendered by PartnerApplicationForm. Humans
// never see it; naive bots fill every input they find.
const HONEYPOT_FIELD = 'website';

const invalid = message => ({ valid: false, error: message });

/**
 * Validate and normalize a laundry-partner application submitted by an anonymous visitor.
 *
 * @param {Object} body raw request body (may be undefined)
 * @returns {Object} `{ valid: true, application }`, `{ valid: true, isSpam: true }` when the
 *   honeypot was filled, or `{ valid: false, error }` with a human-readable message.
 */
const validateApplication = body => {
  const source = body && typeof body === 'object' ? body : {};

  // Honeypot: report success to the client but never deliver. Telling a bot that it
  // was detected only teaches it to stop filling the field.
  const honeypotValue = source[HONEYPOT_FIELD];
  if (typeof honeypotValue === 'string' && honeypotValue.trim() !== '') {
    return { valid: true, isSpam: true };
  }

  const application = {};

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
    if (spec.minLength && value.length < spec.minLength) {
      return invalid(`Invalid "${name}" in request body: min length is ${spec.minLength}.`);
    }
    if (spec.pattern && !spec.pattern.test(value)) {
      return invalid(`Invalid "${name}" in request body.`);
    }

    application[name] = value;
  }

  const turnaroundDays = Number(source.turnaroundDays);
  if (
    source.turnaroundDays == null ||
    source.turnaroundDays === '' ||
    !Number.isInteger(turnaroundDays) ||
    turnaroundDays < 1 ||
    turnaroundDays > MAX_TURNAROUND_DAYS
  ) {
    return invalid(
      `Missing or invalid "turnaroundDays" in request body. Must be a whole number of days between 1 and ${MAX_TURNAROUND_DAYS}.`
    );
  }
  application.turnaroundDays = turnaroundDays;

  // Same comma-separated-string -> array convention as LaundryProfilePage.
  const categories = application.acceptedCategories
    .split(',')
    .map(category => category.trim())
    .filter(category => category !== '');

  if (categories.length === 0) {
    return invalid('Missing required "acceptedCategories" in request body.');
  }
  if (categories.length > MAX_CATEGORIES) {
    return invalid(
      `Invalid "acceptedCategories" in request body: max ${MAX_CATEGORIES} categories.`
    );
  }
  if (categories.some(category => category.length > MAX_CATEGORY_LENGTH)) {
    return invalid(
      `Invalid "acceptedCategories" in request body: each category is limited to ${MAX_CATEGORY_LENGTH} characters.`
    );
  }
  application.acceptedCategories = categories;

  return { valid: true, application };
};

// Human-readable labels for the notification email, in the order an operator would read
// them. Keyed by the validated application's own field names.
const EMAIL_FIELD_LABELS = [
  ['studioName', 'Studio name'],
  ['contactName', 'Contact name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['address', 'Address'],
  ['businessHours', 'Business hours'],
  ['acceptedCategories', 'Garments accepted'],
  ['turnaroundDays', 'Turnaround (days)'],
  ['notes', 'Notes'],
];

const escapeHtml = value =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Inline styles, not a <style> block: Gmail strips <head> entirely and Outlook ignores most
// of what survives, so anything an operator is meant to actually see has to travel on the
// element. Kept to borders and padding for the same reason — this is a work email, and the
// table is here to be scanned, not designed.
const TABLE_STYLE =
  'border-collapse:collapse;width:100%;max-width:640px;font-family:Arial,Helvetica,sans-serif;font-size:14px;';
const LABEL_CELL_STYLE =
  'border:1px solid #ddd;padding:8px 12px;text-align:left;vertical-align:top;background:#f7f4ef;font-weight:bold;white-space:nowrap;';
const VALUE_CELL_STYLE =
  'border:1px solid #ddd;padding:8px 12px;text-align:left;vertical-align:top;';

// The application is written by an anonymous member of the public, so every value here is
// untrusted input landing in an operator's inbox — escape it for the HTML part.
const buildApplicationEmail = application => {
  const rows = EMAIL_FIELD_LABELS.filter(([key]) => {
    const value = application[key];
    return Array.isArray(value) ? value.length > 0 : value != null && value !== '';
  }).map(([key, label]) => {
    const raw = application[key];
    return [label, Array.isArray(raw) ? raw.join(', ') : String(raw)];
  });

  const subject = `Cocloset: new laundry partner application — ${application.studioName ||
    application.contactName ||
    'unnamed'}`;

  const text = [
    'A new laundry partner application was submitted.',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'Reply directly to the applicant at the email address above.',
  ].join('\n');

  // A table rather than the bullet list this used to be: an operator reading these compares
  // one application against the next, and a two-column grid lines the labels up so the eye can
  // run down them. Every field the applicant filled in is a row — `rows` is built from
  // EMAIL_FIELD_LABELS, which covers the whole of FIELD_SPECS plus turnaround, so adding a
  // field to the form and forgetting it here is the one way a value could go missing.
  const html = [
    '<p>A new laundry partner application was submitted.</p>',
    `<table role="presentation" cellpadding="0" cellspacing="0" style="${TABLE_STYLE}">`,
    '<tbody>',
    ...rows.map(
      ([label, value]) =>
        `<tr><th scope="row" style="${LABEL_CELL_STYLE}">${escapeHtml(label)}</th>` +
        `<td style="${VALUE_CELL_STYLE}">${escapeHtml(value)}</td></tr>`
    ),
    '</tbody>',
    '</table>',
    '<p>Reply directly to the applicant at the email address above.</p>',
  ].join('');

  return { subject, text, html };
};

/**
 * Deliver a validated application.
 *
 * Sinks, in order:
 *
 *   1. A structured stdout line prefixed with `[laundry-partner-application]`. On Railway
 *      this is retained in the platform log stream and is greppable. It is the baseline
 *      guarantee that an application is never simply discarded, and it runs first so that
 *      no downstream outage can lose a submission.
 *   2. An email to `SERVER_LAUNDRY_PARTNER_APPLICATION_EMAIL` via Mailgun. This is the
 *      intended destination — an operator reads applications in their inbox. Skipped
 *      silently when either that address or the Mailgun credentials are unset, which is
 *      what keeps local development and CI working without credentials.
 *   3. An optional outbound webhook (`SERVER_LAUNDRY_PARTNER_APPLICATION_WEBHOOK_URL`) — a
 *      Slack incoming webhook, a Zapier/Make catch hook, anything accepting a JSON POST.
 *      The URL comes from the environment, never from the request, so this is not an SSRF
 *      vector. Retained alongside email for operators who would rather route applications
 *      into an existing tool.
 *
 * A failure in either delivery channel is escalated through `log.error`, carrying the full
 * application so it reaches Sentry as extras when a DSN is set — an outage still leaves a
 * durable, alertable copy rather than a silently dropped applicant.
 *
 * Never rejects: a delivery problem must not turn into an error page for someone who just
 * filled in a form correctly.
 *
 * @param {Object} application validated application from `validateApplication`
 * @returns {Promise<Object>} delivery outcome per sink
 */
const deliverApplication = application => {
  const webhookUrl = process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_WEBHOOK_URL;
  const recipient = process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_EMAIL;
  const record = { receivedAt: new Date().toISOString(), application };

  // Sink 1 — always, and always first, so a delivery outage cannot lose the submission.
  console.log(`[laundry-partner-application] ${JSON.stringify(record)}`);

  // Sink 2 — email to the operator.
  const emailPromise = !recipient
    ? Promise.resolve({ configured: false, delivered: false, reason: 'no-recipient' })
    : sendMail({ to: recipient, ...buildApplicationEmail(application) }).then(result => {
        if (!result.sent && result.reason !== 'not-configured') {
          log.error(
            result.error || new Error(`Mailgun did not send: ${result.reason}`),
            'laundry-partner-application-email-failed',
            { record }
          );
        }
        return {
          configured: true,
          delivered: !!result.sent,
          reason: result.reason,
        };
      });

  // Sink 3 — optional webhook.
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
            const error = new Error(
              `Laundry partner application webhook responded with ${response.status}.`
            );
            error.status = response.status;
            throw error;
          }
          return { configured: true, delivered: true };
        })
        .catch(e => {
          log.error(e, 'laundry-partner-application-delivery-failed', { record });
          return { configured: true, delivered: false };
        });

  return Promise.all([emailPromise, webhookPromise]).then(([email, webhook]) => {
    if (!email.configured && !webhook.configured) {
      console.warn(
        '[laundry-partner-application] Neither SERVER_LAUNDRY_PARTNER_APPLICATION_EMAIL nor ' +
          'SERVER_LAUNDRY_PARTNER_APPLICATION_WEBHOOK_URL is set. The application above exists ' +
          'only in this log stream — configure one so applications reach a human.'
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
  validateApplication,
  deliverApplication,
  FIELD_SPECS,
  HONEYPOT_FIELD,
  MAX_TURNAROUND_DAYS,
  MAX_CATEGORIES,
  MAX_CATEGORY_LENGTH,
};
