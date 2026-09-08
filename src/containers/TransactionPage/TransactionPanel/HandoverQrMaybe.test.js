import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders, testingLibrary } from '../../../util/testHelpers';
import en from '../../../translations/en.json';

import HandoverQrMaybe from './HandoverQrMaybe';

const { screen } = testingLibrary;

// testHelpers maps every translation key to itself by default; the real strings
// are needed here because the payload and the ticket code are interpolated INTO
// messages. NOTE: Console's hosted translation asset overrides en.json at
// runtime, so this pins the local default copy.
const render = ui => renderWithProviders(ui, { messages: en });

const TX_ID = '6a74b530-a104-42b6-a586-b35efb5dee79';
const transactionId = { uuid: TX_ID };

const record = {
  version: 1,
  payload: TX_ID,
  encoding: 'transaction-id',
  scope: 'pickup-and-return',
  createdAt: '2026-08-09T12:00:00.000Z',
};

const renderPanel = (props = {}) =>
  render(
    <HandoverQrMaybe
      processName="cocloset-booking"
      processState="ready-for-pickup"
      transactionId={transactionId}
      metadata={{ handoverQr: record }}
      // The renter is the default subject: they are the one who carries the code
      // through every state below. The owner's much narrower window is asserted
      // on its own, with the role and the garment's whereabouts stated.
      isCustomer
      {...props}
    />
  );

describe('HandoverQrMaybe', () => {
  it('shows the QR to the customer once the booking is accepted', () => {
    renderPanel({ processState: 'accepted' });

    expect(screen.getByRole('img')).toHaveAttribute('src', `/api/transaction-qr?id=${TX_ID}`);
  });

  describe('one QR for both handover events', () => {
    // The same single code must be on screen through the collection AND the
    // return. If a future change ever splits it in two, these four break.
    it.each([['accepted'], ['ready-for-pickup'], ['picked-up'], ['overdue']])(
      'renders exactly one code in state %s',
      state => {
        renderPanel({ processState: state });

        const images = screen.getAllByRole('img');
        expect(images).toHaveLength(1);
        expect(images[0]).toHaveAttribute('src', `/api/transaction-qr?id=${TX_ID}`);
      }
    );

    it('renders the identical code before and after the garment is collected', () => {
      const before = renderPanel({ processState: 'ready-for-pickup' });
      const beforeSrc = before.container.querySelector('img').getAttribute('src');
      before.unmount();

      const after = renderPanel({ processState: 'picked-up' });
      const afterSrc = after.container.querySelector('img').getAttribute('src');

      expect(afterSrc).toBe(beforeSrc);
    });
  });

  describe('it disappears once both handovers are done', () => {
    // Derived from the transaction's real process state, not from a metadata
    // flag: the only ways into `returned` are the two return transitions, so
    // being in `returned` already means the second handover happened.
    it.each([['returned'], ['cleaning'], ['delivered'], ['reviewed-by-customer'], ['reviewed']])(
      'renders nothing in state %s',
      state => {
        const { container } = renderPanel({ processState: state });
        expect(container).toBeEmptyDOMElement();
      }
    );

    it('keeps the metadata record - only the display goes away', () => {
      // "Debe desaparecer despues de este evento" is about the screen;
      // "la información del qr debe permanecer en la metadata" is about the
      // record. This component only ever reads metadata, never writes it.
      const metadata = { handoverQr: record };
      const { container } = renderPanel({ processState: 'returned', metadata });

      expect(container).toBeEmptyDOMElement();
      expect(metadata.handoverQr).toEqual(record);
    });
  });

  it('renders nothing before the payment is confirmed', () => {
    // There is no rental to collect until the customer has actually paid.
    ['inquiry', 'pending-payment'].forEach(state => {
      const { container } = renderPanel({ processState: state });
      expect(container).toBeEmptyDOMElement();
    });
  });

  // The client moved this floor:
  //   > "el QR debe mostrarse al cliente desde que se confirma el pago pero con la
  //   >  instrucción de que debe esperar a que el provider entregue la prenda"
  // The old worry - a code for a booking the provider might still decline - is answered by
  // the COPY, so the copy is what this asserts alongside the code being there at all.
  // Matched on the real strings, not the keys: this suite renders with `messages: en`, and
  // the point is which SENTENCE the customer reads.
  const WAITING_COPY = /still has to bring the garment to the laundry/i;
  const READY_COPY = /Show this code at the laundry counter/i;

  // The copy, not the visibility rule - which party sees what and when is asserted in "who
  // sees the code, and from when" below. What matters here is that whoever DOES see a code
  // before the garment is ready is told it is not usable yet.
  it('carries the waiting copy while the garment is not at the counter yet', () => {
    //   > "La key TransactionPanel.handoverQr.descriptionWaiting se muestra a un provider
    //   >  aunque en ese momento no es necesario que se le muestre el QR"
    //   >   (Jonathan, 2026-09-08)
    //
    // It is the RENTER's sentence - wait for the owner to drop it off and the studio to clean
    // it - and it was being shown to the owner about their own garment, which they are the one
    // holding. The owner has their own two sentences now, one per errand.
    const viewers = [
      // The renter, from the moment the booking is accepted.
      { processState: 'accepted', isCustomer: true },
    ];

    viewers.forEach(props => {
      const { queryByText, getByRole, unmount } = renderPanel(props);
      expect(getByRole('img')).toBeInTheDocument();
      expect(queryByText(WAITING_COPY)).toBeInTheDocument();
      expect(queryByText(READY_COPY)).not.toBeInTheDocument();
      unmount();
    });
  });

  it('switches to the collect-it-now copy once the garment is ready', () => {
    ['ready-for-pickup', 'picked-up', 'overdue'].forEach(state => {
      const { queryByText, unmount } = renderPanel({ processState: state });
      expect(queryByText(READY_COPY)).toBeInTheDocument();
      expect(queryByText(WAITING_COPY)).not.toBeInTheDocument();
      unmount();
    });
  });

  it('renders nothing in dead-end states', () => {
    ['declined', 'canceled', 'expired', 'payment-expired'].forEach(state => {
      const { container } = renderPanel({ processState: state });
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('renders nothing for other transaction processes', () => {
    // No other process in this template has a laundry handover.
    ['default-booking', 'default-purchase', 'default-negotiation', undefined].forEach(
      processName => {
        const { container } = renderPanel({ processName, processState: 'accepted' });
        expect(container).toBeEmptyDOMElement();
      }
    );
  });

  it('falls back to the transaction id for a booking with no stored record', () => {
    // Every booking that predates this feature has no record; design §11 fixes
    // the payload as the transaction id, so the code is still correct.
    renderPanel({ metadata: { ticketCode: 'PIG-A3F91C' } });

    expect(screen.getByRole('img')).toHaveAttribute('src', `/api/transaction-qr?id=${TX_ID}`);
  });

  it('shows the payload as selectable text alongside the image', () => {
    renderPanel();
    expect(screen.getByText(TX_ID)).toBeInTheDocument();
  });

  it('shows the cosmetic ticket code when the laundry has printed one', () => {
    renderPanel({ metadata: { handoverQr: record, ticketCode: 'PIG-A3F91C' } });
    expect(screen.getByText('PIG-A3F91C')).toBeInTheDocument();
  });

  it('omits the ticket code row while it does not exist yet', () => {
    // ticketCode is written at transition/laundry-mark-ready, so it is absent
    // while the transaction is still `accepted`.
    renderPanel({ processState: 'accepted', metadata: { handoverQr: record } });

    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(screen.queryByText(/^Ticket:/)).not.toBeInTheDocument();
  });

  it('renders nothing when there is no payload at all', () => {
    const { container } = renderPanel({ transactionId: undefined, metadata: {} });
    expect(container).toBeEmptyDOMElement();
  });

  // ---------------------------------------------------------------------------
  //   > "Cuando se renta, a partir de ese momento aparece el QR, puedes ocultarlo a menos que
  //   >  el provider acepte o que se autoacepte la transacción? El provider si puede ver el QR"
  //
  // This REVERSES the earlier instruction that put the customer's code on screen from payment.
  // Both directions were asked for, months apart; the tests say which one is current.
  // ---------------------------------------------------------------------------
  describe('who sees the code, and from when', () => {
    const qr = view => view.queryByRole('img');

    it('hides it from the customer while the booking is unanswered', () => {
      const view = renderPanel({ processState: 'preauthorized', isCustomer: true });

      expect(qr(view)).not.toBeInTheDocument();
    });

    // ------------------------------------------------------------------------
    //   > "El QR no debe poder verse hasta que el provider apruebe la transacción,
    //   >  esto aplica solo si la prenda no esta en una laundry, a su vez, si los
    //   >  pasos siguientes aplican para el customer, el provider no debe ver el
    //   >  QR" (Jonathan, 2026-09-03)
    //
    // This narrows the owner's window from both ends, and REVERSES the previous
    // rule that showed them the code from payment. Three assertions, one per
    // clause, because each is a separate promise.
    // ------------------------------------------------------------------------
    it('hides it from the owner too, until they have answered the booking', () => {
      const view = renderPanel({ processState: 'preauthorized', isCustomer: false });

      expect(qr(view)).not.toBeInTheDocument();
    });

    // ------------------------------------------------------------------------
    //   > "puedes mostrar el QR al provider solo bajo estas condiciones? 1. Yo como provider
    //   >  tengo la prenda en mi poder (onLaundry = false) y debo ir a entregarla a la
    //   >  lavanderia. 2. La prenda ya regresó a la lavandería, ya terminó el proceso de
    //   >  limpieza y puedo ir a recogerla. 3. Una transacción fue cancelada y puedo recoger
    //   >  nuevamente la prenda" (Jonathan, 2026-09-08)
    //
    // Three cases, and they are TWO ERRANDS: take it in, or come and get it. Everything else
    // is a stretch where the studio has the garment and the next person at the counter is the
    // renter - which is what the owner was being shown a code for.
    // ------------------------------------------------------------------------
    it('shows it to the owner while the garment is theirs to deliver', () => {
      const view = renderPanel({ processState: 'accepted', isCustomer: false });

      expect(qr(view)).toBeInTheDocument();
    });

    it('hides it once the studio has the garment and the rental is live', () => {
      // Nothing for the owner to do with a code here: the handovers left are the renter's.
      const view = renderPanel({ processState: 'accepted', isCustomer: false, isAtLaundry: true });

      expect(qr(view)).not.toBeInTheDocument();
    });

    it('shows it to the owner again once the wash is done and it can be collected', () => {
      ['delivered', 'reviewed', 'reviewed-by-customer', 'reviewed-by-provider'].forEach(
        processState => {
          const view = renderPanel({ processState, isCustomer: false, isAtLaundry: true });
          expect(qr(view)).toBeInTheDocument();
          view.unmount();
        }
      );
    });

    it('shows it to the owner after a cancellation, so they can take the garment back', () => {
      const view = renderPanel({ processState: 'canceled', isCustomer: false, isAtLaundry: true });

      expect(qr(view)).toBeInTheDocument();
    });

    it('shows nothing to collect for a cancellation where the owner still has the garment', () => {
      // There is no errand: the garment never left home.
      const view = renderPanel({ processState: 'canceled', isCustomer: false });

      expect(qr(view)).not.toBeInTheDocument();
    });

    it('tells the owner which walk they are making', () => {
      const dropOff = renderPanel({ processState: 'accepted', isCustomer: false });
      expect(dropOff.queryByText(/Take the garment to the laundry/i)).toBeInTheDocument();
      dropOff.unmount();

      const collect = renderPanel({
        processState: 'delivered',
        isCustomer: false,
        isAtLaundry: true,
      });
      expect(collect.queryByText(/ready to collect/i)).toBeInTheDocument();
      // And never the renter's sentence, which is what the client was looking at.
      expect(collect.queryByText(WAITING_COPY)).not.toBeInTheDocument();
    });

    it('gives it to the owner once they accept', () => {
      const view = renderPanel({ processState: 'accepted', isCustomer: false });

      expect(qr(view)).toBeInTheDocument();
    });

    it("takes it from the owner the moment the next steps are the renter's", () => {
      // From ready-for-pickup on, every remaining handover is the renter's errand.
      ['ready-for-pickup', 'picked-up', 'overdue'].forEach(state => {
        [false, true].forEach(isAtLaundry => {
          const view = renderPanel({ processState: state, isCustomer: false, isAtLaundry });
          expect(qr(view)).not.toBeInTheDocument();
          view.unmount();
        });
      });
    });

    // "que acepte o que se autoacepte" needs no branch here: auto-accept is a transition INTO
    // `accepted`, exactly like a manual accept. The two differ in who triggered them, not in
    // where they land, so a rule keyed on the state covers both.
    it('gives it to the customer the moment the booking is accepted, however that happened', () => {
      const view = renderPanel({ processState: 'accepted', isCustomer: true });

      expect(qr(view)).toBeInTheDocument();
    });

    it('keeps showing it to the customer through the rest of the rental', () => {
      ['ready-for-pickup', 'picked-up', 'overdue'].forEach(state => {
        const view = renderPanel({ processState: state, isCustomer: true });
        expect(qr(view)).toBeInTheDocument();
        view.unmount();
      });
    });

    // Unchanged by any of this: entering `returned` IS the second handover, so the code has
    // nothing left to do for either party.
    it('hides it from both once the garment is back', () => {
      [true, false].forEach(isCustomer => {
        const view = renderPanel({ processState: 'returned', isCustomer });
        expect(qr(view)).not.toBeInTheDocument();
        view.unmount();
      });
    });
  });
});
