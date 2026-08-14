import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import { HandoverPageComponent } from './HandoverPage';

const { screen, fireEvent } = testingLibrary;

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

describe('HandoverPage: the full current status, for a party', () => {
  //   > "si soy un actor, debo poder ver la información completa del status actual"
  //
  // The step says what happens NEXT; these say where the rental IS. A page that answered
  // only the first left a customer unable to tell whether their garment had been dropped
  // off yet.
  it('states the current status in words', () => {
    renderPage();
    expect(screen.getByText('HandoverPage.status.ready-for-pickup')).toBeInTheDocument();
  });

  it('states the rental dates, with the customer-facing inclusive end', () => {
    renderPage({
      handover: handoverFor({
        bookingStart: '2026-09-01T00:00:00.000Z',
        // Exclusive on the wire; the renter's last day is the 7th.
        bookingEnd: '2026-09-08T00:00:00.000Z',
      }),
    });

    expect(screen.getByText('HandoverPage.fact.rentalRange')).toBeInTheDocument();
  });

  it('tells the reader which party they are', () => {
    renderPage({ handover: handoverFor({ viewerRole: 'customer', canConfirm: false }) });
    expect(screen.getByText('HandoverPage.role.customer')).toBeInTheDocument();
  });

  it('still states the status when nothing is due at the counter', () => {
    // `cleaning` has no handover step, but it is exactly the status a customer wants to read.
    renderPage({
      handover: handoverFor({ processState: 'cleaning', step: null, canConfirm: false }),
    });

    expect(screen.getByText('HandoverPage.status.cleaning')).toBeInTheDocument();
  });

  it('omits the rows it has no data for rather than rendering empty labels', () => {
    renderPage({
      handover: handoverFor({ ticketCode: null, bookingStart: null, bookingEnd: null }),
    });

    expect(screen.queryByText('HandoverPage.fact.ticket')).not.toBeInTheDocument();
    expect(screen.queryByText('HandoverPage.fact.rental')).not.toBeInTheDocument();
    expect(screen.getByText('HandoverPage.fact.status')).toBeInTheDocument();
  });
});

describe('HandoverPage: the cleaning-days box at a return', () => {
  //   > "al momento de recibir la prenda, laundry puede seleccionar cuantos dias necesita
  //   >  para lavar, pero en mobile no aparece esta opción, estos días deben tener un default
  //   >  de los días que indique la laundry, pero pueden modificarse al recibir"
  //
  // This page IS the studio's phone screen - it is what a scan opens - so a return confirmed
  // here used to fall back to the configured turnaround with nothing on screen to say so.

  const returnStep = {
    state: 'picked-up',
    status: 'returned',
    counterparty: 'customer',
    direction: 'in',
    isLate: false,
  };

  const returning = (overrides = {}) =>
    handoverFor({
      processState: 'picked-up',
      step: returnStep,
      defaultCleaningDays: 3,
      ...overrides,
    });

  const daysInput = () => document.getElementById('handoverCleaningDays');

  it('offers the box, pre-filled with the studio configured turnaround', () => {
    renderPage({ handover: returning() });
    expect(daysInput()).toHaveValue(3);
  });

  it('sends the number the operator actually typed', () => {
    const onConfirm = jest.fn();
    renderPage({ handover: returning(), onConfirm });

    fireEvent.change(daysInput(), { target: { value: '5' } });
    confirmButton().click();

    expect(onConfirm).toHaveBeenCalledWith({
      transactionId: TX_ID,
      status: 'returned',
      cleaningDays: 5,
    });
  });

  it('sends NO cleaningDays when the box is cleared', () => {
    // A blank box is not a zero. Absent means "apply the configured turnaround"; 0 would mean
    // "ready today" and would block nothing at all.
    const onConfirm = jest.fn();
    renderPage({ handover: returning(), onConfirm });

    fireEvent.change(daysInput(), { target: { value: '' } });
    confirmButton().click();

    expect(onConfirm).toHaveBeenCalledWith({ transactionId: TX_ID, status: 'returned' });
  });

  it('sends a real zero when the operator types one', () => {
    // "Ready today" is a legitimate answer, and it has to survive the blank-is-not-zero rule.
    const onConfirm = jest.fn();
    renderPage({ handover: returning(), onConfirm });

    fireEvent.change(daysInput(), { target: { value: '0' } });
    confirmButton().click();

    expect(onConfirm).toHaveBeenCalledWith({
      transactionId: TX_ID,
      status: 'returned',
      cleaningDays: 0,
    });
  });

  it('does not offer the box at a step that does not take it', () => {
    // WHETHER TO ASK is the server's answer - it omits `defaultCleaningDays` except for the
    // laundry at a return - and this component does not re-derive it.
    renderPage();
    expect(daysInput()).toBeNull();
  });

  it('does not offer the box to a party who cannot confirm', () => {
    renderPage({
      handover: returning({
        viewerRole: 'customer',
        canConfirm: false,
        defaultCleaningDays: undefined,
      }),
    });
    expect(daysInput()).toBeNull();
  });
});

describe('HandoverPage: the damage report at a return', () => {
  //   > "cuando esta el form en que ingreso esos días, ya sea que venga de qr, o no, no me
  //   >  aparece la opción para reportar daños"
  //
  // The return is the one moment the garment is physically inspected, and by the next step
  // the payout has fired and a cancel-with-refund is no longer expressible. A studio working
  // from a phone had no way to record damage at all.

  const returning = (overrides = {}) =>
    handoverFor({
      processState: 'picked-up',
      step: {
        state: 'picked-up',
        status: 'returned',
        counterparty: 'customer',
        direction: 'in',
        isLate: false,
      },
      defaultCleaningDays: 3,
      takesDamageReport: true,
      ...overrides,
    });

  const damageCheckbox = () => document.getElementById('handoverDamaged');

  it('offers the damage checkbox at a return', () => {
    renderPage({ handover: returning() });
    expect(damageCheckbox()).toBeInTheDocument();
  });

  it('asks for a note only once damage is actually reported', () => {
    renderPage({ handover: returning() });
    expect(screen.queryByPlaceholderText('HandoverPage.damage.notePlaceholder')).toBeNull();

    fireEvent.click(damageCheckbox());
    expect(screen.getByPlaceholderText('HandoverPage.damage.notePlaceholder')).toBeInTheDocument();
  });

  it('sends the report with the confirmation', () => {
    const onConfirm = jest.fn();
    renderPage({ handover: returning(), onConfirm });

    fireEvent.click(damageCheckbox());
    fireEvent.change(screen.getByPlaceholderText('HandoverPage.damage.notePlaceholder'), {
      target: { value: 'Small pull at left cuff.' },
    });
    confirmButton().click();

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ damaged: true, damageNote: 'Small pull at left cuff.' })
    );
  });

  it('drops a note left behind after the box is un-ticked', () => {
    // A description of damage attached to a garment recorded as fine is worse than no note.
    const onConfirm = jest.fn();
    renderPage({ handover: returning(), onConfirm });

    fireEvent.click(damageCheckbox());
    fireEvent.change(screen.getByPlaceholderText('HandoverPage.damage.notePlaceholder'), {
      target: { value: 'Actually it is fine' },
    });
    fireEvent.click(damageCheckbox());
    confirmButton().click();

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ damaged: false, damageNote: '' })
    );
  });

  it('does not offer it at a step that does not take one', () => {
    // WHETHER TO ASK is the server's answer, and this component does not re-derive it.
    renderPage();
    expect(damageCheckbox()).toBeNull();
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

  it('never renders an empty page', () => {
    // THE REGRESSION THIS PAGE SHIPPED WITH: a duck bug stored `undefined` instead of the
    // handover, and this branch returned null - a heading over empty space, no data and no
    // error. A page with no answer still owes the reader a sentence.
    const { container } = renderPage({ handover: null, fetchError: null, fetchInProgress: false });

    expect(screen.getByText('HandoverPage.error.generic')).toBeInTheDocument();
    expect(container).not.toBeEmptyDOMElement();
  });

  it('keeps the button after a failed confirm, with the failure explained', () => {
    // The operator has physically handed the garment over by this point; taking the button
    // away would leave them with no way to record it.
    renderPage({ confirmError: { status: 409 } });

    expect(screen.getByText('HandoverPage.error.confirmFailed')).toBeInTheDocument();
    expect(confirmButton()).toBeInTheDocument();
  });
});
