import React from 'react';

// Utils
import {
  getDetailCustomFieldValue,
  isFieldForCategory,
  isFieldForListingType,
  pickCategoryFields,
  pickCustomFieldProps,
} from '../../util/fieldHelpers.js';
import {
  isSearchableListingField,
  listingFieldSearchParams,
} from '../../util/listingFieldSearch.js';

import CustomExtendedDataSection from '../../components/CustomExtendedDataSection/CustomExtendedDataSection.js';

import css from './ListingPage.module.css';

/**
 * Renders custom listing fields.
 * - SectionDetails is used if schemaType is 'enum', 'long', or 'boolean'
 * - SectionMultiEnum is used if schemaType is 'multi-enum'
 * - SectionText is used if schemaType is 'text'
 *
 * @param {*} props include publicData, metadata, listingFieldConfigs, categoryConfiguration
 * @returns React.Fragment containing aforementioned components
 */
const CustomListingFields = props => {
  const { publicData, metadata, listingFieldConfigs, categoryConfiguration, intl } = props;

  const { key: categoryPrefix, categories: listingCategoriesConfig } = categoryConfiguration;
  const categoriesObj = pickCategoryFields(publicData, categoryPrefix, 1, listingCategoriesConfig);
  const currentCategories = Object.values(categoriesObj);

  // Fields are shown by default. Set showConfig.displayOnListingPage to false to explicitly hide a field.
  const displayableFieldConfigs = listingFieldConfigs.filter(
    fieldConfig => fieldConfig.showConfig?.displayOnListingPage !== false
  );

  const isFieldForSelectedCategories = fieldConfig => {
    const isTargetCategory = isFieldForCategory(currentCategories, fieldConfig);
    return isTargetCategory;
  };
  // Some field values are worth browsing by - the brand, today. Attaching the search params
  // here rather than inside the shared pick helpers keeps this listing-page behaviour out of
  // ProfilePage, which renders custom fields through the same components and has no search to
  // link to. See util/listingFieldSearch.js for how the query is derived from the field's own
  // config, so a free-text brand and a multi-select brand each get the right one.
  const withSearchParams = (fieldProps, key) => {
    if (!isSearchableListingField(key)) {
      return fieldProps;
    }
    const config = displayableFieldConfigs.find(candidate => candidate.key === key);
    const searchParams = listingFieldSearchParams(config, publicData?.[key]);
    return searchParams ? { ...fieldProps, searchParams } : fieldProps;
  };

  const propsForCustomFields = (
    pickCustomFieldProps(
      { publicData, metadata },
      displayableFieldConfigs,
      'listingType',
      isFieldForSelectedCategories
    ) || []
  ).map(fieldProps => withSearchParams(fieldProps, fieldProps.key));

  const sectionDetailsProps = {
    ...props,
    isFieldForCategory: isFieldForSelectedCategories,
    fieldConfigs: displayableFieldConfigs,
    heading: 'ListingPage.detailsTitle',
    // The design's two-column grid of stacked label/value pairs. Passed as class overrides
    // because SectionDetails is SHARED with the ProfilePage, which wants the rows it already
    // has - restyling through props rather than forking the component.
    listClassName: css.detailsGrid,
    rowClassName: css.detailsGridRow,
    labelClassName: css.detailsGridLabel,
    valueClassName: css.detailsGridValue,
  };

  const pickExtendedDataFields = (filteredConfigs, config) => {
    const { key, schemaType, enumOptions, showConfig = {} } = config;
    const listingType = publicData.listingType;
    const isTargetListingType = isFieldForListingType(listingType, config);
    const isTargetCategory = isFieldForCategory(currentCategories, config);

    const { isDetail, label } = showConfig;
    const publicDataValue = publicData[key];
    const metadataValue = metadata[key];
    const value = publicDataValue != null ? publicDataValue : metadataValue;

    if (isDetail && isTargetListingType && isTargetCategory && typeof value !== 'undefined') {
      const detailValue = getDetailCustomFieldValue(
        enumOptions,
        value,
        schemaType,
        key,
        label,
        intl,
        'ListingPage'
      );

      return detailValue
        ? filteredConfigs.concat(withSearchParams(detailValue, key))
        : filteredConfigs;
    }
    return filteredConfigs;
  };

  return (
    <CustomExtendedDataSection
      sectionDetailsProps={sectionDetailsProps}
      propsForCustomFields={propsForCustomFields}
      idPrefix="listingPage"
      pickExtendedDataFields={pickExtendedDataFields}
    />
  );
};

export default CustomListingFields;
