import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';
import {
  TX_TRANSITION_ACTOR_CUSTOMER,
  TX_TRANSITION_ACTOR_PROVIDER,
} from '../../transactions/transaction';

import InboxTransactionPanel from './InboxTransactionPanel';
import { getStateData } from './InboxPage.stateData';

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
  // "el resto de los pasos debe funcionar igual" - the annotation replaces one step's label and
  // touches nothing else. Which steps a reader gets is a separate rule, asserted below; this
  // renders as the CUSTOMER, so the laundry's post-return work is not among them.
  it("still renders the rest of the renter's steps on a damaged rental", () => {
    renderPanel({ damageReported: { flag: true, note: 'Hem torn' } });

    ['bookingConfirmed', 'laundryPreparing', 'readyForPickup', 'pickedUp', 'rentalActive'].forEach(
      key => {
        expect(screen.getByText(`ListingPage.rentalTimeline.${key}`)).toBeInTheDocument();
      }
    );
    expect(screen.getByText('ListingPage.rentalTimeline.review')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
//   > "aparecen para el customer Cleaning y Ready for next rental, el customer no tiene que
//   >  saber eso, laundry y provider si, podemos agregar para customer y provider los steps de
//   >  review?"
//
// The rule lives in util/rentalTimeline.js and is tested there. This pins the WIRING - that
// the panel passes the role it already knows, rather than rendering one list for everybody.
// On this project that is exactly where things die: a correct helper reached by nobody looks
// like a working feature.
// ---------------------------------------------------------------------------
describe('InboxTransactionPanel: whose timeline it renders', () => {
  const asRole = role =>
    render(
      <InboxTransactionPanel
        transaction={transactionWith({})}
        transactionRole={role}
        onManageDisableScrolling={() => null}
      />
    );

  const step = key => screen.queryByText(`ListingPage.rentalTimeline.${key}`);

  it("keeps the laundry's work off the renter's timeline", () => {
    asRole(TX_TRANSITION_ACTOR_CUSTOMER);

    expect(step('cleaning')).not.toBeInTheDocument();
    expect(step('readyForNextRental')).not.toBeInTheDocument();
  });

  it('shows the owner both, because their rental is not over until then', () => {
    asRole(TX_TRANSITION_ACTOR_PROVIDER);

    expect(step('cleaning')).toBeInTheDocument();
    expect(step('readyForNextRental')).toBeInTheDocument();
  });

  it('gives both of them the review step', () => {
    [TX_TRANSITION_ACTOR_CUSTOMER, TX_TRANSITION_ACTOR_PROVIDER].forEach(role => {
      const view = asRole(role);
      expect(step('review')).toBeInTheDocument();
      view.unmount();
    });
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
  const atTransition = (lastTransition, role, { isAtLaundry = false } = {}) => {
    const base = transactionWith({});
    return render(
      <InboxTransactionPanel
        transaction={{
          ...base,
          attributes: { ...base.attributes, lastTransition },
          listing: {
            ...base.listing,
            attributes: {
              ...base.listing.attributes,
              // The CUSTODY flag, which is what the rule turns on - see the read in
              // InboxTransactionPanel.js. `readinessStatus` rides along because other parts
              // of the panel still use it.
              metadata: {
                onLaundry: isAtLaundry,
                readinessStatus: isAtLaundry ? 'stored' : 'incoming',
              },
            },
          },
        }}
        transactionRole={role}
        onManageDisableScrolling={() => null}
      />
    );
  };

  const qrButton = () => screen.queryByLabelText('InboxPage.panel.openQr');

  it('is hidden from the customer while the booking is unanswered', () => {
    atTransition('transition/confirm-payment', TX_TRANSITION_ACTOR_CUSTOMER);

    expect(qrButton()).not.toBeInTheDocument();
  });

  //   > "puedes mostrar el QR al provider solo bajo estas condiciones? 1. (...) tengo la
  //   >  prenda en mi poder (onLaundry = false) y debo ir a entregarla (...) 2. (...) ya
  //   >  terminó el proceso de limpieza y puedo ir a recogerla. 3. Una transacción fue
  //   >  cancelada y puedo recoger nuevamente la prenda" (Jonathan, 2026-09-08)
  //
  // Two errands, and the garment can only be in one place - so the pre-acceptance state now
  // shows nothing either way. This panel and the transaction page read the same rule, which
  // is the point of it living in transactions/transactionProcessCoclosetBooking.js.
  it('shows the owner nothing before they have answered the booking', () => {
    atTransition('transition/confirm-payment', TX_TRANSITION_ACTOR_PROVIDER).unmount();
    expect(qrButton()).not.toBeInTheDocument();

    atTransition('transition/confirm-payment', TX_TRANSITION_ACTOR_PROVIDER, {
      isAtLaundry: true,
    });
    expect(qrButton()).not.toBeInTheDocument();
  });

  it('gives the owner the code while the garment is still theirs to drop off', () => {
    atTransition('transition/accept', TX_TRANSITION_ACTOR_PROVIDER);

    expect(qrButton()).toBeInTheDocument();
  });

  it('gives it back once the wash is done, or the booking was called off', () => {
    const afterWash = atTransition(
      'transition/laundry-mark-available',
      TX_TRANSITION_ACTOR_PROVIDER,
      {
        isAtLaundry: true,
      }
    );
    expect(qrButton()).toBeInTheDocument();
    afterWash.unmount();

    atTransition('transition/cancel', TX_TRANSITION_ACTOR_PROVIDER, { isAtLaundry: true });
    expect(qrButton()).toBeInTheDocument();
  });

  //   > "si los pasos siguientes aplican para el customer, el provider no debe ver el QR"
  it("leaves the owner once the remaining handovers are the renter's", () => {
    atTransition('transition/laundry-mark-ready', TX_TRANSITION_ACTOR_PROVIDER);

    expect(qrButton()).not.toBeInTheDocument();
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

// ==========================================================================
// The status pill's colour.
//
// The state data decides the tone and has its own tests; this pins the WIRING,
// which is the half that goes wrong on this project - a correct rule reached by
// nobody looks exactly like a working feature. CSS Modules are stubbed in Jest
// so the class name comes through as written, which is what makes it readable
// here at all.
// ==========================================================================
describe('InboxTransactionPanel: the status pill', () => {
  const pillAt = lastTransition => {
    // The real state data, not a hand-written prop: the point is that the tone
    // survives the whole path from the process state to the class name.
    const transaction = {
      ...transactionWith({}),
      attributes: { ...transactionWith({}).attributes, lastTransition },
    };
    const stateData = getStateData({
      transaction,
      transactionRole: TX_TRANSITION_ACTOR_CUSTOMER,
    });

    const { container } = render(
      <InboxTransactionPanel
        transaction={transaction}
        stateData={stateData}
        transactionRole={TX_TRANSITION_ACTOR_CUSTOMER}
        onManageDisableScrolling={() => null}
      />
    );
    return container.querySelector('[class*="panelStatus"]');
  };

  it('is red on a declined request, not green', () => {
    const pill = pillAt('transition/decline');

    expect(pill.className).toContain('panelStatusNegative');
    expect(pill.className).not.toContain('panelStatusFinal');
  });

  it.each(['transition/cancel', 'transition/expire'])(
    'is red on %s too, so the endings match each other',
    lastTransition => {
      expect(pillAt(lastTransition).className).toContain('panelStatusNegative');
    }
  );

  it('is green once the booking is accepted', () => {
    expect(pillAt('transition/accept').className).toContain('panelStatusPositive');
  });

  it('is green on a rental that ran its course', () => {
    expect(pillAt('transition/expire-review-period').className).toContain('panelStatusPositive');
  });

  it('leaves a rental in flight neutral', () => {
    const pill = pillAt('transition/laundry-confirm-pickup');

    expect(pill.className).not.toContain('panelStatusNegative');
    expect(pill.className).not.toContain('panelStatusPositive');
    expect(pill.className).not.toContain('panelStatusFinal');
  });
});
