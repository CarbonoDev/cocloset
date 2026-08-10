import React from 'react';
import { Field, Form as FinalForm } from 'react-final-form';
import { FieldArray } from 'react-final-form-arrays';
import arrayMutators from 'final-form-arrays';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { propTypes } from '../../../util/types';
import {
  CATEGORY_PRICING_FIELDS,
  categoryPricingFieldName,
  categoryPricingFromFormValues,
  flattenCategoryTree,
  getCategoryLabels,
  getOrphanedPricingCategories,
  getTurnaroundCategoryIds,
  splitAcceptedCategories,
} from '../../../util/fieldHelpers';
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
  FieldCheckbox,
  FieldTextInput,
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

// Sanity rail on the turnaround inputs, not a business rule: it exists to catch a stray
// digit before it blocks a listing's calendar for years. 30 days is already an
// implausible turnaround; beyond it the number is a typo, not a service.
const MAX_TURNAROUND_DAYS = 30;

// `null` is what the parser below emits for an empty box, and an empty box is valid —
// it means "no specific value for this category, use the studio-wide one". Only an
// actually-entered number is checked.
const optionalNumberInRange = (min, max, message) => value =>
  value === null || value === undefined || value === ''
    ? undefined
    : typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? undefined
    : message;

const parseOptionalInteger = value => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * One studio-wide-fallback hint, shown under a per-category input ONLY while that
 * input is empty.
 *
 * This is the answer to "which of these categories is actually using my default?".
 * Without it a column of blank boxes is ambiguous — a studio cannot tell "not
 * configured" apart from "configured to nothing", and the number that will really be
 * used is invisible. Showing it only when blank keeps it from becoming noise once the
 * studio has filled the row in.
 */
const FallbackHint = props => {
  const { value, messageId, fallback } = props;
  const isBlank = value === null || value === undefined || value === '';

  if (!isBlank) {
    return null;
  }
  return (
    <span className={css.pricingFallback}>
      {typeof fallback === 'number' && Number.isFinite(fallback) ? (
        <FormattedMessage id={messageId} values={{ value: fallback }} />
      ) : (
        <FormattedMessage id="LaundryProfileForm.pricingFallbackUnset" />
      )}
    </span>
  );
};

/**
 * LaundryProfileForm
 *
 * Phase 1 laundry-only studio profile form: studio name, address (reusing the
 * same FieldLocationAutocompleteInput pattern as EditListingLocationForm), business
 * hours, studio-wide turnaround, and one table of accepted garment categories that
 * also carries a turnaround per top-level category.
 *
 * NO CLEANING FEE IS COLLECTED HERE ANY MORE — not studio-wide, and not per category.
 * Per the client the fee is marketplace-level server configuration, one env var per
 * category (`CLEANING_FEE_<CATEGORY_ID>`; see server/api-util/cleaningFeeEnv.js):
 * "El precio por categoría que establece la laundry será establecido por una variable
 * env, por lo que hay que ocultar el form y que el precio venga de una env". Removing
 * the inputs is only half of that change — the server also stopped reading the stored
 * values, so a studio's old `cleaningFee` cannot keep pricing rentals from behind a form
 * that no longer shows it.
 *
 * ONE TABLE, NOT TWO SECTIONS. The accepted-categories picker and the per-category
 * turnaround input used to be separate blocks, which meant reading a category name in
 * one list and finding its input in another. They are now the same row, per the client:
 * "es mejor si lo dejamos en la misma tabla que selecciona las categorias, no en una
 * sección mas abajo". This is a hand-built table of FieldCheckbox + FieldTextInput
 * rather than a FieldCheckboxGroup, because FieldCheckboxGroup renders an option list
 * and cannot put a per-option input on a row.
 *
 * TURNAROUND IS IN DAYS, AND ONLY ON TOP-LEVEL ROWS. Days because that is the unit a
 * studio thinks in and the unit the day-granular availability calendar consumes (there
 * is no hours/days conversion anywhere in the codebase). Top-level only per the client
 * ("las horas estan bien por categoría grande"): a subcategory row deliberately gets no
 * input, because a value stored there is never read and a control that silently does
 * nothing is worse than no control. Anything left blank falls back to the studio-wide
 * value, and each blank input says so inline rather than leaving the studio to guess
 * (see FallbackHint).
 *
 * The RESOLUTION rule — which configured value a given listing actually gets — is
 * server-side in server/api-util/categoryPricing.js and is deliberately not restated
 * here. Summary for the reader: turnaround comes from the listing's top-level category,
 * then the studio-wide value, then a server env default.
 *
 * ACCEPTED CATEGORIES ARE CONSOLE CATEGORY IDS, NOT FREE TEXT.
 * They used to be a comma-separated text field, which meant a laundry wrote
 * "Eveningwear" while a listing was filed under `dresses` / `midi_dress`. The listing
 * wizard's accepted-category check compared those two vocabularies and could therefore
 * never match. The table below is fed from `config.categoryConfiguration.categories`
 * (the same tree the listing wizard uses), with its hierarchy shown, so an unmatchable
 * value cannot be entered in the first place. Ticking a parent accepts the whole branch
 * (see isCategoryAcceptedByLaundry), which is why parent rows stay visually dominant.
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
        initialValues,
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
      // render as an explanatory empty state rather than a silently empty table.
      const categoryTree = config?.categoryConfiguration?.categories || [];
      const categoryRows = flattenCategoryTree(categoryTree);

      // `acceptedCategories` holds BOTH picked ids and any pre-existing free-text values.
      // The checkboxes below only ever add/remove their own ids, so legacy entries ride
      // along untouched instead of being wiped by the first save after this migration.
      // They are surfaced under the table so the laundry can see and clear them.
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

      // Which top-level rows show a turnaround input: those with anything accepted in
      // their branch. Follows the checkboxes live, so ticking a category reveals its
      // input immediately and the studio never has to save-then-return to configure what
      // it just accepted.
      const turnaroundCategoryIds = getTurnaroundCategoryIds(
        categoryTree,
        values.acceptedCategories
      );

      // Stored values are retained, never pruned, when a category is un-ticked or
      // disappears from Console — see server/api-util/categoryPricing.js for why. They
      // ride along in `values` (seeded from initialValues, unbound to any input), so a
      // save cannot silently drop them. What they must not do is stay INVISIBLE: a
      // turnaround that is configured, live for any listing still filed under that
      // category, and impossible to find is how a studio ends up blocking its calendar
      // for a reason nobody can locate. Surfaced here with the same treatment legacy
      // free-text categories get — shown, and clearable on purpose.
      const orphanedPricingIds = getOrphanedPricingCategories(
        categoryPricingFromFormValues(values),
        turnaroundCategoryIds
      );
      const orphanedPricingLabels = getCategoryLabels(categoryTree, orphanedPricingIds, {
        withPath: true,
      });

      // Fields to register with final-form even though nothing renders an input for
      // them. `pristine` is derived ONLY from registered fields (see final-form's
      // buildFormState), so a stored value with no input can be changed without the
      // form ever noticing — "Save changes" stays disabled and the studio cannot
      // commit the removal it just asked for.
      //
      // Keyed off initialValues, NOT the current values: registering the currently
      // orphaned ids would unmount the field the instant the value was cleared (the
      // entry stops being orphaned), un-registering it and making the form pristine
      // again — the same bug one step later.
      const storedPricingIds = Object.keys(categoryPricingFromFormValues(initialValues));
      const unrenderedPricingIds = storedPricingIds.filter(
        categoryId => !turnaroundCategoryIds.includes(categoryId)
      );
      const clearPricingForCategory = categoryId => {
        CATEGORY_PRICING_FIELDS.forEach(field => {
          form.change(categoryPricingFieldName(field, categoryId), undefined);
        });
      };

      const turnaroundRangeMessage = intl.formatMessage(
        { id: 'LaundryProfileForm.turnaroundDaysRange' },
        { max: MAX_TURNAROUND_DAYS }
      );
      const validateTurnaround = optionalNumberInRange(
        1,
        MAX_TURNAROUND_DAYS,
        turnaroundRangeMessage
      );

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
            id={`${formId}.turnaroundDays`}
            name="turnaroundDays"
            labelClassName={css.fieldLabel}
            label={intl.formatMessage({ id: 'LaundryProfileForm.turnaroundDaysLabel' })}
            placeholder={intl.formatMessage({
              id: 'LaundryProfileForm.turnaroundDaysPlaceholder',
            })}
            helpText={intl.formatMessage({ id: 'LaundryProfileForm.turnaroundDaysHelp' })}
            parse={parseOptionalInteger}
            validate={composeValidators(
              required(intl.formatMessage({ id: 'LaundryProfileForm.turnaroundDaysRequired' })),
              validateTurnaround
            )}
          />

          {/* ── The one table: accept + turnaround, per category ──────────────
              FieldArray registers `acceptedCategories` with final-form even when the
              tree is empty and no checkbox renders. That registration is what makes
              "Save changes" enable after removing a legacy free-text chip, which is
              otherwise a change to a field the form does not know exists. */}
          <FieldArray
            name="acceptedCategories"
            render={() => (
              /* fieldset + legend, so the whole table is one named group for assistive
                 tech exactly as the FieldCheckboxGroup it replaces was. */
              <fieldset className={css.categoryFieldset}>
                <legend className={css.fieldLabel}>
                  <FormattedMessage id="LaundryProfileForm.acceptedCategoriesLabel" />
                </legend>
                <p className={css.pricingHelp}>
                  <FormattedMessage id="LaundryProfileForm.acceptedCategoriesHelp" />
                </p>

                {categoryRows.length === 0 ? (
                  <p className={css.categoryEmpty}>
                    <FormattedMessage id="LaundryProfileForm.acceptedCategoriesEmpty" />
                  </p>
                ) : (
                  <ul className={css.categoryTable}>
                    {categoryRows.map(entry => {
                      const daysName = categoryPricingFieldName('turnaroundDays', entry.id);
                      const showTurnaround = turnaroundCategoryIds.includes(entry.id);
                      return (
                        <li key={entry.id} className={css.categoryRow}>
                          <FieldCheckbox
                            className={css.categoryCheckbox}
                            id={`${formId}.acceptedCategories.${entry.id}`}
                            name="acceptedCategories"
                            value={entry.id}
                            label={
                              <span
                                className={levelClass(entry.level)}
                                title={entry.path.join(' › ')}
                              >
                                {entry.name}
                              </span>
                            }
                          />

                          {/* Top-level rows only. A subcategory gets no input because a
                              turnaround stored there is never read (see the docblock). */}
                          {showTurnaround ? (
                            <div className={css.pricingControl}>
                              <FieldTextInput
                                className={css.pricingInput}
                                inputRootClass={css.pricingInputRoot}
                                type="number"
                                step="1"
                                min="1"
                                max={`${MAX_TURNAROUND_DAYS}`}
                                id={`${formId}.${daysName}`}
                                name={daysName}
                                labelClassName={css.pricingInputLabel}
                                label={intl.formatMessage({
                                  id: 'LaundryProfileForm.categoryTurnaroundLabel',
                                })}
                                // Every input in this table carries the same visible
                                // label ("Turnaround (days)"), which by itself tells a
                                // screen reader user nothing about WHICH garment they
                                // are on — the category name is only conveyed visually,
                                // by being on the same row. aria-label restores it.
                                aria-label={intl.formatMessage(
                                  { id: 'LaundryProfileForm.categoryTurnaroundAriaLabel' },
                                  { category: entry.name }
                                )}
                                placeholder={intl.formatMessage({
                                  id: 'LaundryProfileForm.turnaroundDaysPlaceholder',
                                })}
                                parse={parseOptionalInteger}
                                validate={validateTurnaround}
                              />
                              <FallbackHint
                                value={values[daysName]}
                                messageId="LaundryProfileForm.pricingFallbackDays"
                                fallback={values.turnaroundDays}
                              />
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* Registration-only fields — they render nothing. See
                    unrenderedPricingIds above for why they have to exist at all. */}
                {unrenderedPricingIds.map(categoryId =>
                  CATEGORY_PRICING_FIELDS.map(field => (
                    <Field
                      key={categoryPricingFieldName(field, categoryId)}
                      name={categoryPricingFieldName(field, categoryId)}
                      render={() => null}
                    />
                  ))
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

                {orphanedPricingIds.length > 0 ? (
                  <div className={css.legacyCategories}>
                    <p className={css.legacyCategoriesNote}>
                      <FormattedMessage id="LaundryProfileForm.categoryPricingOrphanedNote" />
                    </p>
                    <ul className={css.legacyCategoryList}>
                      {orphanedPricingIds.map((categoryId, index) => (
                        <li key={categoryId} className={css.legacyCategory}>
                          <span className={css.legacyCategoryLabel}>
                            {orphanedPricingLabels[index]}
                          </span>
                          <InlineTextButton
                            type="button"
                            className={css.legacyCategoryRemove}
                            onClick={() => clearPricingForCategory(categoryId)}
                            title={intl.formatMessage(
                              { id: 'LaundryProfileForm.categoryPricingOrphanedRemove' },
                              { category: orphanedPricingLabels[index] }
                            )}
                          >
                            <span aria-hidden="true">×</span>
                            <span className={css.legacyCategoryRemoveText}>
                              <FormattedMessage
                                id="LaundryProfileForm.categoryPricingOrphanedRemove"
                                values={{ category: orphanedPricingLabels[index] }}
                              />
                            </span>
                          </InlineTextButton>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </fieldset>
            )}
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
