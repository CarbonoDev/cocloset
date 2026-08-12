import React, { useEffect, useState } from 'react';
import { Form as FinalForm } from 'react-final-form';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { required } from '../../../util/validators';
import {
  getStartOf,
  isDateSameOrAfter,
  isInRange,
  monthIdString,
  timeOfDayFromLocalToTimeZone,
  timeOfDayFromTimeZoneToLocal,
} from '../../../util/dates';
import { BOOKING_PROCESS_NAME } from '../../../transactions/transaction';
import { resolveCleaningWindowDays } from '../../../util/rentalPeriods';

import { Form, PrimaryButton, FieldSingleDatePicker, H6 } from '../../../components';

import EstimatedCustomerBreakdownMaybe from '../EstimatedCustomerBreakdownMaybe';
import FetchLineItemsError from '../FetchLineItemsError/FetchLineItemsError.js';
import {
  TODAY,
  getAllTimeSlots,
  nextMonthFn,
  prevMonthFn,
  showNextMonthStepper,
  showPreviousMonthStepper,
} from '../booking.shared';
import {
  earliestBookableDate,
  resolveInitialCleaningDays,
} from '../BookingDatesForm/BookingDatesForm';

import RentalPeriodChips from './RentalPeriodChips';
import css from './BookingRentalPeriodForm.module.css';

/**
 * FIXED-PERIOD BOOKING, FROM THE CUSTOMER'S SIDE.
 *
 *   > "el customer debe seleccionar uno de dos botones, estos botones deben parecer mas
 *   >  como chips, una vez seleccionado debe indicar solo un día, que es donde inicia la
 *   >  reserva, este día debe estar sujeto a la disponibilidad que ya trabajamos (la del
 *   >  listing y la de los días que indique laundry)"
 *
 * Two decisions, in order: WHICH period, then WHEN it starts. The end date is not a
 * decision at all — it is derived and displayed.
 *
 * This is a sibling of BookingDatesForm rather than a mode inside it. The two differ in the
 * only thing that form is about: BookingDatesForm asks for a RANGE and validates its length,
 * this one asks for a single day and derives the range. Folding them together would have
 * meant a range picker that is sometimes a day picker, with `minimumNights`, seats,
 * `isBlockedBetween` and the two-boundary time-slot dance all carrying an "unless fixed
 * period" branch. What IS shared — the initial-cleaning floor — is imported from there, so
 * the rule still has exactly one implementation.
 */

const dateFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };

/**
 * Availability for a whole window, not for a single day.
 *
 *   > "el booking se queda como 7 días mas los días que necesite laundry (...) debe empatar
 *   >  con lo demas trabajado de onLaundry y el siguiente periodo de lavado"
 *
 * A start date is offerable only when the ENTIRE window is free: the rental period itself,
 * plus the laundry's turnaround afterwards. Checking only the rental days would let a
 * customer book a week that ends the day before someone else's booking starts — the garment
 * would come back with nowhere to be washed, and the buffer write at accept time would
 * silently create nothing, because it only creates the sub-ranges that are not already
 * blocked (server/api-util/availabilityBuffer.js).
 *
 * IMPLEMENTED AGAINST THE MERGED TIME SLOTS, NOT A PER-DAY MAP. Availability arrives as
 * half-open `[start, end)` ranges which `getAllTimeSlots` merges across month boundaries, so
 * a fully free window is exactly a window that fits inside ONE slot. Asking a per-day map
 * instead would have needed the map to extend past the fetched months, where it holds
 * nothing — and "no entry" would then read as "available" for the tail of every window.
 * This way an unfetched day has no containing slot and the start date is refused, which is
 * the safe direction to be wrong in.
 *
 * @param {Array<Object>} allTimeSlots - merged time slots
 * @param {string} timeZone - IANA key
 * @returns {(startDay: Date, windowDays: number) => boolean}
 */
export const isWindowAvailableFn = (allTimeSlots, timeZone) => (startDay, windowDays) => {
  if (!(startDay instanceof Date) || !(windowDays > 0)) {
    return false;
  }
  const start = getStartOf(startDay, 'day', timeZone);
  const end = getStartOf(start, 'day', timeZone, windowDays, 'days');

  const containingSlot = allTimeSlots.find(ts =>
    isInRange(start, ts.attributes.start, ts.attributes.end, undefined, timeZone)
  );
  if (!containingSlot) {
    return false;
  }
  // The slot's end is exclusive and so is the window's, so a window that ends exactly when
  // the slot does is inside it. Getting this comparison wrong by one costs the customer the
  // last bookable start date of every availability block.
  return isDateSameOrAfter(containingSlot.attributes.end, end);
};

/**
 * The last day the picker may offer, given how far ahead this marketplace books.
 *
 * The whole window has to fit, so the last offerable START is the horizon minus the window.
 * Without this the picker would offer dates whose window runs past the fetched availability
 * and then refuse them through `isWindowAvailableFn` with no explanation — a date that
 * looks enabled and does nothing when clicked.
 *
 * @param {number} dayCountAvailableForBooking
 * @param {number} windowDays
 * @param {string} timeZone
 * @param {Date} [today]
 * @returns {Date}
 */
export const latestBookableStartDate = (
  dayCountAvailableForBooking,
  windowDays,
  timeZone,
  today = TODAY
) => getStartOf(today, 'day', timeZone, dayCountAvailableForBooking - windowDays, 'days');

const fetchMonthData = (
  date,
  listingId,
  dayCountAvailableForBooking,
  timeZone,
  onFetchTimeSlots
) => {
  const endOfRangeDate = getStartOf(TODAY, 'day', timeZone, dayCountAvailableForBooking, 'days');

  if (isInRange(date, TODAY, endOfRangeDate)) {
    const start = isDateSameOrAfter(TODAY, date) ? TODAY : date;
    const nextMonthDate = nextMonthFn(date, timeZone);
    const end = isDateSameOrAfter(nextMonthDate, endOfRangeDate)
      ? getStartOf(endOfRangeDate, 'day', timeZone)
      : nextMonthDate;

    onFetchTimeSlots(listingId, start, end, timeZone);
  }
};

const handleMonthClick = (
  currentMonth,
  monthlyTimeSlots,
  dayCountAvailableForBooking,
  timeZone,
  listingId,
  onFetchTimeSlots
) => monthFn => {
  // Populate the two invisible months the picker keeps ready. Two rather than one because a
  // window can run past the end of the visible month: the availability of a start date in
  // late September depends on data from October.
  fetchMonthData(
    monthFn(currentMonth, timeZone, 2),
    listingId,
    dayCountAvailableForBooking,
    timeZone,
    onFetchTimeSlots
  );

  const monthId = monthIdString(currentMonth, timeZone);
  const currentMonthData = monthlyTimeSlots[monthId];
  if (currentMonthData && currentMonthData.fetchTimeSlotsError) {
    fetchMonthData(
      currentMonth,
      listingId,
      dayCountAvailableForBooking,
      timeZone,
      onFetchTimeSlots
    );
  }
};

/**
 * The exclusive booking end for a start date and a period.
 *
 * Exclusive, matching the API and `daysBetween`: a 7-day rental starting on the 1st ends on
 * the 8th. `server/api-util/rentalPeriods.js` derives the same value and rejects anything
 * else, so this is the expression the server checks against.
 */
export const bookingEndForPeriod = (startDate, periodDays, timeZone) =>
  startDate && periodDays ? getStartOf(startDate, 'day', timeZone, periodDays, 'days') : null;

/**
 * The last day the customer actually has the garment.
 *
 * The exclusive end minus a day. This is what gets SHOWN — "el cliente va a seleccionar el
 * día de inicio por lo que verá la fecha final" — and it is deliberately the same
 * convention LineItemBookingPeriod uses for `line-item/day`, so the date on this form and
 * the date in the price breakdown underneath it are the same date.
 */
export const inclusiveEndForPeriod = (startDate, periodDays, timeZone) =>
  startDate && periodDays ? getStartOf(startDate, 'day', timeZone, periodDays - 1, 'days') : null;

/**
 * A form for booking a garment for a fixed rental period.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.rootClassName]
 * @param {string} [props.className]
 * @param {Object} props.price - the listing's price (the cheapest period)
 * @param {string} props.listingId
 * @param {boolean} props.isOwnListing
 * @param {Array<Object>} props.rentalPeriods - from util/rentalPeriods.js `getRentalPeriods`
 * @param {Object} props.monthlyTimeSlots
 * @param {Function} props.onFetchTimeSlots
 * @param {Array<Object>} [props.lineItems]
 * @param {boolean} props.fetchLineItemsInProgress
 * @param {propTypes.error} [props.fetchLineItemsError]
 * @param {Function} props.onFetchTransactionLineItems
 * @param {string} props.timeZone
 * @param {string} props.marketplaceName
 * @param {number} props.dayCountAvailableForBooking
 * @param {boolean} [props.onLaundry] - Cocloset: true once the garment reached its laundry
 * @param {number} [props.initialCleaningDays] - Cocloset: assignment-time snapshot of the
 *   laundry's turnaround
 * @param {number} [props.liveInitialCleaningDays] - Cocloset: the laundry's CURRENT
 *   turnaround, resolved at ListingPage load. Wins over the snapshot.
 * @returns {JSX.Element}
 */
export const BookingRentalPeriodForm = props => {
  const {
    rootClassName,
    className,
    price: unitPrice,
    listingId,
    isOwnListing,
    rentalPeriods = [],
    fetchLineItemsInProgress,
    onFetchTransactionLineItems,
    timeZone,
    dayCountAvailableForBooking,
    marketplaceName,
    payoutDetailsWarning,
    monthlyTimeSlots,
    onMonthChanged,
    onLaundry,
    initialCleaningDays,
    liveInitialCleaningDays,
    onSubmit,
    ...rest
  } = props;
  const intl = useIntl();
  const [currentMonth, setCurrentMonth] = useState(getStartOf(TODAY, 'month', timeZone));

  const allTimeSlots = getAllTimeSlots(monthlyTimeSlots, false);
  const monthId = monthIdString(currentMonth);

  useEffect(() => {
    if (onMonthChanged) {
      onMonthChanged(monthId);
    }
  }, [currentMonth, onMonthChanged]);

  const classes = classNames(rootClassName || css.root, className);

  // The initial cleaning lead time: how long before this garment can be rented AT ALL,
  // while it is still on its way to its laundry. Same resolution as the range picker uses,
  // imported rather than re-derived — the calendar floor and the server gate agree day for
  // day, and initialCleaningAgreement.test.js exists to keep them that way.
  const initialCleaningBlockDays = resolveInitialCleaningDays(
    initialCleaningDays,
    onLaundry,
    liveInitialCleaningDays
  );
  const earliestStartDate = earliestBookableDate(initialCleaningBlockDays, timeZone);

  // The laundry's turnaround, which has to fit AFTER the rental. Note this is the same
  // number as the initial cleaning lead time and is deliberately read even once
  // `onLaundry === true`, when the lead time no longer applies: the garment still has to be
  // washed between rentals. `resolveInitialCleaningDays` returns null in that case, which is
  // why the snapshot and the live value are passed here directly instead.
  const cleaningWindowDays = resolveCleaningWindowDays(
    liveInitialCleaningDays,
    initialCleaningDays
  );

  // The page's submit handler speaks the same language as every other order form:
  // `{ bookingDates: { startDate, endDate }, priceVariantName }` (see
  // ListingPage.shared.js `handleSubmit`). This form collects a start date and a period
  // instead, so the end date is derived HERE rather than by teaching the page a second
  // shape. `bookingEnd` is exclusive, matching the API and the server's own derivation in
  // api-util/rentalPeriods.js.
  const handleFormSubmit = values => {
    const period = rentalPeriods.find(p => p.name === values?.priceVariantName);
    const startDate = values?.bookingStartDate?.date || null;
    const endDate = bookingEndForPeriod(startDate, period?.bookingLengthInDays, timeZone);

    return onSubmit({
      bookingDates: { startDate, endDate },
      priceVariantName: values?.priceVariantName,
    });
  };

  return (
    <FinalForm
      {...rest}
      onSubmit={handleFormSubmit}
      unitPrice={unitPrice}
      render={formRenderProps => {
        const {
          formId = 'BookingRentalPeriodForm',
          handleSubmit,
          values,
          lineItems,
          fetchLineItemsError,
          onFetchTimeSlots,
          form: formApi,
          finePrintComponent: FinePrint,
        } = formRenderProps;

        const priceVariantName = values?.priceVariantName || null;
        const selectedPeriod = rentalPeriods.find(p => p.name === priceVariantName) || null;
        const periodDays = selectedPeriod?.bookingLengthInDays || null;
        const windowDays = periodDays ? periodDays + cleaningWindowDays : null;

        const startDate = values?.bookingStartDate?.date || null;
        const startDateInTz = startDate
          ? getStartOf(timeOfDayFromLocalToTimeZone(startDate, timeZone), 'day', timeZone)
          : null;
        const bookingEnd = bookingEndForPeriod(startDateInTz, periodDays, timeZone);
        const inclusiveEnd = inclusiveEndForPeriod(startDateInTz, periodDays, timeZone);

        const isWindowAvailable = isWindowAvailableFn(allTimeSlots, timeZone);
        const latestStart = windowDays
          ? latestBookableStartDate(dayCountAvailableForBooking, windowDays, timeZone)
          : null;

        // Until a period is chosen there is no window to test, so the picker stays
        // disabled rather than guessing a length. That is also the order the client asked
        // for: chips first, "una vez seleccionado debe indicar solo un día".
        const isDayBlocked = day => {
          if (!windowDays) {
            return true;
          }
          const dayInTz = getStartOf(timeOfDayFromLocalToTimeZone(day, timeZone), 'day', timeZone);
          return !isWindowAvailable(dayInTz, windowDays);
        };

        const isOutsideRange = day => {
          if (!windowDays) {
            return true;
          }
          const dayInTz = getStartOf(timeOfDayFromLocalToTimeZone(day, timeZone), 'day', timeZone);
          return (
            !isDateSameOrAfter(dayInTz, earliestStartDate) ||
            !isDateSameOrAfter(latestStart, dayInTz)
          );
        };

        const onMonthClick = handleMonthClick(
          currentMonth,
          monthlyTimeSlots,
          dayCountAvailableForBooking,
          timeZone,
          listingId,
          onFetchTimeSlots
        );

        const breakdownData =
          startDateInTz && bookingEnd ? { startDate: startDateInTz, endDate: bookingEnd } : null;
        const showEstimatedBreakdown =
          breakdownData && lineItems && !fetchLineItemsInProgress && !fetchLineItemsError;

        const fetchLineItemsFor = (nextPriceVariantName, nextStartDate) => {
          const period = rentalPeriods.find(p => p.name === nextPriceVariantName);
          const end = bookingEndForPeriod(nextStartDate, period?.bookingLengthInDays, timeZone);
          if (nextStartDate && end && !fetchLineItemsInProgress) {
            onFetchTransactionLineItems({
              orderData: {
                bookingStart: nextStartDate,
                bookingEnd: end,
                priceVariantName: nextPriceVariantName,
              },
              listingId,
              isOwnListing,
            });
          }
        };

        return (
          <Form onSubmit={handleSubmit} className={classes} enforcePagePreloadFor="CheckoutPage">
            {/* A calendar that silently refuses the next few days reads as broken, so say
                why — above the picker, so it is read before the first click. */}
            {initialCleaningBlockDays ? (
              <p className={css.initialCleaningNotice}>
                <FormattedMessage
                  id="BookingDatesForm.initialCleaningNotice"
                  values={{
                    days: initialCleaningBlockDays,
                    date: intl.formatDate(earliestStartDate, dateFormatOptions),
                  }}
                />
              </p>
            ) : null}

            <RentalPeriodChips
              className={css.periodChips}
              name="priceVariantName"
              id={`${formId}_priceVariantName`}
              periods={rentalPeriods}
              currency={unitPrice?.currency}
              validate={required(
                intl.formatMessage({ id: 'BookingRentalPeriodForm.periodRequired' })
              )}
              onPeriodChange={() => {
                // Switching from 7 to 14 days changes the window that has to be free, so a
                // date that was valid a moment ago may no longer be. Clearing it is the only
                // honest option: silently keeping a start date the new period cannot use
                // would leave the customer looking at a filled-in form that fails on submit.
                formApi.change('bookingStartDate', null);
              }}
            />

            <FieldSingleDatePicker
              className={css.startDate}
              name="bookingStartDate"
              id={`${formId}_bookingStartDate`}
              label={intl.formatMessage({ id: 'BookingRentalPeriodForm.startDateLabel' })}
              placeholderText={intl.formatDate(earliestStartDate, dateFormatOptions)}
              format={value => {
                // The form holds the day in the LISTING's time zone; the picker works in the
                // browser's. Skipping this shifts the highlighted day by one for any
                // customer whose zone is behind the listing's.
                const date = value?.date;
                return date ? { date: timeOfDayFromTimeZoneToLocal(date, timeZone) } : value;
              }}
              parse={value => {
                const date = value?.date;
                return date
                  ? {
                      date: getStartOf(
                        timeOfDayFromLocalToTimeZone(date, timeZone),
                        'day',
                        timeZone
                      ),
                    }
                  : value;
              }}
              useMobileMargins
              showErrorMessage
              validate={required(
                intl.formatMessage({ id: 'BookingRentalPeriodForm.startDateRequired' })
              )}
              isDayBlocked={isDayBlocked}
              isOutsideRange={isOutsideRange}
              disabled={!periodDays || fetchLineItemsInProgress}
              showLabelAsDisabled={!periodDays}
              showPreviousMonthStepper={showPreviousMonthStepper(currentMonth, timeZone)}
              showNextMonthStepper={showNextMonthStepper(
                currentMonth,
                dayCountAvailableForBooking,
                timeZone
              )}
              onMonthChange={date => {
                const localizedDate = timeOfDayFromLocalToTimeZone(date, timeZone);
                onMonthClick(localizedDate < currentMonth ? prevMonthFn : nextMonthFn);
                setCurrentMonth(localizedDate);
              }}
              onChange={value => {
                const picked = value?.date
                  ? getStartOf(timeOfDayFromLocalToTimeZone(value.date, timeZone), 'day', timeZone)
                  : null;
                fetchLineItemsFor(priceVariantName, picked);
              }}
            />

            {/* The end date is derived, so it is stated rather than asked for.
                  > "el cliente va a seleccionar el día de inicio por lo que verá la fecha
                  >  final" */}
            {startDateInTz && inclusiveEnd ? (
              <p className={css.derivedEndDate}>
                <FormattedMessage
                  id="BookingRentalPeriodForm.rentalRange"
                  values={{
                    startDate: intl.formatDate(startDateInTz, dateFormatOptions),
                    endDate: intl.formatDate(inclusiveEnd, dateFormatOptions),
                    days: periodDays,
                  }}
                />
              </p>
            ) : null}

            {showEstimatedBreakdown ? (
              <div className={css.priceBreakdownContainer}>
                <H6 as="h3" className={css.bookingBreakdownTitle}>
                  <FormattedMessage id="BookingDatesForm.priceBreakdownTitle" />
                </H6>
                <hr className={css.totalDivider} />
                <EstimatedCustomerBreakdownMaybe
                  breakdownData={breakdownData}
                  lineItems={lineItems}
                  timeZone={timeZone}
                  currency={unitPrice.currency}
                  marketplaceName={marketplaceName}
                  processName={BOOKING_PROCESS_NAME}
                />
              </div>
            ) : null}
            <FetchLineItemsError error={fetchLineItemsError} />

            <div className={css.submitButton}>
              <PrimaryButton type="submit" inProgress={fetchLineItemsInProgress}>
                <FormattedMessage id="BookingDatesForm.requestToBook" />
              </PrimaryButton>
            </div>
            <FinePrint payoutDetailsWarning={payoutDetailsWarning} isOwnListing={isOwnListing} />
          </Form>
        );
      }}
    />
  );
};

export default BookingRentalPeriodForm;
