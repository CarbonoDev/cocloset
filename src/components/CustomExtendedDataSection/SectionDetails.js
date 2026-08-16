import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';

import { richText } from '../../util/richText';
import { stringify } from '../../util/urlHelpers';

import { Heading, NamedLink } from '../../components';

import css from './CustomExtendedDataSection.module.css';

const SectionDetails = props => {
  const {
    fieldConfigs,
    pickExtendedDataFields,
    heading,
    className,
    rootClassName,
    // OPTIONAL LAYOUT OVERRIDES, defaulting to what this component has always rendered.
    // The ListingPage wants the design's two-column grid of stacked label/value pairs; the
    // ProfilePage renders the same component and wants the label-value rows it already has.
    // Passing classes is the template's own way of restyling a shared section without
    // forking it - the same mechanism PageBuilder's `defaultClasses` uses.
    listClassName,
    rowClassName,
    labelClassName,
    valueClassName,
  } = props;

  const classes = classNames(rootClassName || css.sectionDetails, className);

  if (!fieldConfigs) {
    return null;
  }

  const existingFields = fieldConfigs?.reduce(pickExtendedDataFields, []);

  return existingFields?.length > 0 ? (
    <section className={classes}>
      {heading ? (
        <Heading as="h2" rootClassName={css.sectionHeading}>
          <FormattedMessage id={heading} />
        </Heading>
      ) : null}
      <ul className={classNames(css.details, listClassName)}>
        {existingFields.map(detail => {
          // Note: currently, we are auto-linking any value of these key-value details.
          // If this behaviour needs to be changed later (e.g. due to a separate "custom link field"),
          // we need to add an extra flag (linkify: true) through getDetailCustomFieldValue function in util/fieldHelpers.js
          const valueContent = richText(detail.value, {
            linkify: true,
          });
          // Some values are worth browsing by (the brand). The params are computed by the
          // page that knows the field's config - see util/listingFieldSearch.js - so this
          // component only has to decide whether it was handed any.
          const linked = detail.searchParams ? (
            <NamedLink name="SearchPage" to={{ search: stringify(detail.searchParams) }}>
              {valueContent}
            </NamedLink>
          ) : (
            valueContent
          );
          return (
            <li key={detail.key} className={classNames(css.detailsRow, rowClassName)}>
              <span className={classNames(css.detailLabel, labelClassName)}>{detail.label}</span>
              <span className={valueClassName}>{linked}</span>
            </li>
          );
        })}
      </ul>
    </section>
  ) : null;
};

export default SectionDetails;
