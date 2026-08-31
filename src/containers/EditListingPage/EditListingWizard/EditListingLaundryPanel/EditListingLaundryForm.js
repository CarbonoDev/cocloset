import React from 'react';
import { Form as FinalForm, Field } from 'react-final-form';
import classNames from 'classnames';

// Import configs and util modules
import { FormattedMessage, useIntl } from '../../../../util/reactIntl';
import { propTypes } from '../../../../util/types';
import { required } from '../../../../util/validators';
import { getCategoryLabels, isCategoryAcceptedByLaundry } from '../../../../util/fieldHelpers';
import { useConfiguration } from '../../../../context/configurationContext';

// Import shared components
import { Form, Button, NamedLink } from '../../../../components';

// Import modules from this directory
import css from './EditListingLaundryForm.module.css';

// A single laundry option, rendered as a selectable card (not a dropdown item)
// per mockup 12.jpg: name, address, business hours, turnaround, accepted
// categories. The radio input itself is visually hidden - the whole card is
// the clickable/label target.
const LaundryCard = props => {
  const { categoryTree, formId, laundry, selected, locked } = props;
  const intl = useIntl();
  // /api/laundries returns a flat, explicitly allowlisted record (see
  // server/api-util/laundryDirectory.js) rather than the raw publicData blob.
  const { studioName, address, businessHours, acceptedCategories = [] } = laundry || {};
  // THE STUDIO'S NAME, NOT THE ACCOUNT HOLDER'S.
  //
  //   > "se muestra el displayName de cada laundry, pero debe ser el nombre de la laundry, no
  //   >  del user"
  //
  // The precedence was the wrong way round. `displayName` is whatever the person who signed
  // the studio up called themselves - often their own name - and an owner choosing where their
  // garment goes is choosing a PLACE. `studioName` is the name that place trades under and the
  // one on its shopfront.
  //
  // `displayName` stays as the fallback rather than being dropped: a studio that has not filled
  // in its profile name yet must still be identifiable in this list, and an unnamed card is
  // worse than one naming the account.
  const name = studioName || laundry.displayName;
  const inputId = `${formId}.assignedLaundryId.${laundry.id}`;

  // Stored accepted categories are Console category IDs (`midi_dress`), which are not
  // words. Show the configured name instead, with the full branch on hover so two
  // similarly-named leaves under different parents stay distinguishable. Values that
  // predate the picker are free text already and pass through unchanged.
  const labels = getCategoryLabels(categoryTree, acceptedCategories);
  const paths = getCategoryLabels(categoryTree, acceptedCategories, { withPath: true });
  const categoryChips = acceptedCategories.map((value, index) => ({
    value,
    label: labels[index],
    path: paths[index],
  }));

  return (
    <label
      htmlFor={inputId}
      className={classNames(css.card, {
        [css.cardSelected]: selected,
        [css.cardLocked]: locked,
      })}
    >
      <Field
        id={inputId}
        className={css.cardInput}
        name="assignedLaundryId"
        component="input"
        type="radio"
        value={laundry.id}
        // Disabling the input rather than hiding the grid: an owner whose garment
        // is at the laundry should still be able to SEE which laundry has it, and
        // a disabled radio says "not now" to assistive tech, where a removed one
        // would say nothing at all.
        disabled={locked}
        aria-label={intl.formatMessage(
          { id: 'EditListingLaundryForm.screenreader.chooseLaundry' },
          { name }
        )}
      />
      {/* Selection is already exposed to assistive tech by the radio's checked
          state; this tick is a redundant visual cue so selection doesn't rest
          on the fill colour alone (mockup 12.jpg). */}
      <span className={css.cardCheck} aria-hidden="true" />
      <span className={css.cardName}>{name}</span>
      {address ? <span className={css.cardDetail}>{address}</span> : null}
      {businessHours ? <span className={css.cardDetail}>{businessHours}</span> : null}
      {/* A laundry sets turnaround (in days) per top-level category, so /api/laundries
          resolves it for the garment being assigned and flags whether the number it
          returned is specific to that category. Say which: "2 days for this garment" is
          a promise about this booking, a studio-wide 2 days is not, and showing the same
          string for both would quietly overstate one of them. */}
      {typeof laundry.turnaroundDays === 'number' ? (
        <span className={css.cardDetail}>
          <FormattedMessage
            id={
              laundry.turnaroundDaysIsCategorySpecific
                ? 'EditListingLaundryForm.turnaroundForCategory'
                : 'EditListingLaundryForm.turnaround'
            }
            values={{ days: laundry.turnaroundDays }}
          />
        </span>
      ) : null}
      {/* {categoryChips.length > 0 ? (
        <span className={css.cardCategories}>
          {categoryChips.map(category => (
            <span key={category.value} className={css.cardCategory} title={category.path}>
              {category.label}
            </span>
          ))}
        </span>
      ) : null} */}
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
 * @param {Array<string>} [props.listingCategories] - The listing's own category values (categoryLevel1/2/3)
 * @param {boolean} [props.laundryLocked] - True when `listing.metadata.onLaundry` is
 *   set, i.e. the garment is physically at the laundry. Locks the picker (the
 *   assigned laundry may not be changed until the garment is back with its owner)
 *   while leaving Save enabled, so re-saving the same laundry still passes the tab.
 * @param {boolean} [props.filesRequired] - Whether the listing type requires verified file
 *   attachments before publishing
 * @param {boolean} [props.allFilesUploadedAndVerified] - Whether every uploaded file has
 *   passed verification
 * @param {Object} [props.filesTabParams] - Path params for a link to the Files tab
 * @param {Object} props.errors - The errors object
 * @param {propTypes.error} props.errors.showListingsError - The show listings error
 * @param {propTypes.error} props.errors.updateListingError - The update listing error
 * @param {propTypes.error} props.errors.publishListingError - The publish listing error,
 *   shown here because this is the last panel of the cocloset-booking new-listing flow
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
        listingCategories,
        laundryLocked = false,
        allFilesUploadedAndVerified,
        filesTabParams,
        filesRequired,
        values,
      } = formRenderProps;

      const intl = useIntl();
      const config = useConfiguration();
      const categoryTree = config?.categoryConfiguration?.categories || [];
      const laundryRequiredMessage = intl.formatMessage({
        id: 'EditListingLaundryForm.laundryRequired',
      });

      const { updateListingError, showListingsError, publishListingError } = fetchErrors || {};

      const classes = classNames(rootClassName || css.root, className);
      const submitReady = (updated && pristine) || ready;
      const submitInProgress = updateInProgress;
      const submitDisabled = invalid || disabled || submitInProgress || fetchLaundriesInProgress;

      const selectedLaundry = laundries.find(l => l.id === values.assignedLaundryId);
      const selectedAcceptedCategories = selectedLaundry?.acceptedCategories || [];
      const categories = listingCategories || [];
      // Both sides now speak Console category ids, so this is an exact-id comparison.
      // A listing carries every level of its chain (`dresses`, then `midi_dress`), and a
      // match on ANY level counts - so a laundry that ticks the parent accepts the whole
      // branch. See isCategoryAcceptedByLaundry for the rule and why it used to misfire.
      const showCategoryWarning =
        !!selectedLaundry && !isCategoryAcceptedByLaundry(categories, selectedAcceptedCategories);
      // The warning is read by a garment owner, so it names the listing's category the way
      // Console names it ("Dresses > Midi Dress"), never the raw id chain.
      const listingCategoryLabel = getCategoryLabels(categoryTree, categories).join(' › ');

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

          {/* Sits directly above the picker it explains, rather than with the
              panel's other notices, so an owner who finds the cards unclickable
              reads the reason in the same glance. `role="status"` because it is
              information about the control, not an error the owner caused. */}
          {laundryLocked ? (
            <p className={css.lockNotice} role="status">
              <FormattedMessage id="EditListingLaundryForm.laundryLocked" />
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
                  categoryTree={categoryTree}
                  formId={formId}
                  laundry={laundry}
                  selected={values.assignedLaundryId === laundry.id}
                  locked={laundryLocked}
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

          {/* {showCategoryWarning ? (
            <p className={css.warning}>
              <FormattedMessage
                id="EditListingLaundryForm.categoryWarning"
                values={{ category: listingCategoryLabel }}
              />
            </p>
          ) : null} */}

          {/* Publish-time surfaces. These used to live only in EditListingPhotosForm,
              which was the last panel of the new-listing flow; for cocloset-booking this
              panel is. `publishListingError` in particular has no other rendering
              surface here, so without it a failed publish would leave the owner pressing
              a button that appears to do nothing. See Note 4 on `tabsForListingType`. */}
          {publishListingError ? (
            <p className={css.error}>
              <FormattedMessage id="EditListingLaundryForm.publishListingFailed" />
            </p>
          ) : null}

          {/* Why the publish button is disabled while file verification is pending. The
              wizard disables the last tab's submit for exactly this reason
              (EditListingWizardTab's panelProps), and a disabled button with no
              explanation is the failure Note 4 exists to prevent. */}
          {filesRequired && !allFilesUploadedAndVerified ? (
            <p className={css.filesNotReady}>
              <FormattedMessage
                id="EditListingLaundryForm.filesNotReady"
                values={{
                  filesTabLink: (
                    <NamedLink name="EditListingPage" params={filesTabParams}>
                      <FormattedMessage id="EditListingLaundryForm.filesTabLinkText" />
                    </NamedLink>
                  ),
                }}
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
