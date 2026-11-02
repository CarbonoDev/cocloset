import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders } from '../../../util/testHelpers';

import ListingImageGallery from './ListingImageGallery';

// react-image-gallery observes its own width on mount; jsdom has no
// ResizeObserver and there is no shared jest setup file to polyfill it in.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// The gallery frame is an AspectRatioWrapper, which expresses the ratio as a
// `padding-bottom` percentage of height/width. Reading that back is the only
// way to assert the shape of the frame without exporting the helper that
// computes it.
const framePadding = container =>
  Array.from(container.querySelectorAll('[style*="padding-bottom"]')).map(
    el => el.style.paddingBottom
  )[0];

const imageWith = (width, height) => ({
  id: { uuid: 'image-1' },
  type: 'image',
  attributes: {
    variants: {
      'scaled-small': width && height ? { name: 'scaled-small', width, height, url: 'x' } : {},
    },
  },
});

const renderGallery = images =>
  renderWithProviders(
    <ListingImageGallery
      images={images}
      imageVariants={['scaled-small']}
      thumbnailVariants={['listing-card']}
    />
  );

describe('ListingImageGallery frames garments in portrait', () => {
  it('gives a portrait photo a portrait frame', () => {
    // Stock behaviour widened anything at or below 4:3 to 4:3 landscape, which
    // is every portrait photo - the bug the client reported.
    const { container } = renderGallery([imageWith(900, 1200)]);
    expect(framePadding(container)).toEqual('133.33333333333331%');
  });

  it('letterboxes a landscape photo rather than turning the frame sideways', () => {
    const { container } = renderGallery([imageWith(1600, 900)]);
    expect(framePadding(container)).toEqual('133.33333333333331%');
  });

  it('does not go square', () => {
    const { container } = renderGallery([imageWith(1000, 1000)]);
    expect(framePadding(container)).toEqual('133.33333333333331%');
  });

  it('caps a very tall photo so the frame cannot run off the page', () => {
    // 9:16 would otherwise reserve 178% of the column's width in height.
    const { container } = renderGallery([imageWith(900, 1600)]);
    expect(framePadding(container)).toEqual('150%');
  });

  it('keeps a ratio that is already between the two caps', () => {
    // 0.7 sits between 2:3 and 3:4, so the frame is the photo's own shape and
    // nothing is letterboxed at all.
    const { container } = renderGallery([imageWith(700, 1000)]);
    expect(framePadding(container)).toEqual(`${(1000 / 700) * 100}%`);
  });

  it('letterboxes rather than distorts anything outside the band', () => {
    // 4:5 is portrait but wider than the 3:4 cap, so it gets the standard
    // frame with thin bars rather than a frame of its own. This is the
    // trade-off that keeps every listing page the same shape.
    const { container } = renderGallery([imageWith(800, 1000)]);
    expect(framePadding(container)).toEqual('133.33333333333331%');
  });

  it('reserves the portrait frame before the dimensions are known', () => {
    // A variant without width/height used to fall back to 1:1, so the page
    // reflowed from square to whatever the image turned out to be.
    const { container } = renderGallery([imageWith(null, null)]);
    expect(framePadding(container)).toEqual('133.33333333333331%');
  });
});
