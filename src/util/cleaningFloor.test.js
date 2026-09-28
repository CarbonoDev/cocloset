import { canBeCollectedToday, earliestBookableStart } from './cleaningFloor';

/**
 * WHY THIS FILE EXISTS
 *
 *   > "el UX debe permitirnos hacer el booking a partir del día de hoy, sea cual sea la hora,
 *   >  solo en aquellos listings que cumplan esas condiciones, que esten en laundry y que hayan
 *   >  terminado su proceso de lavado" (Jonathan, 2026-09-28)
 *
 * `canBeCollectedToday` is the "solo en aquellos listings" half of that sentence, and it is
 * shared: the booking picker uses it to decide whether today's date may be clicked
 * (isWindowAvailableFn in BookingRentalPeriodForm) and the "Pickup Today" badge uses it to
 * decide whether to appear (isPickupTodayListing in searchCleaningFloor.js). The two
 * disagreeing is a reported bug class, not a hypothetical - see the 2026-09-19 entry in that
 * file - so the rule has one implementation and this is where it is pinned.
 */

const TZ = 'Etc/UTC';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// A fixed instant late in the day, because "late in the day" is the case the client called
// out ("sea cual sea la hora") and the case an hours-based rule would get wrong.
const today = new Date(Date.UTC(2026, 8, 28, 23, 40, 0));
const startOfToday = new Date(Date.UTC(2026, 8, 28));
const daysFromToday = n => new Date(startOfToday.getTime() + n * MS_PER_DAY);

describe('canBeCollectedToday', () => {
  it('is false for a garment that has not reached its laundry', () => {
    // The first of the client's two conditions, and `=== true` like every other reader of
    // custody: a garment still in its owner's wardrobe cannot be collected from a studio,
    // whatever the calendar says.
    expect(canBeCollectedToday(false, startOfToday, TZ, today)).toBe(false);
    expect(canBeCollectedToday(undefined, startOfToday, TZ, today)).toBe(false);
    expect(canBeCollectedToday('true', startOfToday, TZ, today)).toBe(false);
  });

  it('is true at the studio with a floor that has already been reached', () => {
    expect(canBeCollectedToday(true, startOfToday, TZ, today)).toBe(true);
    expect(canBeCollectedToday(true, daysFromToday(-3), TZ, today)).toBe(true);
  });

  it('is true at the studio with no floor at all', () => {
    // No stored turnaround and no wash in progress. `earliestBookableStartForListing` returns
    // null in that case rather than a date, and null is "nothing blocks it" - not "unknown".
    expect(canBeCollectedToday(true, null, TZ, today)).toBe(true);
  });

  it('is false while the garment is still in a wash', () => {
    // The second condition: "que hayan terminado su proceso de lavado". A `readyAt` in the
    // future floors the garment past today.
    expect(canBeCollectedToday(true, daysFromToday(1), TZ, today)).toBe(false);
    expect(canBeCollectedToday(true, daysFromToday(4), TZ, today)).toBe(false);
  });

  it('holds at 23:40, not just in the morning', () => {
    //   > "sea cual sea la hora"
    // The comparison is between two START-OF-DAY instants, so the hour the customer is
    // shopping cannot move the answer. An implementation that compared `now` against the
    // floor would flip this to false for every evening shopper.
    const morning = new Date(Date.UTC(2026, 8, 28, 6, 0, 0));
    expect(canBeCollectedToday(true, startOfToday, TZ, morning)).toBe(
      canBeCollectedToday(true, startOfToday, TZ, today)
    );
  });

  it('accepts the floor the picker actually computes for a garment at its studio', () => {
    // Composed with the real producer rather than a hand-made date: `onLaundry === true`
    // spends the initial-cleaning rule (resolveInitialCleaningDays returns null), so the floor
    // collapses to the start of today and today is offerable. This is the exact path the
    // booking picker takes.
    const floor = earliestBookableStart(null, undefined, TZ, today);

    expect(canBeCollectedToday(true, floor, TZ, today)).toBe(true);
  });

  it('refuses the floor the picker computes for a garment awaiting its first wash', () => {
    // 2 cleaning days, starting tomorrow, so the floor is 3 days out - and today is not it.
    const floor = earliestBookableStart(2, undefined, TZ, today);

    expect(canBeCollectedToday(true, floor, TZ, today)).toBe(false);
  });
});
