import {
  bookingEndForPeriod,
  dateFormatOptionsIn,
  inclusiveEndForPeriod,
  isWindowAvailableFn,
  latestBookableStartDate,
  submitButtonMessageId,
} from './BookingRentalPeriodForm';

const TZ = 'Etc/UTC';
const day = n => new Date(Date.UTC(2026, 8, n)); // September 2026

// Availability arrives as half-open [start, end) ranges, already merged across months by
// booking.shared.js `getAllTimeSlots`.
const slot = (from, to) => ({
  id: { uuid: `ts-${from}-${to}` },
  type: 'timeSlot',
  attributes: { type: 'time-slot/time', start: day(from), end: day(to), seats: 1 },
});

describe('bookingEndForPeriod', () => {
  it('is exclusive: a 7-day rental from the 1st ends on the 8th', () => {
    // The same expression server/api-util/rentalPeriods.js checks against. Off by one here
    // is a booking the server refuses after the customer has chosen it.
    expect(bookingEndForPeriod(day(1), 7, TZ)).toEqual(day(8));
  });

  it('is null without a start date or a period', () => {
    expect(bookingEndForPeriod(null, 7, TZ)).toBeNull();
    expect(bookingEndForPeriod(day(1), null, TZ)).toBeNull();
  });
});

describe('inclusiveEndForPeriod', () => {
  it('is the last day the customer actually has the garment', () => {
    // What gets SHOWN. It has to match LineItemBookingPeriod, which subtracts a day for
    // `line-item/day` - two different dates for the same booking, on the same screen,
    // would read as a bug in whichever one the customer noticed second.
    expect(inclusiveEndForPeriod(day(1), 7, TZ)).toEqual(day(7));
  });
});

describe('latestBookableStartDate', () => {
  it('leaves room for the whole window inside the booking horizon', () => {
    // Without this the picker offers a start date whose window runs past the fetched
    // availability, and then refuses it silently: a date that looks enabled and does
    // nothing when clicked.
    const today = day(1);
    expect(latestBookableStartDate(90, 9, TZ, today)).toEqual(day(1 + 90 - 9));
  });

  it('moves earlier as the window grows', () => {
    const today = day(1);
    const forSeven = latestBookableStartDate(90, 7, TZ, today);
    const forFourteen = latestBookableStartDate(90, 14, TZ, today);
    expect(forFourteen.getTime()).toBeLessThan(forSeven.getTime());
  });
});

describe('isWindowAvailableFn', () => {
  // One free block: the 1st up to (not including) the 20th.
  const timeSlots = [slot(1, 20)];
  const isAvailable = isWindowAvailableFn(timeSlots, TZ);

  it('accepts a window that fits inside a free block', () => {
    expect(isAvailable(day(1), 9)).toBe(true);
  });

  it('accepts a window that ends exactly when the block does', () => {
    // The block's end is exclusive and so is the window's. Getting this comparison wrong by
    // one costs the customer the last bookable start date of every availability block.
    expect(isAvailable(day(11), 9)).toBe(true);
  });

  it('refuses a window that runs one day past the block', () => {
    expect(isAvailable(day(12), 9)).toBe(false);
  });

  it('refuses a start day with no availability at all', () => {
    expect(isAvailable(day(25), 9)).toBe(false);
  });

  it('refuses a window that needs days beyond the fetched months', () => {
    // A day with no containing slot is refused rather than assumed free. That is the safe
    // direction: the alternative offers dates the marketplace cannot honour.
    expect(isAvailable(day(19), 7)).toBe(false);
  });

  it('refuses a window that would span two separate blocks', () => {
    // Two blocks with the 10th blocked between them. A booking cannot hop the gap, and
    // neither can the cleaning window that follows it.
    const split = isWindowAvailableFn([slot(1, 10), slot(11, 20)], TZ);
    expect(split(day(5), 7)).toBe(false);
    expect(split(day(11), 7)).toBe(true);
  });

  it('lengthens the requirement by the cleaning window', () => {
    //   > "el booking se queda como 7 días mas los días que necesite laundry"
    // 7 rental days fit before the block ends; 7 + 3 cleaning days do not.
    const tight = isWindowAvailableFn([slot(1, 8)], TZ);
    expect(tight(day(1), 7)).toBe(true);
    expect(tight(day(1), 10)).toBe(false);
  });

  it('refuses rather than throwing on nonsense input', () => {
    expect(isAvailable(null, 7)).toBe(false);
    expect(isAvailable(day(1), 0)).toBe(false);
    expect(isAvailable(day(1), undefined)).toBe(false);
  });

  // THE FIRST DAY OF A SLOT IS OFFERABLE, INCLUDING WHEN THAT DAY IS TODAY.
  //
  //   > "el día de hoy esté habilitado para seleccionarlo y que la fecha de reserva sea hoy"
  //   >   (Jonathan, 2026-09-28)
  //
  // Today was refused for a whole month on the belief that the API truncates the current day's
  // slot at the moment of the query, and a previous fix tried to compensate HERE, at day
  // granularity. Both were wrong: the slot starts wherever the QUERY starts, and the listing
  // page was querying from tomorrow. These two cases pin the two halves of that, so neither
  // belief can come back.
  it('accepts a start on the first day of the slot, whatever date that is', () => {
    // Nothing about today is special to this function. Given a slot that begins on the day
    // being asked about, a window that fits is available - which is all it ever needed to do
    // once the fetch started including today. See isWindowAvailableFn's comment for the
    // measurements.
    expect(isAvailable(day(1), 9)).toBe(true);
  });

  it('refuses a start before the slot begins, and is not lenient about part-days', () => {
    // The flip side, and the reason the comparison is an exact instant again: a slot that
    // genuinely begins mid-day (an availability exception, not a query artefact) does not make
    // that whole day offerable. A day-granularity comparison here would have said otherwise -
    // and would have been indistinguishable from the bug it was meant to fix.
    const midDay = new Date(Date.UTC(2026, 8, 5, 15, 0, 0));
    const fromMidDay = isWindowAvailableFn(
      [{ ...slot(5, 20), attributes: { ...slot(5, 20).attributes, start: midDay } }],
      TZ
    );

    expect(fromMidDay(day(5), 9)).toBe(false);
    expect(fromMidDay(day(6), 9)).toBe(true);
  });
});

describe('dateFormatOptionsIn', () => {
  // THE BUG THIS PREVENTS, reported from Dev: the picker read "Thu, Aug 13", the sentence
  // under it read "Tue, Aug 11", and the price breakdown read "Aug 12". Three renderings of
  // one booking. Two faults combined - a double time-zone conversion (fixed by reading the
  // field's already-parsed value) and this one: every date in this form is a MIDNIGHT
  // INSTANT IN THE LISTING'S ZONE, and `intl.formatDate` defaults to the browser's, so for
  // any customer west of the listing it renders as the previous day.
  //
  // Asserted through a real Intl formatter rather than by inspecting the returned object,
  // so what is checked is that the option actually changes the rendered day - the reason it
  // has to be there at all.
  const render = (instant, options) => new Intl.DateTimeFormat('en-US', options).format(instant);

  // Midnight on 13 August in a UTC listing's calendar.
  const midnightUtc = new Date('2026-08-13T00:00:00.000Z');

  it('renders a listing-time-zone midnight as that day', () => {
    expect(render(midnightUtc, dateFormatOptionsIn('Etc/UTC'))).toContain('Aug 13');
  });

  it('renders the SAME instant as the previous day in a zone behind the listing', () => {
    // Not a quirk of the test: this is precisely what the customer saw. It is here so that
    // dropping the timeZone option again fails loudly instead of silently.
    expect(render(midnightUtc, dateFormatOptionsIn('America/Mexico_City'))).toContain('Aug 12');
  });

  it('omits the option entirely when the listing has no time zone', () => {
    // A listing with no availabilityPlan has none. Passing `timeZone: undefined` to Intl
    // throws in some engines; leaving the key out falls back to the browser's zone, which is
    // the best available answer.
    expect('timeZone' in dateFormatOptionsIn(undefined)).toBe(false);
    expect(() => render(midnightUtc, dateFormatOptionsIn(undefined))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
//   > "cuando se puede hacer autoaccept, el label del button no debe ser 'Request...' si no
//   >  solo 'Book now' o algo similar"
//
// The label has to be right exactly when server/api/auto-accept-booking.js fires, so it asks
// that endpoint's own question - `onLaundry === true` - rather than a cleverer one. These pin
// the strictness: anything short of a real boolean is not custody, and a garment still in its
// owner's wardrobe genuinely does need its owner to accept.
// ---------------------------------------------------------------------------
describe('submitButtonMessageId', () => {
  it('says "book now" for a garment already at its studio', () => {
    expect(submitButtonMessageId(true)).toBe('BookingRentalPeriodForm.bookNow');
  });

  it('keeps "request to book" when the owner still has to hand the garment over', () => {
    expect(submitButtonMessageId(false)).toBe('BookingDatesForm.requestToBook');
  });

  it('keeps "request to book" for anything that is not a real boolean true', () => {
    [undefined, null, 'true', 1, {}].forEach(value => {
      expect(submitButtonMessageId(value)).toBe('BookingDatesForm.requestToBook');
    });
  });
});
