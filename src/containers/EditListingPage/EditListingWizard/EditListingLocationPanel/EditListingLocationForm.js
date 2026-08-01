import React from 'react';
import { Form as FinalForm } from 'react-final-form';
import classNames from 'classnames';

// Import configs and util modules
import { FormattedMessage, useIntl } from '../../../../util/reactIntl';
import { propTypes } from '../../../../util/types';
import { required } from '../../../../util/validators';

// Import shared components
import { Form, Button, FieldTextInput } from '../../../../components';

// Import modules from this directory
import css from './EditListingLocationForm.module.css';

/**
 * The EditListingLocationForm component.
 *
 * Captures the garment owner's own address - used only for shipping the
 * garment to the assigned laundry. Plain text fields (no map/autocomplete,
 * no lat/lng): this address is never shown to renters and never used as the
 * listing's public geolocation. That comes from the Laundry Assignment step
 * instead (EditListingLaundryForm), which copies the chosen laundry's own
 * location onto the listing.
 *
 * @component
 * @param {Object} props
 * @param {string} props.formId - The form id
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {boolean} props.autoFocus - Whether the form is auto focused
 * @param {boolean} props.disabled - Whether the form is disabled
 * @param {boolean} props.ready - Whether the form is ready
 * @param {boolean} props.updated - Whether the form is updated
 * @param {boolean} props.updateInProgress - Whether the update is in progress
 * @param {Object} props.fetchErrors - The fetch errors object
 * @param {string} props.saveActionMsg - The save action message
 * @param {Function} props.onSubmit - The submit function
 * @param {Object} props.errors - The errors object
 * @param {propTypes.error} props.errors.showListingsError - The show listings error
 * @param {propTypes.error} props.errors.updateListingError - The update listing error
 * @returns {JSX.Element}
 */
export const EditListingLocationForm = props => (
  <FinalForm
    {...props}
    render={formRenderProps => {
      const {
        formId = 'EditListingLocationForm',
        autoFocus,
        className,
        rootClassName,
        disabled,
        ready,
        handleSubmit,
        invalid,
        pristine,
        saveActionMsg,
        updated,
        updateInProgress = false,
        fetchErrors,
      } = formRenderProps;

      const intl = useIntl();
      const streetRequiredMessage = intl.formatMessage({
        id: 'EditListingLocationForm.streetRequired',
      });
      const cityRequiredMessage = intl.formatMessage({
        id: 'EditListingLocationForm.cityRequired',
      });
      const postcodeRequiredMessage = intl.formatMessage({
        id: 'EditListingLocationForm.postcodeRequired',
      });

      const { updateListingError, showListingsError } = fetchErrors || {};

      const classes = classNames(rootClassName || css.root, className);
      const submitReady = (updated && pristine) || ready;
      const submitInProgress = updateInProgress;
      const submitDisabled = invalid || disabled || submitInProgress;

      return (
        <Form className={classes} onSubmit={handleSubmit}>
          {updateListingError ? (
            <p className={css.error}>
              <FormattedMessage id="EditListingLocationForm.updateFailed" />
            </p>
          ) : null}

          {showListingsError ? (
            <p className={css.error}>
              <FormattedMessage id="EditListingLocationForm.showListingFailed" />
            </p>
          ) : null}

          <FieldTextInput
            className={css.field}
            type="text"
            autoFocus={autoFocus}
            id={`${formId}street`}
            name="street"
            label={intl.formatMessage({ id: 'EditListingLocationForm.street' })}
            placeholder={intl.formatMessage({ id: 'EditListingLocationForm.streetPlaceholder' })}
            validate={required(streetRequiredMessage)}
          />

          <FieldTextInput
            className={css.field}
            type="text"
            id={`${formId}city`}
            name="city"
            label={intl.formatMessage({ id: 'EditListingLocationForm.city' })}
            placeholder={intl.formatMessage({ id: 'EditListingLocationForm.cityPlaceholder' })}
            validate={required(cityRequiredMessage)}
          />

          <FieldTextInput
            className={css.field}
            type="text"
            id={`${formId}postcode`}
            name="postcode"
            label={intl.formatMessage({ id: 'EditListingLocationForm.postcode' })}
            placeholder={intl.formatMessage({ id: 'EditListingLocationForm.postcodePlaceholder' })}
            validate={required(postcodeRequiredMessage)}
          />

          <Button
            className={css.submitButton}
            type="submit"
            inProgress={submitInProgress}
            disabled={submitDisabled}
            ready={submitReady}
          >
            {saveActionMsg}
          </Button>
        </Form>
      );
    }}
  />
);

export default EditListingLocationForm;
