const {
  STATES_AWAITING_CLEANING,
  countCompletedRentals,
  resolveGapDays,
  occupiedWindow,
  collectBookingsAwaitingCleaning,
  computeCleaningGaps,
  assertCleaningGap,
} = require('./cleaningGaps');

// The client reported this with both ends named:
//
//   > "Sigue sin respetarse el buffer de dias de limpieza (Revisa los dias antes del booking
//   >  y despues de que se regresa)"
//
// They are one rule. A booking occupies its rental days PLUS the turnaround after them, and
// two occupied windows may not overlap - which refuses a rental that starts the day another
// ends AND a rental that ends the day another starts.
//
// The dates below are the client's own from Dev, 2026-08-14: a 7-day rental of a garment at a
// studio with a 2-day turnaround, booked 17-24 Aug, followed eleven minutes later by a second
// booking starting on the 24th.

const day = iso => new Date(`${iso}T00:00:00.000Z`);
const UTC = 'Etc/UTC';

const FIRST_RENTAL = { start: day('2026-08-17'), end: day('2026-08-24') };

describe('resolveGapDays', () => {
  it('takes whole days and rounds a fraction up', () => {
    // Under-blocking means offering a garment that is still in the wash.
    expect(resolveGapDays(2)).toBe(2);
    expect(resolveGapDays(1.2)).toBe(2);
    expect(resolveGapDays('3')).toBe(3);
  });

  it('reads every non-answer as no gap', () => {
    [0, -1, null, undefined, NaN, 'soon', {}].forEach(value => {
      expect(resolveGapDays(value)).toBe(0);
    });
  });

  it('clamps an absurd value rather than taking a garment off the market for a decade', () => {
    expect(resolveGapDays(4000)).toBe(365);
  });
});

describe('occupiedWindow', () => {
  it('runs from the rental start to the turnaround after its end', () => {
    const window = occupiedWindow(FIRST_RENTAL, 2, UTC);
    expect(window.start.toISOString()).toBe('2026-08-17T00:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-08-26T00:00:00.000Z');
  });

  it('is the rental itself when there is no turnaround to hold', () => {
    const window = occupiedWindow(FIRST_RENTAL, 0, UTC);
    expect(window.end.toISOString()).toBe('2026-08-24T00:00:00.000Z');
  });
});

describe('assertCleaningGap', () => {
  const bookings = [FIRST_RENTAL];

  it('refuses a rental that starts the day the previous one ends', () => {
    // THE REPORTED BUG, exactly. The 24th is the first day of the wash, not the first day
    // the garment is free.
    expect(() =>
      assertCleaningGap({
        bookingStart: day('2026-08-24'),
        bookingEnd: day('2026-08-31'),
        bookings,
        turnaroundDays: 2,
        timeZone: UTC,
      })
    ).toThrow(/cleaning between rentals/);
  });

  it('names the day the garment is next free, and its own error code', () => {
    try {
      assertCleaningGap({
        bookingStart: day('2026-08-24'),
        bookingEnd: day('2026-08-31'),
        bookings,
        turnaroundDays: 2,
        timeZone: UTC,
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.status).toBe(400);
      // Distinct from 'booking-before-cleaning-ready': that one means "this garment is in a
      // wash right now", this one means "another rental has claimed the wash around then".
      expect(e.data.code).toBe('booking-inside-cleaning-gap');
      expect(e.data.conflictEnd).toBe('2026-08-26T00:00:00.000Z');
    }
  });

  it('allows the first day after the turnaround', () => {
    // Half-open: the 26th is the first free day, not the last blocked one. Off by one here
    // costs the owner a day of availability after every rental.
    expect(() =>
      assertCleaningGap({
        bookingStart: day('2026-08-26'),
        bookingEnd: day('2026-09-02'),
        bookings,
        turnaroundDays: 2,
        timeZone: UTC,
      })
    ).not.toThrow();
  });

  it('refuses a rental that ends the day another one starts', () => {
    // "los dias antes del booking" - the same rule from the other side. This rental would
    // come back on the 17th with nowhere to be washed.
    expect(() =>
      assertCleaningGap({
        bookingStart: day('2026-08-10'),
        bookingEnd: day('2026-08-17'),
        bookings,
        turnaroundDays: 2,
        timeZone: UTC,
      })
    ).toThrow(/cleaning between rentals/);
  });

  it('allows a rental that leaves the turnaround before the next one', () => {
    expect(() =>
      assertCleaningGap({
        bookingStart: day('2026-08-08'),
        bookingEnd: day('2026-08-15'),
        bookings,
        turnaroundDays: 2,
        timeZone: UTC,
      })
    ).not.toThrow();
  });

  it('is a no-op with no turnaround, no other bookings, or unusable dates', () => {
    const cases = [
      { bookings, turnaroundDays: 0 },
      { bookings: [], turnaroundDays: 2 },
      { bookings, turnaroundDays: 2, bookingStart: 'not a date' },
    ];
    cases.forEach(overrides => {
      expect(() =>
        assertCleaningGap({
          bookingStart: day('2026-08-24'),
          bookingEnd: day('2026-08-31'),
          timeZone: UTC,
          ...overrides,
        })
      ).not.toThrow();
    });
  });
});

describe('collectBookingsAwaitingCleaning', () => {
  const booking = (id, start, end) => ({
    id: { uuid: id },
    type: 'booking',
    attributes: { start: day(start), end: day(end) },
  });
  const tx = (id, lastTransition, bookingId) => ({
    id: { uuid: id },
    attributes: { lastTransition },
    relationships: { booking: { data: { id: { uuid: bookingId } } } },
  });

  const included = [
    booking('b1', '2026-08-17', '2026-08-24'),
    booking('b2', '2026-07-01', '2026-07-08'),
  ];

  it('keeps a booking whose garment has not come back yet', () => {
    const collected = collectBookingsAwaitingCleaning({
      transactions: [tx('t1', 'transition/accept', 'b1')],
      included,
    });
    expect(collected).toHaveLength(1);
    expect(collected[0].end.toISOString()).toBe('2026-08-24T00:00:00.000Z');
  });

  it('drops one the studio has already taken back', () => {
    // `metadata.readyAt` holds that window, from the REAL return date. Projecting
    // bookingEnd + turnaround on top of it would double-block a rental returned early -
    // which is exactly the shape of the client's own Dev data.
    ['transition/laundry-confirm-return', 'transition/laundry-mark-available'].forEach(t => {
      expect(
        collectBookingsAwaitingCleaning({ transactions: [tx('t1', t, 'b1')], included })
      ).toEqual([]);
    });
  });

  it('drops a booking that never happened', () => {
    ['transition/decline', 'transition/expire-payment', 'transition/expire'].forEach(t => {
      expect(
        collectBookingsAwaitingCleaning({ transactions: [tx('t1', t, 'b1')], included })
      ).toEqual([]);
    });
  });

  it('holds days for a checkout that is still in progress', () => {
    // Sharetribe already reserved the days at `request-payment`, so the turnaround after them
    // has to be held too - otherwise two checkouts a minute apart agree on a gap that neither
    // of them leaves.
    expect(STATES_AWAITING_CLEANING).toContain('pending-payment');
    const collected = collectBookingsAwaitingCleaning({
      transactions: [tx('t1', 'transition/request-payment', 'b1')],
      included,
    });
    expect(collected).toHaveLength(1);
  });

  it('never compares a transaction against itself', () => {
    const collected = collectBookingsAwaitingCleaning({
      transactions: [tx('t1', 'transition/accept', 'b1')],
      included,
      excludeTransactionId: 't1',
    });
    expect(collected).toEqual([]);
  });

  it('skips a transaction whose booking was not included', () => {
    expect(
      collectBookingsAwaitingCleaning({
        transactions: [tx('t1', 'transition/accept', 'b9')],
        included,
      })
    ).toEqual([]);
  });
});

describe('computeCleaningGaps', () => {
  it('is the turnaround that follows each rental', () => {
    const gaps = computeCleaningGaps({
      bookings: [FIRST_RENTAL],
      turnaroundDays: 2,
      timeZone: UTC,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].start.toISOString()).toBe('2026-08-24T00:00:00.000Z');
    expect(gaps[0].end.toISOString()).toBe('2026-08-26T00:00:00.000Z');
  });

  it('returns one per booking, in order', () => {
    const gaps = computeCleaningGaps({
      bookings: [FIRST_RENTAL, { start: day('2026-07-01'), end: day('2026-07-08') }],
      turnaroundDays: 1,
      timeZone: UTC,
    });
    expect(gaps.map(g => g.start.toISOString().slice(0, 10))).toEqual(['2026-07-08', '2026-08-24']);
  });

  it('is empty when there is no turnaround to hold', () => {
    expect(computeCleaningGaps({ bookings: [FIRST_RENTAL], turnaroundDays: 0 })).toEqual([]);
  });
});

describe('countCompletedRentals', () => {
  // > "Quiza podriamos contabilizar las transacciones exitosas para ese listing y mostrar
  // >  este dato, de lo contrario lo omitimos"
  //
  // Counted from the transactions query the gap rule already makes, so it costs nothing.
  const tx = lastTransition => ({ id: { uuid: 'x' }, attributes: { lastTransition } });

  it('counts a rental that ran its course', () => {
    expect(countCompletedRentals([tx('transition/laundry-mark-available')])).toBe(1);
  });

  it('still counts it once somebody has reviewed it', () => {
    // A garment must not lose a rental from its count because a review was written about it.
    const reviewed = [
      'transition/review-1-by-customer',
      'transition/review-1-by-provider',
      'transition/review-2-by-customer',
      'transition/review-2-by-provider',
      'transition/expire-review-period',
    ];
    reviewed.forEach(t => {
      expect(countCompletedRentals([tx(t)])).toBe(1);
    });
  });

  it('does not count a rental that is still running, or one that never happened', () => {
    const notCompleted = [
      'transition/request-payment',
      'transition/confirm-payment',
      'transition/accept',
      'transition/laundry-confirm-pickup',
      'transition/laundry-confirm-return',
      'transition/decline',
      'transition/expire-payment',
    ];
    notCompleted.forEach(t => {
      expect(countCompletedRentals([tx(t)])).toBe(0);
    });
  });

  it('is zero, not a crash, for an empty or absent list', () => {
    expect(countCompletedRentals([])).toBe(0);
    expect(countCompletedRentals()).toBe(0);
  });
});
