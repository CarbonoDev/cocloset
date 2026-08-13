import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import { HandoverPageComponent } from './HandoverPage';

const { screen } = testingLibrary;

// WHY THIS FILE EXISTS
//
//   > "El qr solo debe poder leerse si eres laundry, si otro actor lo lee solo debe mostrarle
//   >  indicaciones"
//
// One screen, three audiences, and the difference between them is a single button. These
// tests are about that button existing for exactly one role and never for the others - and
// about the page taking that answer from the SERVER rather than deciding it itself, since a
// rule the browser evaluates is a rule an attacker can edit.

const TX_ID = '6a74b530-a104-42b6-a586-b35efb5dee79';

const handoverFor = (overrides = {}) => ({
  transactionId: TX_ID,
  processState: 'ready-for-pickup',
  viewerRole: 'laundry',
  canConfirm: true,
  step: {
    state: 'ready-for-pickup',
    status: 'picked-up',
    counterparty: 'customer',
    direction: 'out',
    isLate: false,
  },
  listingTitle: 'A silk frock',
  bookingStart: null,
  bookingEnd: null,
  ticketCode: 'PIG-A3F91C',
  ...overrides,
});

const renderPage = (props = {}) =>
  render(
    <HandoverPageComponent
      scrollingDisabled={false}
      handover={handoverFor()}
      fetchInProgress={false}
      fetchError={null}
      confirmInProgress={false}
      confirmError={null}
      onConfirm={() => null}
      {...props}
    />
  );

const confirmButton = () =>
  screen.queryByRole('button', { name: /HandoverPage\.step\..*\.confirm/ });

describe('HandoverPage: who gets an action', () => {
  it('offers the laundry a confirm button', () => {
    renderPage();
    expect(confirmButton()).toBeInTheDocument();
  });

  it.each([['customer'], ['provider']])('offers %s no button at all, only instructions', role => {
    renderPage({ handover: handoverFor({ viewerRole: role, canConfirm: false }) });

    expect(confirmButton()).not.toBeInTheDocument();
    // Instructions, not silence: the client asked for the other actors to be told what to do.
    expect(
      screen.getByText(/HandoverPage\.step\.ready-for-pickup\.(yourTurn|waiting)/)
    ).toBeInTheDocument();
  });

  it('takes canConfirm from the server, not from the role it was told', () => {
    // The load-bearing assertion. If this component ever derives "am I the laundry" itself,
    // the authorization moves into the browser - and `canConfirm` is what the server
    // computed after checking the assigned laundry.
    renderPage({ handover: handoverFor({ viewerRole: 'laundry', canConfirm: false }) });

    expect(confirmButton()).not.toBeInTheDocument();
  });

  it('fires the step status the server named', () => {
    const onConfirm = jest.fn();
    renderPage({ onConfirm });

    confirmButton().click();

    expect(onConfirm).toHaveBeenCalledWith({ transactionId: TX_ID, status: 'picked-up' });
  });
});

describe('HandoverPage: what it says is next', () => {
  it('names the counterparty for a collection', () => {
    renderPage();
    expect(screen.getByText('HandoverPage.counterparty.customer')).toBeInTheDocument();
  });

  it('names the OWNER when the garment still has to come in', () => {
    renderPage({
      handover: handoverFor({
        processState: 'accepted',
        step: {
          state: 'accepted',
          status: 'ready-for-pickup',
          counterparty: 'provider',
          direction: 'in',
          isLate: false,
        },
      }),
    });

    expect(screen.getByText('HandoverPage.counterparty.provider')).toBeInTheDocument();
    expect(screen.getByText('HandoverPage.step.accepted.title')).toBeInTheDocument();
  });

  it('says so when a return is late', () => {
    renderPage({
      handover: handoverFor({
        processState: 'overdue',
        step: {
          state: 'overdue',
          status: 'returned',
          counterparty: 'customer',
          direction: 'in',
          isLate: true,
        },
      }),
    });

    expect(screen.getByText('HandoverPage.lateReturn')).toBeInTheDocument();
  });

  it('offers nothing to confirm once the garment is back', () => {
    // A step of null is every state after the counter is done with the rental. A button here
    // would advance an internal cleaning phase because somebody re-scanned an old code.
    renderPage({
      handover: handoverFor({ processState: 'cleaning', step: null, canConfirm: false }),
    });

    expect(confirmButton()).not.toBeInTheDocument();
    expect(screen.getByText('HandoverPage.nothingDue.title')).toBeInTheDocument();
  });
});

describe('HandoverPage: failures', () => {
  it('tells a stranger they are not part of this rental', () => {
    renderPage({ handover: null, fetchError: { status: 403 } });

    expect(screen.getByText('HandoverPage.error.forbidden')).toBeInTheDocument();
    expect(confirmButton()).not.toBeInTheDocument();
  });

  it('offers a signed-out scanner a way in', () => {
    renderPage({ handover: null, fetchError: { status: 401 } });

    expect(screen.getByText('HandoverPage.error.unauthorized')).toBeInTheDocument();
    expect(screen.getByText('HandoverPage.error.signIn')).toBeInTheDocument();
  });

  it('separates a transport failure from a refusal', () => {
    // "Try again" and "this is not yours" send the reader to do different things.
    renderPage({ handover: null, fetchError: { status: 500 } });

    expect(screen.getByText('HandoverPage.error.generic')).toBeInTheDocument();
  });

  it('keeps the button after a failed confirm, with the failure explained', () => {
    // The operator has physically handed the garment over by this point; taking the button
    // away would leave them with no way to record it.
    renderPage({ confirmError: { status: 409 } });

    expect(screen.getByText('HandoverPage.error.confirmFailed')).toBeInTheDocument();
    expect(confirmButton()).toBeInTheDocument();
  });
});
