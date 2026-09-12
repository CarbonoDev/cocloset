import React, { useEffect, useState } from 'react';
import { Field, Form as FinalForm } from 'react-final-form';
import { FieldArray } from 'react-final-form-arrays';
import arrayMutators from 'final-form-arrays';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { propTypes } from '../../../util/types';
import { isUploadImageOverLimitError } from '../../../util/errors';
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
import {
  BUSINESS_DAYS,
  dayCloseField,
  dayEnabledField,
  dayOpenField,
} from '../../../util/businessHours';
import { useConfiguration } from '../../../context/configurationContext';
import {
  autocompleteSearchRequired,
  autocompletePlaceSelected,
  composeValidators,
  required,
} from '../../../util/validators';

import {
  Form,
  Avatar,
  Button,
  FieldCheckbox,
  FieldTextInput,
  FieldLocationAutocompleteInput,
  IconAlert,
  IconSpinner,
  ImageFromFile,
  InlineTextButton,
} from '../../../components';

import css from './LaundryProfileForm.module.css';

const identity = v => v;
const ACCEPT_IMAGES = 'image/*';
const UPLOAD_CHANGE_DELAY = 2000; // Show spinner so that browser has time to load img srcset

/**
 * The Logo field. Reuses the exact upload mechanism ProfileSettingsForm's avatar does
 * (same `profileImage` user attribute, same sdk.images.upload flow) - "Logo" is a
 * label change for laundries, not a new stored field. Kept as its own component
 * because it needs the upload-delay smoothing timer (`uploadDelay`), which the rest of
 * this form has no use for.
 */
const LogoField = props => {
  const {
    formId,
    form,
    currentUser,
    profileImage = {},
    onImageUpload,
    uploadInProgress = false,
    uploadImageError,
  } = props;
  const intl = useIntl();
  const [uploadDelay, setUploadDelay] = useState(false);
  const wasUploading = React.useRef(uploadInProgress);

  useEffect(() => {
    // Upload delay is an additional time window where the Avatar is added to the DOM,
    // but not yet visible (time to load the image URL from srcset).
    if (wasUploading.current && !uploadInProgress) {
      setUploadDelay(true);
      const timeoutId = window.setTimeout(() => setUploadDelay(false), UPLOAD_CHANGE_DELAY);
      wasUploading.current = uploadInProgress;
      return () => window.clearTimeout(timeoutId);
    }
    wasUploading.current = uploadInProgress;
  }, [uploadInProgress]);

  const uploadingOverlay =
    uploadInProgress || uploadDelay ? (
      <div className={css.uploadingImageOverlay}>
        <IconSpinner />
      </div>
    ) : null;

  const hasUploadError = !!uploadImageError && !uploadInProgress;
  const errorClasses = classNames({ [css.avatarUploadError]: hasUploadError });
  const transientUserProfileImage = profileImage.uploadedImage || currentUser?.profileImage;
  const transientUser = { ...currentUser, profileImage: transientUserProfileImage };

  const fileExists = !!profileImage.file;
  const fileUploadInProgress = uploadInProgress && fileExists;
  const delayAfterUpload = profileImage.imageId && uploadDelay;
  const imageFromFile =
    fileExists && (fileUploadInProgress || delayAfterUpload) ? (
      <ImageFromFile
        id={profileImage.id}
        className={errorClasses}
        rootClassName={css.uploadingImage}
        aspectWidth={1}
        aspectHeight={1}
        file={profileImage.file}
      >
        {uploadingOverlay}
      </ImageFromFile>
    ) : null;

  const avatarClasses = classNames(errorClasses, css.avatar, {
    [css.avatarInvisible]: uploadDelay,
  });
  const avatarComponent =
    !fileUploadInProgress && profileImage.imageId ? (
      <Avatar
        className={avatarClasses}
        renderSizes="(max-width: 767px) 96px, 240px"
        user={transientUser}
        disableProfileLink
      />
    ) : null;

  const chooseLogoLabel =
    profileImage.imageId || fileUploadInProgress ? (
      <div className={css.avatarContainer}>
        {imageFromFile}
        {avatarComponent}
        <div className={css.changeAvatar}>
          <FormattedMessage id="LaundryProfileForm.changeLogo" />
        </div>
      </div>
    ) : (
      <div className={css.avatarPlaceholder}>
        <div className={css.avatarPlaceholderText}>
          <FormattedMessage id="LaundryProfileForm.addYourLogo" />
        </div>
      </div>
    );

  let uploadError = null;
  if (isUploadImageOverLimitError(uploadImageError)) {
    uploadError = (
      <div className={css.error}>
        <FormattedMessage id="LaundryProfileForm.imageUploadFailedFileTooLarge" />
      </div>
    );
  } else if (uploadImageError) {
    uploadError = (
      <div className={css.error}>
        <FormattedMessage id="LaundryProfileForm.imageUploadFailed" />
      </div>
    );
  }

  return (
    <div className={css.field}>
      <span className={css.fieldLabel}>
        <FormattedMessage id="LaundryProfileForm.logoLabel" />
      </span>
      <Field accept={ACCEPT_IMAGES} id={`${formId}.logo`} name="logo" type="file" form={null}>
        {fieldProps => {
          const { accept, id, input } = fieldProps;
          const { name, type } = input;
          const onChange = e => {
            const file = e.target.files[0];
            form.change('logo', file);
            form.blur('logo');
            if (file != null) {
              const tempId = `${file.name}_${Date.now()}`;
              onImageUpload({ id: tempId, file });
            }
          };

          return (
            <div className={css.uploadAvatarWrapper}>
              <label className={css.label} htmlFor={id}>
                {chooseLogoLabel}
              </label>
              <input
                accept={accept}
                id={id}
                name={name}
                className={css.uploadAvatarInput}
                disabled={uploadInProgress}
                onChange={onChange}
                type={type}
              />
            </div>
          );
        }}
      </Field>
      {uploadError}
    </div>
  );
};

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
 * ── THE ADDRESS IS DIFFERENT FROM EVERY OTHER FIELD HERE ────────────────────────
 * Two client rules land on it:
 *
 *   > "la laundry no puede estar en la lista de disponibles si no tiene dirección,
 *   >  por lo que en el form de laundry hay que poner una alerta llamativa de que no
 *   >  se le pueden asignar prendas si no tiene dirección establecida"
 *
 *   > "debemos indicar al usuario que no puede cambiar su dirección y que si desea
 *   >  modificar la dirección, debe solicitar apoyo al administrador o soporte"
 *
 * THE ALERT fires on `hasUsableAddress === false`, which is BOTH "no address" and
 * "an address with no geocoded coordinates" — the server excludes the second case
 * exactly as hard as the first (see util/laundryProfile.js, which is parity-tested
 * against the server predicate), and a studio told "you have an address" while
 * receiving nothing would be worse than no alert. It has to be loud because the
 * symptom is silence: /api/laundries simply omits this studio, so nothing else on
 * any screen tells the laundry why no garments arrive.
 *
 * THE LOCK is `addressEditable === false`, and it is NOT "locked whenever an address
 * exists". It is locked unless the studio may currently change it: no usable
 * address yet (onboarding — a permanently disabled empty field would strand every
 * new studio), or an admin has granted a one-off change
 * (`metadata.addressChangeAllowed`). When the grant is present the field opens and
 * says so, so a studio that has just been granted the change can tell.
 *
 * WHAT THE LOCK IS WORTH, HONESTLY: the disabled input is UX. The address is saved
 * through a gated server endpoint (/api/laundry-address, which re-takes the same
 * decision against the stored user), but it still LIVES in the laundry's own
 * `publicData`, which it can write directly against the Marketplace API. So this
 * form and that endpoint gate the sanctioned path; neither closes the direct one.
 * Nothing in this file may say otherwise — see server/api-util/laundryAddress.js.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.formId] - The form id
 * @param {Function} props.onSubmit - The function to handle form submission
 * @param {boolean} props.updateInProgress - Whether the update is in progress
 * @param {propTypes.error} [props.updateProfileError] - The update profile error
 * @param {Object} [props.updateAddressError] - The gated address call's error. Carries
 *   `code` ('change-not-allowed' | 'invalid-address' | ...) so the message can be
 *   translated rather than echoing the server's English `statusText`.
 * @param {boolean} [props.hasUsableAddress] - Does the STORED profile have an address
 *   AND usable coordinates? Drives the alert.
 * @param {boolean} [props.addressEditable] - May the studio change the address right
 *   now? Drives the lock. Defaults to true so a caller that passes neither prop gets
 *   the pre-existing editable form rather than a silently frozen one.
 * @param {propTypes.currentUser} [props.currentUser] - The current user, for the Logo's
 *   Avatar preview
 * @param {Object} [props.profileImage] - In-flight/uploaded Logo image, see
 *   ProfileSettingsForm for the identical shape
 * @param {Function} [props.onImageUpload] - `({ id, file }) => void`
 * @param {boolean} [props.uploadInProgress] - Whether the Logo upload is in progress
 * @param {propTypes.error} [props.uploadImageError] - The Logo upload error
 * @returns {JSX.Element}
 */
const LaundryProfileForm = props => (
  <FinalForm
    {...props}
    mutators={{ ...arrayMutators }}
    render={fieldRenderProps => {
      const {
        addressEditable = true,
        className,
        currentUser,
        form,
        formId = 'LaundryProfileForm',
        handleSubmit,
        hasUsableAddress = false,
        initialValues,
        invalid,
        onImageUpload,
        pristine,
        profileImage = {},
        rootClassName,
        updateAddressError,
        updateInProgress,
        updateProfileError,
        uploadImageError,
        uploadInProgress = false,
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

      // The address call fails for its own reasons, and one of them - the change is
      // not currently permitted - is not an error the studio can fix by retrying.
      // Switched on the server's machine-readable `data.code`, never on `statusText`,
      // which would put an English server sentence on a translated page.
      const addressError = updateAddressError ? (
        <div className={css.error} role="alert">
          <FormattedMessage
            id={
              updateAddressError.code === 'change-not-allowed'
                ? 'LaundryProfileForm.addressChangeNotAllowed'
                : 'LaundryProfileForm.updateAddressFailed'
            }
          />
        </div>
      ) : null;

      // ── THE ALERT ─────────────────────────────────────────────────────────────
      // `role="alert"` rather than `role="status"`: this is not progress
      // information, it is the reason the studio is receiving nothing, and it should
      // interrupt.
      const missingAddressAlert = hasUsableAddress ? null : (
        <div className={css.addressAlert} role="alert">
          <IconAlert className={css.addressAlertIcon} />
          <div className={css.addressAlertBody}>
            <p className={css.addressAlertTitle}>
              <FormattedMessage id="LaundryProfileForm.noAddressAlertTitle" />
            </p>
            <p className={css.addressAlertText}>
              <FormattedMessage id="LaundryProfileForm.noAddressAlertText" />
            </p>
          </div>
        </div>
      );

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
          {/* First thing on the form, before any field: a studio that cannot receive
              garments needs to know that before it edits anything else. */}
          {missingAddressAlert}
          {submitError}
          {addressError}

          <LogoField
            formId={formId}
            form={form}
            currentUser={currentUser}
            profileImage={profileImage}
            onImageUpload={onImageUpload}
            uploadInProgress={uploadInProgress}
            uploadImageError={uploadImageError}
          />

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
            // UX only. The value still submits (final-form keeps it from
            // initialValues), the page sends the STORED address on the ungated write,
            // and the gated endpoint decides again server-side. See the docblock.
            disabled={!addressEditable}
            validate={composeValidators(
              autocompleteSearchRequired(addressRequiredMessage),
              autocompletePlaceSelected(addressNotRecognizedMessage)
            )}
          />

          {/* Why the field is closed, or why it has just opened. Not rendered at all
              during onboarding: a studio with no address yet has the alert above
              telling it to set one, and a third block would only add noise. */}
          {!addressEditable ? (
            <p className={css.addressNote}>
              <FormattedMessage id="LaundryProfileForm.addressChangeRequiresSupport" />
            </p>
          ) : hasUsableAddress ? (
            <p className={css.addressNoteGranted}>
              <FormattedMessage id="LaundryProfileForm.addressChangeGranted" />
            </p>
          ) : null}

          {/* THE FALLBACK, ASKED ONLY WHEN THE ADDRESS COULD NOT ANSWER.
                > "de ahi hay que obtener el vecindario, si no es posible obtenerlo se
                >  utilizará un field de vecindario, pero debe estar en settings de laundry,
                >  no en profile settings del user" (Jonathan, 2026-09-07)

              The address autocomplete carries the district in its Mapbox context, and the
              submit handler prefers it - a studio that moves picks a new address and the
              district follows on its own. This box exists for the addresses Mapbox has no
              district for, and it is here rather than on the user's profile settings because
              a studio's neighbourhood is a fact about the shop, not about the person who
              signed it up.

              Always shown rather than revealed after a failed lookup: the geocoder runs on
              save, so a box that appeared only afterwards would appear only after the studio
              had already left the page. */}
          <FieldTextInput
            className={css.field}
            type="text"
            id={`${formId}.neighborhood`}
            name="neighborhood"
            labelClassName={css.fieldLabel}
            label={intl.formatMessage({ id: 'LaundryProfileForm.neighborhoodLabel' })}
            placeholder={intl.formatMessage({ id: 'LaundryProfileForm.neighborhoodPlaceholder' })}
          />
          <p className={css.fieldHint}>
            <FormattedMessage id="LaundryProfileForm.neighborhoodHelp" />
          </p>

          {/* THE STUDIO'S "ABOUT" LINE, shown read-only on its public ProfilePage
              alongside address/neighborhood/business hours (2026-09-11). Optional,
              same as neighborhood - a studio that doesn't want to say anything leaves
              it blank. */}
          <FieldTextInput
            className={css.field}
            type="textarea"
            id={`${formId}.description`}
            name="description"
            labelClassName={css.fieldLabel}
            label={intl.formatMessage({ id: 'LaundryProfileForm.descriptionLabel' })}
            placeholder={intl.formatMessage({ id: 'LaundryProfileForm.descriptionPlaceholder' })}
          />

          {/* ONE ROW PER DAY, ALL TICKED TO START WITH.
                > "un listado con checkboxes por cada día, cada día debe tener un input
                >  para hora de abrir y un input para hora de cerrar, por default todos
                >  los días deben estar checkeados"

              This replaced a single free-text box, which is why nothing could ever answer
              "are they open on Sunday" - it held a sentence. The times are `type="time"`,
              so the browser gives a picker and enforces HH:MM rather than this form
              inventing a parser for whatever somebody types.

              A day's inputs are disabled rather than hidden when it is unticked: the row
              stays in place, so the grid does not reflow under the cursor as a studio
              works down it, and the hours it had are still there when it is ticked back. */}
          <fieldset className={css.hoursFieldset}>
            <legend className={css.fieldLabel}>
              {intl.formatMessage({ id: 'LaundryProfileForm.businessHoursLabel' })}
            </legend>
            <p className={css.hoursHelp}>
              <FormattedMessage id="LaundryProfileForm.businessHoursHelp" />
            </p>

            {BUSINESS_DAYS.map(day => {
              const isOpen = !!values[dayEnabledField(day)];
              return (
                <div className={css.hoursRow} key={day}>
                  <FieldCheckbox
                    className={css.hoursDay}
                    id={`${formId}.${dayEnabledField(day)}`}
                    name={dayEnabledField(day)}
                    label={intl.formatMessage({ id: `LaundryProfileForm.day.${day}` })}
                  />
                  <FieldTextInput
                    className={css.hoursTime}
                    type="time"
                    id={`${formId}.${dayOpenField(day)}`}
                    name={dayOpenField(day)}
                    disabled={!isOpen}
                    label={intl.formatMessage({ id: 'LaundryProfileForm.opensAt' })}
                  />
                  <FieldTextInput
                    className={css.hoursTime}
                    type="time"
                    id={`${formId}.${dayCloseField(day)}`}
                    name={dayCloseField(day)}
                    disabled={!isOpen}
                    label={intl.formatMessage({ id: 'LaundryProfileForm.closesAt' })}
                  />
                </div>
              );
            })}
          </fieldset>

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
