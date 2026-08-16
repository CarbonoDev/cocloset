import {
  CALENDAR_WEEKS,
  DAY_AVAILABLE,
  DAY_BOOKED,
  DAY_CLEANING,
  DAY_SELECTED,
  buildCalendarDays,
  classifyDay,
  selectedRange,
} from './availabilityCalendar';

// The read-only five-week view. Its whole job is one distinction the client asked for by name:
//
//   > "Debemos identificar cual es cleaning y cual es booked"
//
// Those are different facts from different sources - booked is availability, cleaning is the
// turnaround owed after a rental, which availability does not know about - so the tests that
// matter here are the ones where a day could be read as either.

const day = iso => new Date(`${iso}T00:00:00.000Z`);
const UTC = 'Etc/UTC';

const slot = (start, end) => ({ attributes: { start: day(start), end: day(end) } });

// A garment free all month except 17-24 Aug, which is booked, and owing two cleaning days
// after that rental.
const TIME_SLOTS = [slot('2026-08-01', '2026-08-17'), slot('2026-08-24', '2026-09-30')];
const GAPS = [{ start: day('2026-08-24'), end: day('2026-08-26') }];

const classify = (iso, extra = {}) =>
  classifyDay({
    day: day(iso),
    allTimeSlots: TIME_SLOTS,
    cleaningGaps: GAPS,
    timeZone: UTC,
    ...extra,
  });

describe('classifyDay', () => {
  it('calls a free day available', () => {
    expect(classify('2026-08-10')).toBe(DAY_AVAILABLE);
  });

  it('calls a day inside a rental booked', () => {
    expect(classify('2026-08-20')).toBe(DAY_BOOKED);
  });

  it('calls the turnaround after a rental cleaning, not available', () => {
    // THE POINT OF THE WHOLE FEATURE. The availability API says these days are free - the
    // buffer exception that should say otherwise is written from a browser and, on Dev, is
    // not there. Only the server-resolved gap list knows.
    expect(classify('2026-08-24')).toBe(DAY_CLEANING);
    expect(classify('2026-08-25')).toBe(DAY_CLEANING);
  });

  it('prefers cleaning over booked when a day is both', () => {
    // If the buffer exception DID land, the day is unavailable and in a gap. "Booked" would
    // be true and less true: the reader wants to know a wash is why.
    const bookedAndCleaning = classifyDay({
      day: day('2026-08-24'),
      allTimeSlots: [slot('2026-08-01', '2026-08-17')],
      cleaningGaps: GAPS,
      timeZone: UTC,
    });
    expect(bookedAndCleaning).toBe(DAY_CLEANING);
  });

  it('prefers the selection over everything', () => {
    // A selected day that also looks booked means the picker and this grid disagree, and
    // painting it grey would hide that rather than show it.
    const selection = selectedRange(day('2026-08-24'), 7, UTC);
    expect(classify('2026-08-24', { selection })).toBe(DAY_SELECTED);
  });

  it('reads a day past the fetched months as booked, not available', () => {
    // The safe direction: an unknown day must not be painted as bookable.
    expect(classify('2026-12-01')).toBe(DAY_BOOKED);
  });
});

describe('selectedRange', () => {
  it('covers the rental period and NOT the turnaround after it', () => {
    // The buffer belongs to the studio. Painting it as "your selection" tells a customer they
    // have the garment for longer than they do.
    const range = selectedRange(day('2026-08-10'), 7, UTC);
    expect(range.start.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-08-17T00:00:00.000Z');
  });

  it('is null with no period chosen yet', () => {
    expect(selectedRange(day('2026-08-10'), null, UTC)).toBeNull();
    expect(selectedRange(null, 7, UTC)).toBeNull();
  });
});

describe('buildCalendarDays', () => {
  const days = buildCalendarDays({
    today: day('2026-08-12'),
    allTimeSlots: TIME_SLOTS,
    cleaningGaps: GAPS,
    timeZone: UTC,
    firstDayOfWeek: 1,
  });

  it('draws five whole weeks', () => {
    expect(days).toHaveLength(CALENDAR_WEEKS * 7);
  });

  it('starts on the first day of the week containing today, so the columns line up', () => {
    // 2026-08-12 is a Wednesday; with Monday as the first weekday the grid opens on the 10th.
    expect(days[0].date.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(days[0].isPast).toBe(true);
  });

  it('never calls a day that has already passed available', () => {
    days
      .filter(d => d.isPast)
      .forEach(d => {
        expect(d.status).not.toBe(DAY_AVAILABLE);
      });
  });

  it('marks the cleaning days as cleaning', () => {
    const cleaning = days.filter(d => d.status === DAY_CLEANING).map(d => d.date.getUTCDate());
    expect(cleaning).toEqual([24, 25]);
  });
});
