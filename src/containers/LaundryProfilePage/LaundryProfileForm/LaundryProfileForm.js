import React from 'react';
import { Form as FinalForm } from 'react-final-form';
import arrayMutators from 'final-form-arrays';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { propTypes } from '../../../util/types';
import { flattenCategoryTree, splitAcceptedCategories } from '../../../util/fieldHelpers';
import { useConfiguration } from '../../../context/configurationContext';
import {
  autocompleteSearchRequired,
  autocompletePlaceSelected,
  composeValidators,
  required,
} from '../../../util/validators';

import {
  Form,
  Button,
  FieldTextInput,
  FieldCheckboxGroup,
  FieldLocationAutocompleteInput,
  InlineTextButton,
} from '../../../components';

import css from './LaundryProfileForm.module.css';

const identity = v => v;

// Indent class per nesting level, so "Dresses > Maxi Dress > ..." reads as a tree rather
// than a flat wall of checkboxes. Console allows three levels; anything deeper (it
// shouldn't exist) falls back to the deepest indent rather than losing its offset.
const LEVEL_CLASSES = [css.categoryLevel1, css.categoryLevel2, css.categoryLevel3];
const levelClass = level => LEVEL_CLASSES[Math.min(level, LEVEL_CLASSES.length) - 1];

/**
 * LaundryProfileForm
 *
 * Phase 1 laundry-only studio profile form: studio name, address (reusing the
 * same FieldLocationAutocompleteInput pattern as EditListingLocationForm), business
 * hours, default turnaround hours, cleaning fee, and accepted garment categories.
 *
 * ACCEPTED CATEGORIES ARE CONSOLE CATEGORY IDS, NOT FREE TEXT.
 * They used to be a comma-separated text field, which meant a laundry wrote
 * "Eveningwear" while a listing was filed under `dresses` / `midi_dress`. The listing
 * wizard's accepted-category check compared those two vocabularies and could therefore
 * never match. The picker below is fed from `config.categoryConfiguration.categories`
 * (the same tree the listing wizard uses), flattened with its hierarchy shown, so an
 * unmatchable value cannot be entered in the first place.
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
    mutators={{ ...arrayMutators }}
    render={fieldRenderProps => {
      const {
        className,
        form,
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
      const config = useConfiguration();

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

      // The category tree comes from Console (hosted asset). An empty tree is a real
      // possibility — a marketplace that hasn't configured categories yet — and must
      // render as an explanatory empty state rather than a silently empty fieldset.
      const categoryTree = config?.categoryConfiguration?.categories || [];
      const categoryOptions = flattenCategoryTree(categoryTree).map(entry => ({
        key: entry.id,
        label: (
          <span className={levelClass(entry.level)} title={entry.path.join(' › ')}>
            {entry.name}
          </span>
        ),
      }));

      // `acceptedCategories` holds BOTH picked ids and any pre-existing free-text values.
      // FieldCheckboxGroup is a FieldArray, so it only ever adds/removes its own option
      // keys — legacy entries ride along untouched instead of being wiped by the first
      // save after this migration. They are surfaced below so the laundry can see and
      // clear them deliberately.
      const { legacy: legacyCategories } = splitAcceptedCategories(
        categoryTree,
        values.acceptedCategories
      );
      const removeLegacyCategory = value => {
        form.change(
          'acceptedCategories',
          (values.acceptedCategories || []).filter(entry => entry !== value)
        );
      };

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
            labelClassName={css.fieldLabel}
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
            labelClassName={css.fieldLabel}
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
            labelClassName={css.fieldLabel}
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
            labelClassName={css.fieldLabel}
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
            labelClassName={css.fieldLabel}
            label={intl.formatMessage({ id: 'LaundryProfileForm.cleaningFeeLabel' })}
            placeholder={intl.formatMessage({ id: 'LaundryProfileForm.cleaningFeePlaceholder' })}
            parse={value => {
              const parsed = Number.parseFloat(value);
              return Number.isNaN(parsed) ? null : parsed;
            }}
          />

          <div className={css.field}>
            {categoryOptions.length > 0 ? (
              <FieldCheckboxGroup
                id={`${formId}.acceptedCategories`}
                name="acceptedCategories"
                labelClassName={css.fieldLabel}
                listClassName={css.categoryList}
                label={intl.formatMessage({ id: 'LaundryProfileForm.acceptedCategoriesLabel' })}
                options={categoryOptions}
                helpText={intl.formatMessage({ id: 'LaundryProfileForm.acceptedCategoriesHelp' })}
              />
            ) : (
              <>
                <span className={css.fieldLabel}>
                  <FormattedMessage id="LaundryProfileForm.acceptedCategoriesLabel" />
                </span>
                <p className={css.categoryEmpty}>
                  <FormattedMessage id="LaundryProfileForm.acceptedCategoriesEmpty" />
                </p>
              </>
            )}

            {legacyCategories.length > 0 ? (
              <div className={css.legacyCategories}>
                <p className={css.legacyCategoriesNote}>
                  <FormattedMessage id="LaundryProfileForm.acceptedCategoriesLegacyNote" />
                </p>
                <ul className={css.legacyCategoryList}>
                  {legacyCategories.map(value => (
                    <li key={value} className={css.legacyCategory}>
                      <span className={css.legacyCategoryLabel}>{value}</span>
                      <InlineTextButton
                        type="button"
                        className={css.legacyCategoryRemove}
                        onClick={() => removeLegacyCategory(value)}
                        title={intl.formatMessage(
                          { id: 'LaundryProfileForm.acceptedCategoriesLegacyRemove' },
                          { category: value }
                        )}
                      >
                        <span aria-hidden="true">×</span>
                        <span className={css.legacyCategoryRemoveText}>
                          <FormattedMessage
                            id="LaundryProfileForm.acceptedCategoriesLegacyRemove"
                            values={{ category: value }}
                          />
                        </span>
                      </InlineTextButton>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

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
