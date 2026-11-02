import React from 'react';
import '@testing-library/jest-dom';
import { Form as FinalForm, Field } from 'react-final-form';
import arrayMutators from 'final-form-arrays';

import { fakeIntl } from '../../../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';

import EditListingPhotosForm, { FieldAddImage, MIN_LISTING_IMAGES } from './EditListingPhotosForm';

const { screen, userEvent, waitFor, act } = testingLibrary;

const noop = () => null;

describe('EditListingDeliveryForm', () => {
  it('matches snapshot', () => {
    const saveActionMsg = 'Save photos';
    const tree = render(
      <EditListingPhotosForm
        initialValues={{ country: 'US', images: [] }}
        intl={fakeIntl}
        dispatch={noop}
        onImageUpload={v => Promise.reject(v)}
        onSubmit={v => v}
        saveActionMsg={saveActionMsg}
        stripeConnected={false}
        updated={false}
        ready={false}
        updateInProgress={false}
        disabled={false}
        onRemoveImage={noop}
        listingImageConfig={{ aspectWidth: 1, aspectHeight: 1, variantPrefix: 'listing-card' }}
        allFilesUploadedAndVerified={true}
      />
    );
    expect(tree.asFragment()).toMatchSnapshot();
  });

  // TODO to test this fully, we would need to check that store's state changes correctly.

  it('Check that FieldAddImage works', async () => {
    const user = userEvent.setup();
    const ACCEPT_IMAGES = 'image/*';
    const tree = render(
      <FinalForm
        onSubmit={noop}
        mutators={{ ...arrayMutators }}
        render={formRenderProps => {
          return (
            <form onSubmit={noop}>
              <FieldAddImage
                id="addImage"
                name="addImage"
                accept={ACCEPT_IMAGES}
                label={<div>label</div>}
                type="file"
                disabled={false}
                formApi={{
                  change: noop,
                  blur: noop,
                }}
                onImageUploadHandler={noop}
                aspectWidth={1}
                aspectHeight={1}
              />
            </form>
          );
        }}
      />
    );

    // Fill mandatory attributes
    const file = new File(['hello'], './public/static/icons/favicon-16x16.png', {
      type: 'image/png',
    });
    const input = screen.getByLabelText(/label/i);

    await user.upload(input, file);
    expect(input.files[0]).toBe(file);
    expect(input.files.item(0)).toBe(file);
    expect(input.files).toHaveLength(1);
  });
  // ---------------------------------------------------------------------------
  // Cocloset: the photo minimum.
  //
  //   > "el mínimo de imagenes es de dos, si sube solo 1 no puede continuar"
  //
  // "No puede continuar" is the assertion: the SUBMIT BUTTON has to be disabled, not just a
  // message shown. The stock `nonEmptyArray` validator is satisfied by a single photo, so
  // before this a one-photo listing walked straight through to the next wizard tab.
  // ---------------------------------------------------------------------------
  const renderWithImages = count => {
    const images = Array.from({ length: count }, (_, i) => ({
      id: `image-${i}`,
      type: 'image',
      attributes: { variants: {} },
    }));

    return render(
      <EditListingPhotosForm
        initialValues={{ images }}
        images={images}
        intl={fakeIntl}
        dispatch={noop}
        onImageUpload={v => Promise.reject(v)}
        onSubmit={v => v}
        saveActionMsg="Save photos"
        stripeConnected={false}
        updated={false}
        ready={false}
        updateInProgress={false}
        disabled={false}
        onRemoveImage={noop}
        listingImageConfig={{ aspectWidth: 1, aspectHeight: 1, variantPrefix: 'listing-card' }}
        allFilesUploadedAndVerified={true}
      />
    );
  };

  const saveButton = () => screen.getByRole('button', { name: 'Save photos' });

  it('refuses to continue with fewer photos than the minimum', () => {
    renderWithImages(MIN_LISTING_IMAGES - 1);
    expect(saveButton()).toBeDisabled();
  });

  it('continues once the minimum is met', () => {
    renderWithImages(MIN_LISTING_IMAGES);
    expect(saveButton()).not.toBeDisabled();
  });

  it('still refuses with no photos at all', () => {
    renderWithImages(0);
    expect(saveButton()).toBeDisabled();
  });
});
