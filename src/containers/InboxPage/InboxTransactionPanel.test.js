import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';
import { TX_TRANSITION_ACTOR_CUSTOMER } from '../../transactions/transaction';

import InboxTransactionPanel from './InboxTransactionPanel';

const { screen } = testingLibrary;

/**
 * WHY THIS FILE EXISTS
 *
 * `timelineStepMessageId` has its own tests, and they pin the rule. This one pins the WIRING -
 * that the panel actually reads `metadata.damageReported.flag` and hands it over. On this
 * project that is where things die: a correct helper reached by nobody looks exactly like a
 * working feature, and the last two rounds both ended in a field the UI built and a duck
 * dropped.
 */

const TX_ID = '6a74b530-a104-42b6-a586-b35efb5dee79';

const transactionWith = (metadata = {}) => ({
  id: { uuid: TX_ID },
  type: 'transaction',
  attributes: {
    processName: 'cocloset-booking',
    // `returned` is where damage is recorded, so it is the state the annotation matters in.
    lastTransition: 'transition/laundry-confirm-return',
    processVersion: 1,
    lineItems: [],
    metadata,
  },
  listing: {
    id: { uuid: '11111111-1111-1111-1111-111111111111' },
    type: 'listing',
    attributes: {
      title: 'Draped jersey gown, crimson',
      publicData: {},
      availabilityPlan: { timezone: 'Etc/UTC' },
    },
    images: [],
  },
  booking: null,
});

const renderPanel = metadata =>
  render(
    <InboxTransactionPanel
      transaction={transactionWith(metadata)}
      transactionRole={TX_TRANSITION_ACTOR_CUSTOMER}
      onManageDisableScrolling={() => null}
    />
  );

describe('InboxTransactionPanel: the damage annotation on the return step', () => {
  it('reads "returned to laundry - reported" when the studio flagged damage', () => {
    renderPanel({ damageReported: { flag: true, note: 'Hem torn' } });

    expect(
      screen.getByText('ListingPage.rentalTimeline.returnedToLaundryReported')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('ListingPage.rentalTimeline.returnedToLaundry')
    ).not.toBeInTheDocument();
  });

  // The object exists on rentals with no damage at all, so its presence is not a report.
  it('leaves the step alone when the report says there was no damage', () => {
    renderPanel({ damageReported: { flag: false, note: '' } });

    expect(screen.getByText('ListingPage.rentalTimeline.returnedToLaundry')).toBeInTheDocument();
    expect(
      screen.queryByText('ListingPage.rentalTimeline.returnedToLaundryReported')
    ).not.toBeInTheDocument();
  });

  it('leaves the step alone on a rental with no report at all', () => {
    renderPanel({});

    expect(screen.getByText('ListingPage.rentalTimeline.returnedToLaundry')).toBeInTheDocument();
  });

  // "el resto de los pasos debe funcionar igual" - the other seven are untouched either way.
  it('still renders all eight steps on a damaged rental', () => {
    renderPanel({ damageReported: { flag: true, note: 'Hem torn' } });

    ['bookingConfirmed', 'laundryPreparing', 'readyForPickup', 'pickedUp', 'rentalActive'].forEach(
      key => {
        expect(screen.getByText(`ListingPage.rentalTimeline.${key}`)).toBeInTheDocument();
      }
    );
    expect(screen.getByText('ListingPage.rentalTimeline.cleaning')).toBeInTheDocument();
    expect(screen.getByText('ListingPage.rentalTimeline.readyForNextRental')).toBeInTheDocument();
  });
});
