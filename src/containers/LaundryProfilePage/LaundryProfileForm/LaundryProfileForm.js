import React from 'react';
import { Field, Form as FinalForm } from 'react-final-form';
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
  getCategoryPricingGroups,
  getOrphanedPricingCategories,
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

// Bounds for the per-category inputs. These are sanity rails, not business rules: they
// exist to catch a slipped decimal point or a stray digit before it becomes a real
// charge on a customer's card or an availability window blocking a listing for years.
// 720h is 30 days; a turnaround longer than a month is a typo, not a service.
const MAX_TURNAROUND_HOURS = 720;
const MAX_CLEANING_FEE = 10000;

// `null` is what the parsers below emit for an empty box, and an empty box is valid —
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

const parseOptionalFloat = value => {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * One studio-wide-fallback hint, shown under a per-category input ONLY while that
 * input is empty.
 *
 * This is the answer to "which of these categories is actually using my default?".
 * Without it a grid of blank boxes is ambiguous — a studio cannot tell "not configured"
 * apart from "configured to nothing", and the number that will really be charged is
 * invisible. Showing it only when blank keeps it from becoming noise once the studio
 * has filled the row in.
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
 * hours, studio-wide turnaround hours and cleaning fee, accepted garment categories,
 * and a price/turnaround per accepted category.
 *
 * PER-CATEGORY PRICING. A studio does not charge one flat fee for everything it takes,
 * so the two studio-wide numbers above are now FALLBACKS and the real values are set
 * per category below them. The two fields are configured at different granularities,
 * which is what shapes the layout:
 *   - turnaround is set on the TOP-LEVEL category only ("las horas estan bien por
 *     categoría grande"), so it sits in the group header;
 *   - price is set on any accepted category or subcategory, so it sits on the rows.
 * Anything left blank falls back to the studio-wide value, and each blank input says
 * so inline rather than leaving the studio to guess (see FallbackHint).
 *
 * The RESOLUTION rule — which configured value a given listing actually gets — is
 * server-side in server/api-util/categoryPricing.js and is deliberately not restated
 * here. Summary for the reader: of every level of a listing's category chain that
 * carries a price, the HIGHEST wins ("utilizaría el precio mas alto"); turnaround comes
 * from the listing's top-level category; both fall back to the studio-wide value and
 * then to a server env default.
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

      // Rows follow the checkboxes above live: tick a category and its price input
      // appears immediately, so the studio never has to save-then-return to price what
      // it just accepted.
      const pricingGroups = getCategoryPricingGroups(categoryTree, values.acceptedCategories);
      const visiblePricingIds = pricingGroups.reduce(
        (ids, group) => [...ids, group.id, ...group.priceCategories.map(entry => entry.id)],
        []
      );

      // Stored values are retained, never pruned, when a category is un-ticked or
      // disappears from Console — see server/api-util/categoryPricing.js for why. They
      // ride along in `values` (seeded from initialValues, unbound to any input), so a
      // save cannot silently drop them. What they must not do is stay INVISIBLE: money
      // that is configured, live for any listing still filed under that category, and
      // impossible to find is how a mispriced studio goes unnoticed. Surfaced here with
      // the same treatment legacy free-text categories get — shown, and clearable on
      // purpose.
      const orphanedPricingIds = getOrphanedPricingCategories(
        categoryPricingFromFormValues(values),
        visiblePricingIds
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
        categoryId => !visiblePricingIds.includes(categoryId)
      );
      const clearPricingForCategory = categoryId => {
        form.change(categoryPricingFieldName('turnaroundHours', categoryId), undefined);
        form.change(categoryPricingFieldName('cleaningFee', categoryId), undefined);
      };

      const turnaroundRangeMessage = intl.formatMessage(
        { id: 'LaundryProfileForm.turnaroundHoursRange' },
        { max: MAX_TURNAROUND_HOURS }
      );
      const cleaningFeeRangeMessage = intl.formatMessage(
        { id: 'LaundryProfileForm.cleaningFeeRange' },
        { max: MAX_CLEANING_FEE }
      );
      const validateTurnaround = optionalNumberInRange(
        1,
        MAX_TURNAROUND_HOURS,
        turnaroundRangeMessage
      );
      const validateFee = optionalNumberInRange(0, MAX_CLEANING_FEE, cleaningFeeRangeMessage);

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
            helpText={intl.formatMessage({ id: 'LaundryProfileForm.turnaroundHoursHelp' })}
            parse={parseOptionalInteger}
            validate={composeValidators(
              required(intl.formatMessage({ id: 'LaundryProfileForm.turnaroundHoursRequired' })),
              validateTurnaround
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
            helpText={intl.formatMessage({ id: 'LaundryProfileForm.cleaningFeeHelp' })}
            parse={parseOptionalFloat}
            validate={validateFee}
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

          <div className={css.field}>
            <span className={css.fieldLabel}>
              <FormattedMessage id="LaundryProfileForm.categoryPricingLabel" />
            </span>
            <p className={css.pricingHelp}>
              <FormattedMessage id="LaundryProfileForm.categoryPricingHelp" />
            </p>

            {pricingGroups.length === 0 ? (
              <p className={css.categoryEmpty}>
                <FormattedMessage id="LaundryProfileForm.categoryPricingEmpty" />
              </p>
            ) : (
              <ul className={css.pricingGroupList}>
                {pricingGroups.map(group => {
                  const hoursName = categoryPricingFieldName('turnaroundHours', group.id);
                  return (
                    <li key={group.id} className={css.pricingGroup}>
                      <div className={css.pricingGroupHeader}>
                        <span className={css.pricingGroupName}>{group.name}</span>
                        <div className={css.pricingControl}>
                          <FieldTextInput
                            className={css.pricingInput}
                            inputRootClass={css.pricingInputRoot}
                            type="number"
                            step="1"
                            min="1"
                            max={`${MAX_TURNAROUND_HOURS}`}
                            id={`${formId}.${hoursName}`}
                            name={hoursName}
                            labelClassName={css.pricingInputLabel}
                            label={intl.formatMessage({
                              id: 'LaundryProfileForm.categoryTurnaroundLabel',
                            })}
                            // Every input in this list carries the same visible label
                            // ("Turnaround (hours)"), which by itself tells a screen
                            // reader user nothing about WHICH garment they are on —
                            // the category name is only conveyed visually, by
                            // proximity. aria-label restores it.
                            aria-label={intl.formatMessage(
                              { id: 'LaundryProfileForm.categoryTurnaroundAriaLabel' },
                              { category: group.name }
                            )}
                            placeholder={intl.formatMessage({
                              id: 'LaundryProfileForm.turnaroundHoursPlaceholder',
                            })}
                            parse={parseOptionalInteger}
                            validate={validateTurnaround}
                          />
                          <FallbackHint
                            value={values[hoursName]}
                            messageId="LaundryProfileForm.pricingFallbackHours"
                            fallback={values.turnaroundHours}
                          />
                        </div>
                      </div>

                      <ul className={css.pricingRowList}>
                        {group.priceCategories.map(category => {
                          const feeName = categoryPricingFieldName('cleaningFee', category.id);
                          return (
                            <li key={category.id} className={css.pricingRow}>
                              <span
                                className={classNames(
                                  css.pricingRowName,
                                  levelClass(category.level)
                                )}
                                title={category.path.join(' › ')}
                              >
                                {category.name}
                              </span>
                              <div className={css.pricingControl}>
                                <FieldTextInput
                                  className={css.pricingInput}
                                  inputRootClass={css.pricingInputRoot}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max={`${MAX_CLEANING_FEE}`}
                                  id={`${formId}.${feeName}`}
                                  name={feeName}
                                  labelClassName={css.pricingInputLabel}
                                  label={intl.formatMessage({
                                    id: 'LaundryProfileForm.categoryCleaningFeeLabel',
                                  })}
                                  // See the turnaround input above: the visible label
                                  // is the same on every row, so the category name has
                                  // to reach assistive tech some other way.
                                  aria-label={intl.formatMessage(
                                    { id: 'LaundryProfileForm.categoryCleaningFeeAriaLabel' },
                                    { category: category.path.join(' › ') }
                                  )}
                                  placeholder={intl.formatMessage({
                                    id: 'LaundryProfileForm.cleaningFeePlaceholder',
                                  })}
                                  parse={parseOptionalFloat}
                                  validate={validateFee}
                                />
                                <FallbackHint
                                  value={values[feeName]}
                                  messageId="LaundryProfileForm.pricingFallbackFee"
                                  fallback={values.cleaningFee}
                                />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
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
