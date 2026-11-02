const { maxCleaningDaysBeforeNextBooking, resolveCleaningDays } = require('./listingCustody');

// THE CEILING A NEXT BOOKING PUTS ON A WASH.
//
//   > "si alguien hace booking el 29 y la prenda es devuelta el día 26, solo se tienen dos
//   >  días para hacer el lavado, a pesar de eso se le pregunta a la laundry cuantos días
//   >  necesita, por lo tanto hay que limitarlo para que no sean mas de esos días"
//
// The client chose the cap over the alternative (let the studio overrun and flag the next
// booking as in conflict), so these pin the cap winning - including in the case where it
// leaves the studio less time than it says it needs.

const at = (iso, time = '12:00') => new Date(`${iso}T${time}:00.000Z`);
const UTC = 'Etc/UTC';

describe('maxCleaningDaysBeforeNextBooking', () => {
  it('is the days between the return and the next rental, minus the handover day', () => {
    // The client's own arithmetic: back on the 26th, next rental the 29th, so the 27th and the
    // 28th are the wash. The handover day is not a wash day - the same +1 computeReadiness
    // uses, seen from the other side.
    expect(
      maxCleaningDaysBeforeNextBooking({
        returnedAt: at('2026-08-26'),
        nextBookingStart: at('2026-08-29', '00:00'),
        timeZone: UTC,
      })
    ).toBe(2);
  });

  it('ignores the hour the garment came back', () => {
    // The operator pressing the button at 23:50 has the same days available as one pressing it
    // at 08:00. Both inputs are wall-clock days, so both ends are floored.
    ['00:01', '12:00', '23:50'].forEach(time => {
      expect(
        maxCleaningDaysBeforeNextBooking({
          returnedAt: at('2026-08-26', time),
          nextBookingStart: at('2026-08-29', '00:00'),
          timeZone: UTC,
        })
      ).toBe(2);
    });
  });

  it('is 0 when the next rental starts tomorrow, and never negative', () => {
    // A late return can leave no room at all. 0 is the honest answer - ready today, because it
    // has to be - and a negative number would be meaningless to a caller that wants to show it.
    expect(
      maxCleaningDaysBeforeNextBooking({
        returnedAt: at('2026-08-28'),
        nextBookingStart: at('2026-08-29', '00:00'),
        timeZone: UTC,
      })
    ).toBe(0);
    expect(
      maxCleaningDaysBeforeNextBooking({
        returnedAt: at('2026-08-30'),
        nextBookingStart: at('2026-08-29', '00:00'),
        timeZone: UTC,
      })
    ).toBe(0);
  });

  it('is null when nothing is booked next, so there is no ceiling at all', () => {
    // null and 0 must not be confused: one means "hold it as long as you need", the other
    // means "you have no days".
    [null, undefined, 'soon', new Date('nonsense')].forEach(nextBookingStart => {
      expect(
        maxCleaningDaysBeforeNextBooking({ returnedAt: at('2026-08-26'), nextBookingStart })
      ).toBeNull();
    });
  });
});

describe('resolveCleaningDays, capped', () => {
  it('cuts the studio down to what the calendar leaves it', () => {
    // THE REPORTED CASE. The studio asks for 4; the next rental starts in 2 days' room.
    expect(resolveCleaningDays({ requestedDays: 4, turnaroundDays: 2, maxDays: 2 })).toEqual({
      days: 2,
      source: 'laundry',
      requestedDays: 4,
      cappedByNextBooking: true,
    });
  });

  it('caps the configured turnaround too, not just a typed number', () => {
    // A studio that types nothing gets its configured turnaround - which can overrun the next
    // booking just as easily.
    expect(resolveCleaningDays({ turnaroundDays: 5, maxDays: 1 })).toEqual({
      days: 1,
      source: 'configured-turnaround',
      requestedDays: 5,
      cappedByNextBooking: true,
    });
  });

  it('caps to 0 when there is no room at all', () => {
    // The client chose this over flagging the next booking: the garment goes back out without
    // the wash its studio asked for.
    expect(resolveCleaningDays({ requestedDays: 3, turnaroundDays: 2, maxDays: 0 })).toEqual({
      days: 0,
      source: 'laundry',
      requestedDays: 3,
      cappedByNextBooking: true,
    });
  });

  it('leaves a request that fits completely alone', () => {
    // No `cappedByNextBooking` key at all, so a caller cannot mistake a normal return for a
    // shortened one.
    expect(resolveCleaningDays({ requestedDays: 2, turnaroundDays: 2, maxDays: 5 })).toEqual({
      days: 2,
      source: 'laundry',
    });
  });

  it('does not cap when there is no next booking', () => {
    // `maxDays` null/undefined is "no ceiling", and must not be read as zero.
    [null, undefined].forEach(maxDays => {
      expect(resolveCleaningDays({ requestedDays: 9, turnaroundDays: 2, maxDays })).toEqual({
        days: 9,
        source: 'laundry',
      });
    });
  });
});
