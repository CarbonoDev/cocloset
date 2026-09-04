import {
  BUSINESS_DAYS,
  DEFAULT_CLOSE_TIME,
  DEFAULT_OPEN_TIME,
  businessHoursSummary,
  dayCloseField,
  dayEnabledField,
  dayOpenField,
  isOpenOn,
  toBusinessHoursByDay,
  toFormValues,
} from './businessHours';

// The free-text box this replaces could not answer "are they open on Sunday" - it held a
// sentence. What these pin is the two directions the grid has to survive: form -> record on
// save, and record -> form on load, including the load with nothing stored at all.

const allDays = (open = '09:00', close = '18:00') =>
  BUSINESS_DAYS.reduce((acc, day) => ({ ...acc, [day]: { open, close } }), {});

describe('toBusinessHoursByDay', () => {
  it('keeps only the days that are ticked', () => {
    const values = {
      ...toFormValues(null),
      [dayEnabledField('sun')]: false,
      [dayEnabledField('sat')]: false,
    };

    expect(Object.keys(toBusinessHoursByDay(values)).sort()).toEqual(
      ['fri', 'mon', 'thu', 'tue', 'wed'].sort()
    );
  });

  it('stores the hours typed for each day, not one pair for all of them', () => {
    const values = {
      ...toFormValues(null),
      [dayOpenField('sat')]: '10:00',
      [dayCloseField('sat')]: '14:00',
    };
    const stored = toBusinessHoursByDay(values);

    expect(stored.sat).toEqual({ open: '10:00', close: '14:00' });
    expect(stored.mon).toEqual({ open: DEFAULT_OPEN_TIME, close: DEFAULT_CLOSE_TIME });
  });

  it('drops a day whose time is unusable rather than storing half of it', () => {
    // `{ open: undefined }` is a record that every reader calls closed anyway. One that says
    // so is better than one that looks open until something tries to print it.
    const values = { ...toFormValues(null), [dayOpenField('wed')]: '25:00' };

    expect(toBusinessHoursByDay(values).wed).toBeUndefined();
    expect(toBusinessHoursByDay(values).thu).toBeDefined();
  });

  it('is empty when nothing is ticked', () => {
    const values = BUSINESS_DAYS.reduce(
      (acc, day) => ({ ...acc, [dayEnabledField(day)]: false }),
      {}
    );

    expect(toBusinessHoursByDay(values)).toEqual({});
  });
});

describe('toFormValues', () => {
  //   > "por default todos los días deben estar checkeados"
  it.each([[undefined], [null], [{}]])('ticks every day at the defaults for %p', stored => {
    const values = toFormValues(stored);

    BUSINESS_DAYS.forEach(day => {
      expect(values[dayEnabledField(day)]).toBe(true);
      expect(values[dayOpenField(day)]).toBe(DEFAULT_OPEN_TIME);
      expect(values[dayCloseField(day)]).toBe(DEFAULT_CLOSE_TIME);
    });
  });

  it('does not invent hours for a studio that only has the old free-text line', () => {
    // The old value is a sentence. Parsing it would put words in a studio's mouth about when
    // it is open, so the grid starts from the defaults and the studio confirms them.
    const values = toFormValues(null);
    expect(values[dayEnabledField('sun')]).toBe(true);
  });

  it('round-trips a stored record', () => {
    const stored = { ...allDays(), sat: { open: '10:00', close: '14:00' }, sun: undefined };
    delete stored.sun;

    expect(toBusinessHoursByDay(toFormValues(stored))).toEqual(stored);
  });

  it('leaves a closed day unticked, with the defaults in its disabled inputs', () => {
    const stored = { mon: { open: '08:00', close: '16:00' } };
    const values = toFormValues(stored);

    expect(values[dayEnabledField('mon')]).toBe(true);
    expect(values[dayOpenField('mon')]).toBe('08:00');
    expect(values[dayEnabledField('tue')]).toBe(false);
    // Not blank: ticking the day should not then require typing two times from scratch.
    expect(values[dayOpenField('tue')]).toBe(DEFAULT_OPEN_TIME);
  });
});

describe('isOpenOn', () => {
  it('is false for a missing day, a missing record and a malformed one', () => {
    expect(isOpenOn(allDays(), 'mon')).toBe(true);
    expect(isOpenOn({}, 'mon')).toBe(false);
    expect(isOpenOn(undefined, 'mon')).toBe(false);
    expect(isOpenOn({ mon: { open: '09:00' } }, 'mon')).toBe(false);
    expect(isOpenOn({ mon: { open: 'morning', close: 'evening' } }, 'mon')).toBe(false);
  });
});

describe('businessHoursSummary', () => {
  it('collapses consecutive days that share their hours', () => {
    const stored = { ...allDays(), sat: { open: '10:00', close: '14:00' } };
    delete stored.sun;

    expect(businessHoursSummary(stored)).toBe('Mon-Fri 09:00-18:00, Sat 10:00-14:00');
  });

  it('never merges across a closed day', () => {
    // A studio open Mon and Wed at the same hours is not open "Mon-Wed", and a reader has no
    // way to discover the Tuesday that would imply.
    const stored = {
      mon: { open: '09:00', close: '18:00' },
      wed: { open: '09:00', close: '18:00' },
    };

    expect(businessHoursSummary(stored)).toBe('Mon 09:00-18:00, Wed 09:00-18:00');
  });

  it('is empty for a studio that is never open, rather than a stray separator', () => {
    expect(businessHoursSummary({})).toBe('');
    expect(businessHoursSummary(undefined)).toBe('');
  });

  it('reads the whole week as one range when every day matches', () => {
    expect(businessHoursSummary(allDays())).toBe('Mon-Sun 09:00-18:00');
  });
});
