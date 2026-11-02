// ⚠️ If you modify the styling of this component and you're using the SectionListings component in your marketplace (featured listings)
// please reflect those changes in the calculateCarouselHeight function in SectionListing.js to avoid layout issues
import React from 'react';
import classNames from 'classnames';

import { useConfiguration } from '../../context/configurationContext';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { requireListingImage } from '../../util/configHelpers';
import { lazyLoadWithDimensions } from '../../util/uiHelpers';
import { createSlug } from '../../util/urlHelpers';

import {
  AspectRatioWrapper,
  NamedLink,
  ResponsiveImage,
  ListingCardThumbnail,
} from '../../components';
// Imported directly rather than through the barrel: components/index.js exports this file
// too, so going through it would be a cycle.
import FavoriteButton from '../FavoriteButton/FavoriteButton';
import PickupTodayBadge from '../PickupTodayBadge/PickupTodayBadge';

import { isPickupTodayListing } from '../../util/searchCleaningFloor';
import { getListingCardTranslations } from './ListingCard.helpers';

import css from './ListingCard.module.css';

const LazyImage = lazyLoadWithDimensions(ResponsiveImage, { loadAfterInitialRendering: 3000 });

/**
 * ListingCardImage
 * Component responsible for rendering the image part of the listing card.
 * It either renders the first image from the listing's images array with lazy loading,
 * or a stylized placeholder if images are disabled for the listing type.
 * Also wraps the image in a fixed aspect ratio container for consistent layout.
 * @component
 * @param {Object} props
 * @param {Object} props.listing listing entity with image data
 * @param {Function?} props.setActivePropsMaybe mouse enter/leave handlers for map highlighting
 * @param {string} props.title listing title for alt text
 * @param {string} props.renderSizes img/srcset size rules
 * @param {number} props.aspectWidth aspect ratio width
 * @param {number} props.aspectHeight aspect ratio height
 * @param {string} props.variantPrefix image variant prefix (e.g. "listing-card")
 * @param {boolean} props.showListingImage whether to show actual listing image or not
 * @param {Object?} props.style the background color for the listing card with no image
 * @returns {JSX.Element} listing image with fixed aspect ratio or fallback preview
 */
const ListingCardImage = props => {
  const {
    listing,
    setActivePropsMaybe,
    title,
    renderSizes,
    aspectWidth,
    aspectHeight,
    variantPrefix,
    aspectRatioClassName,
    lazyLoadImage,
  } = props;

  const firstImage = listing?.images?.[0] || null;
  const variants = firstImage
    ? Object.keys(firstImage?.attributes?.variants).filter(k => k.startsWith(variantPrefix))
    : [];

  const aspectRatioClass = aspectRatioClassName || css.aspectRatioWrapper;
  const ImageComponent = lazyLoadImage ? LazyImage : ResponsiveImage;

  return (
    <AspectRatioWrapper
      className={aspectRatioClass}
      width={aspectWidth}
      height={aspectHeight}
      {...setActivePropsMaybe}
    >
      <ImageComponent
        rootClassName={css.rootForImage}
        alt={title}
        image={firstImage}
        variants={variants}
        sizes={renderSizes}
      />
    </AspectRatioWrapper>
  );
};

/**
 * THE EDITORIAL CARD.
 *
 * The layout the landing page's "New & noteworthy" carousel uses: the brand as a tracked
 * eyebrow, the garment as the headline, then size and collection point on one line with the
 * price set against them.
 *
 * A VARIANT RATHER THAN A REPLACEMENT. This same component renders every card on the search
 * page and the map, and those are a different job - a browsing grid wants the price first
 * and the seller named, because the reader is comparing. Restyling the default would have
 * changed both surfaces to suit one of them.
 *
 * Every field degrades on its own. A garment with no brand, no size or no laundry assigned
 * yet renders the rows it has and drops the rest - none of these are required to publish, so
 * all of them are absent on some real listing.
 *
 * `assignedLaundryName` is the collection point: server-written when a laundry is assigned
 * `pickupNeighborhood` checks whether a listing has been assigned a neighborhood; if not, skip it.
 * (see server/api-util/laundryAssignment.js), and the same name the listing page shows.
 */
const EditorialInfo = props => {
  const {
    listing,
    titleFormatted,
    showPrice,
    priceMessage,
    priceTooltip,
    darkMode,
    listingFieldConfigs,
  } = props;
  const { brand, size, assignedLaundryName, pickupNeighborhood } =
    listing?.attributes?.publicData || {};

  // THE CONSOLE LABEL, NOT THE STORED VALUE.
  //
  //   > "se muestra 'x_small', lo cual es correcto porque es su valor guardado, pero debe
  //   >  mostrar 'X-Small', que es el valor del label de listing field que viene de la
  //   >  consola" (Jonathan, 2026-09-19)
  //
  // `size` in publicData is the enum's stored OPTION (`x_small`), never the label an operator
  // typed in Console (`X-Small`) - the two only look the same by coincidence for options
  // nobody bothered to capitalize. Same lookup ListingPage's own details grid already does
  // (util/fieldHelpers.js's getDetailCustomFieldValue) - falls back to the raw value so an
  // option Console no longer lists (renamed or deleted) still shows something rather than
  // nothing.
  const sizeFieldConfig = listingFieldConfigs?.find(f => f.key === 'size');
  const sizeLabel =
    sizeFieldConfig?.enumOptions?.find(o => `${o.option}` === size)?.label || size;

  const meta = [
    size ? (
      <FormattedMessage key="size" id="ListingCard.editorialSize" values={{ size: sizeLabel }} />
    ) : null,
    assignedLaundryName ? (
      <FormattedMessage
        key="pickup"
        id={
          pickupNeighborhood
            ? 'ListingCard.editorialPickupWithNeighborhood'
            : 'ListingCard.editorialPickup'
        }
        values={{ name: assignedLaundryName, neighborhood: pickupNeighborhood }}
      />
    ) : null,
  ].filter(Boolean);

  const hasMetaRow = meta.length > 0 || showPrice;

  return (
    <div className={classNames(css.editorialInfo, { [css.lightText]: darkMode })}>
      {brand ? <p className={css.editorialBrand}>{brand}</p> : null}

      {/* Round 3 (2026-09-18): the price used to sit on THIS row, next to the title - the
          reference pairs it with the size/collection-point line below instead. Title now
          renders alone. */}
      <p className={css.editorialTitle}>{titleFormatted}</p>

      {hasMetaRow ? (
        <div className={css.editorialMetaRow}>
          {meta.length > 0 ? (
            <p className={css.editorialMeta}>
              {meta.map((entry, index) => (
                <React.Fragment key={index}>
                  {/* A middot separator rather than a list, because these read as one line of
                      provenance. Rendered between entries only, so a garment with just one of
                      the two does not trail a stray dot. */}
                  {index > 0 ? <span aria-hidden="true"> · </span> : null}
                  {entry}
                </React.Fragment>
              ))}
            </p>
          ) : null}
          {showPrice ? (
            <p className={css.editorialPrice} title={priceTooltip}>
              {priceMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

/**
 * ListingCard
 *
 * @component
 * @param {Object} props
 * @param {string?} props.className add more style rules in addition to component's own css.root
 * @param {string?} props.rootClassName overwrite components own css.root
 * @param {string?} props.aspectRatioClassName custom className for AspectRatioWrapper component
 * @param {Object} props.listing API entity: listing or ownListing
 * @param {string?} props.renderSizes for img/srcset
 * @param {Function?} props.setActiveListing
 * @param {boolean?} props.showAuthorInfo
 * @param {'editorial'?} props.variant Cocloset: the landing page's carousel layout
 * @returns {JSX.Element} listing card to be used in search result panel etc.
 */
export const ListingCard = props => {
  const config = useConfiguration();
  const intl = props.intl || useIntl();

  const {
    className,
    rootClassName,
    aspectRatioClassName,
    darkMode,
    listing,
    renderSizes,
    setActiveListing,
    showAuthorInfo = true,
    lazyLoadImage = true,
    // Cocloset: 'editorial' is the landing page's carousel card. Anything else - including
    // nothing, which is every existing call site - keeps the stock layout untouched.
    variant,
    // Cocloset: the save-this-garment heart. OFF by default, and that is deliberate rather
    // than cautious: the card's root element is a link, and a <button> inside an <a> is
    // invalid markup that browsers disagree about. Turning the heart on therefore wraps the
    // card in a positioning element, which is a change to the root of every card on every
    // screen. Defaulting to false keeps the markup byte-identical wherever nobody asked.
    showFavorite = false,
    // Cocloset: the real, verified answer to "is this bookable starting today" - see the
    // comment beside showPickupToday for why this overrides rather than supplements the
    // metadata-only approximation when a caller has it.
    pickupTodayVerified,
  } = props;

  const isEditorial = variant === 'editorial';

  const translations = getListingCardTranslations(listing, config, intl);
  const {
    titlePlain,
    titleFormatted,
    cardAriaLabel,
    showPrice,
    priceTooltip,
    priceMessage,
    authorName,
  } = translations;

  const classes = classNames(rootClassName || css.root, className);

  const id = listing?.id?.uuid;
  const { title = '', publicData } = listing?.attributes || {};
  const slug = createSlug(title);

  // "Pickup Today" (mockup: green pill, top-right of the card image).
  //
  //   > "la tag debe ser mostrada para los listings que esten en laundry y que esten
  //   >  disponibles para hoy" (Jonathan, 2026-09-11)
  //
  //   > "Puedes revisar lo necesario para que en una listing card, solo se muestre 'Pickup
  //   >  today' solo si realmente puedo reservar a partir de hoy? Es muy confuso para el
  //   >  usuario si se muestra ese tag pero realmente no puedo reservar hoy" (Jonathan,
  //   >  2026-09-19)
  //
  // `pickupTodayVerified` is the real answer, computed once per search results page by a
  // bounded, ids-scoped availability query (SearchPage.duck.js) - not per card. When a caller
  // supplies it (a boolean, from SearchResultsPanel), it is trusted outright and the
  // metadata-only approximation is not consulted at all: the approximation's whole job was to
  // decide whether that verification query was worth running, not to have the final word once
  // it has an answer. Callers with no way to verify (the landing page carousel, which has no
  // per-listing availability data at all) get the approximation instead - see
  // util/searchCleaningFloor.js's isPickupTodayListing for what that does and does not
  // guarantee.
  const showPickupToday =
    typeof pickupTodayVerified === 'boolean' ? pickupTodayVerified : isPickupTodayListing(listing);

  const { listingType, cardStyle } = publicData || {};
  const validListingTypes = config.listing.listingTypes || [];
  const foundListingTypeConfig = validListingTypes.find(conf => conf.listingType === listingType);
  // Render the listing image only if listing images are enabled in the listing type
  const showListingImage = requireListingImage(foundListingTypeConfig);

  const {
    aspectWidth = 1,
    aspectHeight = 1,
    variantPrefix = 'listing-card',
  } = config.layout.listingImage;

  // Sets the listing as active in the search map when hovered (if the search map is enabled)
  const setActivePropsMaybe = setActiveListing
    ? {
        onMouseEnter: () => setActiveListing(listing?.id),
        onMouseLeave: () => setActiveListing(null),
      }
    : null;

  const card = (
    <NamedLink
      className={classes}
      name="ListingPage"
      params={{ id, slug }}
      ariaLabel={cardAriaLabel}
    >
      {showListingImage ? (
        <ListingCardImage
          renderSizes={renderSizes}
          title={titlePlain}
          listing={listing}
          setActivePropsMaybe={setActivePropsMaybe}
          aspectWidth={aspectWidth}
          aspectHeight={aspectHeight}
          variantPrefix={variantPrefix}
          aspectRatioClassName={aspectRatioClassName}
          lazyLoadImage={lazyLoadImage}
        />
      ) : (
        <ListingCardThumbnail
          style={cardStyle}
          listingTitle={title}
          className={aspectRatioClassName}
          width={aspectWidth}
          height={aspectHeight}
          setActivePropsMaybe={setActivePropsMaybe}
        />
      )}
      {isEditorial ? (
        <EditorialInfo
          listing={listing}
          titleFormatted={titleFormatted}
          showPrice={showPrice}
          priceMessage={priceMessage}
          priceTooltip={priceTooltip}
          darkMode={darkMode}
          listingFieldConfigs={config.listing.listingFields}
        />
      ) : (
        <div className={css.info}>
          {showPrice ? (
            <div className={css.price} title={priceTooltip}>
              {priceMessage}
            </div>
          ) : null}
          <div className={css.mainInfo}>
            {showListingImage && (
              <div className={classNames(css.title, { [css.lightText]: darkMode })}>
                {titleFormatted}
              </div>
            )}
            {showAuthorInfo ? (
              <div className={classNames(css.authorInfo, { [css.lightText]: darkMode })}>
                {authorName}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </NamedLink>
  );

  const showFavoriteButton = showFavorite && !!id;
  if (!showFavoriteButton && !showPickupToday) {
    return card;
  }

  // The heart is a SIBLING of the link, not a child: nested interactive elements are invalid
  // and a screen reader reads the whole card as one control with a button hidden inside it.
  // Absolutely positioned over the image so the card itself keeps its layout. The badge is a
  // plain span, so it has no such constraint, but shares the wrapper for the same reason.
  return (
    <div className={css.cardWithFavorite}>
      {card}
      {showPickupToday ? <PickupTodayBadge className={css.cardPickupToday} /> : null}
      {showFavoriteButton ? (
        <FavoriteButton
          listingId={id}
          // Both corners are the same corner (top-right) by design (mockup), so the heart
          // makes room for the badge rather than sitting under it - see .cardFavoriteShifted.
          className={classNames(css.cardFavorite, {
            [css.cardFavoriteShifted]: showPickupToday,
          })}
        />
      ) : null}
    </div>
  );
};

export default ListingCard;
