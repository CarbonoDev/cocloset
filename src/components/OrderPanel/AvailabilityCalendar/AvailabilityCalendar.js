import React from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import {
  CALENDAR_WEEKS,
  DAY_AVAILABLE,
  DAY_BOOKED,
  DAY_CLEANING,
  DAY_PAST,
  DAY_SELECTED,
  buildCalendarDays,
} from '../../../util/availabilityCalendar';

import css from './AvailabilityCalendar.module.css';

/**
 * A READ-ONLY view of the next five weeks.
 *
 *   > "el calendario que aparece ahi solo es informativo, no tiene uso mas que para ver
 *   >  disponibilidad de las próximas 5 semanas"
 *
 * Nothing here is clickable, and that is the point: the booking calendar is the picker above
 * it, which enforces rules this one only reports. Making these squares selectable would give a
 * customer two calendars that disagree the first time a rule applies to one and not the other.
 *
 * The four colours answer the client's other request - "debemos identificar cual es cleaning y
 * cual es booked" - and the two come from genuinely different places: booked is availability,
 * cleaning is the turnaround owed after a rental, which availability does not know about. See
 * util/availabilityCalendar.js.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className]
 * @param {Array<Object>} [props.allTimeSlots] - merged time slots
 * @param {Array<{start: Date, end: Date}>} [props.cleaningGaps]
 * @param {Date} [props.selectedStartDate]
 * @param {number} [props.selectedPeriodDays]
 * @param {string} [props.timeZone]
 * @param {number} [props.firstDayOfWeek]
 * @param {Date} [props.today] - injectable for tests
 * @returns {JSX.Element}
 */
const AvailabilityCalendar = props => {
  const {
    className,
    allTimeSlots,
    cleaningGaps,
    selectedStartDate,
    selectedPeriodDays,
    timeZone,
    firstDayOfWeek,
    today = new Date(),
  } = props;
  const intl = useIntl();

  const days = buildCalendarDays({
    today,
    allTimeSlots,
    cleaningGaps,
    selectedStartDate,
    selectedPeriodDays,
    timeZone,
    firstDayOfWeek,
    weeks: CALENDAR_WEEKS,
  });

  const statusClass = {
    [DAY_AVAILABLE]: css.available,
    [DAY_SELECTED]: css.selected,
    [DAY_BOOKED]: css.booked,
    [DAY_CLEANING]: css.cleaning,
    // Deliberately the same neutral fill as `available`, dimmed by `.past`: a day that has
    // gone by is not a state of the garment, and giving it a colour of its own would put a
    // fifth thing in a legend that explains four.
    [DAY_PAST]: css.available,
  };

  // Every square carries its meaning as text as well as colour. Colour alone cannot be read by
  // a screen reader and cannot be distinguished by a good share of readers who can see it -
  // and this grid's whole job is to communicate a distinction.
  const statusLabel = status => intl.formatMessage({ id: `AvailabilityCalendar.status.${status}` });

  const legend = [DAY_AVAILABLE, DAY_SELECTED, DAY_BOOKED, DAY_CLEANING];

  return (
    <section className={classNames(css.root, className)}>
      <h3 className={css.heading}>
        <FormattedMessage id="AvailabilityCalendar.heading" values={{ weeks: CALENDAR_WEEKS }} />
      </h3>

      <ul className={css.grid}>
        {days.map(({ date, status, isPast }) => (
          <li
            key={date.toISOString()}
            className={classNames(css.day, statusClass[status], { [css.past]: isPast })}
            title={`${intl.formatDate(date, {
              day: 'numeric',
              month: 'short',
              ...(timeZone ? { timeZone } : {}),
            })} — ${statusLabel(status)}`}
          >
            <span aria-hidden="true">
              {intl.formatDate(date, { day: 'numeric', ...(timeZone ? { timeZone } : {}) })}
            </span>
            <span className={css.srOnly}>
              {intl.formatDate(date, {
                day: 'numeric',
                month: 'long',
                ...(timeZone ? { timeZone } : {}),
              })}
              {': '}
              {statusLabel(status)}
            </span>
          </li>
        ))}
      </ul>

      <ul className={css.legend}>
        {legend.map(status => (
          <li key={status} className={css.legendItem}>
            <span className={classNames(css.swatch, statusClass[status])} aria-hidden="true" />
            {statusLabel(status)}
          </li>
        ))}
      </ul>
    </section>
  );
};

export default AvailabilityCalendar;
