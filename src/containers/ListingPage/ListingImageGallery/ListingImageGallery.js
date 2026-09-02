import React, { useState } from 'react';
import classNames from 'classnames';
import ReactImageGallery from 'react-image-gallery';

import { propTypes } from '../../../util/types';
import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import {
  AspectRatioWrapper,
  Button,
  IconClose,
  IconArrowHead,
  ResponsiveImage,
} from '../../../components';

// Copied directly from
// `node_modules/react-image-gallery/styles/image-gallery.css`. The
// copied file is left unedited, and all the overrides are defined in
// the component CSS file below.
import './image-gallery.css';

import css from './ListingImageGallery.module.css';

const IMAGE_GALLERY_OPTIONS = {
  showPlayButton: false,
  disableThumbnailScroll: true,
};
// The gallery frame is PORTRAIT, always.
//
// Stock behaviour was the opposite and is what the client saw ("se muestra en
// square y es necesario un portrait mode", Jonathan 2026-09-02): the frame took
// the first image's ratio, but anything at or below 4:3 - which is every
// portrait photo ever taken - was widened to 4:3 landscape, and an image whose
// dimensions had not loaded fell back to 1:1. A garment shot head to hem then
// sat letterboxed in a wide box with white bars down both sides.
//
// Garments are photographed vertically, so the frame is clamped INTO portrait
// instead of out of it: never wider than 3:4, never taller than 2:3. A landscape
// or square photo is letterboxed in a portrait frame rather than the other way
// round, and - the part that matters on a grid of listings - every listing page
// reserves the same shape before its images load, so the page does not jump.
const WIDEST_PORTRAIT_ASPECT_RATIO = 3 / 4;
const TALLEST_PORTRAIT_ASPECT_RATIO = 2 / 3;
const DEFAULT_ASPECT = { aspectWidth: 3, aspectHeight: 4 };

const getFirstImageAspectRatio = (firstImage, scaledVariant) => {
  if (!firstImage) {
    return DEFAULT_ASPECT;
  }

  const v = firstImage?.attributes?.variants?.[scaledVariant];
  const w = v?.width;
  const h = v?.height;
  const hasDimensions = !!w && !!h;

  if (!hasDimensions) {
    return DEFAULT_ASPECT;
  }

  const aspectRatio = w / h;

  // We keep the fractions separated as these are given to AspectRatioWrapper
  // which expects separate width and height
  return aspectRatio >= WIDEST_PORTRAIT_ASPECT_RATIO
    ? DEFAULT_ASPECT
    : aspectRatio <= TALLEST_PORTRAIT_ASPECT_RATIO
    ? { aspectWidth: 2, aspectHeight: 3 }
    : { aspectWidth: w, aspectHeight: h };
};

/**
 * The ListingImageGallery component.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {Array<propTypes.image>} props.images - The images
 * @param {Array<string>} props.imageVariants - The image variants
 * @param {Array<string>} props.thumbnailVariants - The thumbnail variants
 * @returns {JSX.Element} listing image gallery component
 */
const ListingImageGallery = props => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const intl = useIntl();
  const { rootClassName, className, images, imageVariants, thumbnailVariants } = props;
  const thumbVariants = thumbnailVariants || imageVariants;
  // imageVariants are scaled variants.
  const { aspectWidth, aspectHeight } = getFirstImageAspectRatio(images?.[0], imageVariants[0]);
  const items = images.map((img, i) => {
    return {
      // We will only use the image resource, but react-image-gallery
      // requires the `original` key from each item.
      original: '',
      alt: intl.formatMessage(
        { id: 'ListingImageGallery.imageAltText' },
        { index: i + 1, count: images.length }
      ),
      thumbAlt: intl.formatMessage(
        { id: 'ListingImageGallery.imageThumbnailAltText' },
        { index: i + 1, count: images.length }
      ),
      thumbnail: img.attributes?.variants?.[thumbVariants[0]],
      image: img,
    };
  });
  const imageSizesMaybe = isFullscreen
    ? {}
    : { sizes: `(max-width: 1024px) 100vw, (max-width: 1200px) calc(100vw - 192px), 708px` };
  const renderItem = item => {
    return (
      <AspectRatioWrapper
        width={aspectWidth || 1}
        height={aspectHeight || 1}
        className={isFullscreen ? css.itemWrapperFullscreen : css.itemWrapper}
      >
        <div className={css.itemCentering}>
          <ResponsiveImage
            rootClassName={css.item}
            image={item.image}
            alt={item.alt}
            variants={imageVariants}
            {...imageSizesMaybe}
          />
        </div>
      </AspectRatioWrapper>
    );
  };
  const renderThumbInner = item => {
    return (
      <div>
        <ResponsiveImage
          rootClassName={css.thumb}
          image={item.image}
          alt={item.thumbAlt}
          variants={thumbVariants}
          sizes="88px"
        />
      </div>
    );
  };

  const onScreenChange = isFull => {
    setIsFullscreen(isFull);
  };

  const renderLeftNav = (onClick, disabled) => {
    return (
      <button className={css.navLeft} disabled={disabled} onClick={onClick}>
        <div className={css.navArrowWrapper}>
          <IconArrowHead direction="left" size="big" />
        </div>
      </button>
    );
  };
  const renderRightNav = (onClick, disabled) => {
    return (
      <button className={css.navRight} disabled={disabled} onClick={onClick}>
        <div className={css.navArrowWrapper}>
          <IconArrowHead direction="right" size="big" />
        </div>
      </button>
    );
  };
  const renderFullscreenButton = (onClick, isFullscreen) => {
    return isFullscreen ? (
      <Button
        onClick={onClick}
        rootClassName={css.close}
        title={intl.formatMessage({ id: 'ListingImageGallery.closeModalTitle' })}
      >
        <span className={css.closeText}>
          <FormattedMessage id="ListingImageGallery.closeModal" />
        </span>
        <IconClose rootClassName={css.closeIcon} />
      </Button>
    ) : (
      <button className={css.openFullscreen} onClick={onClick}>
        <FormattedMessage
          id="ListingImageGallery.viewImagesButton"
          values={{ count: images.length }}
        />
      </button>
    );
  };

  if (items.length === 0) {
    return <ResponsiveImage className={css.noImage} image={null} variants={[]} alt="" />;
  }

  const classes = classNames(rootClassName || css.root, className);

  return (
    <ReactImageGallery
      additionalClass={classes}
      items={items}
      renderItem={renderItem}
      renderThumbInner={renderThumbInner}
      onScreenChange={onScreenChange}
      renderLeftNav={renderLeftNav}
      renderRightNav={renderRightNav}
      renderFullscreenButton={renderFullscreenButton}
      {...IMAGE_GALLERY_OPTIONS}
    />
  );
};

export default ListingImageGallery;
