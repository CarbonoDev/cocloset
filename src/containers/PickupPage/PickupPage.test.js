import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import { PickupPageComponent } from './PickupPage';

const { screen, fireEvent } = testingLibrary;

const LISTING_ID = '6aa26840-16da-44df-8a74-ff4ece1da4eb';
const TOKEN = 'a'.repeat(32);

const statusFor = (overrides = {}) => ({
  listingId: LISTING_ID,
  listingTitle: 'A silk frock',
  ownerName: 'Ana Rivera',
  onLaundry: true,
  viewerRole: 'laundry',
  tokenValid: true,
  canConfirm: true,
  ...overrides,
});

const renderPage = (props = {}) =>
  render(
    <PickupPageComponent
      scrollingDisabled={false}
      listingId={LISTING_ID}
      token={TOKEN}
      pickupStatus={statusFor()}
      fetchInProgress={false}
      fetchError={null}
      confirmInProgress={false}
      confirmError={null}
      justConfirmed={false}
      onConfirm={() => null}
      {...props}
    />
  );

const confirmButton = () =>
  screen.queryByRole('button', { name: 'PickupPage.laundry.confirmButton' });

describe('PickupPage: who gets an action', () => {
  it('offers the laundry a confirm button when the token is valid', () => {
    renderPage();
    expect(confirmButton()).toBeInTheDocument();
  });

  it('offers the owner no button, only their own QR and a waiting message', () => {
    renderPage({ pickupStatus: statusFor({ viewerRole: 'owner', canConfirm: false }) });

    expect(confirmButton()).not.toBeInTheDocument();
    expect(screen.getByText('PickupPage.owner.heading')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      `/api/listing-pickup-qr?id=${LISTING_ID}`
    );
  });

  it('never offers a button when canConfirm is false, even for the laundry role', () => {
    // The page never re-derives who may act - it only ever reflects the server's own answer.
    renderPage({ pickupStatus: statusFor({ canConfirm: false, tokenValid: false }) });
    expect(confirmButton()).not.toBeInTheDocument();
  });
});

describe('PickupPage: an invalid or spent code', () => {
  it('shows the expired state when the token does not match', () => {
    renderPage({ pickupStatus: statusFor({ tokenValid: false }) });
    expect(screen.getByText('PickupPage.expired.heading')).toBeInTheDocument();
    expect(confirmButton()).not.toBeInTheDocument();
  });

  it('shows the expired state when the garment already went home', () => {
    renderPage({ pickupStatus: statusFor({ onLaundry: false }) });
    expect(screen.getByText('PickupPage.expired.heading')).toBeInTheDocument();
  });
});

describe('PickupPage: loading and error states', () => {
  it('shows a loading message while fetching', () => {
    renderPage({ pickupStatus: null, fetchInProgress: true });
    expect(screen.getByText('PickupPage.loading')).toBeInTheDocument();
  });

  it('tells a non-party caller they have no standing here', () => {
    renderPage({
      pickupStatus: null,
      fetchError: { status: 403, statusText: 'Forbidden' },
    });
    expect(screen.getByText('PickupPage.forbidden')).toBeInTheDocument();
  });

  it('falls back to a generic not-found message for any other fetch error', () => {
    renderPage({ pickupStatus: null, fetchError: { status: 500 } });
    expect(screen.getByText('PickupPage.notFound')).toBeInTheDocument();
  });
});

describe('PickupPage: confirming', () => {
  it('calls onConfirm with the listingId and token from the page itself, never the DOM', () => {
    const onConfirm = jest.fn();
    renderPage({ onConfirm });

    fireEvent.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledWith({ listingId: LISTING_ID, token: TOKEN });
  });

  it('shows a confirmed message instead of the button once justConfirmed is true', () => {
    renderPage({ justConfirmed: true });

    expect(confirmButton()).not.toBeInTheDocument();
    expect(screen.getByText('PickupPage.laundry.confirmed')).toBeInTheDocument();
  });

  it('surfaces a rejected confirm without hiding the button, so the laundry can retry', () => {
    renderPage({ confirmError: { status: 500 } });

    expect(screen.getByText('PickupPage.laundry.confirmFailed')).toBeInTheDocument();
    expect(confirmButton()).toBeInTheDocument();
  });

  it('shows the expired copy specifically for a 409 (token already spent mid-flight)', () => {
    renderPage({ confirmError: { status: 409 } });
    expect(screen.getByText('PickupPage.expired.body')).toBeInTheDocument();
  });
});
