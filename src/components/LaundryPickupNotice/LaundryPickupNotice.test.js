import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import LaundryPickupNotice from './LaundryPickupNotice';

const { screen, fireEvent } = testingLibrary;

describe('LaundryPickupNotice', () => {
  it('renders the heading, body, and all four steps when not collapsible', () => {
    render(<LaundryPickupNotice />);

    expect(screen.getByText('LaundryPickupNotice.heading')).toBeInTheDocument();
    expect(screen.getByText('LaundryPickupNotice.body')).toBeInTheDocument();
    expect(screen.getByText('LaundryPickupNotice.step1')).toBeInTheDocument();
    expect(screen.getByText('LaundryPickupNotice.step2')).toBeInTheDocument();
    expect(screen.getByText('LaundryPickupNotice.step3')).toBeInTheDocument();
    expect(screen.getByText('LaundryPickupNotice.step4')).toBeInTheDocument();
    // No toggle at all when not collapsible - it's always open.
    expect(screen.queryByText('LaundryPickupNotice.toggleShow')).not.toBeInTheDocument();
  });

  it('starts collapsed behind a toggle when collapsible, and expands on click', () => {
    render(<LaundryPickupNotice collapsible />);

    expect(screen.getByText('LaundryPickupNotice.toggleShow')).toBeInTheDocument();
    expect(screen.queryByText('LaundryPickupNotice.heading')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('LaundryPickupNotice.toggleShow'));

    expect(screen.getByText('LaundryPickupNotice.toggleHide')).toBeInTheDocument();
    expect(screen.getByText('LaundryPickupNotice.heading')).toBeInTheDocument();
  });

  it('collapses again on a second toggle click', () => {
    render(<LaundryPickupNotice collapsible />);

    fireEvent.click(screen.getByText('LaundryPickupNotice.toggleShow'));
    fireEvent.click(screen.getByText('LaundryPickupNotice.toggleHide'));

    expect(screen.getByText('LaundryPickupNotice.toggleShow')).toBeInTheDocument();
    expect(screen.queryByText('LaundryPickupNotice.heading')).not.toBeInTheDocument();
  });
});

describe('LaundryPickupNotice: the QR', () => {
  const LISTING_ID = '6aa26840-16da-44df-8a74-ff4ece1da4eb';

  it('renders the QR once the listing is actually paused', () => {
    render(<LaundryPickupNotice listingId={LISTING_ID} isPaused />);

    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      `/api/listing-pickup-qr?id=${LISTING_ID}`
    );
  });

  it('does not render a QR before the listing is paused - there is nothing to scan yet', () => {
    render(<LaundryPickupNotice listingId={LISTING_ID} isPaused={false} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('does not render a QR without a listingId, even if told the listing is paused', () => {
    render(<LaundryPickupNotice isPaused />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
