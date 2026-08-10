import React from 'react';
import classNames from 'classnames';

// Import configs and util modules
import { useIntl } from '../../../../util/reactIntl';
import * as validators from '../../../../util/validators';

// Import shared components
import { FieldTextInput } from '../../../../components';

// Import modules from this directory
import css from './MinimumBookingDays.module.css';

/**
 * Shortest rental a garment owner can ask for. A minimum below this would mean "no minimum",
 * which is what an absent value already expresses.
 */
export const MIN_MINIMUM_BOOKING_DAYS = 1;

/**
 * Upper bound used when REACT_APP_MAX_MINIMUM_BOOKING_DAYS is unset or unusable.
 */
export const DEFAULT_MAX_MINIMUM_BOOKING_DAYS = 30;

/**
 * Parse a whole number without truncating. Number.parseInt('2.5') is 2 and
 * Number.parseInt('3 days') is 3 — both would quietly accept input that isn't an integer,
 * so anything that is not entirely digits is rejected instead.
 *
 * @param {*} value - The value to parse, typically a form input string or a publicData number.
 * @returns {number|null} The number, or null when the value is not a whole number.
 */
const parseWholeNumber = value => {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : null;
};

/**
 * The largest minimum an owner may choose, read from the environment.
 *
 * This is a UI bound rather than a secret, which is why it carries the REACT_APP_ prefix:
 * the wizard form needs it in the browser to validate the field. Read on each call (not
 * once at module load) so that a test can vary it.
 *
 * @returns {number} The configured bound, or DEFAULT_MAX_MINIMUM_BOOKING_DAYS when the
 *   variable is unset or does not parse to a whole number of at least MIN_MINIMUM_BOOKING_DAYS.
 */
export const getMaxMinimumBookingDays = () => {
  const configured = parseWholeNumber(process.env.REACT_APP_MAX_MINIMUM_BOOKING_DAYS);
  return configured != null && configured >= MIN_MINIMUM_BOOKING_DAYS
    ? configured
    : DEFAULT_MAX_MINIMUM_BOOKING_DAYS;
};

/**
 * Read the stored minimum into the pricing form's initial values.
 *
 * An absent (or unusable) value means "no minimum", so it yields no form value at all
 * rather than a 1 — seeding a 1 would write a minimum the owner never asked for on the
 * next save. A numeric string is tolerated in case the value was set by hand in Console.
 *
 * @param {Object} params - The props given to the panel component.
 * @param {Object} params.listing - The listing entity.
 * @returns {Object} An object with minimumBookingDays as a number, or an empty object.
 */
export const getInitialValuesForMinimumBookingDays = params => {
  const { listing } = params;
  const { publicData } = listing?.attributes || {};
  const storedValue = parseWholeNumber(publicData?.minimumBookingDays);

  return storedValue != null && storedValue >= MIN_MINIMUM_BOOKING_DAYS
    ? { minimumBookingDays: storedValue }
    : {};
};

/**
 * Add minimumBookingDays to the publicData that the pricing panel is about to save.
 *
 * The value is stored as a number. A blank field means "no minimum": for a listing that
 * has no stored value nothing is written at all, and for one that has a value we write
 * null, which is how the Marketplace API removes an extended data key. Values outside the
 * accepted range are dropped rather than clamped — the form validator blocks them, and
 * silently storing a different number than the owner typed would be worse than ignoring it.
 *
 * @param {Object} values - The submitted form values.
 * @param {Object} publicDataUpdates - The publicData updates collected so far.
 * @param {Object} [currentPublicData] - The listing's existing publicData.
 * @returns {Object} An object with the publicData updates.
 */
export const handleSubmitValuesForMinimumBookingDays = (
  values,
  publicDataUpdates,
  currentPublicData
) => {
  const submittedValue = parseWholeNumber(values?.minimumBookingDays);
  const isInRange =
    submittedValue != null &&
    submittedValue >= MIN_MINIMUM_BOOKING_DAYS &&
    submittedValue <= getMaxMinimumBookingDays();

  const hasStoredValue = currentPublicData?.minimumBookingDays != null;
  const minimumBookingDaysMaybe = isInRange
    ? { minimumBookingDays: submittedValue }
    : hasStoredValue
    ? { minimumBookingDays: null }
    : {};

  return { publicData: { ...publicDataUpdates, ...minimumBookingDaysMaybe } };
};

/**
 * The MinimumBookingDays component: how many days long a booking of this garment must be
 * at the very least. This is a rental length, not a price.
 *
 * @component
 * @param {Object} props
 * @param {string} props.name - The name of the input in Final Form
 * @param {string} props.id - The id of the input element
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @returns {JSX.Element}
 */
const MinimumBookingDays = props => {
  const intl = useIntl();
  const { name, id, className } = props;
  const maxMinimumBookingDays = getMaxMinimumBookingDays();

  const validate = validators.optionalIntegerInRange(
    intl.formatMessage({ id: 'MinimumBookingDays.notAnInteger' }),
    intl.formatMessage(
      { id: 'MinimumBookingDays.tooSmall' },
      { minDays: MIN_MINIMUM_BOOKING_DAYS }
    ),
    intl.formatMessage({ id: 'MinimumBookingDays.tooBig' }, { maxDays: maxMinimumBookingDays }),
    MIN_MINIMUM_BOOKING_DAYS,
    maxMinimumBookingDays
  );

  return (
    <FieldTextInput
      id={id}
      name={name}
      className={classNames(css.root, className)}
      type="number"
      min={MIN_MINIMUM_BOOKING_DAYS}
      max={maxMinimumBookingDays}
      step="1"
      label={intl.formatMessage({ id: 'MinimumBookingDays.label' })}
      placeholder={intl.formatMessage({ id: 'MinimumBookingDays.placeholder' })}
      helpText={intl.formatMessage(
        { id: 'MinimumBookingDays.helpText' },
        { maxDays: maxMinimumBookingDays }
      )}
      validate={validate}
    />
  );
};

export default MinimumBookingDays;
