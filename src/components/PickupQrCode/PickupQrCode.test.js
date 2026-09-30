import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import PickupQrCode from './PickupQrCode';

const { screen } = testingLibrary;

const LISTING_ID = '6aa26840-16da-44df-8a74-ff4ece1da4eb';

describe('PickupQrCode', () => {
  it('renders nothing without a listingId', () => {
    const { container } = render(<PickupQrCode />);
    expect(container).toBeEmptyDOMElement();
  });

  it('points the image at the authenticated pickup-qr endpoint for this listing', () => {
    render(<PickupQrCode listingId={LISTING_ID} />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', `/api/listing-pickup-qr?id=${LISTING_ID}`);
  });

  it('never prints the token/payload as text - the QR itself is the only credential', () => {
    // Unlike HandoverQrCode, there is deliberately no showPayload fallback: doing so would
    // hand anyone who can see the screen the same power as scanning it.
    render(<PickupQrCode listingId={LISTING_ID} />);
    expect(screen.queryByText(LISTING_ID)).not.toBeInTheDocument();
  });
});
