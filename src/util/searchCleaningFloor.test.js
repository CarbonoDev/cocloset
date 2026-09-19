import {
  isBookableFrom,
  isPickupTodayListing,
  showPickupTodayOnListingPage,
  withOnlyPickupTodayListings,
  withoutUnbookableListings,
} from './searchCleaningFloor';

/**
 * WHY THIS FILE EXISTS
 *
 *   > "tengo un listing que estará disponible hasta el día 22 de septiembre; sin embargo,
 *   >  cuando hago filtros por fecha, al seleccionar por ejemplo el día 10 (...) aparece el
 *   >  listing como resultado de la búsqueda" (Jonathan, 2026-09-10)
 *
 * The date filter was not wrong - it asked Sharetribe's calendar, which has no idea about the
 * initial cleaning lead time, because that time is relative to a drop-off that has not
 * happened. This is the third place that rule now runs, after the picker and the checkout
 * gate, and the thing worth pinning is that it hides exactly the garments a booking would
 * refuse: no more, or the marketplace loses stock nobody can explain.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const today = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};
const daysFromToday = n => new Date(today().getTime() + n * MS_PER_DAY);

const listing = ({ id = 'l1', initialCleaningDays, onLaundry, readyAt } = {}) => ({
  id: { uuid: id },
  type: 'listing',
  attributes: {
    availabilityPlan: { timezone: 'Etc/UTC' },
    metadata: { initialCleaningDays, onLaundry, readyAt },
  },
});

describe('a garment the calendar offers and a booking would refuse', () => {
  it('is hidden when its first wash has not been done yet', () => {
    // 12 days of lead time, asked for tomorrow.
    const garment = listing({ initialCleaningDays: 12, onLaundry: false });

    expect(isBookableFrom(garment, daysFromToday(1))).toBe(false);
  });

  it('is shown once the requested day is past the lead time', () => {
    const garment = listing({ initialCleaningDays: 12, onLaundry: false });

    expect(isBookableFrom(garment, daysFromToday(20))).toBe(true);
  });

  it('is shown when the studio already has it', () => {
    // The lead time is spent. `onLaundry` is the same discriminator the picker uses.
    const garment = listing({ initialCleaningDays: 12, onLaundry: true });

    expect(isBookableFrom(garment, daysFromToday(1))).toBe(true);
  });

  it('is shown when nothing blocks it at all', () => {
    expect(isBookableFrom(listing({}), daysFromToday(1))).toBe(true);
  });

  it('is shown when no dates were asked for', () => {
    // A search with no date filter must hide nothing: the reader has not said when they want
    // it, and every one of these garments is bookable on SOME day.
    const garment = listing({ initialCleaningDays: 12, onLaundry: false });

    expect(isBookableFrom(garment, null)).toBe(true);
  });
});

// -------------------------------------------------------------------------
//   > "la tag debe ser mostrada para los listings que esten en laundry y que esten
//   >  disponibles para hoy" (Jonathan, 2026-09-11)
// -------------------------------------------------------------------------
describe('isPickupTodayListing', () => {
  it('is false when the garment has never reached its laundry', () => {
    // Free today per the cleaning floor, but onLaundry is the first condition, not an
    // afterthought - a garment still with its owner is not collectable from a studio.
    expect(isPickupTodayListing(listing({ onLaundry: false }), today())).toBe(false);
    expect(isPickupTodayListing(listing({}), today())).toBe(false);
  });

  it('is true when at the studio and nothing blocks today', () => {
    expect(isPickupTodayListing(listing({ onLaundry: true }), today())).toBe(true);
  });

  // `initialCleaningDays` stops mattering once `onLaundry` is true - resolveInitialCleaningDays
  // treats that flag as proof the first-time lead time has already been spent, first and
  // regardless of the stored number. A stale value left over from before the handoff must not
  // resurrect a rule that no longer applies.
  it('ignores a stale initialCleaningDays once the garment has actually reached the studio', () => {
    const garment = listing({ onLaundry: true, initialCleaningDays: 12 });

    expect(isPickupTodayListing(garment, today())).toBe(true);
  });

  it('is false when a post-rental readyAt has not passed yet', () => {
    const garment = listing({ onLaundry: true, readyAt: daysFromToday(2).toISOString() });

    expect(isPickupTodayListing(garment, today())).toBe(false);
  });

  it('is true once a past readyAt has cleared', () => {
    const garment = listing({ onLaundry: true, readyAt: daysFromToday(-2).toISOString() });

    expect(isPickupTodayListing(garment, today())).toBe(true);
  });
});

describe('withOnlyPickupTodayListings', () => {
  const responseWith = (listings, totalItems) => ({
    data: { data: listings, meta: { totalItems, totalPages: 3, page: 1, perPage: 24 } },
  });

  it('keeps only listings on laundry and free today, and corrects the count', () => {
    const response = responseWith(
      [
        listing({ id: 'pickup-today', onLaundry: true }),
        listing({ id: 'not-on-laundry', onLaundry: false }),
        listing({ id: 'still-cleaning', onLaundry: true, readyAt: daysFromToday(2).toISOString() }),
      ],
      17
    );

    const filtered = withOnlyPickupTodayListings(response);

    expect(filtered.data.data.map(l => l.id.uuid)).toEqual(['pickup-today']);
    expect(filtered.data.meta.totalItems).toBe(15);
  });

  it('returns the response untouched when everything qualifies', () => {
    const response = responseWith([listing({ onLaundry: true })], 17);

    expect(withOnlyPickupTodayListings(response)).toBe(response);
  });
});

// -------------------------------------------------------------------------
//   > "Hay unas prendas que tienen el tag de Pickup Today, pero al entrar al listing page de
//   >  ese artículo, en realidad no podemos pedir hoy si no hasta dentro de varios días, un
//   >  ejemplo de esto es el artículo con id 6aa26840-16da-44df-8a74-ff4ece1da4eb" (Jonathan,
//   >  2026-09-19)
//
// Reproduces the reported listing exactly: onLaundry true, no cleaning-floor block at all (so
// isPickupTodayListing alone says yes), but its only real free time slot starts tomorrow.
// -------------------------------------------------------------------------
describe('showPickupTodayOnListingPage', () => {
  const timeSlot = (start, end) => ({
    attributes: { start, end, type: 'time-full', seats: 1 },
  });

  it('is false when the approximation alone would say yes', () => {
    expect(isPickupTodayListing(listing({ onLaundry: true }), today())).toBe(true);
  });

  it("shows optimistically before any month's time slots have loaded", () => {
    expect(showPickupTodayOnListingPage(listing({ onLaundry: true }), {}, today())).toBe(true);
    expect(
      showPickupTodayOnListingPage(
        listing({ onLaundry: true }),
        { '2026-09': { fetchTimeSlotsInProgress: true } },
        today()
      )
    ).toBe(true);
  });

  it('is false once the real calendar shows today has nothing free at all - the reported bug', () => {
    const garment = listing({ onLaundry: true });
    // The exact shape of the reported listing: free, but not until tomorrow.
    const monthlyTimeSlots = {
      '2026-09': { timeSlots: [timeSlot(daysFromToday(1), daysFromToday(30))] },
    };

    expect(showPickupTodayOnListingPage(garment, monthlyTimeSlots, today())).toBe(false);
  });

  it('is true once the real calendar confirms today is inside a free slot', () => {
    const garment = listing({ onLaundry: true });
    const monthlyTimeSlots = {
      '2026-09': { timeSlots: [timeSlot(today(), daysFromToday(30))] },
    };

    expect(showPickupTodayOnListingPage(garment, monthlyTimeSlots, today())).toBe(true);
  });

  it('never overrides a "no" from the approximation itself', () => {
    // Not on laundry at all - the real calendar cannot make this a yes.
    const garment = listing({ onLaundry: false });
    const monthlyTimeSlots = {
      '2026-09': { timeSlots: [timeSlot(today(), daysFromToday(30))] },
    };

    expect(showPickupTodayOnListingPage(garment, monthlyTimeSlots, today())).toBe(false);
  });
});

describe('the count it reports', () => {
  const responseWith = (listings, totalItems) => ({
    data: { data: listings, meta: { totalItems, totalPages: 3, page: 1, perPage: 24 } },
  });

  it('drops the unbookable garments and takes them off the total', () => {
    //   > "trata de corregir el conteo" (Jonathan, 2026-09-10)
    const response = responseWith(
      [
        listing({ id: 'ok', onLaundry: true }),
        listing({ id: 'blocked', initialCleaningDays: 12, onLaundry: false }),
      ],
      17
    );

    const filtered = withoutUnbookableListings(response, daysFromToday(1));

    expect(filtered.data.data.map(l => l.id.uuid)).toEqual(['ok']);
    expect(filtered.data.meta.totalItems).toBe(16);
  });

  it('leaves the page count alone', () => {
    // `totalPages` is what the pager is built from. Shrinking it on the strength of one page
    // would remove pages that still hold results.
    const response = responseWith([listing({ initialCleaningDays: 12, onLaundry: false })], 17);

    const filtered = withoutUnbookableListings(response, daysFromToday(1));

    expect(filtered.data.meta.totalPages).toBe(3);
  });

  it('never claims fewer than none', () => {
    const response = responseWith([listing({ initialCleaningDays: 12, onLaundry: false })], 0);

    expect(withoutUnbookableListings(response, daysFromToday(1)).data.meta.totalItems).toBe(0);
  });

  it('returns the response untouched when nothing was dropped', () => {
    // Identity, not a copy: every other search on the site goes through here.
    const response = responseWith([listing({ onLaundry: true })], 17);

    expect(withoutUnbookableListings(response, daysFromToday(1))).toBe(response);
  });

  it('returns the response untouched when no dates were asked for', () => {
    const response = responseWith([listing({ initialCleaningDays: 12, onLaundry: false })], 17);

    expect(withoutUnbookableListings(response, null)).toBe(response);
  });

  it('survives a response with no listings array', () => {
    const broken = { data: { meta: {} } };
    expect(withoutUnbookableListings(broken, daysFromToday(1))).toBe(broken);
  });
});
