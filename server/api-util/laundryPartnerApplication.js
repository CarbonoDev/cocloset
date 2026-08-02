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
 * where they overlap (`studioName`, `businessHours`, `turnaroundHours`,
 * `acceptedCategories`) so an approved application maps onto a real laundry profile
 * without a translation layer.
 */

const log = require('../log');

// Max hours a laundry could plausibly claim as turnaround (30 days).
const MAX_TURNAROUND_HOURS = 720;

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

  const turnaroundHours = Number(source.turnaroundHours);
  if (
    source.turnaroundHours == null ||
    source.turnaroundHours === '' ||
    !Number.isInteger(turnaroundHours) ||
    turnaroundHours < 1 ||
    turnaroundHours > MAX_TURNAROUND_HOURS
  ) {
    return invalid(
      `Missing or invalid "turnaroundHours" in request body. Must be a whole number of hours between 1 and ${MAX_TURNAROUND_HOURS}.`
    );
  }
  application.turnaroundHours = turnaroundHours;

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

/**
 * Deliver a validated application.
 *
 * WARNING — this marketplace has no CRM, no mail transport and no database of its own,
 * so there is no genuinely good destination for these yet. Until one is configured, the
 * sinks are, in order:
 *
 *   1. A structured stdout line prefixed with `[laundry-partner-application]`. On Railway
 *      this is retained in the platform log stream and is greppable. It is the baseline
 *      guarantee that an application is never simply discarded.
 *   2. An operator-configured outbound webhook (`SERVER_LAUNDRY_PARTNER_APPLICATION_WEBHOOK_URL`)
 *      — a Slack incoming webhook, a Zapier/Make catch hook, a form backend, anything that
 *      accepts a JSON POST. The URL comes from the environment, never from the request, so
 *      this is not an SSRF vector.
 *   3. If the webhook is configured but fails, the full application is escalated through
 *      `log.error`, which forwards it to Sentry as extras when a DSN is set. That way a
 *      delivery outage still leaves a durable, alertable copy.
 *
 * Configure the webhook before launching this page. See `.env-template`.
 *
 * @param {Object} application validated application from `validateApplication`
 * @returns {Promise<Object>} `{ loggedToStdout, webhookConfigured, webhookDelivered }`
 */
const deliverApplication = application => {
  const webhookUrl = process.env.SERVER_LAUNDRY_PARTNER_APPLICATION_WEBHOOK_URL;
  const record = { receivedAt: new Date().toISOString(), application };

  // Sink 1 — always, and always first, so a webhook outage cannot lose the submission.
  console.log(`[laundry-partner-application] ${JSON.stringify(record)}`);

  if (!webhookUrl) {
    console.warn(
      '[laundry-partner-application] SERVER_LAUNDRY_PARTNER_APPLICATION_WEBHOOK_URL is not set. ' +
        'The application above exists only in this log stream — configure a webhook so applications reach a human.'
    );
    return Promise.resolve({
      loggedToStdout: true,
      webhookConfigured: false,
      webhookDelivered: false,
    });
  }

  return fetch(webhookUrl, {
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
      return { loggedToStdout: true, webhookConfigured: true, webhookDelivered: true };
    })
    .catch(e => {
      // Escalate so the payload lands in Sentry as well as stdout.
      log.error(e, 'laundry-partner-application-delivery-failed', { record });
      return { loggedToStdout: true, webhookConfigured: true, webhookDelivered: false };
    });
};

module.exports = {
  validateApplication,
  deliverApplication,
  FIELD_SPECS,
  HONEYPOT_FIELD,
  MAX_TURNAROUND_HOURS,
  MAX_CATEGORIES,
  MAX_CATEGORY_LENGTH,
};
