import { isBookableFrom, withoutUnbookableListings } from './searchCleaningFloor';

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
