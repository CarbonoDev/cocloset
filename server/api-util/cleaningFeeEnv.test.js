jest.mock('../log', () => ({ error: jest.fn() }));

const log = require('../log');
const {
  CLEANING_FEE_ENV_PREFIX,
  DEFAULT_CLEANING_FEE_ENV_VAR,
  cleaningFeeEnvVarName,
  readCleaningFeeEnvVar,
  resolveCleaningFeeEntry,
  resolveCleaningFeeMajorUnits,
  resetReportedMalformedEnvVars,
} = require('./cleaningFeeEnv');

// Every test passes its own `env` object rather than mutating process.env: the resolution
// rules are what is under test, and a leaked var would make one test's fee decide
// another's.
beforeEach(() => {
  log.error.mockClear();
  resetReportedMalformedEnvVars();
});

describe('cleaningFeeEnvVarName()', () => {
  it('upper-cases the Console category id behind the prefix', () => {
    expect(cleaningFeeEnvVarName('dresses')).toBe('CLEANING_FEE_DRESSES');
    expect(cleaningFeeEnvVarName('midi_dress')).toBe('CLEANING_FEE_MIDI_DRESS');
    expect(cleaningFeeEnvVarName('jumpsuits_rompers')).toBe('CLEANING_FEE_JUMPSUITS_ROMPERS');
  });

  it('replaces every character outside [A-Z0-9] with an underscore', () => {
    // Console ids are free-form operator input: a dash, a space or an accent are all
    // possible and none of them can appear in a portable env var name. Normalising
    // totally means there is exactly one name to document and one name to set.
    expect(cleaningFeeEnvVarName('mini-dress')).toBe('CLEANING_FEE_MINI_DRESS');
    expect(cleaningFeeEnvVarName('mini dress')).toBe('CLEANING_FEE_MINI_DRESS');
    expect(cleaningFeeEnvVarName('robes.été')).toBe('CLEANING_FEE_ROBES__T_');
    expect(cleaningFeeEnvVarName('tops2')).toBe('CLEANING_FEE_TOPS2');
  });

  it('uses the documented prefix', () => {
    expect(CLEANING_FEE_ENV_PREFIX).toBe('CLEANING_FEE_');
    expect(DEFAULT_CLEANING_FEE_ENV_VAR).toBe('DEFAULT_CLEANING_FEE');
  });

  it('returns null for an unusable id', () => {
    expect(cleaningFeeEnvVarName('')).toBeNull();
    expect(cleaningFeeEnvVarName(undefined)).toBeNull();
    expect(cleaningFeeEnvVarName(null)).toBeNull();
    expect(cleaningFeeEnvVarName(42)).toBeNull();
  });
});

describe('readCleaningFeeEnvVar()', () => {
  it('parses a plain major-unit number', () => {
    expect(readCleaningFeeEnvVar('CLEANING_FEE_TOPS', { CLEANING_FEE_TOPS: '12' })).toBe(12);
    expect(readCleaningFeeEnvVar('CLEANING_FEE_TOPS', { CLEANING_FEE_TOPS: '12.5' })).toBe(12.5);
    expect(readCleaningFeeEnvVar('CLEANING_FEE_TOPS', { CLEANING_FEE_TOPS: ' 12.5 ' })).toBe(12.5);
  });

  it('treats an explicit ZERO as a configured fee — free, not blank', () => {
    // Zero has meant "this category is not charged for" since the fee existed, and a
    // zero fee simply adds no line item.
    expect(readCleaningFeeEnvVar('CLEANING_FEE_TOPS', { CLEANING_FEE_TOPS: '0' })).toBe(0);
  });

  it('treats unset and blank as unconfigured, without logging', () => {
    // `FOO=` in a .env file is how people comment a value out in a hurry. Reporting it
    // as a deployment error would be noise, not a signal.
    expect(readCleaningFeeEnvVar('CLEANING_FEE_TOPS', {})).toBeNull();
    expect(readCleaningFeeEnvVar('CLEANING_FEE_TOPS', { CLEANING_FEE_TOPS: '' })).toBeNull();
    expect(readCleaningFeeEnvVar('CLEANING_FEE_TOPS', { CLEANING_FEE_TOPS: '   ' })).toBeNull();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('ignores a non-numeric value and names the offending var in the log', () => {
    expect(readCleaningFeeEnvVar('CLEANING_FEE_TOPS', { CLEANING_FEE_TOPS: 'twelve' })).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
    const [error, code, data] = log.error.mock.calls[0];
    expect(error.message).toContain('CLEANING_FEE_TOPS');
    expect(code).toBe('cleaning-fee-env-invalid');
    expect(data).toEqual({ envVar: 'CLEANING_FEE_TOPS', rawValue: 'twelve' });
  });

  it('refuses to half-parse a partly numeric value', () => {
    // parseFloat('12abc') is 12 and parseFloat('12,50') is 12 — charging 12.00 instead
    // of 12.50 with no error anywhere is exactly the silent mispricing this module
    // exists to refuse. Number() rejects both.
    expect(readCleaningFeeEnvVar('CLEANING_FEE_TOPS', { CLEANING_FEE_TOPS: '12abc' })).toBeNull();
    expect(readCleaningFeeEnvVar('CLEANING_FEE_PANTS', { CLEANING_FEE_PANTS: '12,50' })).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(2);
  });

  it('rejects a NEGATIVE fee as a data error, not a discount', () => {
    expect(readCleaningFeeEnvVar('CLEANING_FEE_TOPS', { CLEANING_FEE_TOPS: '-5' })).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][2]).toEqual({
      envVar: 'CLEANING_FEE_TOPS',
      rawValue: '-5',
    });
  });

  it('rejects Infinity', () => {
    expect(
      readCleaningFeeEnvVar('CLEANING_FEE_TOPS', { CLEANING_FEE_TOPS: 'Infinity' })
    ).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('reports one malformed var ONCE, however many times it is read', () => {
    // This runs on the checkout path — every price preview, every booking request. An
    // un-deduplicated log would emit thousands of identical lines and bury the signal it
    // exists to raise.
    const env = { CLEANING_FEE_TOPS: 'twelve' };
    readCleaningFeeEnvVar('CLEANING_FEE_TOPS', env);
    readCleaningFeeEnvVar('CLEANING_FEE_TOPS', env);
    readCleaningFeeEnvVar('CLEANING_FEE_TOPS', env);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('reports each malformed var separately', () => {
    const env = { CLEANING_FEE_TOPS: 'twelve', CLEANING_FEE_PANTS: '-1' };
    readCleaningFeeEnvVar('CLEANING_FEE_TOPS', env);
    readCleaningFeeEnvVar('CLEANING_FEE_PANTS', env);
    expect(log.error).toHaveBeenCalledTimes(2);
    expect(log.error.mock.calls.map(call => call[2].envVar)).toEqual([
      'CLEANING_FEE_TOPS',
      'CLEANING_FEE_PANTS',
    ]);
  });

  it('falls back to process.env when no env object is given', () => {
    const original = process.env.CLEANING_FEE_TOPS;
    process.env.CLEANING_FEE_TOPS = '7';
    try {
      expect(readCleaningFeeEnvVar('CLEANING_FEE_TOPS')).toBe(7);
    } finally {
      if (original === undefined) {
        delete process.env.CLEANING_FEE_TOPS;
      } else {
        process.env.CLEANING_FEE_TOPS = original;
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HIGHEST CONFIGURED CATEGORY IN THE CHAIN WINS.
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveCleaningFeeMajorUnits()', () => {
  const ENV = {
    DEFAULT_CLEANING_FEE: '10',
    CLEANING_FEE_DRESSES: '15',
    CLEANING_FEE_MIDI_DRESS: '22',
    CLEANING_FEE_SILK: '30',
    CLEANING_FEE_PANTS: '6',
  };

  it('uses an exact leaf match', () => {
    // Only the deepest level is priced highest here: 22 on midi_dress vs 15 on dresses.
    expect(resolveCleaningFeeMajorUnits(['dresses', 'midi_dress'], ENV)).toBe(22);
  });

  it('uses a parent match when the leaf has no var at all', () => {
    // CLEANING_FEE_MAXI_DRESS is unset; the parent is set. A fee on the parent covers
    // its whole branch, mirroring how accepting a parent accepts the branch.
    expect(resolveCleaningFeeMajorUnits(['dresses', 'maxi_dress'], ENV)).toBe(15);
  });

  it('takes the HIGHEST of several matching levels, not the deepest', () => {
    // THE RULE, stated by the client as "utilizaría el precio mas alto". This example is
    // ascending so it would also pass under most-specific-wins; the next test is the one
    // that actually distinguishes them.
    expect(resolveCleaningFeeMajorUnits(['dresses', 'maxi_dress', 'silk'], ENV)).toBe(30);
  });

  it('takes the PARENT fee when the deeper category is CHEAPER', () => {
    // This is the test that separates "highest wins" from "most specific wins".
    // The client's own example: 10 on dresses, 8 on midi_dress -> charge 10.
    const env = {
      DEFAULT_CLEANING_FEE: '4',
      CLEANING_FEE_DRESSES: '10',
      CLEANING_FEE_MIDI_DRESS: '8',
    };
    expect(resolveCleaningFeeMajorUnits(['dresses', 'midi_dress'], env)).toBe(10);
  });

  it('takes the highest across three levels when the MIDDLE one is the maximum', () => {
    // Neither the shallowest nor the deepest wins — only a real max does.
    const env = {
      CLEANING_FEE_DRESSES: '12',
      CLEANING_FEE_MAXI_DRESS: '40',
      CLEANING_FEE_SILK: '9',
    };
    expect(resolveCleaningFeeMajorUnits(['dresses', 'maxi_dress', 'silk'], env)).toBe(40);
  });

  it('falls back to DEFAULT_CLEANING_FEE when no level in the chain is configured', () => {
    expect(resolveCleaningFeeMajorUnits(['coats', 'trench'], ENV)).toBe(10);
  });

  it('falls back to DEFAULT_CLEANING_FEE when the listing has no category at all', () => {
    expect(resolveCleaningFeeMajorUnits([], ENV)).toBe(10);
    expect(resolveCleaningFeeMajorUnits(undefined, ENV)).toBe(10);
  });

  it('does NOT let DEFAULT_CLEANING_FEE compete in the max', () => {
    // The default is a fallback for "no category priced this", not a floor. A default of
    // 20 with a matching category fee of 8 charges 8.
    const env = { DEFAULT_CLEANING_FEE: '20', CLEANING_FEE_MIDI_DRESS: '8' };
    expect(resolveCleaningFeeMajorUnits(['dresses', 'midi_dress'], env)).toBe(8);
  });

  it('returns null (no fee at all) when nothing is configured anywhere', () => {
    expect(resolveCleaningFeeMajorUnits(['dresses'], {})).toBeNull();
    expect(resolveCleaningFeeMajorUnits([], {})).toBeNull();
  });

  it('lets a priced parent beat a zeroed child, because highest wins', () => {
    // Documented consequence of the max rule, not an accident: "free for midi dresses"
    // cannot override a paid parent. Clear the parent's var to make the branch free.
    const env = { CLEANING_FEE_DRESSES: '15', CLEANING_FEE_MIDI_DRESS: '0' };
    expect(resolveCleaningFeeMajorUnits(['dresses', 'midi_dress'], env)).toBe(15);
  });

  it('charges zero when the only configured level is zero', () => {
    const env = { DEFAULT_CLEANING_FEE: '10', CLEANING_FEE_MIDI_DRESS: '0' };
    expect(resolveCleaningFeeMajorUnits(['dresses', 'midi_dress'], env)).toBe(0);
  });

  it('skips a MALFORMED level and keeps considering the rest of the chain', () => {
    // The dangerous failure mode is the quiet one: reading `twelve` as 0 here would
    // suppress the parent's real fee and produce a checkout that works perfectly while
    // charging the wrong price.
    const env = {
      DEFAULT_CLEANING_FEE: '3',
      CLEANING_FEE_DRESSES: '15',
      CLEANING_FEE_MIDI_DRESS: 'twelve',
    };
    expect(resolveCleaningFeeMajorUnits(['dresses', 'midi_dress'], env)).toBe(15);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('falls through to the default when the ONLY matching level is malformed', () => {
    const env = { DEFAULT_CLEANING_FEE: '7', CLEANING_FEE_MIDI_DRESS: '-2' };
    expect(resolveCleaningFeeMajorUnits(['dresses', 'midi_dress'], env)).toBe(7);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('charges nothing, and logs, when a malformed DEFAULT_CLEANING_FEE is the last rung', () => {
    const env = { DEFAULT_CLEANING_FEE: 'ten' };
    expect(resolveCleaningFeeMajorUnits(['dresses'], env)).toBeNull();
    expect(log.error.mock.calls[0][2].envVar).toBe('DEFAULT_CLEANING_FEE');
  });

  it('never throws on a garbage chain', () => {
    expect(resolveCleaningFeeMajorUnits([null, '', 42, {}], ENV)).toBe(10);
    expect(resolveCleaningFeeMajorUnits('dresses', ENV)).toBe(10);
    expect(resolveCleaningFeeMajorUnits(null, ENV)).toBe(10);
  });

  it('ignores non-string ids but still resolves the usable ones', () => {
    expect(resolveCleaningFeeMajorUnits([null, '', 'midi_dress'], ENV)).toBe(22);
  });

  it('resolves an id that needs normalising', () => {
    // Adding a category is an env change, never a code change: whatever Console calls
    // it, the var name follows from the id mechanically.
    const env = { CLEANING_FEE_JUMPSUITS_ROMPERS: '14' };
    expect(resolveCleaningFeeMajorUnits(['jumpsuits_rompers'], env)).toBe(14);
  });
});

describe('resolveCleaningFeeEntry()', () => {
  it('reports WHERE the fee came from, so a caller can label or debug it', () => {
    const env = { DEFAULT_CLEANING_FEE: '10', CLEANING_FEE_MIDI_DRESS: '22' };
    expect(resolveCleaningFeeEntry(['dresses', 'midi_dress'], env)).toEqual({
      value: 22,
      source: 'category',
      envVar: 'CLEANING_FEE_MIDI_DRESS',
      categoryId: 'midi_dress',
    });
    expect(resolveCleaningFeeEntry(['coats'], env)).toEqual({
      value: 10,
      source: 'default',
      envVar: 'DEFAULT_CLEANING_FEE',
      categoryId: null,
    });
    expect(resolveCleaningFeeEntry(['coats'], {})).toBeNull();
  });

  it('names the category that supplied the WINNING (highest) fee, not the deepest', () => {
    const env = { CLEANING_FEE_DRESSES: '10', CLEANING_FEE_MIDI_DRESS: '8' };
    expect(resolveCleaningFeeEntry(['dresses', 'midi_dress'], env)).toEqual({
      value: 10,
      source: 'category',
      envVar: 'CLEANING_FEE_DRESSES',
      categoryId: 'dresses',
    });
  });
});
