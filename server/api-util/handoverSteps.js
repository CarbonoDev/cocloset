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

const STEPS = {
  [STATES.ACCEPTED]: {
    state: STATES.ACCEPTED,
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
 * @returns {Object|null} null when nothing is due at the counter
 */
const handoverStepFor = processState => STEPS[processState] || null;

module.exports = {
  HANDOVER_COUNTERPARTY_PROVIDER,
  HANDOVER_COUNTERPARTY_CUSTOMER,
  HANDOVER_DIRECTION_IN,
  HANDOVER_DIRECTION_OUT,
  handoverStepFor,
};
