jest.mock('../log', () => ({ error: jest.fn() }));

const log = require('../log');
const {
  SPECIAL_HANDLING_FEE_ENV_VAR,
  DEFAULT_SPECIAL_HANDLING_FEE_MAJOR_UNITS,
  readSpecialHandlingFeeEnvVar,
  resolveSpecialHandlingFeeMajorUnits,
  resetReportedMalformed,
} = require('./specialHandlingFeeEnv');

// Every test passes its own `env` object rather than mutating process.env: the
// resolution rules are what is under test, and a leaked var would make one test's fee
// decide another's.
beforeEach(() => {
  log.error.mockClear();
  resetReportedMalformed();
});

describe('readSpecialHandlingFeeEnvVar()', () => {
  it('uses the documented var name', () => {
    expect(SPECIAL_HANDLING_FEE_ENV_VAR).toBe('SPECIAL_HANDLING_FEE');
  });

  it('parses a plain major-unit number', () => {
    expect(readSpecialHandlingFeeEnvVar({ SPECIAL_HANDLING_FEE: '12' })).toBe(12);
    expect(readSpecialHandlingFeeEnvVar({ SPECIAL_HANDLING_FEE: '12.5' })).toBe(12.5);
    expect(readSpecialHandlingFeeEnvVar({ SPECIAL_HANDLING_FEE: ' 12.5 ' })).toBe(12.5);
  });

  it('treats an explicit ZERO as a configured, deliberate override - not blank', () => {
    // Per the client, the fee "también puede ser $0" - so an explicit zero disables the
    // fee, it does not fall back to the $15 default.
    expect(readSpecialHandlingFeeEnvVar({ SPECIAL_HANDLING_FEE: '0' })).toBe(0);
  });

  it('treats unset and blank as unconfigured, without logging', () => {
    expect(readSpecialHandlingFeeEnvVar({})).toBeNull();
    expect(readSpecialHandlingFeeEnvVar({ SPECIAL_HANDLING_FEE: '' })).toBeNull();
    expect(readSpecialHandlingFeeEnvVar({ SPECIAL_HANDLING_FEE: '   ' })).toBeNull();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('ignores a non-numeric value and names the offending var in the log', () => {
    expect(readSpecialHandlingFeeEnvVar({ SPECIAL_HANDLING_FEE: 'fifteen' })).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
    const [error, code, data] = log.error.mock.calls[0];
    expect(error.message).toContain('SPECIAL_HANDLING_FEE');
    expect(code).toBe('special-handling-fee-env-invalid');
    expect(data).toEqual({ envVar: 'SPECIAL_HANDLING_FEE', rawValue: 'fifteen' });
  });

  it('refuses to half-parse a partly numeric value', () => {
    expect(readSpecialHandlingFeeEnvVar({ SPECIAL_HANDLING_FEE: '15abc' })).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('rejects a NEGATIVE fee as a data error, not a discount', () => {
    expect(readSpecialHandlingFeeEnvVar({ SPECIAL_HANDLING_FEE: '-5' })).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('rejects Infinity', () => {
    expect(readSpecialHandlingFeeEnvVar({ SPECIAL_HANDLING_FEE: 'Infinity' })).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('reports a malformed value ONCE, however many times it is read', () => {
    // This resolves on every price preview and every booking request - an
    // un-deduplicated log would bury the signal it exists to raise.
    const env = { SPECIAL_HANDLING_FEE: 'fifteen' };
    readSpecialHandlingFeeEnvVar(env);
    readSpecialHandlingFeeEnvVar(env);
    readSpecialHandlingFeeEnvVar(env);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('falls back to process.env when no env object is given', () => {
    const original = process.env.SPECIAL_HANDLING_FEE;
    process.env.SPECIAL_HANDLING_FEE = '7';
    try {
      expect(readSpecialHandlingFeeEnvVar()).toBe(7);
    } finally {
      if (original === undefined) {
        delete process.env.SPECIAL_HANDLING_FEE;
      } else {
        process.env.SPECIAL_HANDLING_FEE = original;
      }
    }
  });
});

describe('resolveSpecialHandlingFeeMajorUnits()', () => {
  it('uses the documented $15 default', () => {
    expect(DEFAULT_SPECIAL_HANDLING_FEE_MAJOR_UNITS).toBe(15);
  });

  it('falls back to the code default of 15 when the env var is unset', () => {
    expect(resolveSpecialHandlingFeeMajorUnits({})).toBe(15);
  });

  it('uses the env value when it is a valid non-negative number, including 0', () => {
    expect(resolveSpecialHandlingFeeMajorUnits({ SPECIAL_HANDLING_FEE: '20' })).toBe(20);
    expect(resolveSpecialHandlingFeeMajorUnits({ SPECIAL_HANDLING_FEE: '0' })).toBe(0);
  });

  it('falls back to the default (rather than 0) when the env value is malformed', () => {
    expect(resolveSpecialHandlingFeeMajorUnits({ SPECIAL_HANDLING_FEE: 'nope' })).toBe(15);
  });
});
