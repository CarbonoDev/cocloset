import React from 'react';
import { Form as FinalForm, Field } from 'react-final-form';
import classNames from 'classnames';

// Import configs and util modules
import { FormattedMessage, useIntl } from '../../../../util/reactIntl';
import { propTypes } from '../../../../util/types';
import { required } from '../../../../util/validators';

// Import shared components
import { Form, Button } from '../../../../components';

// Import modules from this directory
import css from './EditListingLaundryForm.module.css';

// A single laundry option, rendered as a selectable card (not a dropdown item)
// per mockup 12.jpg: name, address, business hours, turnaround, accepted
// categories. The radio input itself is visually hidden - the whole card is
// the clickable/label target.
const LaundryCard = props => {
  const { formId, laundry, selected } = props;
  const intl = useIntl();
  const { laundryProfile = {}, acceptedCategories = [] } = laundry.publicData || {};
  const { studioName, address, businessHours } = laundryProfile;
  const name = laundry.displayName || studioName;
  const inputId = `${formId}.assignedLaundryId.${laundry.id}`;

  return (
    <label
      htmlFor={inputId}
      className={classNames(css.card, { [css.cardSelected]: selected })}
    >
      <Field
        id={inputId}
        className={css.cardInput}
        name="assignedLaundryId"
        component="input"
        type="radio"
        value={laundry.id}
        aria-label={intl.formatMessage(
          { id: 'EditListingLaundryForm.screenreader.chooseLaundry' },
          { name }
        )}
      />
      <span className={css.cardName}>{name}</span>
      {address ? <span className={css.cardDetail}>{address}</span> : null}
      {businessHours ? <span className={css.cardDetail}>{businessHours}</span> : null}
      {typeof laundry.turnaroundHours === 'number' ? (
        <span className={css.cardDetail}>
          <FormattedMessage
            id="EditListingLaundryForm.turnaround"
            values={{ hours: laundry.turnaroundHours }}
          />
        </span>
      ) : null}
      {acceptedCategories.length > 0 ? (
        <span className={css.cardCategories}>{acceptedCategories.join(' · ')}</span>
      ) : null}
    </label>
  );
};

/**
 * The EditListingLaundryForm component.
 *
 * Card-picker (grid of LaundryCard) for choosing the assigned laundry, plus a
 * soft (non-blocking) warning if the listing's own category isn't among the
 * selected laundry's accepted categories - Phase 1 keeps this a warning, not
 * a hard validation rule (per Jonathan's "muy sencillo" instruction, see
 * design doc §12).
 *
 * @component
 * @param {Object} props
 * @param {string} [props.formId] - The form id
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {boolean} props.disabled - Whether the form is disabled
 * @param {boolean} props.ready - Whether the form is ready
 * @param {boolean} props.updated - Whether the form is updated
 * @param {boolean} props.updateInProgress - Whether the update is in progress
 * @param {Object} props.fetchErrors - The fetch errors object
 * @param {string} props.saveActionMsg - The save action message
 * @param {Function} props.onSubmit - The submit function
 * @param {Array} props.laundries - The laundries fetched via fetchLaundries()
 * @param {boolean} props.fetchLaundriesInProgress - Whether laundries are still loading
 * @param {string} [props.listingCategory] - The listing's own publicData.category
 * @param {Object} props.errors - The errors object
 * @param {propTypes.error} props.errors.showListingsError - The show listings error
 * @param {propTypes.error} props.errors.updateListingError - The update listing error
 * @returns {JSX.Element}
 */
export const EditListingLaundryForm = props => (
  <FinalForm
    {...props}
    render={formRenderProps => {
      const {
        formId = 'EditListingLaundryForm',
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
        laundries = [],
        fetchLaundriesInProgress,
        listingCategory,
        values,
      } = formRenderProps;

      const intl = useIntl();
      const laundryRequiredMessage = intl.formatMessage({
        id: 'EditListingLaundryForm.laundryRequired',
      });

      const { updateListingError, showListingsError } = fetchErrors || {};

      const classes = classNames(rootClassName || css.root, className);
      const submitReady = (updated && pristine) || ready;
      const submitInProgress = updateInProgress;
      const submitDisabled = invalid || disabled || submitInProgress || fetchLaundriesInProgress;

      const selectedLaundry = laundries.find(l => l.id === values.assignedLaundryId);
      const selectedAcceptedCategories = selectedLaundry?.publicData?.acceptedCategories || [];
      const showCategoryWarning =
        !!selectedLaundry &&
        !!listingCategory &&
        selectedAcceptedCategories.length > 0 &&
        !selectedAcceptedCategories.includes(listingCategory);

      return (
        <Form className={classes} onSubmit={handleSubmit}>
          {updateListingError ? (
            <p className={css.error}>
              <FormattedMessage id="EditListingLaundryForm.updateFailed" />
            </p>
          ) : null}

          {showListingsError ? (
            <p className={css.error}>
              <FormattedMessage id="EditListingLaundryForm.showListingFailed" />
            </p>
          ) : null}

          {fetchLaundriesInProgress ? (
            <p className={css.loading}>
              <FormattedMessage id="EditListingLaundryForm.loading" />
            </p>
          ) : laundries.length === 0 ? (
            <p className={css.empty}>
              <FormattedMessage id="EditListingLaundryForm.noLaundries" />
            </p>
          ) : (
            <div className={css.cardGrid}>
              {laundries.map(laundry => (
                <LaundryCard
                  key={laundry.id}
                  formId={formId}
                  laundry={laundry}
                  selected={values.assignedLaundryId === laundry.id}
                />
              ))}
            </div>
          )}

          {/* Registers the "required" validator for assignedLaundryId and renders its error.
              The radio inputs above (in LaundryCard) share this field name but don't carry
              their own validator, so there's a single source of truth for the error message. */}
          <Field name="assignedLaundryId" validate={required(laundryRequiredMessage)}>
            {({ meta }) =>
              (meta.touched || meta.submitFailed) && meta.error ? (
                <p className={css.error}>{meta.error}</p>
              ) : null
            }
          </Field>

          {showCategoryWarning ? (
            <p className={css.warning}>
              <FormattedMessage
                id="EditListingLaundryForm.categoryWarning"
                values={{ category: listingCategory }}
              />
            </p>
          ) : null}

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

export default EditListingLaundryForm;
