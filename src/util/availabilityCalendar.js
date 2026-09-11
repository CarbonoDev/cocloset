import { getStartOf, getStartOfWeek, isDateSameOrAfter, isInRange } from './dates';
import { isDayInCleaningGap } from './cleaningGaps';

/**
 * THE READ-ONLY AVAILABILITY CALENDAR.
 *
 *   > "el calendario que aparece ahi solo es informativo, no tiene uso mas que para ver
 *   >  disponibilidad de las próximas 5 semanas"
 *
 * It answers one question per day, in four colours, and the client named the distinction that
 * makes it worth building at all:
 *
 *   > "Debemos identificar cual es cleaning y cual es booked"
 *
 * BOOKED and CLEANING are different facts about a garment and they come from different places.
 * "Booked" is availability: somebody has it. "Cleaning" is the turnaround owed after a rental,
 * which the availability API does NOT know about - the exception that should say so is written
 * from a browser after the provider accepts and, on Dev, is simply not there (see
 * server/api-util/cleaningGaps.js). So the cleaning days arrive as their own list, resolved
 * server-side, and this module keeps the two apart rather than collapsing them into "grey".
 *
 * Precedence, when a day could be more than one thing:
 *
 *   1. SELECTED - what the customer is about to book. It is the answer to "what am I doing",
 *      and it wins over everything: the picker only offers a start date whose whole window is
 *      free, so a selected day that also looks booked means the two disagree, and hiding that
 *      behind a grey square would hide a bug.
 *   2. CLEANING - more specific than "booked" and the reason the client asked for this. A day
 *      that is BOTH (the buffer exception did land) is a cleaning day; saying "booked" would
 *      be true but less true.
 *   3. BOOKED - not inside any free time slot.
 *   4. AVAILABLE.
 *
 * A day with no containing time slot at all - past the fetched months - is BOOKED rather than
 * available, the same direction BookingRentalPeriodForm errs in: an unknown day must not be
 * painted as bookable.
 */

export const DAY_AVAILABLE = 'available';
export const DAY_SELECTED = 'selected';
export const DAY_BOOKED = 'booked';
export const DAY_CLEANING = 'cleaning';

/**
 * Free, but no rental fits from here.
 *
 *   > "nota que no aparecen ocupados ni el 10 que es hoy, ni 11 ni 12; pero el calendario a
 *   >  buscar no estan habilitados" (Jonathan, 2026-09-10)
 *
 * Both views were telling the truth and contradicting each other. This strip answers "is this
 * day booked", and the 10th genuinely was not; the picker above it answers "can a rental START
 * here", and a seven-day rental from the 10th ran into a booking on the 13th. Two right
 * answers, stacked, reading as one wrong one.
 *
 * So a day the picker will refuse stops calling itself "Available". It is not `booked` either
 * - nobody has it - and saying so would be a different lie. It is its own thing: the garment
 * is free, the rental does not fit.
 */
export const DAY_NO_ROOM = 'noRoom';

/**
 * A day that has gone by. NOT one of the four the legend explains.
 *
 * It exists because the alternative is worse. A rental is a whole day, so Sharetribe stops
 * offering today the moment today starts - its first free slot begins at tomorrow's midnight.
 * Classified by availability alone, today therefore comes out BOOKED, and the calendar paints
 * a solid "somebody has this garment" square on a garment that is sitting on a rack. Verified
 * in the browser against Dev, which is the only place it shows.
 *
 * So a day nobody can book any more is its own thing: drawn dim and neutral, named for what it
 * is, and kept out of the legend - which describes the states of the GARMENT, and this is a
 * fact about the clock.
 */
export const DAY_PAST = 'past';

/** How many weeks the calendar shows. The client asked for five. */
export const CALENDAR_WEEKS = 5;

/**
 * Is this day inside a free time slot?
 *
 * @param {Date} day - midnight in the listing's zone
 * @param {Array<Object>} allTimeSlots - merged slots, from booking.shared `getAllTimeSlots`
 * @param {string} [timeZone]
 * @returns {boolean}
 */
const isDayFree = (day, allTimeSlots, timeZone) =>
  Array.isArray(allTimeSlots) &&
  allTimeSlots.some(slot => {
    const start = slot?.attributes?.start;
    const end = slot?.attributes?.end;
    if (!start || !end) {
      return false;
    }
    // THE SLOT'S START IS FLOORED TO ITS DAY, and that is not cosmetic. Availability is
    // fetched from NOW, so the slot covering today begins at whatever o'clock the page was
    // loaded - 04:54 rather than midnight. Compared as an instant, midnight today falls
    // outside it and TODAY renders as booked on every listing, every day. A day-unit listing
    // is bookable for a whole day or not at all, so the day is the unit of comparison.
    return isInRange(day, getStartOf(start, 'day', timeZone), end, 'day', timeZone);
  });

/**
 * The days the customer's current pick covers: the rental period itself, NOT the turnaround.
 *
 * The buffer after it belongs to the studio, not to the renter, and painting it as "your
 * selection" would tell a customer they have the garment for longer than they do - the exact
 * confusion the derived end date under the picker exists to prevent.
 *
 * @param {Date} [startDate]
 * @param {number} [periodDays]
 * @param {string} [timeZone]
 * @returns {{start: Date, end: Date}|null}
 */
export const selectedRange = (startDate, periodDays, timeZone) => {
  if (!(startDate instanceof Date) || !(periodDays > 0)) {
    return null;
  }
  const start = getStartOf(startDate, 'day', timeZone);
  return { start, end: getStartOf(start, 'day', timeZone, periodDays, 'days') };
};

/**
 * Classify one day.
 *
 * @param {Object} params
 * @param {Date} params.day - midnight in the listing's zone
 * @param {Array<Object>} [params.allTimeSlots]
 * @param {Array<{start: Date, end: Date}>} [params.cleaningGaps]
 * @param {{start: Date, end: Date}} [params.selection]
 * @param {string} [params.timeZone]
 * @param {number} [params.windowDays] - the rental window a start here would need. Omitted
 *   when no period is chosen yet, and then no day is classified DAY_NO_ROOM - "nothing fits"
 *   is not something that can be said before there is something to fit.
 * @returns {string} one of the DAY_* constants
 */
export const classifyDay = ({
  day,
  allTimeSlots,
  cleaningGaps,
  selection,
  timeZone,
  windowDays,
}) => {
  const time = day.getTime();

  if (selection && time >= selection.start.getTime() && time < selection.end.getTime()) {
    return DAY_SELECTED;
  }
  if (isDayInCleaningGap(day, cleaningGaps, timeZone)) {
    return DAY_CLEANING;
  }
  if (!isDayFree(day, allTimeSlots, timeZone)) {
    return DAY_BOOKED;
  }

  // Free, and then asked the picker's question: does a whole rental fit from here. Checked
  // LAST, so a booked day still reads as booked - "no room" is only interesting about a day
  // that is otherwise yours.
  const fits =
    windowDays > 0 ? isWindowFree(day, windowDays, allTimeSlots, cleaningGaps, timeZone) : true;
  return fits ? DAY_AVAILABLE : DAY_NO_ROOM;
};

/**
 * Is the whole rental window free, starting on this day?
 *
 * The strip's copy of the rule the picker enforces (isWindowAvailableFn in
 * BookingRentalPeriodForm). Deliberately a copy of the QUESTION rather than a shared function:
 * the picker works from monthly time slots it fetches per month and a set of cleaning gaps,
 * and this works from the merged slots the strip already holds. Sharing would mean handing one
 * of them the other's data structure for no gain.
 *
 * Erring: an unfetched day has no containing slot, so it reads as not free and the day shows
 * as no-room rather than as available. That is the safe direction - it never promises a start
 * the picker will refuse.
 *
 * @param {Date} day
 * @param {number} windowDays
 * @param {Array<Object>} [allTimeSlots]
 * @param {Array<{start: Date, end: Date}>} [cleaningGaps]
 * @param {string} [timeZone]
 * @returns {boolean}
 */
export const isWindowFree = (day, windowDays, allTimeSlots, cleaningGaps, timeZone) => {
  const slots = Array.isArray(allTimeSlots) ? allTimeSlots : [];
  const windowEnd = getStartOf(day, 'day', timeZone, windowDays, 'days');

  // ONE containing slot, not a walk over every day in the window. Walking was the obvious
  // implementation and it is measurably the wrong one: this runs for all 35 cells on every
  // render of the strip, so a fortnight-long window turned one classification into hundreds
  // of time-zone conversions and slowed the panel enough to fail a test that waits on it.
  //
  // Availability arrives as contiguous free blocks, so "is the whole window free" is the same
  // question as "does one block contain it" - which is also exactly how the picker asks it
  // (isWindowAvailableFn in BookingRentalPeriodForm).
  const containing = slots.find(slot => {
    const slotStart = slot?.attributes?.start;
    const slotEnd = slot?.attributes?.end;
    if (!slotStart || !slotEnd) {
      return false;
    }
    // Floored to its day for the same reason isDayFree floors it: availability is fetched
    // from NOW, so today's slot starts at whatever o'clock the page was loaded.
    return isInRange(day, getStartOf(slotStart, 'day', timeZone), slotEnd, 'day', timeZone);
  });

  if (!containing || !isDateSameOrAfter(containing.attributes.end, windowEnd)) {
    return false;
  }

  // Cleaning gaps are separate from availability - the day a rental ends is owed to that
  // rental's wash, and no time slot says so. There are only ever a handful, so this one stays
  // a walk.
  for (let offset = 0; offset < windowDays; offset += 1) {
    if (
      isDayInCleaningGap(getStartOf(day, 'day', timeZone, offset, 'days'), cleaningGaps, timeZone)
    ) {
      return false;
    }
  }
  return true;
};

/**
 * The five weeks the calendar draws, as a flat list of classified days.
 *
 * STARTS ON THE WEEK CONTAINING TODAY, not on today itself, so the grid keeps its weekday
 * columns - a five-row block whose first row starts on a Wednesday reads as a bug. Days before
 * today are still drawn, and are never `available`: a date that has passed is not bookable and
 * painting it as free would be a lie the picker then refuses.
 *
 * @param {Object} params
 * @param {Date} params.today
 * @param {Array<Object>} [params.allTimeSlots]
 * @param {Array<{start: Date, end: Date}>} [params.cleaningGaps]
 * @param {Date} [params.selectedStartDate]
 * @param {number} [params.selectedPeriodDays]
 * @param {string} [params.timeZone]
 * @param {number} [params.firstDayOfWeek] - the marketplace's configured first weekday, so the
 *   columns line up with every other calendar in the app rather than assuming Sunday
 * @param {number} [params.weeks]
 * @returns {Array<{date: Date, status: string, isPast: boolean}>}
 */
export const buildCalendarDays = ({
  today,
  allTimeSlots,
  cleaningGaps,
  selectedStartDate,
  selectedPeriodDays,
  timeZone,
  firstDayOfWeek,
  weeks = CALENDAR_WEEKS,
  windowDays,
}) => {
  const startOfToday = getStartOf(today, 'day', timeZone);
  const firstDay = getStartOfWeek(startOfToday, timeZone, firstDayOfWeek);
  const selection = selectedRange(selectedStartDate, selectedPeriodDays, timeZone);

  return Array.from({ length: weeks * 7 }, (_, index) => {
    const date = getStartOf(firstDay, 'day', timeZone, index, 'days');
    const status = classifyDay({
      day: date,
      allTimeSlots,
      cleaningGaps,
      selection,
      timeZone,
      windowDays,
    });

    // Gone by, or gone by for booking purposes. Today counts when availability no longer
    // offers it - which for a day-unit rental is from the moment today begins. See DAY_PAST.
    const isPast =
      date.getTime() < startOfToday.getTime() ||
      (date.getTime() === startOfToday.getTime() && status === DAY_BOOKED);

    return { date, isPast, status: isPast ? DAY_PAST : status };
  });
};
