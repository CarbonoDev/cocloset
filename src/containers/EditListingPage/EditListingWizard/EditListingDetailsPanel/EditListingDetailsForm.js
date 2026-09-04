import React, { useState, useEffect } from 'react';
import { Field, Form as FinalForm } from 'react-final-form';
import arrayMutators from 'final-form-arrays';
import classNames from 'classnames';

// Import util modules
import { FormattedMessage, useIntl } from '../../../../util/reactIntl';
import { displayDescription } from '../../../../util/configHelpers.js';
import { useConfiguration } from '../../../../context/configurationContext.js';
import { EXTENDED_DATA_SCHEMA_TYPES, propTypes } from '../../../../util/types';
import {
  isFieldForCategory,
  isFieldForListingType,
  isValidCurrencyForTransactionProcess,
} from '../../../../util/fieldHelpers';
import { maxLength, required, composeValidators } from '../../../../util/validators';
import { SPECIAL_CARE_NOTE_MAX_LENGTH, SPECIAL_CARE_OPTIONS } from '../../../../util/specialCare';

// Import shared components
import {
  Form,
  Button,
  FieldCheckbox,
  FieldSelect,
  FieldTextInput,
  Heading,
  CustomExtendedDataField,
} from '../../../../components';
// Import modules from this directory
import css from './EditListingDetailsForm.module.css';

const TITLE_MAX_LENGTH = 60;

// Show various error messages
const ErrorMessage = props => {
  const { fetchErrors } = props;
  const { updateListingError, createListingDraftError, showListingsError } = fetchErrors || {};
  const errorMessage = updateListingError ? (
    <FormattedMessage id="EditListingDetailsForm.updateFailed" />
  ) : createListingDraftError ? (
    <FormattedMessage id="EditListingDetailsForm.createListingDraftError" />
  ) : showListingsError ? (
    <FormattedMessage id="EditListingDetailsForm.showListingFailed" />
  ) : null;

  if (errorMessage) {
    return <p className={css.error}>{errorMessage}</p>;
  }
  return null;
};

// Hidden input field
const FieldHidden = props => {
  const { name } = props;
  return (
    <Field id={name} name={name} type="hidden" className={css.unitTypeHidden}>
      {fieldRenderProps => <input {...fieldRenderProps?.input} />}
    </Field>
  );
};

// Field component that either allows selecting listing type (if multiple types are available)
// or just renders hidden fields:
// - listingType              Set of predefined configurations for each listing type
// - transactionProcessAlias  Initiate correct transaction against Marketplace API
// - unitType                 Main use case: pricing unit
const FieldSelectListingType = props => {
  const {
    name,
    listingTypes,
    hasPredefinedListingType,
    onListingTypeChange,
    formApi,
    formId,
    intl,
  } = props;
  const hasMultipleListingTypes = listingTypes?.length > 1;

  const handleOnChange = value => {
    const selectedListingType = listingTypes.find(config => config.listingType === value);
    formApi.change('transactionProcessAlias', selectedListingType.transactionProcessAlias);
    formApi.change('unitType', selectedListingType.unitType);

    if (onListingTypeChange) {
      onListingTypeChange(selectedListingType);
    }
  };
  const getListingTypeLabel = listingType => {
    const listingTypeConfig = listingTypes.find(config => config.listingType === listingType);
    return listingTypeConfig ? listingTypeConfig.label : listingType;
  };

  return hasMultipleListingTypes && !hasPredefinedListingType ? (
    <>
      <FieldSelect
        id={formId ? `${formId}.${name}` : name}
        name={name}
        className={css.listingTypeSelect}
        label={intl.formatMessage({ id: 'EditListingDetailsForm.listingTypeLabel' })}
        validate={required(
          intl.formatMessage({ id: 'EditListingDetailsForm.listingTypeRequired' })
        )}
        onChange={handleOnChange}
      >
        <option disabled value="">
          {intl.formatMessage({ id: 'EditListingDetailsForm.listingTypePlaceholder' })}
        </option>
        {listingTypes.map(config => {
          const type = config.listingType;
          return (
            <option key={type} value={type}>
              {config.label}
            </option>
          );
        })}
      </FieldSelect>
      <FieldHidden name="transactionProcessAlias" />
      <FieldHidden name="unitType" />
    </>
  ) : hasMultipleListingTypes && hasPredefinedListingType ? (
    <div className={css.listingTypeSelect}>
      <Heading as="h5" rootClassName={css.selectedLabel}>
        {intl.formatMessage({ id: 'EditListingDetailsForm.listingTypeLabel' })}
      </Heading>
      <p className={css.selectedValue}>{getListingTypeLabel(formApi.getFieldState(name)?.value)}</p>
      <FieldHidden name={name} />
      <FieldHidden name="transactionProcessAlias" />
      <FieldHidden name="unitType" />
    </div>
  ) : (
    <>
      <FieldHidden name={name} />
      <FieldHidden name="transactionProcessAlias" />
      <FieldHidden name="unitType" />
    </>
  );
};

// Finds the correct subcategory within the given categories array based on the provided categoryIdToFind.
const findCategoryConfig = (categories, categoryIdToFind) => {
  return categories?.find(category => category.id === categoryIdToFind);
};

/**
 * Recursively render subcategory field inputs if there are subcategories available.
 * This function calls itself with updated props to render nested category fields.
 * The select field is used for choosing a category or subcategory.
 */
const CategoryField = props => {
  const { currentCategoryOptions, level, values, prefix, handleCategoryChange, intl } = props;

  const currentCategoryKey = `${prefix}${level}`;

  const categoryConfig = findCategoryConfig(currentCategoryOptions, values[`${prefix}${level}`]);

  // ONLY THE TOP CATEGORY IS REQUIRED.
  //
  //   > "Puedes cambiar la subcategoría para que sea opcional? Si el usuario selecciona una
  //   >  categoria esta bien, pero si esa categoria tiene subcategorías, puedo continuar si la
  //   >  selecciono o no"
  //
  // A garment has to be something; how finely it is described below that is the owner's
  // choice. Deeper levels only exist because the level above them offered them, so making
  // them optional is a rule about depth rather than about any particular category - it holds
  // for a three-level tree an operator adds next year without another change here.
  const isRequired = level === 1;

  return (
    <>
      {currentCategoryOptions ? (
        <FieldSelect
          key={currentCategoryKey}
          id={currentCategoryKey}
          name={currentCategoryKey}
          className={css.listingTypeSelect}
          onChange={event => handleCategoryChange(event, level, currentCategoryOptions)}
          label={intl.formatMessage(
            {
              id: isRequired
                ? 'EditListingDetailsForm.categoryLabel'
                : 'EditListingDetailsForm.categoryLabelOptional',
            },
            { categoryLevel: currentCategoryKey }
          )}
          validate={
            isRequired
              ? required(
                  intl.formatMessage(
                    { id: 'EditListingDetailsForm.categoryRequired' },
                    { categoryLevel: currentCategoryKey }
                  )
                )
              : undefined
          }
        >
          {/* THE PLACEHOLDER IS A REAL CHOICE ON AN OPTIONAL LEVEL.
                > "ese select no permite regresar al placeholder si selecciono una opción"

              It was `disabled` on every level, which is correct for a required field - there
              is nothing to go back TO - and a dead end on an optional one: having picked a
              subcategory the owner could never un-pick it, only pick a different wrong one.
              So the option is disabled exactly when the field is required. */}
          <option disabled={isRequired} value="">
            {intl.formatMessage(
              { id: 'EditListingDetailsForm.categoryPlaceholder' },
              { categoryLevel: currentCategoryKey }
            )}
          </option>

          {currentCategoryOptions.map(option => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </FieldSelect>
      ) : null}

      {categoryConfig?.subcategories?.length > 0 ? (
        <CategoryField
          currentCategoryOptions={categoryConfig.subcategories}
          level={level + 1}
          values={values}
          prefix={prefix}
          handleCategoryChange={handleCategoryChange}
          intl={intl}
        />
      ) : null}
    </>
  );
};

const FieldSelectCategory = props => {
  useEffect(() => {
    checkIfInitialValuesExist();
  }, []);

  const { prefix, listingCategories, formApi, intl, setAllCategoriesChosen, values } = props;

  // Counts the category levels that actually hold a choice. `Object.keys` alone counted a key
  // whose value had been cleared to null, which now happens on purpose: an owner may empty an
  // optional subcategory, and a level that has been emptied is not a level that was selected.
  const countSelectedCategories = () => {
    return Object.keys(values).filter(key => key.startsWith(prefix) && !!values[key]).length;
  };

  // Checks if initial values exist for categories and sets the state accordingly.
  // If initial values exist, it sets `allCategoriesChosen` state to true; otherwise, it sets it to false
  const checkIfInitialValuesExist = () => {
    const count = countSelectedCategories(values, prefix);
    setAllCategoriesChosen(count > 0);
  };

  // If a parent category changes, clear all child category values
  const handleCategoryChange = (category, level, currentCategoryOptions) => {
    const selectedCatLenght = countSelectedCategories();
    if (level < selectedCatLenght) {
      for (let i = selectedCatLenght; i > level; i--) {
        formApi.change(`${prefix}${i}`, null);
      }
    }

    // WHAT "ALL CHOSEN" MEANS NOW THAT SUBCATEGORIES ARE OPTIONAL.
    //
    // This flag is what reveals the title, the description and every listing field, so it has
    // to flip the moment the owner has said enough - which, with only level 1 required, is as
    // soon as level 1 holds a value. It used to wait for a leaf category, so a garment whose
    // top category happened to have subcategories showed an empty form until the owner picked
    // one; that is precisely the wait the client asked to remove.
    //
    // Level-aware rather than reading `values`, which is stale inside this handler: only
    // level 1 can take the form back to nothing, and clearing an optional subcategory must
    // not hide a form the owner has already filled in.
    //
    // This also drops an unguarded `findCategoryConfig(...).subcategories` that used to
    // decide the flag. Clearing a select calls this with an empty id, for which that lookup
    // returns undefined - so the old line threw the moment a placeholder became reachable.
    setAllCategoriesChosen(level > 1 ? true : !!category);
  };

  return (
    <CategoryField
      currentCategoryOptions={listingCategories}
      level={1}
      values={values}
      prefix={prefix}
      handleCategoryChange={handleCategoryChange}
      intl={intl}
    />
  );
};

/**
 * LISTING FIELDS THAT COME BEFORE THE TITLE.
 *
 *   > "brand debe estar en el editListingPage como el primer field despues de categoria y
 *   >  subcategoria"
 *
 * Everything else keeps the order Console gives it. Console orders ALL the listing fields
 * together, after the title and the description, and has no way to say "this one belongs up
 * with the category" - so the exception has to live here, where the title and the category are
 * laid out.
 *
 * A key list, so adding a second early field is a one-word change and the rule stays readable.
 * A key that is not configured, not for this listing type, or not for the chosen category is
 * simply not rendered - the split below filters, it does not force anything to appear.
 */
const LISTING_FIELD_KEYS_BEFORE_TITLE = ['brand'];

// Add collect data for listing fields (both publicData and privateData) based on configuration
const AddListingFields = props => {
  const { listingType, listingFieldsConfig, selectedCategories, formId, intl, pickField } = props;
  const targetCategoryIds = Object.values(selectedCategories);

  const fields = listingFieldsConfig.reduce((pickedFields, fieldConfig) => {
    const { key, schemaType, scope } = fieldConfig || {};
    const namespacedKey = scope === 'public' ? `pub_${key}` : `priv_${key}`;

    const isKnownSchemaType = EXTENDED_DATA_SCHEMA_TYPES.includes(schemaType);
    const isProviderScope = ['public', 'private'].includes(scope);
    const isTargetListingType = isFieldForListingType(listingType, fieldConfig);
    const isTargetCategory = isFieldForCategory(targetCategoryIds, fieldConfig);
    // Which SIDE of the title this field belongs on. Defaults to rendering everything, so the
    // component behaves exactly as before for any caller that does not split.
    const isWantedHere = pickField ? pickField(key) : true;

    return isKnownSchemaType &&
      isProviderScope &&
      isTargetListingType &&
      isTargetCategory &&
      isWantedHere
      ? [
          ...pickedFields,
          <CustomExtendedDataField
            key={namespacedKey}
            name={namespacedKey}
            fieldConfig={fieldConfig}
            defaultRequiredMessage={intl.formatMessage({
              id: 'EditListingDetailsForm.defaultRequiredMessage',
            })}
            formId={formId}
          />,
        ]
      : pickedFields;
  }, []);

  return <>{fields}</>;
};

// Return configuration for given listingType
const getListingTypeConfig = (config, listingType) => {
  return config.listing.listingTypes?.find(config => config.listingType === listingType);
};

/**
 * The garment owner's OWN address, used only for shipping the garment in to the assigned
 * laundry. Stored in `privateData.ownerAddress`, never shown to renters, and never used as
 * the listing's public geolocation - that comes from the assigned laundry.
 *
 * These three inputs used to live on their own wizard step (EditListingLocationForm).
 * cocloset-booking dropped that step because its PUBLIC pickup address comes from the
 * laundry, which says nothing about the owner's own address, so the capture moved here
 * rather than being deleted. Plain text fields, no map or autocomplete, and the same
 * required-ness the dedicated step had.
 */
/**
 * THE BRAND, AS AN AUTOCOMPLETE OVER THE BRANDS THAT ALREADY EXIST.
 *
 *   > "Podemos usar brand como un autocomplete de todas las brands que existen"
 *
 * BESPOKE, not a Console listing field, and it has to be. Brand was removed from Console so
 * flex-cli could own the `pub_brand` search schema - Console owns the schema for the fields it
 * defines, and a Console `text` field cannot produce a filterable parameter at all. That is
 * also why this could never have been a Console field even if one existed: Console renders a
 * plain text box, and a plain text box is not an autocomplete.
 *
 * A NATIVE `<datalist>` rather than a custom combobox. It gives suggestion-plus-free-text for
 * free, keyboard and screen-reader behaviour come from the browser rather than from us, and it
 * adds no dependency - which this project's conventions ask for before reaching for a package.
 * The trade is that the popup cannot be styled and mobile browsers present it differently. If
 * the design later needs the list to look like the rest of the form, this is the seam to
 * replace, and nothing outside this component knows how the suggestions are drawn.
 *
 * The field is FREE TEXT on purpose: the list is a shortcut to a brand that exists, never a
 * restriction to one. A garment whose brand nobody has listed yet has to be listable, and the
 * first person to type it is the one person who knows how it is spelled.
 *
 * Snapping a typed brand onto an existing spelling happens on SUBMIT, in the panel, not here -
 * see util/brandValue.js. Doing it on every keystroke would fight the person typing.
 */
const FieldBrandAutocomplete = props => {
  const { formId, intl, brandOptions = [] } = props;
  const listId = `${formId}brandOptions`;

  return (
    <>
      <FieldTextInput
        id={`${formId}brand`}
        name="brand"
        className={css.brand}
        type="text"
        // Long enough for the longest real brand and short enough to keep a paragraph out of
        // the field; matches what Console's own short-text fields allow.
        maxLength={70}
        label={intl.formatMessage({ id: 'EditListingDetailsForm.brand' })}
        placeholder={intl.formatMessage({ id: 'EditListingDetailsForm.brandPlaceholder' })}
        helpText={intl.formatMessage({ id: 'EditListingDetailsForm.brandHelp' })}
        // Reaches the DOM input through FieldTextInput's `...rest`.
        list={listId}
        autoComplete="off"
        validate={required(intl.formatMessage({ id: 'EditListingDetailsForm.brandRequired' }))}
      />
      <datalist id={listId}>
        {brandOptions.map(({ brand }) => (
          <option key={brand} value={brand} />
        ))}
      </datalist>
    </>
  );
};

/**
 * SPECIAL CARE: what the studio needs to know before it washes the garment.
 *
 *   > "hay que agregar una sección 'Special Care' con un conjunto de check boxes ... Note to
 *   >  Cleaner: ___ (Aqui se puede agregar texto libre)"
 *
 * Bespoke rather than a Console field, and it has to be: the data must reach the owner and the
 * studio and nobody else, which is not a visibility Console can express. See util/specialCare.js
 * for where it is stored and why that is the only option.
 *
 * ONE HIGH VALUE CHECKBOX. A separate request asked for a standalone one; this list already has
 * it. Two controls meaning the same thing can disagree, and nothing downstream could say which
 * was right.
 *
 * The note is capped and counted rather than left unbounded - it is read at a counter by
 * somebody holding a garment, so a paragraph is worse than a sentence.
 */
const FieldSpecialCare = props => {
  const { formId, intl } = props;

  return (
    <div className={css.specialCare}>
      <Heading as="h3" rootClassName={css.specialCareTitle}>
        {intl.formatMessage({ id: 'EditListingDetailsForm.specialCareTitle' })}
      </Heading>
      <p className={css.specialCareHelp}>
        {intl.formatMessage({ id: 'EditListingDetailsForm.specialCareHelp' })}
      </p>

      {SPECIAL_CARE_OPTIONS.map(option => (
        <FieldCheckbox
          key={option}
          id={`${formId}specialCare_${option}`}
          name="specialCareFlags"
          value={option}
          label={intl.formatMessage({ id: `EditListingDetailsForm.specialCare.${option}` })}
        />
      ))}

      <FieldTextInput
        id={`${formId}specialCareNote`}
        name="specialCareNote"
        className={css.specialCareNote}
        type="textarea"
        maxLength={SPECIAL_CARE_NOTE_MAX_LENGTH}
        label={intl.formatMessage({ id: 'EditListingDetailsForm.specialCare.note' })}
        placeholder={intl.formatMessage({
          id: 'EditListingDetailsForm.specialCare.notePlaceholder',
        })}
      />
    </div>
  );
};

const FieldOwnerAddress = props => {
  const { formId, intl } = props;

  return (
    <div className={css.ownerAddress}>
      <Heading as="h3" rootClassName={css.ownerAddressTitle}>
        {intl.formatMessage({ id: 'EditListingDetailsForm.ownerAddressTitle' })}
      </Heading>
      <p className={css.ownerAddressHelp}>
        {intl.formatMessage({ id: 'EditListingDetailsForm.ownerAddressHelp' })}
      </p>

      <FieldTextInput
        id={`${formId}ownerStreet`}
        name="ownerStreet"
        className={css.ownerAddressField}
        type="text"
        label={intl.formatMessage({ id: 'EditListingDetailsForm.ownerStreet' })}
        placeholder={intl.formatMessage({ id: 'EditListingDetailsForm.ownerStreetPlaceholder' })}
        validate={required(
          intl.formatMessage({ id: 'EditListingDetailsForm.ownerStreetRequired' })
        )}
      />

      <FieldTextInput
        id={`${formId}ownerCity`}
        name="ownerCity"
        className={css.ownerAddressField}
        type="text"
        label={intl.formatMessage({ id: 'EditListingDetailsForm.ownerCity' })}
        placeholder={intl.formatMessage({ id: 'EditListingDetailsForm.ownerCityPlaceholder' })}
        validate={required(intl.formatMessage({ id: 'EditListingDetailsForm.ownerCityRequired' }))}
      />

      <FieldTextInput
        id={`${formId}ownerPostcode`}
        name="ownerPostcode"
        className={css.ownerAddressField}
        type="text"
        label={intl.formatMessage({ id: 'EditListingDetailsForm.ownerPostcode' })}
        placeholder={intl.formatMessage({ id: 'EditListingDetailsForm.ownerPostcodePlaceholder' })}
        validate={required(
          intl.formatMessage({ id: 'EditListingDetailsForm.ownerPostcodeRequired' })
        )}
      />
    </div>
  );
};

/**
 * Form that asks title, description, transaction process and unit type for pricing
 * In addition, it asks about custom fields according to marketplace-custom-config.js
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.formId] - The form id
 * @param {boolean} props.disabled - Whether the form is disabled
 * @param {boolean} props.ready - Whether the form is ready
 * @param {boolean} props.updated - Whether the form is updated
 * @param {boolean} props.updateInProgress - Whether the update is in progress
 * @param {Object} props.fetchErrors - The fetch errors object
 * @param {propTypes.error} [props.fetchErrors.createListingDraftError] - The create listing draft error
 * @param {propTypes.error} [props.fetchErrors.showListingsError] - The show listings error
 * @param {propTypes.error} [props.fetchErrors.updateListingError] - The update listing error
 * @param {Function} props.pickSelectedCategories - The pick selected categories function
 * @param {Array<Object>} props.selectableListingTypes - The selectable listing types
 * @param {boolean} props.hasPredefinedListingType - Whether the listing type is already saved or predefined through URL
 * @param {propTypes.listingFields} props.listingFieldsConfig - The listing fields config
 * @param {string} props.listingCurrency - The listing currency
 * @param {boolean} [props.showOwnerAddress] - Whether to ask for the owner's own private
 *   shipping address (`privateData.ownerAddress`). Set for processes whose wizard has no
 *   LOCATION step; see FieldOwnerAddress above.
 * @param {string} props.saveActionMsg - The save action message
 * @param {boolean} [props.autoFocus] - Whether the form should autofocus
 * @param {Function} props.onListingTypeChange - The listing type change function
 * @param {Function} props.onSubmit - The submit function
 * @returns {JSX.Element}
 */
const EditListingDetailsForm = props => (
  <FinalForm
    {...props}
    mutators={{ ...arrayMutators }}
    render={formRenderProps => {
      const {
        autoFocus,
        className,
        disabled,
        ready,
        formId = 'EditListingDetailsForm',
        form: formApi,
        handleSubmit,
        onListingTypeChange,
        invalid,
        pristine,
        marketplaceCurrency,
        marketplaceName,
        selectableListingTypes,
        selectableCategories,
        hasPredefinedListingType = false,
        pickSelectedCategories,
        categoryPrefix,
        saveActionMsg,
        previewListingLink,
        updated,
        updateInProgress,
        fetchErrors,
        listingFieldsConfig = [],
        // The brands that already exist, for the autocomplete. Empty until the public endpoint
        // answers and on any failure - the input still works, it just suggests nothing.
        brandOptions = [],
        listingCurrency,
        showOwnerAddress = false,
        values,
      } = formRenderProps;

      const intl = useIntl();
      const { listingType, transactionProcessAlias, unitType } = values;
      const [allCategoriesChosen, setAllCategoriesChosen] = useState(false);

      const titleRequiredMessage = intl.formatMessage({
        id: 'EditListingDetailsForm.titleRequired',
      });
      const maxLengthMessage = intl.formatMessage(
        { id: 'EditListingDetailsForm.maxLength' },
        {
          maxLength: TITLE_MAX_LENGTH,
        }
      );

      // Determine the currency to validate:
      // - If editing an existing listing, use the listing's currency.
      // - If creating a new listing, fall back to the default marketplace currency.
      const currencyToCheck = listingCurrency || marketplaceCurrency;

      // Verify if the selected listing type's transaction process supports the chosen currency.
      // This checks compatibility between the transaction process
      // and the marketplace or listing currency.
      const isCompatibleCurrency = isValidCurrencyForTransactionProcess(
        transactionProcessAlias,
        currencyToCheck
      );

      const maxLength60Message = maxLength(maxLengthMessage, TITLE_MAX_LENGTH);

      // Console has no brand field today - it was removed so flex-cli could own the pub_brand
      // search schema - which is why FieldBrandAutocomplete exists at all. Checked rather than
      // assumed, so adding brand back in Console switches this off instead of producing two
      // brand inputs side by side.
      const hasHostedBrandField = listingFieldsConfig.some(config => config?.key === 'brand');

      const hasCategories = selectableCategories && selectableCategories.length > 0;
      const showCategories = listingType && hasCategories;

      const showTitle = hasCategories ? allCategoriesChosen : listingType;

      const config = useConfiguration();
      const listingTypeConfig = getListingTypeConfig(config, listingType);
      const showDescriptionMaybe = displayDescription(listingTypeConfig);
      const showDescription = hasCategories
        ? allCategoriesChosen && showDescriptionMaybe
        : showDescriptionMaybe;

      const showListingFields = hasCategories ? allCategoriesChosen : listingType;

      const classes = classNames(css.root, className);
      const submitReady = (updated && pristine) || ready;
      const submitInProgress = updateInProgress;
      const hasMandatoryListingTypeData = listingType && transactionProcessAlias && unitType;
      const submitDisabled =
        invalid ||
        disabled ||
        submitInProgress ||
        !hasMandatoryListingTypeData ||
        !isCompatibleCurrency;

      return (
        <Form className={classes} onSubmit={handleSubmit}>
          <ErrorMessage fetchErrors={fetchErrors} />

          <FieldSelectListingType
            name="listingType"
            listingTypes={selectableListingTypes}
            hasPredefinedListingType={hasPredefinedListingType}
            onListingTypeChange={onListingTypeChange}
            formApi={formApi}
            formId={formId}
            intl={intl}
          />

          {showCategories && isCompatibleCurrency && (
            <FieldSelectCategory
              values={values}
              prefix={categoryPrefix}
              listingCategories={selectableCategories}
              formApi={formApi}
              intl={intl}
              allCategoriesChosen={allCategoriesChosen}
              setAllCategoriesChosen={setAllCategoriesChosen}
            />
          )}

          {/* Brand is not a Console field, so nothing renders it but this. Guarded on Console
              NOT having one: if an operator ever adds brand back, the hosted field is the truth
              and this would otherwise draw a second brand input beside it. Same rule as
              listingFieldSearchConfig in util/listingFieldSearch.js - hosted wins. */}
          {showListingFields && isCompatibleCurrency && !hasHostedBrandField && (
            <FieldBrandAutocomplete formId={formId} intl={intl} brandOptions={brandOptions} />
          )}

          {/* A hosted brand, if one ever comes back, still sits with the category rather than
              down with the rest of the listing fields - see LISTING_FIELD_KEYS_BEFORE_TITLE.
              Same visibility condition as the block at the bottom, so an early field never
              appears before the category has been chosen. */}
          {showListingFields && isCompatibleCurrency && (
            <AddListingFields
              listingType={listingType}
              listingFieldsConfig={listingFieldsConfig}
              selectedCategories={pickSelectedCategories(values)}
              formId={formId}
              intl={intl}
              pickField={key => LISTING_FIELD_KEYS_BEFORE_TITLE.includes(key)}
            />
          )}

          {showTitle && isCompatibleCurrency && (
            <FieldTextInput
              id={`${formId}title`}
              name="title"
              className={css.title}
              type="text"
              label={intl.formatMessage({ id: 'EditListingDetailsForm.title' })}
              placeholder={intl.formatMessage({
                id: 'EditListingDetailsForm.titlePlaceholder',
              })}
              maxLength={TITLE_MAX_LENGTH}
              validate={composeValidators(required(titleRequiredMessage), maxLength60Message)}
              autoFocus={autoFocus}
            />
          )}

          {showDescription && isCompatibleCurrency && (
            <FieldTextInput
              id={`${formId}description`}
              name="description"
              className={css.description}
              type="textarea"
              label={intl.formatMessage({ id: 'EditListingDetailsForm.description' })}
              placeholder={intl.formatMessage({
                id: 'EditListingDetailsForm.descriptionPlaceholder',
              })}
              validate={required(
                intl.formatMessage({
                  id: 'EditListingDetailsForm.descriptionRequired',
                })
              )}
            />
          )}

          {showListingFields && isCompatibleCurrency && (
            <AddListingFields
              listingType={listingType}
              listingFieldsConfig={listingFieldsConfig}
              selectedCategories={pickSelectedCategories(values)}
              formId={formId}
              intl={intl}
              pickField={key => !LISTING_FIELD_KEYS_BEFORE_TITLE.includes(key)}
            />
          )}

          {/* THE ONE BLOCK ON THIS TAB THE RENTER NEVER SEES. It is boxed for that reason -
              the boundary between what the shop shows and what the studio is told should be
              visible rather than something you have to know. See util/specialCare.js. */}
          {showListingFields && isCompatibleCurrency && (
            <FieldSpecialCare formId={formId} intl={intl} />
          )}

          {/* {showOwnerAddress && showListingFields && isCompatibleCurrency && (
            <FieldOwnerAddress formId={formId} intl={intl} />
          )} */}

          {!isCompatibleCurrency && listingType && (
            <p className={css.error}>
              <FormattedMessage
                id="EditListingDetailsForm.incompatibleCurrency"
                values={{ marketplaceName, marketplaceCurrency }}
              />
            </p>
          )}

          <div className={css.formActions}>
            <Button
              className={css.submitButton}
              type="submit"
              inProgress={submitInProgress}
              disabled={submitDisabled}
              ready={submitReady}
            >
              {saveActionMsg}
            </Button>
            {previewListingLink}
          </div>
        </Form>
      );
    }}
  />
);

export default EditListingDetailsForm;
