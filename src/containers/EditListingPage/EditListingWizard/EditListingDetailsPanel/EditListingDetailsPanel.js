import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

// Import util modules
import { FormattedMessage } from '../../../../util/reactIntl';
import {
  EXTENDED_DATA_SCHEMA_TYPES,
  LISTING_STATE_DRAFT,
  SCHEMA_TYPE_ENUM,
  SCHEMA_TYPE_MULTI_ENUM,
} from '../../../../util/types';
import { LISTING_PAGE_PARAM_TYPE_NEW } from '../../../../util/urlHelpers';
import {
  isFieldForCategory,
  isFieldForListingType,
  pickCategoryFields,
} from '../../../../util/fieldHelpers';
import {
  COCLOSET_BOOKING_PROCESS_NAME,
  isBookingProcessAlias,
} from '../../../../transactions/transaction';

// Import shared components
import { H3, ListingLink } from '../../../../components';

// Import modules from this directory
import ErrorMessage from './ErrorMessage';
import { fetchBrands } from '../../../../util/api';
import { normalizeBrandForStorage } from '../../../../util/brandValue';
import {
  specialCareFlags,
  specialCareForStorage,
  specialCareNote,
} from '../../../../util/specialCare';

import EditListingDetailsForm from './EditListingDetailsForm';
import css from './EditListingDetailsPanel.module.css';

/**
 * Get listing configuration. For existing listings, it is stored to publicData.
 * For new listings, the data needs to be figured out from listingTypes configuration.
 *
 * In the latter case, we select first type in the array. However, EditListingDetailsForm component
 * gets 'selectableListingTypes' prop, which it uses to provide a way to make selection,
 * if multiple listing types are available.
 *
 * @param {Array} listingTypes
 * @param {Object} existingListingTypeInfo
 * @returns an object containing mainly information that can be stored to publicData.
 */
const getTransactionInfo = props => {
  const {
    listingTypes = [],
    existingListingTypeInfo = {},
    includeLabel = false,
    preselectedListingType = null,
  } = props;
  const { listingType, transactionProcessAlias, unitType } = existingListingTypeInfo;

  if (listingType && transactionProcessAlias && unitType) {
    // If listing type has already been set, return the existing listing type info.
    return { listingType, transactionProcessAlias, unitType };
  } else if (listingTypes.length === 1 || preselectedListingType) {
    const listingTypeConfig =
      listingTypes.length === 1
        ? listingTypes[0]
        : preselectedListingType
        ? listingTypes.find(conf => conf.listingType === preselectedListingType)
        : {};
    const { listingType: type, label, transactionType } = listingTypeConfig || {};
    if (!type) {
      // If listing type is not found (e.g. preselected listing type is not found among listingTypes),
      // return empty object.
      return {};
    }
    const { alias, unitType: configUnitType } = transactionType;
    const labelMaybe = includeLabel ? { label: label || type } : {};
    return {
      listingType: type,
      transactionProcessAlias: alias,
      unitType: configUnitType,
      ...labelMaybe,
    };
  }
  return {};
};

/**
 * Check if listingType has already been set.
 *
 * If listing type (incl. process & unitType) has been set, we won't allow change to it.
 * It's possible to make it editable, but it becomes somewhat complex to modify following panels,
 * for the different process. (E.g. adjusting stock vs booking availability settings,
 * if process has been changed for existing listing.)
 *
 * @param {Object} publicData JSON-like data stored to listing entity.
 * @returns object literal with to keys: { hasExistingListingType, existingListingTypeInfo }
 */
const hasSetListingType = publicData => {
  const { listingType, transactionProcessAlias, unitType } = publicData;
  const existingListingTypeInfo = { listingType, transactionProcessAlias, unitType };

  return {
    hasExistingListingType: !!listingType && !!transactionProcessAlias && !!unitType,
    existingListingTypeInfo,
  };
};

/**
 * Pick extended data fields from given form data.
 * Picking is based on extended data configuration for the listing and target scope and listing type.
 *
 * This expects submit data to be namespaced (e.g. 'pub_') and it returns the field without that namespace.
 * This function is used when form submit values are restructured for the actual API endpoint.
 *
 * Note: This returns null for those fields that are managed by configuration, but don't match target listing type.
 *       These might exists if provider swaps between listing types before saving the draft listing.
 *
 * @param {Object} data values to look through against listingConfig.js and util/configHelpers.js
 * @param {String} targetScope Check that the scope of extended data the config matches
 * @param {String} targetListingType Check that the extended data is relevant for this listing type.
 * @param {Object} listingFieldConfigs an extended data configurtions for listing fields.
 * @returns Array of picked extended data fields from submitted data.
 */
const pickListingFieldsData = (
  data,
  targetScope,
  targetListingType,
  targetCategories,
  listingFieldConfigs
) => {
  const targetCategoryIds = Object.values(targetCategories);

  return listingFieldConfigs.reduce((fields, fieldConfig) => {
    const { key, scope = 'public', schemaType } = fieldConfig || {};
    const namespacePrefix = scope === 'public' ? `pub_` : `priv_`;
    const namespacedKey = `${namespacePrefix}${key}`;

    const isKnownSchemaType = EXTENDED_DATA_SCHEMA_TYPES.includes(schemaType);
    const isTargetScope = scope === targetScope;
    const isTargetListingType = isFieldForListingType(targetListingType, fieldConfig);
    const isTargetCategory = isFieldForCategory(targetCategoryIds, fieldConfig);

    if (isKnownSchemaType && isTargetScope && isTargetListingType && isTargetCategory) {
      const fieldValue = data[namespacedKey] != null ? data[namespacedKey] : null;
      return { ...fields, [key]: fieldValue };
    } else if (isKnownSchemaType && isTargetScope) {
      // Note: this clears extra custom fields
      // These might exists if provider swaps between listing types before saving the draft listing.
      return { ...fields, [key]: null };
    }
    return fields;
  }, {});
};

/**
 * Pick extended data fields from given extended data of the listing entity.
 * Picking is based on extended data configuration for the listing and target scope and listing type.
 *
 * This returns namespaced (e.g. 'pub_') initial values for the form.
 *
 * @param {Object} data extended data values to look through against listingConfig.js and util/configHelpers.js
 * @param {String} targetScope Check that the scope of extended data the config matches
 * @param {String} targetListingType Check that the extended data is relevant for this listing type.
 * @param {Object} listingFieldConfigs an extended data configurtions for listing fields.
 * @returns Array of picked extended data fields
 */
const initialValuesForListingFields = (
  data,
  targetScope,
  targetListingType,
  targetCategories,
  listingFieldConfigs
) => {
  const targetCategoryIds = Object.values(targetCategories);

  return listingFieldConfigs.reduce((fields, fieldConfig) => {
    const { key, scope = 'public', schemaType, enumOptions } = fieldConfig || {};
    const namespacePrefix = scope === 'public' ? `pub_` : `priv_`;
    const namespacedKey = `${namespacePrefix}${key}`;

    const isKnownSchemaType = EXTENDED_DATA_SCHEMA_TYPES.includes(schemaType);
    const isEnumSchemaType = schemaType === SCHEMA_TYPE_ENUM;
    const shouldHaveValidEnumOptions =
      !isEnumSchemaType ||
      (isEnumSchemaType && !!enumOptions?.find(conf => conf.option === data?.[key]));
    const isTargetScope = scope === targetScope;
    const isTargetListingType = isFieldForListingType(targetListingType, fieldConfig);
    const isTargetCategory = isFieldForCategory(targetCategoryIds, fieldConfig);

    if (
      isKnownSchemaType &&
      isTargetScope &&
      isTargetListingType &&
      isTargetCategory &&
      shouldHaveValidEnumOptions
    ) {
      const fieldValue = data?.[key] != null ? data[key] : null;
      return { ...fields, [namespacedKey]: fieldValue };
    }
    return fields;
  }, {});
};

/**
 * If listing represents something else than a bookable listing, we set availability-plan to seats=0.
 * Note: this is a performance improvement since the API is backwards compatible.
 *
 * @param {string} processAlias selected for this listing
 * @returns availabilityPlan without any seats available for the listing
 */
const setNoAvailabilityForUnbookableListings = processAlias => {
  return isBookingProcessAlias(processAlias)
    ? {}
    : {
        availabilityPlan: {
          type: 'availability-plan/time',
          timezone: 'Etc/UTC',
          entries: [
            // Note: "no entries" is the same as seats=0 for every entry.
            // { dayOfWeek: 'mon', startTime: '00:00', endTime: '00:00', seats: 0 },
            // { dayOfWeek: 'tue', startTime: '00:00', endTime: '00:00', seats: 0 },
            // { dayOfWeek: 'wed', startTime: '00:00', endTime: '00:00', seats: 0 },
            // { dayOfWeek: 'thu', startTime: '00:00', endTime: '00:00', seats: 0 },
            // { dayOfWeek: 'fri', startTime: '00:00', endTime: '00:00', seats: 0 },
            // { dayOfWeek: 'sat', startTime: '00:00', endTime: '00:00', seats: 0 },
            // { dayOfWeek: 'sun', startTime: '00:00', endTime: '00:00', seats: 0 },
          ],
        },
      };
};

// The plan timezone for an automatically-created cocloset-booking listing.
//
// NOT the browser's zone, which is what the removed AVAILABILITY panel wrote. The
// listing's plan timezone silently becomes the day-boundary authority for the server's
// minimum-booking-days and initial-cleaning gates (server/api-util/bookingRules.js falls
// back to 'Etc/UTC' today, with a test pinning it). Writing the owner's browser zone
// would make those refusals depend on which machine the garment was listed from - a
// garment listed in Madrid and one listed in Bogotá would compute different first
// bookable days for identical data. 'Etc/UTC' preserves exactly today's server
// behaviour.
//
// This is a deliberate choice, not a discovered constant: if Cocloset wants a single
// marketplace-wide zone (e.g. 'Europe/Madrid'), this is the one line to change.
export const FULL_AVAILABILITY_TIMEZONE = 'Etc/UTC';

const DAYS_OF_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * A cocloset-booking listing must be available every day, all day, and it must get that
 * plan without anyone being asked: the wizard has no AVAILABILITY step for this process
 * (see `tabsForListingType`). This is load-bearing rather than cosmetic - OrderPanel
 * gates its whole booking form on `availabilityPlan.timezone` existing, so a plan-less
 * listing cannot be booked at all.
 *
 * The counterpart of `setNoAvailabilityForUnbookableListings` above, and shaped exactly
 * like what the AVAILABILITY form itself persisted for a full-day `oneSeat` listing: one
 * entry per weekday, `00:00` to `00:00`. The end time is not a typo - the form normalises
 * a whole day's `24:00` down to `00:00` when saving (see AvailabilityPlanEntries.js), and
 * `src/util/testData.js` carries the same shape.
 *
 * Skipped when the listing already has a plan, so editing the details of an existing
 * listing never overwrites availability someone has deliberately set.
 *
 * @param {string} processAlias selected for this listing, e.g. 'cocloset-booking/release-1'
 * @param {Object} [existingAvailabilityPlan] the plan already stored on the listing, if any
 * @returns {Object} `{ availabilityPlan }`, or `{}` when nothing should be written
 */
export const setFullAvailabilityForCoclosetBooking = (processAlias, existingAvailabilityPlan) => {
  const processName = processAlias ? processAlias.split('/')[0] : null;
  const isCoclosetBooking = processName === COCLOSET_BOOKING_PROCESS_NAME;

  if (!isCoclosetBooking || existingAvailabilityPlan) {
    return {};
  }

  return {
    availabilityPlan: {
      type: 'availability-plan/time',
      timezone: FULL_AVAILABILITY_TIMEZONE,
      entries: DAYS_OF_WEEK.map(dayOfWeek => ({
        dayOfWeek,
        startTime: '00:00',
        endTime: '00:00',
        seats: 1,
      })),
    },
  };
};

/**
 * Get initialValues for the form. This function includes
 * title, description, listingType, transactionProcessAlias, unitType,
 * and those publicData & privateData fields that are configured through
 * config.listing.listingFields.
 *
 * @param {object} props
 * @param {object} existingListingTypeInfo info saved to listing's publicData
 * @param {object} listingTypes app's configured types (presets for listings)
 * @param {object} listingFields those extended data fields that are part of configurations
 * @returns initialValues object for the form
 */
const getInitialValues = (
  props,
  existingListingTypeInfo,
  listingTypes,
  listingFields,
  listingCategories,
  categoryKey
) => {
  const { description, title, publicData, privateData } = props?.listing?.attributes || {};
  // If details panel is accessed via URL like my.domain.com/l/draft/00000000-0000-0000-0000-000000000000/new/details?listingType=sell-bicycles,
  // we'll pick the preselected listing type from the URL.
  const preselectedListingType = props.locationSearch?.listingType;
  // If listing type has already been set, use it.
  // Otherwise, check if there's a preselected listing type in the URL.
  const listingType = publicData?.listingType || preselectedListingType;

  const nestedCategories = pickCategoryFields(publicData, categoryKey, 1, listingCategories);
  // The owner's own private shipping address, which the LOCATION tab used to own. Kept
  // under distinct `owner*` field names so it cannot collide with a configured listing
  // field (those are always `pub_`/`priv_` namespaced) or with the category keys.
  const { street, city, postcode } = privateData?.ownerAddress || {};

  // Initial values for the form
  return {
    title,
    description,
    ownerStreet: street,
    ownerCity: city,
    ownerPostcode: postcode,
    // Brand is not a Console listing field, so initialValuesForListingFields below does not
    // pick it up - it reads Console's own fields. Editing a garment has to show the brand it
    // already carries, or saving the tab would silently clear it.
    brand: publicData?.brand,
    // Same for special care, which is not a Console field either and for a stronger reason -
    // see util/specialCare.js. Flattened into two form fields because that is what the
    // checkbox group and the textarea bind to; recombined on submit.
    specialCareFlags: specialCareFlags(privateData),
    specialCareNote: specialCareNote(privateData) || '',
    ...nestedCategories,
    // Transaction type info: listingType, transactionProcessAlias, unitType
    ...getTransactionInfo({ listingTypes, existingListingTypeInfo, preselectedListingType }),
    ...initialValuesForListingFields(
      publicData,
      'public',
      listingType,
      nestedCategories,
      listingFields
    ),
    ...initialValuesForListingFields(
      privateData,
      'private',
      listingType,
      nestedCategories,
      listingFields
    ),
  };
};

/**
 * The EditListingDetailsPanel component.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {propTypes.ownListing} props.listing - The listing object
 * @param {boolean} props.disabled - Whether the form is disabled
 * @param {boolean} props.ready - Whether the form is ready
 * @param {Function} props.onSubmit - The submit function
 * @param {Function} props.onListingTypeChange - The listing type change function
 * @param {boolean} [props.captureOwnerAddress] - Whether this panel should also ask for the
 *   owner's own private shipping address (`privateData.ownerAddress`). True only for
 *   processes whose wizard has no LOCATION tab; see EditListingWizard.js.
 * @param {string} props.submitButtonText - The submit button text
 * @param {boolean} props.panelUpdated - Whether the panel is updated
 * @param {boolean} props.updateInProgress - Whether the update is in progress
 * @param {Object} props.errors - The errors object
 * @param {Object} props.config - The config object
 * @returns {JSX.Element}
 */
const EditListingDetailsPanel = props => {
  const {
    className,
    rootClassName,
    params: pathParams,
    locationSearch,
    listing,
    disabled,
    ready,
    onSubmit,
    onListingTypeChange,
    captureOwnerAddress = false,
    // Injectable for tests and the styleguide example; normally the panel fetches its own,
    // below. Empty until that answers and on any failure - the input still works, it just
    // suggests nothing.
    brandOptions: brandOptionsProp,
    submitButtonText,
    previewListingLink,
    panelUpdated,
    updateInProgress,
    errors,
    config,
    updatePageTitle: UpdatePageTitle,
    intl,
  } = props;

  const classes = classNames(rootClassName || css.root, className);
  const { publicData, state } = listing?.attributes || {};
  const listingTypes = config.listing.listingTypes;
  const listingFields = config.listing.listingFields;
  const listingCategories = config.categoryConfiguration.categories;
  const categoryKey = config.categoryConfiguration.key;
  // Console has no brand field today; if one is ever added back it owns the value, and the
  // bespoke input is not rendered - so this tab must not write brand either. Same "hosted
  // wins" rule as listingFieldSearchConfig in util/listingFieldSearch.js.
  const hasHostedBrandField = listingFields.some(field => field?.key === 'brand');

  // THE BRANDS THE AUTOCOMPLETE OFFERS.
  //
  // Fetched by the panel rather than through the duck, matching EditListingLaundryPanel, which
  // owns its own lookup for the same reason: this is wizard-tab data, not page data, and it is
  // not needed for SSR.
  //
  // FAILURE IS NOT AN ERROR STATE and there is no spinner. Brand is a free-text field that
  // happens to suggest; a list that never arrives costs the owner a convenience, not the
  // ability to fill the form in, so blocking or shouting about it would be the wrong trade.
  //
  // Skipped entirely when Console owns the field, since then nothing renders the suggestions.
  const [fetchedBrandOptions, setFetchedBrandOptions] = useState([]);
  const skipBrandFetch = hasHostedBrandField || !!brandOptionsProp;

  useEffect(() => {
    if (skipBrandFetch) {
      return undefined;
    }
    let isMounted = true;
    // Wrapped rather than chained directly. Nothing about a suggestion list may break the form
    // the owner is filling in, and `fetchBrands()` not returning a promise - a stubbed module,
    // a future refactor - would otherwise throw inside an effect and take the whole panel down
    // with it. The catch below cannot help with that; it is not a rejection.
    Promise.resolve(fetchBrands())
      .then(response => {
        if (isMounted) {
          setFetchedBrandOptions(Array.isArray(response?.data) ? response.data : []);
        }
      })
      .catch(() => {
        // Swallowed on purpose - see above. The input keeps working with no suggestions.
      });
    return () => {
      isMounted = false;
    };
  }, [skipBrandFetch]);

  const brandOptions = brandOptionsProp || fetchedBrandOptions;

  const { hasExistingListingType, existingListingTypeInfo } = hasSetListingType(publicData);
  const hasValidExistingListingType =
    hasExistingListingType &&
    !!listingTypes.find(conf => {
      const listinTypesMatch = conf.listingType === existingListingTypeInfo.listingType;
      const unitTypesMatch = conf.transactionType?.unitType === existingListingTypeInfo.unitType;
      return listinTypesMatch && unitTypesMatch;
    });

  const validPreselectedListingType =
    pathParams?.type === LISTING_PAGE_PARAM_TYPE_NEW && !!locationSearch?.listingType
      ? listingTypes.find(conf => conf.listingType === locationSearch.listingType)
      : null;

  // Call onListingTypeChange with validPreselectedListingType id-string on initialization.
  // The call selects the correct wizard tabs for the preselected listing type.
  // Note: it's only called if listing type is not already saved to publicData.
  useEffect(() => {
    if (!hasExistingListingType && validPreselectedListingType && onListingTypeChange) {
      onListingTypeChange(validPreselectedListingType);
    }
  }, []);

  const initialValues = getInitialValues(
    props,
    existingListingTypeInfo,
    listingTypes,
    listingFields,
    listingCategories,
    categoryKey
  );

  const noListingTypesSet = listingTypes?.length === 0;
  const hasListingTypesSet = listingTypes?.length > 0;
  const canShowEditListingDetailsForm =
    hasListingTypesSet && (!hasExistingListingType || hasValidExistingListingType);
  const isPublished = listing?.id && state !== LISTING_STATE_DRAFT;

  const panelHeadingProps = isPublished
    ? {
        id: 'EditListingDetailsPanel.title',
        values: { listingTitle: <ListingLink listing={listing} />, lineBreak: <br /> },
        messageProps: { listingTitle: listing.attributes.title },
      }
    : {
        id: 'EditListingDetailsPanel.createListingTitle',
        values: { lineBreak: <br /> },
        messageProps: {},
      };

  return (
    <main className={classes}>
      <UpdatePageTitle
        panelHeading={intl.formatMessage(
          { id: panelHeadingProps.id },
          { ...panelHeadingProps.messageProps }
        )}
      />
      <H3 as="h1">
        <FormattedMessage id={panelHeadingProps.id} values={{ ...panelHeadingProps.values }} />
      </H3>

      {canShowEditListingDetailsForm ? (
        <EditListingDetailsForm
          className={css.form}
          initialValues={initialValues}
          saveActionMsg={submitButtonText}
          previewListingLink={previewListingLink}
          onSubmit={values => {
            const {
              title,
              description,
              listingType,
              transactionProcessAlias,
              unitType,
              ownerStreet,
              ownerCity,
              ownerPostcode,
              brand,
              specialCareFlags: submittedSpecialCareFlags,
              specialCareNote: submittedSpecialCareNote,
              ...rest
            } = values;

            const nestedCategories = pickCategoryFields(rest, categoryKey, 1, listingCategories);
            // Remove old categories by explicitly saving null for them.
            const cleanedNestedCategories = {
              ...[1, 2, 3].reduce((a, i) => ({ ...a, [`${categoryKey}${i}`]: null }), {}),
              ...nestedCategories,
            };
            const publicListingFields = pickListingFieldsData(
              rest,
              'public',
              listingType,
              nestedCategories,
              listingFields
            );
            const privateListingFields = pickListingFieldsData(
              rest,
              'private',
              listingType,
              nestedCategories,
              listingFields
            );
            // The owner's own private shipping address - the counterpart of the public,
            // laundry-derived pickup address. It is captured here only for processes whose
            // wizard has no LOCATION tab (cocloset-booking); everywhere else that tab
            // still owns the field, and sending it from here as well would overwrite a
            // saved address with three undefineds the first time details were edited.
            //
            // THE SECOND GUARD IS NOT REDUNDANT. `FieldOwnerAddress` was commented out of
            // the form on 2026-08-25 ("Remove address field no longer needed on the partner
            // flow"), but `captureOwnerAddress` stayed on - so every details save was sending
            // `ownerAddress: {street: undefined, city: undefined, postcode: undefined}`, and
            // the first edit of any listing with a stored address wiped it. Exactly the
            // failure the comment above describes, arriving from the other direction.
            //
            // So: send the key only when there is something to send. If the field is put
            // back, an existing address is seeded into the form by `getInitialValues` and
            // saves as before. The trade is that an owner cannot clear their address by
            // emptying all three inputs; that needs an explicit null, and no UI asks for it.
            const hasOwnerAddress = [ownerStreet, ownerCity, ownerPostcode].some(
              value => typeof value === 'string' && value.trim() !== ''
            );
            const ownerAddressMaybe =
              captureOwnerAddress && hasOwnerAddress
                ? {
                    ownerAddress: {
                      street: ownerStreet,
                      city: ownerCity,
                      postcode: ownerPostcode,
                    },
                  }
                : {};

            // THE BRAND, SNAPPED ONTO A SPELLING THAT ALREADY EXISTS.
            //
            // Done here rather than on every keystroke, which would fight the person typing,
            // and here rather than in the form because this is where publicData is assembled.
            //
            // `null` when the field is left empty, not `undefined`: Sharetribe only removes a
            // publicData key when it is explicitly set to null, so an owner clearing the brand
            // has to send one - the same reason the category levels above are nulled.
            //
            // Brand is NOT in `pickListingFieldsData` above: that reads Console's listing
            // fields, and brand deliberately is not one. See util/brandValue.js.
            const brandMaybe = hasHostedBrandField
              ? {}
              : { brand: normalizeBrandForStorage(brand, brandOptions) };

            // WHAT THE STUDIO NEEDS TO KNOW, kept out of the renter's reach.
            //
            // Always sent, even when empty, and `specialCareForStorage` returns null in that
            // case: Sharetribe only drops an extended-data key when it is explicitly null, so
            // an owner UNCHECKING every box has to send one. Omitting the key instead would
            // leave the old flags on the listing and the form would silently disagree with
            // what the studio reads.
            const specialCare = specialCareForStorage({
              flags: submittedSpecialCareFlags,
              note: submittedSpecialCareNote,
            });

            // New values for listing attributes
            const updateValues = {
              title: title.trim(),
              description,
              publicData: {
                listingType,
                transactionProcessAlias,
                unitType,
                ...cleanedNestedCategories,
                ...publicListingFields,
                ...brandMaybe,
              },
              privateData: { ...privateListingFields, ...ownerAddressMaybe, specialCare },
              ...setNoAvailabilityForUnbookableListings(transactionProcessAlias),
              ...setFullAvailabilityForCoclosetBooking(
                transactionProcessAlias,
                listing?.attributes?.availabilityPlan
              ),
            };

            onSubmit(updateValues);
          }}
          selectableListingTypes={listingTypes.map(conf =>
            getTransactionInfo({
              listingTypes: [conf],
              existingListingTypeInfo: {},
              includeLabel: true,
            })
          )}
          hasPredefinedListingType={hasExistingListingType || !!validPreselectedListingType}
          selectableCategories={listingCategories}
          pickSelectedCategories={values =>
            pickCategoryFields(values, categoryKey, 1, listingCategories)
          }
          brandOptions={brandOptions}
          categoryPrefix={categoryKey}
          onListingTypeChange={onListingTypeChange}
          showOwnerAddress={captureOwnerAddress}
          listingFieldsConfig={listingFields}
          listingCurrency={listing?.attributes?.price?.currency}
          marketplaceCurrency={config.currency}
          marketplaceName={config.marketplaceName}
          disabled={disabled}
          ready={ready}
          updated={panelUpdated}
          updateInProgress={updateInProgress}
          fetchErrors={errors}
          autoFocus
        />
      ) : (
        <ErrorMessage
          marketplaceName={config.marketplaceName}
          noListingTypesSet={noListingTypesSet}
          invalidExistingListingType={!hasValidExistingListingType}
        />
      )}
    </main>
  );
};

export default EditListingDetailsPanel;
