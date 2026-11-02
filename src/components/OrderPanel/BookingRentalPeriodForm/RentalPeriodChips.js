import React from 'react';
import { Field } from 'react-final-form';
import classNames from 'classnames';

import { useIntl } from '../../../util/reactIntl';
import { formatMoney } from '../../../util/currency';
import { types as sdkTypes } from '../../../util/sdkLoader';
import { rentalPeriodLabel } from '../../../util/rentalPeriods';
import { ValidationError } from '../../../components';

import css from './RentalPeriodChips.module.css';

const { Money } = sdkTypes;

/**
 * The customer's choice of rental period, as chips.
 *
 *   > "el customer debe seleccionar uno de dos botones, estos botones deben parecer mas
 *   >  como chips"
 *
 * A radio group under the hood rather than a row of `<button>`s. The chips are a single
 * exclusive choice that the form submits, which is what a radio group IS — and it is what
 * gives keyboard users arrow-key selection and screen readers "2 of 2 selected" for free.
 * The chip appearance is entirely in the stylesheet: the native input is visually hidden
 * but still focusable, so the focus ring lands on the chip via `:focus-visible` on the
 * label.
 *
 * The price is part of the chip, not a separate line, because the two periods differ in
 * exactly two things — length and price — and the whole point of this feature is that the
 * price is NOT the length times a daily rate. Showing the length alone would invite the
 * customer to work out the total themselves and get it wrong.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className]
 * @param {string} props.name - the Final Form field name (the price variant name is stored)
 * @param {string} props.id - id prefix for the inputs
 * @param {Array<Object>} props.periods - from util/rentalPeriods.js `getRentalPeriods`
 * @param {string} props.currency - the listing's currency
 * @param {Function} [props.validate] - Final Form validator, registered on the group
 * @param {Function} [props.onPeriodChange] - called with the newly picked period name
 * @param {boolean} [props.disabled]
 * @returns {JSX.Element}
 */
const RentalPeriodChips = props => {
  const intl = useIntl();
  const { className, name, id, periods, currency, validate, onPeriodChange, disabled } = props;

  return (
    // A second registration of the same field name, subscribed to nothing but validation
    // state. Final Form allows it — that is how radio groups work — and it is what lets the
    // group render ONE error message underneath the pair rather than one per chip.
    <Field
      name={name}
      validate={validate}
      subscription={{ touched: true, error: true, invalid: true }}
    >
      {({ meta }) => (
        <fieldset className={classNames(css.root, className)}>
          <legend className={css.legend}>
            {intl.formatMessage({ id: 'BookingRentalPeriodForm.periodLabel' })}
          </legend>

          <div className={css.chips}>
            {periods.map(period => {
              const inputId = `${id}_${period.name}`;
              const priceLabel = formatMoney(intl, new Money(period.priceInSubunits, currency));

              return (
                <Field key={period.name} name={name} type="radio" value={period.name}>
                  {({ input }) => (
                    <>
                      <input
                        {...input}
                        id={inputId}
                        className={css.chipInput}
                        disabled={disabled}
                        onChange={event => {
                          input.onChange(event);
                          if (onPeriodChange) {
                            onPeriodChange(period.name);
                          }
                        }}
                      />
                      <label
                        className={classNames(css.chip, {
                          [css.chipSelected]: input.checked,
                          [css.chipDisabled]: disabled,
                        })}
                        htmlFor={inputId}
                      >
                        <span className={css.chipPeriod}>
                          {rentalPeriodLabel(intl, period.bookingLengthInDays)}
                        </span>
                        <span className={css.chipPrice}>{priceLabel}</span>
                      </label>
                    </>
                  )}
                </Field>
              );
            })}
          </div>

          <ValidationError fieldMeta={meta} />
        </fieldset>
      )}
    </Field>
  );
};

export default RentalPeriodChips;
