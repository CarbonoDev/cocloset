// The special-handling fee, resolved from the SERVER ENVIRONMENT.
//
// Charged once per booking, marketplace-wide, whenever the listing carries any Special
// Care flag (embellishments, leather/suede trim, pressed pleats, high value — see
// src/util/specialCare.js for the full set and why they live in `privateData`). Per
// Jonathan (2026-09-11): "el default será de $15, pero debe venir de una variable de
// ambiente, la cual tambien puede ser $0" — so this follows the SAME env-driven pattern
// as api-util/cleaningFeeEnv.js, with one difference: cleaning fee has NO code-level
// default (unset = no fee at all), but this one does (unset = $15), because the client
// asked for a default that can be dialled to zero rather than for "off by default".
//
// SERVER-ONLY. Never prefix with REACT_APP_ — same reasoning as CLEANING_FEE_*: a fee a
// customer's browser could read is a fee a customer's browser could be tempted to
// compute from, and the charge is computed server-side, from this var only.
const log = require('../log');

const SPECIAL_HANDLING_FEE_ENV_VAR = 'SPECIAL_HANDLING_FEE';

// The code-level default in MAJOR currency units, used whenever the env var is unset or
// blank. An explicit `SPECIAL_HANDLING_FEE=0` is a real, valid override (see
// readSpecialHandlingFeeEnvVar) — it disables the fee outright, it does not fall back to
// this default.
const DEFAULT_SPECIAL_HANDLING_FEE_MAJOR_UNITS = 15;

// Reported once per process, same reasoning as cleaningFeeEnv.js: this resolves on every
// price preview and every booking request, so an un-deduplicated log would bury the
// signal it exists to raise.
let reportedMalformed = false;
const reportMalformed = rawValue => {
  if (reportedMalformed) {
    return;
  }
  reportedMalformed = true;
  log.error(
    new Error(
      `${SPECIAL_HANDLING_FEE_ENV_VAR} is not a valid special-handling fee: expected a ` +
        `non-negative plain number in major currency units (e.g. 15). The value was ` +
        `IGNORED — pricing fell back to the code default of ` +
        `${DEFAULT_SPECIAL_HANDLING_FEE_MAJOR_UNITS}.`
    ),
    'special-handling-fee-env-invalid',
    { envVar: SPECIAL_HANDLING_FEE_ENV_VAR, rawValue }
  );
};

/**
 * Read the special-handling fee env var.
 *
 * @param {Object} [env] the environment to read (defaults to process.env)
 * @returns {number|null} the fee in major units, or null when unset/blank/malformed
 */
const readSpecialHandlingFeeEnvVar = (env = process.env) => {
  const source = env && typeof env === 'object' ? env : process.env;
  const rawValue = source[SPECIAL_HANDLING_FEE_ENV_VAR];

  // Unset, or set to nothing. `FOO=` in a .env file is how people comment a value out in
  // a hurry; treating it as a deployment error would be noise, not a signal.
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return null;
  }

  // Number(), not parseFloat(): parseFloat('15abc') is 15, which is exactly the silent
  // mispricing this module refuses to do.
  const parsed = Number(String(rawValue).trim());

  // Zero IS a valid fee — "no special-handling charge" is a real, deliberate statement
  // (per the client, the env var "tambien puede ser $0"). Negative is not: a negative
  // fee is not a discount, it is a data error.
  if (!Number.isFinite(parsed) || parsed < 0) {
    reportMalformed(String(rawValue));
    return null;
  }

  return parsed;
};

/**
 * The special-handling fee in MAJOR currency units: the env var if it's set to a valid
 * non-negative number (including 0), otherwise the code-level default.
 *
 * @param {Object} [env] the environment to read (defaults to process.env)
 * @returns {number}
 */
const resolveSpecialHandlingFeeMajorUnits = (env = process.env) => {
  const fromEnv = readSpecialHandlingFeeEnvVar(env);
  return fromEnv !== null ? fromEnv : DEFAULT_SPECIAL_HANDLING_FEE_MAJOR_UNITS;
};

// Tests only: forget that a malformed value was already reported, so each malformed-value
// case can assert its own log line.
const resetReportedMalformed = () => {
  reportedMalformed = false;
};

module.exports = {
  SPECIAL_HANDLING_FEE_ENV_VAR,
  DEFAULT_SPECIAL_HANDLING_FEE_MAJOR_UNITS,
  readSpecialHandlingFeeEnvVar,
  resolveSpecialHandlingFeeMajorUnits,
  resetReportedMalformed,
};
