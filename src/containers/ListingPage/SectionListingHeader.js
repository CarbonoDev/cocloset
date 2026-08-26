import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';
import { stringify } from '../../util/urlHelpers';
import { REVIEW_TYPE_OF_PROVIDER } from '../../util/types';
import {
  isSearchableListingField,
  listingFieldSearchConfig,
  listingFieldSearchParams,
} from '../../util/listingFieldSearch';

import { NamedLink } from '../../components';

import css from './ListingPage.module.css';

/**
 * THE TOP OF THE GARMENT'S OWN COLUMN: brand, title, and one line of provenance.
 *
 * The design leads with the BRAND as an eyebrow above the title rather than burying it in the
 * details table, because it is the first thing a reader of this marketplace looks for. It is
 * the same link the details row carries - derived from the field's own config through
 * util/listingFieldSearch.js - so a brand that is free text searches by keyword and a brand
 * that becomes a multi-select in Console starts filtering, with no change here.
 *
 * THE PROVENANCE LINE IS BUILT FROM WHAT IS TRUE, not from a fixed template. Rating, rental
 * count and owner each appear only when known, and the separators are inserted between
 * whatever survives - so a brand-new garment reads "Lent by Ana" rather than "· · Lent by Ana".
 *
 * The rental count comes from the server (completed transactions for this listing) and is
 * absent, not zero, when that read failed:
 *
 *   > "Quiza podriamos contabilizar las transacciones exitosas para ese listing y mostrar
 *   >  este dato, de lo contrario lo omitimos"
 *
 * A count of 0 IS shown, deliberately - "0 rentals" is a true and useful thing to know about a
 * garment nobody has taken out yet, and it is different from not knowing.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className]
 * @param {Object} props.publicData - the listing's publicData
 * @param {Array<Object>} [props.listingFieldConfigs] - merged listing field configs
 * @param {React.Node} props.title - the rendered (rich) title
 * @param {number} [props.completedRentals]
 * @param {Array<Object>} [props.reviews] - the listing's public reviews, already fetched by
 *   the page. The average is derived here rather than by each caller, so the two page
 *   variants cannot compute it differently.
 * @param {string} [props.authorDisplayName]
 * @returns {JSX.Element}
 */
const SectionListingHeader = props => {
  const {
    className,
    publicData = {},
    listingFieldConfigs = [],
    title,
    completedRentals,
    reviews,
    authorDisplayName,
  } = props;

  // Only reviews OF THE PROVIDER carry a rating that is about this garment's rentals going
  // well. `type` is on every review the API returns, and mixing the customer-facing ones in
  // would average two different questions into one number.
  const ratings = (reviews || [])
    .filter(review => review?.attributes?.type === REVIEW_TYPE_OF_PROVIDER)
    .map(review => review?.attributes?.rating)
    .filter(rating => Number.isFinite(rating) && rating > 0);
  const reviewCount = ratings.length;
  const averageRating =
    reviewCount > 0 ? ratings.reduce((sum, rating) => sum + rating, 0) / reviewCount : null;

  const brand = publicData.brand;
  // NOT a plain lookup in the hosted fields. Brand left Console so that flex-cli could own
  // the pub_brand search schema, so it is not among them - and this link quietly went dead when
  // it did, degrading to plain text with nothing to notice. See util/listingFieldSearch.js.
  const brandConfig = listingFieldSearchConfig('brand', listingFieldConfigs);
  const brandSearchParams =
    brand && isSearchableListingField('brand')
      ? listingFieldSearchParams(brandConfig, brand)
      : null;

  const brandContent = brandSearchParams ? (
    <NamedLink
      className={css.brandEyebrowLink}
      name="SearchPage"
      to={{ search: stringify(brandSearchParams) }}
    >
      {brand}
    </NamedLink>
  ) : (
    brand
  );

  // Each entry is rendered only if it exists; the separators go between the survivors.
  const metaParts = [
    averageRating > 0 && reviewCount > 0 ? (
      <span key="rating" className={css.headerRating}>
        <span aria-hidden="true">★</span> {averageRating.toFixed(1)}
      </span>
    ) : null,
    Number.isInteger(completedRentals) ? (
      <FormattedMessage
        key="rentals"
        id="ListingPage.completedRentals"
        values={{ count: completedRentals }}
      />
    ) : null,
    authorDisplayName ? (
      <FormattedMessage key="author" id="ListingPage.lentBy" values={{ name: authorDisplayName }} />
    ) : null,
  ].filter(Boolean);

  return (
    <div className={classNames(css.listingHeader, className)}>
      {brand ? <p className={css.brandEyebrow}>{brandContent}</p> : null}
      <h1 className={css.listingTitle}>{title}</h1>
      {metaParts.length > 0 ? (
        <p className={css.headerMeta}>
          {metaParts.map((part, index) => (
            <React.Fragment key={index}>
              {index > 0 ? <span className={css.headerMetaSeparator}>·</span> : null}
              {part}
            </React.Fragment>
          ))}
        </p>
      ) : null}
    </div>
  );
};

export default SectionListingHeader;
