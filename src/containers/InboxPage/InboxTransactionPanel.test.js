import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';
import {
  TX_TRANSITION_ACTOR_CUSTOMER,
  TX_TRANSITION_ACTOR_PROVIDER,
} from '../../transactions/transaction';

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

// ---------------------------------------------------------------------------
//   > "Cuando se renta, a partir de ese momento aparece el QR, puedes ocultarlo a menos que el
//   >  provider acepte o que se autoacepte la transacción? El provider si puede ver el QR"
//
// The detail panel and this one are two doors to the same code. Gating only the other one
// would have hidden it from the customer in one place and left it in the other - the
// requirement half-met, which reads as a bug rather than as a policy. Hence a test here too.
// ---------------------------------------------------------------------------
describe('InboxTransactionPanel: who gets the QR', () => {
  const atTransition = (lastTransition, role) =>
    render(
      <InboxTransactionPanel
        transaction={{
          ...transactionWith({}),
          attributes: { ...transactionWith({}).attributes, lastTransition },
        }}
        transactionRole={role}
        onManageDisableScrolling={() => null}
      />
    );

  const qrButton = () => screen.queryByLabelText('InboxPage.panel.openQr');

  it('is hidden from the customer while the booking is unanswered', () => {
    atTransition('transition/confirm-payment', TX_TRANSITION_ACTOR_CUSTOMER);

    expect(qrButton()).not.toBeInTheDocument();
  });

  it('is there for the owner in that same state', () => {
    atTransition('transition/confirm-payment', TX_TRANSITION_ACTOR_PROVIDER);

    expect(qrButton()).toBeInTheDocument();
  });

  // Auto-accept lands in the same state as a manual accept, so one rule covers both.
  it('reaches the customer once the booking is accepted', () => {
    atTransition('transition/accept', TX_TRANSITION_ACTOR_CUSTOMER);

    expect(qrButton()).toBeInTheDocument();
  });

  // This panel had NO state gate at all before, so it also used to show a code before the
  // payment was confirmed - never intended, just never checked.
  it('is absent before the payment is confirmed', () => {
    atTransition('transition/request-payment', TX_TRANSITION_ACTOR_PROVIDER);

    expect(qrButton()).not.toBeInTheDocument();
  });

  it('is gone for both once the garment is back', () => {
    [TX_TRANSITION_ACTOR_CUSTOMER, TX_TRANSITION_ACTOR_PROVIDER].forEach(role => {
      const view = atTransition('transition/laundry-confirm-return', role);
      expect(qrButton()).not.toBeInTheDocument();
      view.unmount();
    });
  });
});
