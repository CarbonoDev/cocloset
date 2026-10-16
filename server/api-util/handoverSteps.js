const { STATES } = require('./coclosetBookingProcess');

// THE HANDOVER STEP - server mirror of src/util/handoverSteps.js.
//
//   > "asegurate de que al escanear el qr se procese el siguiente paso, si le corresponde a
//   >  customer o si le corresponde a provider"
//
// Read the client copy first; it carries the reasoning. Duplicated here for the reason
// documented at the top of coclosetBookingProcess.js - the server runs as plain CommonJS
// with no Babel step and cannot require an ESM module out of `src/`. The two are held
// together by src/util/handoverStepsAgreement.test.js, because a scan page that names a
// different next step from the one the confirm endpoint will actually fire is precisely the
// failure the customer would meet at the counter.

const HANDOVER_COUNTERPARTY_PROVIDER = 'provider';
const HANDOVER_COUNTERPARTY_CUSTOMER = 'customer';

const HANDOVER_DIRECTION_IN = 'in';
const HANDOVER_DIRECTION_OUT = 'out';

// See the client copy for why this one step is not a function of the state alone.
const HANDOVER_STEP_DROP_OFF = 'accepted-drop-off';

const DROP_OFF_STEP = {
  state: STATES.ACCEPTED,
  stepKey: HANDOVER_STEP_DROP_OFF,
  status: 'garment-received',
  counterparty: HANDOVER_COUNTERPARTY_PROVIDER,
  direction: HANDOVER_DIRECTION_IN,
};

const STEPS = {
  [STATES.ACCEPTED]: {
    state: STATES.ACCEPTED,
    status: 'ready-for-pickup',
    counterparty: HANDOVER_COUNTERPARTY_PROVIDER,
    direction: HANDOVER_DIRECTION_IN,
  },
  // NEW (2026-10-15), alongside STATES.ACCEPTED_ON_LAUNDRY itself. Identical entry to
  // STATES.ACCEPTED above - this is the same "already on the rack, nothing to receive, next
  // step is ready" counter position that ACCEPTED fell into whenever onLaundry was already
  // true before the state split (see handoverStepFor's `options.onLaundry` branch below,
  // unchanged for the manual path).
  [STATES.ACCEPTED_ON_LAUNDRY]: {
    state: STATES.ACCEPTED_ON_LAUNDRY,
    status: 'ready-for-pickup',
    counterparty: HANDOVER_COUNTERPARTY_PROVIDER,
    direction: HANDOVER_DIRECTION_IN,
  },
  [STATES.READY_FOR_PICKUP]: {
    state: STATES.READY_FOR_PICKUP,
    status: 'picked-up',
    counterparty: HANDOVER_COUNTERPARTY_CUSTOMER,
    direction: HANDOVER_DIRECTION_OUT,
  },
  [STATES.PICKED_UP]: {
    state: STATES.PICKED_UP,
    status: 'returned',
    counterparty: HANDOVER_COUNTERPARTY_CUSTOMER,
    direction: HANDOVER_DIRECTION_IN,
  },
  [STATES.OVERDUE]: {
    state: STATES.OVERDUE,
    status: 'returned',
    counterparty: HANDOVER_COUNTERPARTY_CUSTOMER,
    direction: HANDOVER_DIRECTION_IN,
    isLate: true,
  },
};

/**
 * The next handover step for a transaction in this state.
 *
 * @param {string} [processState]
 * @param {Object} [options]
 * @param {boolean} [options.onLaundry] - is the garment already on the studio's rack?
 * @returns {Object|null} null when nothing is due at the counter
 */
const handoverStepFor = (processState, options = {}) => {
  if (processState === STATES.ACCEPTED && options.onLaundry !== true) {
    return DROP_OFF_STEP;
  }
  return STEPS[processState] || null;
};

module.exports = {
  HANDOVER_STEP_DROP_OFF,
  HANDOVER_COUNTERPARTY_PROVIDER,
  HANDOVER_COUNTERPARTY_CUSTOMER,
  HANDOVER_DIRECTION_IN,
  HANDOVER_DIRECTION_OUT,
  handoverStepFor,
};
