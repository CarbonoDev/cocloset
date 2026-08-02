import React from 'react';
import { Form as FinalForm } from 'react-final-form';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { propTypes } from '../../../util/types';
import {
  autocompleteSearchRequired,
  autocompletePlaceSelected,
  composeValidators,
  required,
} from '../../../util/validators';

import { Form, Button, FieldTextInput, FieldLocationAutocompleteInput } from '../../../components';

import css from './LaundryProfileForm.module.css';

const identity = v => v;

/**
 * LaundryProfileForm
 *
 * Phase 1 laundry-only studio profile form: studio name, address (reusing the
 * same FieldLocationAutocompleteInput pattern as EditListingLocationForm), business
 * hours, default turnaround hours, cleaning fee, and accepted garment categories
 * (entered as a comma-separated list, split into an array by the caller on submit).
 *
 * @component
 * @param {Object} props
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.formId] - The form id
 * @param {Function} props.onSubmit - The function to handle form submission
 * @param {boolean} props.updateInProgress - Whether the update is in progress
 * @param {propTypes.error} [props.updateProfileError] - The update profile error
 * @returns {JSX.Element}
 */
const LaundryProfileForm = props => (
  <FinalForm
    {...props}
    render={fieldRenderProps => {
      const {
        className,
        formId = 'LaundryProfileForm',
        handleSubmit,
        invalid,
        pristine,
        rootClassName,
        updateInProgress,
        updateProfileError,
        values,
      } = fieldRenderProps;

      const intl = useIntl();

      const addressRequiredMessage = intl.formatMessage({
        id: 'LaundryProfileForm.addressRequired',
      });
      const addressNotRecognizedMessage = intl.formatMessage({
        id: 'LaundryProfileForm.addressNotRecognized',
      });

      const submitError = updateProfileError ? (
        <div className={css.error}>
          <FormattedMessage id="LaundryProfileForm.updateProfileFailed" />
        </div>
      ) : null;

      const classes = classNames(rootClassName || css.root, className);
      const submitInProgress = updateInProgress;
      const submitDisabled = invalid || pristine || submitInProgress;

      return (
        <Form className={classes} onSubmit={handleSubmit}>
          {submitError}

          <FieldTextInput
            className={css.field}
            type="text"
            id={`${formId}.studioName`}
            name="studioName"
            label={intl.formatMessage({ id: 'LaundryProfileForm.studioNameLabel' })}
            placeholder={intl.formatMessage({ id: 'LaundryProfileForm.studioNamePlaceholder' })}
            validate={required(intl.formatMessage({ id: 'LaundryProfileForm.studioNameRequired' }))}
          />

          <FieldLocationAutocompleteInput
            className={css.field}
            inputClassName={css.locationAutocompleteInput}
            iconClassName={css.locationAutocompleteInputIcon}
            predictionsClassName={css.predictionsRoot}
            validClassName={css.validLocation}
            name="location"
            id={`${formId}.location`}
            label={intl.formatMessage({ id: 'LaundryProfileForm.addressLabel' })}
            placeholder={intl.formatMessage({ id: 'LaundryProfileForm.addressPlaceholder' })}
            useDefaultPredictions={false}
            format={identity}
            valueFromForm={values.location}
            validate={composeValidators(
              autocompleteSearchRequired(addressRequiredMessage),
              autocompletePlaceSelected(addressNotRecognizedMessage)
            )}
          />

          <FieldTextInput
            className={css.field}
            type="text"
            id={`${formId}.businessHours`}
            name="businessHours"
            label={intl.formatMessage({ id: 'LaundryProfileForm.businessHoursLabel' })}
            placeholder={intl.formatMessage({ id: 'LaundryProfileForm.businessHoursPlaceholder' })}
            validate={required(
              intl.formatMessage({ id: 'LaundryProfileForm.businessHoursRequired' })
            )}
          />

          <FieldTextInput
            className={css.field}
            type="number"
            step="1"
            min="0"
            id={`${formId}.turnaroundHours`}
            name="turnaroundHours"
            label={intl.formatMessage({ id: 'LaundryProfileForm.turnaroundHoursLabel' })}
            placeholder={intl.formatMessage({
              id: 'LaundryProfileForm.turnaroundHoursPlaceholder',
            })}
            parse={value => {
              const parsed = Number.parseInt(value, 10);
              return Number.isNaN(parsed) ? null : parsed;
            }}
            validate={required(
              intl.formatMessage({ id: 'LaundryProfileForm.turnaroundHoursRequired' })
            )}
          />

          <FieldTextInput
            className={css.field}
            type="number"
            step="0.01"
            min="0"
            id={`${formId}.cleaningFee`}
            name="cleaningFee"
            label={intl.formatMessage({ id: 'LaundryProfileForm.cleaningFeeLabel' })}
            placeholder={intl.formatMessage({ id: 'LaundryProfileForm.cleaningFeePlaceholder' })}
            parse={value => {
              const parsed = Number.parseFloat(value);
              return Number.isNaN(parsed) ? null : parsed;
            }}
          />

          <FieldTextInput
            className={css.field}
            type="text"
            id={`${formId}.acceptedCategories`}
            name="acceptedCategories"
            label={intl.formatMessage({ id: 'LaundryProfileForm.acceptedCategoriesLabel' })}
            placeholder={intl.formatMessage({
              id: 'LaundryProfileForm.acceptedCategoriesPlaceholder',
            })}
            helpText={intl.formatMessage({ id: 'LaundryProfileForm.acceptedCategoriesHelp' })}
          />

          <Button
            className={css.submitButton}
            type="submit"
            inProgress={submitInProgress}
            disabled={submitDisabled}
          >
            <FormattedMessage id="LaundryProfileForm.saveChanges" />
          </Button>
        </Form>
      );
    }}
  />
);

export default LaundryProfileForm;
