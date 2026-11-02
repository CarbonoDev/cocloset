import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders, testingLibrary } from '../../../util/testHelpers';

import PickupQrModal from './PickupQrModal';

const render = ui => renderWithProviders(ui, { withPortals: true });
const { screen, fireEvent } = testingLibrary;
const noop = () => null;

describe('PickupQrModal', () => {
  const LISTING_ID = '6aa26840-16da-44df-8a74-ff4ece1da4eb';

  it('renders the QR for the given listing when open', () => {
    render(
      <PickupQrModal
        id="test"
        isOpen
        onCloseModal={noop}
        onManageDisableScrolling={noop}
        listingId={LISTING_ID}
        listingTitle="the garment"
      />
    );

    expect(screen.getByText('PickupQrModal.title')).toBeInTheDocument();
    expect(screen.getByAltText('PickupQrCode.imageAlt')).toHaveAttribute(
      'src',
      `/api/listing-pickup-qr?id=${LISTING_ID}`
    );
  });

  it('calls onCloseModal when the close button is clicked', () => {
    const onCloseModal = jest.fn();
    render(
      <PickupQrModal
        id="test"
        isOpen
        onCloseModal={onCloseModal}
        onManageDisableScrolling={noop}
        listingId={LISTING_ID}
        listingTitle="the garment"
      />
    );

    fireEvent.click(screen.getByText('PickupQrModal.close'));

    expect(onCloseModal).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without a listingId - PickupQrCode refuses to render', () => {
    render(
      <PickupQrModal
        id="test"
        isOpen
        onCloseModal={noop}
        onManageDisableScrolling={noop}
        listingTitle="the garment"
      />
    );

    expect(screen.queryByAltText('PickupQrCode.imageAlt')).not.toBeInTheDocument();
  });
});
