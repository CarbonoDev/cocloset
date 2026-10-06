import React from 'react';
import { Route } from 'react-router-dom';
import '@testing-library/jest-dom';

import { createCurrentUser } from '../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import { LaundryOpsPageComponent } from './LaundryOpsPage';
import css from './LaundryOpsPage.module.css';

const { screen, within, userEvent } = testingLibrary;

const noop = () => null;

const laundryUser = createCurrentUser('laundry', {
  profile: {
    displayName: 'Studio Pigalle',
    metadata: { isLaundry: true },
    publicData: { laundryProfile: { studioName: 'Studio Pigalle' } },
  },
});

const ordinaryUser = createCurrentUser('customer', {
  profile: { displayName: 'Jane Doe', metadata: {} },
});

const orderRow = (overrides = {}) => ({
  id: overrides.id || 'tx:tx-1',
  rowType: 'transaction',
  transactionId: 'tx-1',
  listingId: 'listing-1',
  ticketCode: 'PIG-2032',
  title: 'Draped jersey gown, crimson',
  brand: 'Norma Kamali',
  size: 'S / UK 8',
  imageUrl: null,
  customerName: 'Jane Doe',
  ownerName: 'Ana Rivera',
  currentRack: 'Rack B-03',
  bookingStart: null,
  bookingEnd: null,
  state: 'picked-up',
  cleaningPhase: null,
  readinessStatus: 'stored',
  damageReported: null,
  returnedLate: false,
  defaultCleaningDays: 3,
  ...overrides,
});

const baseProps = {
  currentUser: laundryUser,
  orders: [orderRow()],
  inventory: [],
  truncated: false,
  fetchOrdersInProgress: false,
  fetchOrdersError: null,
  advanceStatusTransactionId: null,
  advanceStatusError: null,
  onAdvanceStatus: noop,
  // Required by the confirm dialog's Modal, which calls it on mount whether or not it is open.
  onManageDisableScrolling: noop,
  scrollingDisabled: false,
};

// The confirm dialog renders through a portal, so its root has to exist. Clicking the trigger
// only ASKS - `onHandBackToOwner` fires from the dialog, which is the whole point of it.
const handBack = async () => {
  await userEvent.click(screen.getByText('HandBackToOwnerButton.trigger'));
  await userEvent.click(screen.getByText('HandBackToOwnerButton.confirm'));
};

describe('LaundryOpsPage', () => {
  describe('access gating', () => {
    it('renders the ops screen for a laundry user', () => {
      render(<LaundryOpsPageComponent {...baseProps} tab="orders" />);
      expect(screen.getByText('LaundryOpsPage.heading.orders')).toBeInTheDocument();
    });

    it('renders NotFoundPage for a non-laundry user', () => {
      render(<LaundryOpsPageComponent {...baseProps} currentUser={ordinaryUser} tab="orders" />);
      expect(screen.queryByText('LaundryOpsPage.heading.orders')).not.toBeInTheDocument();
    });

    it('renders nothing until currentUser has loaded', () => {
      const { container } = render(
        <LaundryOpsPageComponent {...baseProps} currentUser={null} tab="orders" />
      );
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('orders table', () => {
    it('shows the ticket, rack, people, garment and status for each row', () => {
      render(<LaundryOpsPageComponent {...baseProps} tab="orders" />);

      expect(screen.getByText('PIG-2032')).toBeInTheDocument();
      expect(screen.getByText('Rack B-03')).toBeInTheDocument();
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('Draped jersey gown, crimson')).toBeInTheDocument();
      expect(screen.getByText('Norma Kamali · S / UK 8')).toBeInTheDocument();
      expect(screen.getByText('LaundryOpsPage.status.picked-up')).toBeInTheDocument();
    });

    // ---------------------------------------------------------------------------
    //   > "podemos quitar el QR para los laundries? solamente un provider o un customer
    //   >  pueden ver el QR, laundry solo va a escanear"
    //
    // The studio must not be able to render a customer's code on its own screen: doing so
    // would let it advance a handover with nobody at the counter, which is the whole of what
    // the scan is supposed to attest. Asserted at the DOM level rather than by checking a
    // prop, because the failure that matters is a code appearing on this page at all -
    // through this component or any future one.
    // ---------------------------------------------------------------------------
    it('never renders a handover QR anywhere on the ops screens', async () => {
      const user = userEvent.setup();
      render(<LaundryOpsPageComponent {...baseProps} tab="orders" />);

      expect(
        screen.queryByRole('img', { name: 'HandoverQrCode.imageAlt' })
      ).not.toBeInTheDocument();
      expect(screen.queryByText('LaundryOpsPage.table.qr')).not.toBeInTheDocument();

      // Nor in the expanded detail panel, which used to carry a large one.
      await user.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));
      expect(
        screen.queryByRole('img', { name: 'HandoverQrCode.imageAlt' })
      ).not.toBeInTheDocument();
    });

    // ---------------------------------------------------------------------------
    //   > "podrías hacer que todo el row sea clickeable? solo el row, ya que al abrir, se
    //   >  abre el content de cada fila y no deberiamos poder dar click a toda esa area"
    //
    // Two halves of one rule, and the second is the one worth a test: the detail row is a
    // SIBLING of the summary row, not a child, so a handler placed on a wrapper around both -
    // the obvious way to write this - would collapse the panel the moment an operator clicked
    // into the cleaning-days box. Asserted through the panel's own contents rather than
    // through the handler, since the bug is a panel that closes, not a listener that fires.
    // ---------------------------------------------------------------------------
    it('toggles the detail from anywhere on the summary row, not just the label', async () => {
      const user = userEvent.setup();
      render(<LaundryOpsPageComponent {...baseProps} tab="orders" />);

      // A cell with no control in it - the garment's title.
      const cell = screen.getByText('Draped jersey gown, crimson').closest('td');

      await user.click(cell);
      expect(screen.getByText('LaundryOpsPage.detail.transactionId')).toBeInTheDocument();

      await user.click(cell);
      expect(screen.queryByText('LaundryOpsPage.detail.transactionId')).not.toBeInTheDocument();
    });

    it('does not close the detail when the operator clicks inside it', async () => {
      const user = userEvent.setup();
      // A row at the cleaning step: it is the one with a box to click into.
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          orders={[orderRow({ state: 'cleaning', cleaningPhase: 'pending-cleaning' })]}
          tab="orders"
        />
      );

      await user.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));
      await user.click(document.getElementById('LaundryOrderRow.cleaningDays.tx:tx-1'));

      expect(screen.getByText('LaundryOpsPage.detail.transactionId')).toBeInTheDocument();
    });

    // The label keeps working on its own terms. Without `stopPropagation` its click would
    // bubble to the row and toggle a second time, so the panel would never open.
    it('opens exactly once when the label itself is clicked', async () => {
      const user = userEvent.setup();
      render(<LaundryOpsPageComponent {...baseProps} tab="orders" />);

      await user.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));
      expect(screen.getByText('LaundryOpsPage.detail.transactionId')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.close' }));
      expect(screen.queryByText('LaundryOpsPage.detail.transactionId')).not.toBeInTheDocument();
    });

    // Jonathan, 2026-10-06: replace the "Open"/"Close" words with chevron icons. The words
    // still have to exist SOMEWHERE - aria-label, not visible text - or the control loses its
    // accessible name for anyone not reading it visually.
    it('shows a chevron icon instead of the words, and flips it with the row', async () => {
      const user = userEvent.setup();
      render(<LaundryOpsPageComponent {...baseProps} tab="orders" />);

      const toggle = screen.getByRole('button', { name: 'LaundryOpsPage.table.open' });
      expect(toggle.querySelector('svg')).toBeInTheDocument();
      expect(screen.queryByText('LaundryOpsPage.table.open')).not.toBeInTheDocument();
      expect(screen.queryByText('LaundryOpsPage.table.close')).not.toBeInTheDocument();

      await user.click(toggle);

      const closeToggle = screen.getByRole('button', { name: 'LaundryOpsPage.table.close' });
      expect(closeToggle.querySelector('svg')).toBeInTheDocument();
      expect(screen.queryByText('LaundryOpsPage.table.open')).not.toBeInTheDocument();
      expect(screen.queryByText('LaundryOpsPage.table.close')).not.toBeInTheDocument();
    });

    // ---------------------------------------------------------------------------
    //   > "handover/... está en etapa de recibir una prenda y puedo ingresar el numero de
    //   >  internal code, pero no es visible este input en laundry/orders"
    //
    // The endpoint has always ACCEPTED `laundryCode`; the phone page has always asked for it.
    // This table did not, so a reception done at a desk put the garment on a shelf with no
    // name and said nothing about it. The step is the one the server reads the code at
    // (`takesLaundryCode`), and offering it anywhere else would take an operator's input and
    // drop it - which is why the second test here is not redundant.
    // ---------------------------------------------------------------------------
    it('asks for the internal code at the reception step, and sends what was typed', async () => {
      const onAdvanceStatus = jest.fn();
      const user = userEvent.setup();
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          tab="orders"
          orders={[orderRow({ state: 'accepted' })]}
          onAdvanceStatus={onAdvanceStatus}
        />
      );

      await user.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));

      const input = document.getElementById('LaundryOrderRow.laundryCode.tx:tx-1');
      expect(input).toBeInTheDocument();

      await user.type(input, 'A-04 / BIN 7');
      await user.click(screen.getByText('LaundryOpsPage.action.garment-received'));

      expect(onAdvanceStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId: 'tx-1',
          // Reception, not "ready": the wash still has to happen. See laundryActionsFor.
          status: 'garment-received',
          laundryCode: 'A-04 / BIN 7',
        })
      );
    });

    it('pre-fills the code this studio already gave the garment', async () => {
      const user = userEvent.setup();
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          tab="orders"
          orders={[orderRow({ state: 'accepted', laundryCode: 'RACK 12' })]}
        />
      );

      await user.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));

      expect(document.getElementById('LaundryOrderRow.laundryCode.tx:tx-1')).toHaveValue('RACK 12');
    });

    //   > "1. Confirm return, donde solo se cambia de estado" (Jonathan, 2026-09-03)
    //
    // Confirming a return asks nothing. Both boxes belong to the next step, and a box here
    // would collect an answer the server no longer reads at this transition.
    it('asks nothing at the return step itself', async () => {
      const user = userEvent.setup();
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          tab="orders"
          orders={[orderRow({ state: 'picked-up' })]}
        />
      );

      await user.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));

      expect(document.getElementById('LaundryOrderRow.laundryCode.tx:tx-1')).toBeNull();
      expect(document.getElementById('LaundryOrderRow.cleaningDays.tx:tx-1')).toBeNull();
      // ...but the damage report is still here, which is the half that did NOT move.
      expect(screen.getByText('LaundryOpsPage.action.returned')).toBeInTheDocument();
    });

    //   > "se debe preguntar a la laundry los días que necesita para el lavado y que ingrese
    //   >  nuevamente el ticket, por si debe cambiarlo, el valor por default debe ser el
    //   >  ticket anterior"
    it('asks for the ticket when processing for cleaning, and the days at the next step', async () => {
      const user = userEvent.setup();
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          tab="orders"
          orders={[orderRow({ state: 'returned', laundryCode: 'A-04' })]}
        />
      );

      await user.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));

      // The days moved one step later (Jonathan, 2026-09-08) - "Process for Cleaning" is the
      // garment joining the queue, and the next button is the work starting.
      expect(
        document.getElementById('LaundryOrderRow.cleaningDays.tx:tx-1')
      ).not.toBeInTheDocument();
      const codeBox = document.getElementById('LaundryOrderRow.laundryCode.tx:tx-1');
      expect(codeBox).toBeInTheDocument();
      // Prefilled with the code the garment already carries: the common case is confirming
      // it, not retyping it.
      expect(codeBox).toHaveValue('A-04');
      expect(screen.getByText('LaundryOpsPage.action.pending-cleaning')).toBeInTheDocument();
    });

    it('asks for the days at the step that says the work has started', async () => {
      const user = userEvent.setup();
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          tab="orders"
          orders={[orderRow({ state: 'cleaning', cleaningPhase: 'pending-cleaning' })]}
        />
      );

      await user.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));

      expect(screen.getByText('LaundryOpsPage.action.cleaning-in-progress')).toBeInTheDocument();
      expect(document.getElementById('LaundryOrderRow.cleaningDays.tx:tx-1')).toBeInTheDocument();
    });

    // A blank box is "not decided yet", never a delete: sending an empty string would ask the
    // server to consider a code it must then treat as absent, and a studio that has not named a
    // garment yet must still be able to advance it.
    it('sends no code at all when the box is left empty', async () => {
      const onAdvanceStatus = jest.fn();
      const user = userEvent.setup();
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          tab="orders"
          orders={[orderRow({ state: 'accepted' })]}
          onAdvanceStatus={onAdvanceStatus}
        />
      );

      await user.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));
      await user.click(screen.getByText('LaundryOpsPage.action.garment-received'));

      expect(onAdvanceStatus).toHaveBeenCalledWith(
        expect.not.objectContaining({ laundryCode: expect.anything() })
      );
    });

    it('still shows the transaction id, which is what a broken scanner falls back to', async () => {
      const user = userEvent.setup();
      render(<LaundryOpsPageComponent {...baseProps} tab="orders" />);

      await user.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));
      expect(screen.getByText('LaundryOpsPage.detail.transactionId')).toBeInTheDocument();
    });

    it('pre-fills the cleaning-days box with the studio own turnaround', async () => {
      // At the cleaning step now, which is where the box lives.
      //   > "estos días deben tener un default de los días que indique la laundry, pero
      //   >  pueden modificarse al recibir"
      //
      // It used to start blank under "leave it blank to use your configured turnaround",
      // which asked the operator to accept a number they could not see.
      const user = userEvent.setup();
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          orders={[orderRow({ state: 'cleaning', cleaningPhase: 'pending-cleaning' })]}
          tab="orders"
        />
      );

      await user.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));
      const input = document.getElementById('LaundryOrderRow.cleaningDays.tx:tx-1');

      expect(input).toHaveValue(3);
    });

    // -------------------------------------------------------------------------
    //   > "debo poder ver el ticket que asigné a la prenda, no el ticket de la transaction en
    //   >  la columna TICKET (...) el ticket interno de la transaction se debe mostrar solo
    //   >  como fallback" (Jonathan, 2026-09-08)
    //
    // The column is what an operator reads to go and find a garment, and only one of the two
    // codes answers that.
    // -------------------------------------------------------------------------
    it('shows the studio own code in the ticket column', () => {
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          tab="orders"
          orders={[orderRow({ laundryCode: 'A-04', ticketCode: 'PIG-2032' })]}
        />
      );

      expect(screen.getByText('A-04')).toBeInTheDocument();
      expect(screen.queryByText('PIG-2032')).not.toBeInTheDocument();
    });

    it('falls back to the rental ticket for a garment nobody has named yet', () => {
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          tab="orders"
          orders={[orderRow({ laundryCode: null, ticketCode: 'PIG-2032' })]}
        />
      );

      expect(screen.getByText('PIG-2032')).toBeInTheDocument();
    });

    it('renders the filter tabs on the Orders screen only', () => {
      const { unmount } = render(<LaundryOpsPageComponent {...baseProps} tab="orders" />);
      expect(screen.getByText('LaundryOpsPage.tab.damaged')).toBeInTheDocument();
      unmount();

      render(<LaundryOpsPageComponent {...baseProps} tab="returns" />);
      expect(screen.queryByText('LaundryOpsPage.tab.damaged')).not.toBeInTheDocument();
    });

    it('filters rows when a tab is selected', async () => {
      const rows = [
        orderRow({ id: 'tx:1', transactionId: '1', ticketCode: 'KEEP-1', state: 'overdue' }),
        orderRow({ id: 'tx:2', transactionId: '2', ticketCode: 'DROP-1' }),
      ];
      render(<LaundryOpsPageComponent {...baseProps} orders={rows} tab="orders" />);

      expect(screen.getByText('DROP-1')).toBeInTheDocument();
      await userEvent.click(screen.getByText('LaundryOpsPage.tab.late-returns'));

      expect(screen.getByText('KEEP-1')).toBeInTheDocument();
      expect(screen.queryByText('DROP-1')).not.toBeInTheDocument();
    });

    it('filters rows by the search box', async () => {
      const rows = [
        orderRow({ id: 'tx:1', transactionId: '1', ticketCode: 'PIG-2032' }),
        orderRow({ id: 'tx:2', transactionId: '2', ticketCode: 'MAR-1188' }),
      ];
      render(<LaundryOpsPageComponent {...baseProps} orders={rows} tab="orders" />);

      await userEvent.type(
        screen.getByLabelText('LaundryOpsPage.table.searchPlaceholder'),
        'mar-11'
      );

      expect(screen.getByText('MAR-1188')).toBeInTheDocument();
      expect(screen.queryByText('PIG-2032')).not.toBeInTheDocument();
    });

    it('shows the Returns screen as a filtered variant of the same table', () => {
      const rows = [
        orderRow({
          id: 'tx:1',
          transactionId: '1',
          ticketCode: 'OUT-1',
          state: 'picked-up',
        }),
        orderRow({
          id: 'tx:2',
          transactionId: '2',
          ticketCode: 'CLEAN-1',
          state: 'cleaning',
          cleaningPhase: 'cleaning-in-progress',
        }),
      ];
      render(<LaundryOpsPageComponent {...baseProps} orders={rows} tab="returns" />);

      expect(screen.getByText('OUT-1')).toBeInTheDocument();
      expect(screen.queryByText('CLEAN-1')).not.toBeInTheDocument();
    });
  });

  describe('status advance', () => {
    it('offers only the action that is legal from the current state', async () => {
      render(<LaundryOpsPageComponent {...baseProps} tab="orders" />);
      await userEvent.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));

      // State is 'picked-up', so the only legal laundry move is confirming
      // the return.
      expect(screen.getByText('LaundryOpsPage.action.returned')).toBeInTheDocument();
      expect(
        screen.queryByText('LaundryOpsPage.action.available-for-booking')
      ).not.toBeInTheDocument();
    });

    it('calls onAdvanceStatus with the next status', async () => {
      const onAdvanceStatus = jest.fn();
      render(
        <LaundryOpsPageComponent {...baseProps} tab="orders" onAdvanceStatus={onAdvanceStatus} />
      );
      await userEvent.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));
      await userEvent.click(screen.getByText('LaundryOpsPage.action.returned'));

      expect(onAdvanceStatus).toHaveBeenCalledWith(
        expect.objectContaining({ transactionId: 'tx-1', status: 'returned', damaged: false })
      );
    });

    it('offers the same "confirm return" action for an overdue garment', async () => {
      // The two-way branch (laundry-confirm-return vs -return-late) is
      // resolved server-side; the client sends the same status either way.
      const onAdvanceStatus = jest.fn();
      const rows = [orderRow({ state: 'overdue' })];
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          orders={rows}
          tab="orders"
          onAdvanceStatus={onAdvanceStatus}
        />
      );
      await userEvent.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));
      await userEvent.click(screen.getByText('LaundryOpsPage.action.returned'));

      expect(onAdvanceStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'returned' }));
    });

    it('offers the damage report only at the returned step', async () => {
      const onAdvanceStatus = jest.fn();
      render(
        <LaundryOpsPageComponent {...baseProps} tab="orders" onAdvanceStatus={onAdvanceStatus} />
      );
      await userEvent.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));

      const checkbox = screen.getByRole('checkbox');
      await userEvent.click(checkbox);
      await userEvent.type(screen.getByRole('textbox'), 'Small pull at left cuff.');
      await userEvent.click(screen.getByText('LaundryOpsPage.action.returned'));

      // No cleaningDays: the return is one thing now, and the days are asked at the next
      // step. This is the assertion that would have caught them being collected here and
      // applied from there.
      expect(onAdvanceStatus).toHaveBeenCalledWith({
        transactionId: 'tx-1',
        status: 'returned',
        damaged: true,
        damageNote: 'Small pull at left cuff.',
      });
    });

    it('does not offer a damage report at a non-returned step', async () => {
      const rows = [orderRow({ state: 'cleaning', cleaningPhase: 'pending-cleaning' })];
      render(<LaundryOpsPageComponent {...baseProps} orders={rows} tab="orders" />);
      await userEvent.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    // How long cleaning will take, collected at the return step. It drives
    // listing.metadata.readyAt and the availability block that replaces the
    // estimate made at accept time.
    it('sends the cleaning-days estimate the laundry typed', async () => {
      const onAdvanceStatus = jest.fn();
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          orders={[orderRow({ state: 'cleaning', cleaningPhase: 'pending-cleaning' })]}
          tab="orders"
          onAdvanceStatus={onAdvanceStatus}
        />
      );
      await userEvent.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));
      // Cleared first: the box now arrives pre-filled with the studio's configured
      // turnaround, so typing into it would append rather than replace.
      await userEvent.clear(screen.getByRole('spinbutton'));
      await userEvent.type(screen.getByRole('spinbutton'), '5');
      await userEvent.click(screen.getByText('LaundryOpsPage.action.cleaning-in-progress'));

      expect(onAdvanceStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'cleaning-in-progress', cleaningDays: 5 })
      );
    });

    it('sends NO cleaning-days when the operator clears the field', async () => {
      // Absent means "apply the turnaround this studio configured for the category", which
      // only the server can resolve. Sending 0 instead would mean "ready today" and would
      // block nothing at all. The box now arrives pre-filled, so reaching this state takes a
      // deliberate clear - which is the honest version of the old "leave it blank".
      const onAdvanceStatus = jest.fn();
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          orders={[orderRow({ state: 'cleaning', cleaningPhase: 'pending-cleaning' })]}
          tab="orders"
          onAdvanceStatus={onAdvanceStatus}
        />
      );
      await userEvent.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));
      await userEvent.clear(screen.getByRole('spinbutton'));
      await userEvent.click(screen.getByText('LaundryOpsPage.action.cleaning-in-progress'));

      expect(onAdvanceStatus.mock.calls[0][0]).not.toHaveProperty('cleaningDays');
    });

    it('sends an explicit 0 - "ready today" is a real answer', async () => {
      const onAdvanceStatus = jest.fn();
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          orders={[orderRow({ state: 'cleaning', cleaningPhase: 'pending-cleaning' })]}
          tab="orders"
          onAdvanceStatus={onAdvanceStatus}
        />
      );
      await userEvent.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));
      await userEvent.clear(screen.getByRole('spinbutton'));
      await userEvent.type(screen.getByRole('spinbutton'), '0');
      await userEvent.click(screen.getByText('LaundryOpsPage.action.cleaning-in-progress'));

      expect(onAdvanceStatus).toHaveBeenCalledWith(expect.objectContaining({ cleaningDays: 0 }));
    });

    it('does not offer the cleaning-days field outside the cleaning step', async () => {
      const rows = [orderRow({ state: 'accepted' })];
      render(<LaundryOpsPageComponent {...baseProps} orders={rows} tab="orders" />);
      await userEvent.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));

      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    });

    it('keeps confirm-return and start-cleaning as two separate actions', async () => {
      // The gap between them is the only window in which an operator can
      // cancel with a refund after a damage report, so a returned garment must
      // offer "start cleaning" as its own step - and warn that it pays out.
      const rows = [orderRow({ state: 'returned' })];
      render(<LaundryOpsPageComponent {...baseProps} orders={rows} tab="orders" />);
      await userEvent.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));

      expect(screen.getByText('LaundryOpsPage.action.pending-cleaning')).toBeInTheDocument();
      expect(screen.getByText('LaundryOpsPage.detail.payoutWarning')).toBeInTheDocument();
    });

    it('does not warn about payout on steps that do not pay out', async () => {
      render(<LaundryOpsPageComponent {...baseProps} tab="orders" />);
      await userEvent.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));

      expect(screen.queryByText('LaundryOpsPage.detail.payoutWarning')).not.toBeInTheDocument();
    });

    it('offers no advance action once the chain is finished', async () => {
      const rows = [orderRow({ state: 'delivered' })];
      render(<LaundryOpsPageComponent {...baseProps} orders={rows} tab="orders" />);
      await userEvent.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));

      expect(screen.getByText('LaundryOpsPage.detail.noAdvance')).toBeInTheDocument();
      expect(screen.queryByText('LaundryOpsPage.action.returned')).not.toBeInTheDocument();
    });

    it('offers no advance action for a listing-only row', async () => {
      const rows = [
        orderRow({
          id: 'listing:listing-1',
          rowType: 'listing',
          transactionId: null,
          ticketCode: null,
          state: null,
        }),
      ];
      render(<LaundryOpsPageComponent {...baseProps} orders={rows} tab="orders" />);
      await userEvent.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));

      expect(screen.getByText('LaundryOpsPage.detail.noAdvance')).toBeInTheDocument();
    });
  });

  describe('dashboard', () => {
    it('renders a tile for every stat with its count', () => {
      const rows = [
        orderRow({ id: 'tx:1', transactionId: '1', state: 'ready-for-pickup' }),
        orderRow({ id: 'tx:2', transactionId: '2', state: 'picked-up' }),
        orderRow({ id: 'tx:3', transactionId: '3', state: 'picked-up' }),
      ];
      render(<LaundryOpsPageComponent {...baseProps} orders={rows} tab="dashboard" />);

      const rented = screen.getByText('LaundryOpsPage.tile.outWithRenters').closest('a');
      expect(within(rented).getByText('2')).toBeInTheDocument();
      expect(screen.getByText('LaundryOpsPage.tile.flaggedForReview')).toBeInTheDocument();
    });

    it('makes each stat tile a link into its section', () => {
      render(<LaundryOpsPageComponent {...baseProps} tab="dashboard" />);

      expect(
        screen.getByText('LaundryOpsPage.tile.pendingPickups48h').closest('a')
      ).toHaveAttribute('href', '/laundry/pickups');
      expect(screen.getByText('LaundryOpsPage.tile.rentalOrders').closest('a')).toHaveAttribute(
        'href',
        '/laundry/orders'
      );
      expect(screen.getByText('LaundryOpsPage.tile.rentalInventory').closest('a')).toHaveAttribute(
        'href',
        '/laundry/inventory'
      );
    });

    it('shows exactly 8 cards - the 7 stat tiles plus the ticket lookup', () => {
      render(<LaundryOpsPageComponent {...baseProps} tab="dashboard" />);

      expect(document.querySelectorAll(`.${css.tile}`)).toHaveLength(8);
    });

    it('looking up a ticket navigates to the Orders screen with it as the search term', async () => {
      const user = userEvent.setup();
      render(
        <>
          <LaundryOpsPageComponent {...baseProps} tab="dashboard" />
          {/* Location probe: LaundryOpsPageComponent doesn't derive `tab` from the
              URL itself (routeConfiguration.js does that in the real app), so this
              is how the test observes where the ticket lookup form navigated to. */}
          <Route
            path="*"
            render={({ location }) => (
              <div data-testid="location">{`${location.pathname}${location.search}`}</div>
            )}
          />
        </>
      );

      await user.type(
        screen.getByPlaceholderText('LaundryOpsPage.ticketLookup.placeholder'),
        'PIG-2032'
      );
      await user.click(screen.getByText('LaundryOpsPage.ticketLookup.submit'));

      expect(screen.getByTestId('location')).toHaveTextContent('/laundry/orders?search=PIG-2032');
    });
  });

  describe('inventory', () => {
    it('renders one card per garment with rack and status', () => {
      const inventory = [
        {
          id: 'listing:1',
          listingId: '1',
          title: 'Camel hair wrap coat',
          currentRack: 'Rack C-07',
          readinessStatus: 'stored',
          state: null,
          cleaningPhase: null,
          imageUrl: null,
        },
      ];
      render(<LaundryOpsPageComponent {...baseProps} inventory={inventory} tab="inventory" />);

      expect(screen.getByText('Camel hair wrap coat')).toBeInTheDocument();
      expect(screen.getByText('Rack C-07')).toBeInTheDocument();
      expect(screen.getByText('LaundryOpsPage.readiness.stored')).toBeInTheDocument();
    });

    it("shows the studio's own code for the garment, not the rental's ticket", () => {
      //   > "hay que mostrar el ticket que se haya ingresado internamente, no el
      //   >  ticket de la transacción" (Jonathan, 2026-09-03)
      //
      // The two are different labels for different things: `ticketCode` belongs
      // to a rental, `laundryCode` is where the garment is on this studio's
      // shelving - which is the question this screen exists to answer.
      const inventory = [
        {
          id: 'listing:1',
          listingId: '1',
          title: 'Camel hair wrap coat',
          currentRack: 'Rack C-07',
          readinessStatus: 'stored',
          laundryCode: 'A-04',
          ticketCode: 'PIG-2032',
          state: null,
          cleaningPhase: null,
          imageUrl: null,
        },
      ];
      render(<LaundryOpsPageComponent {...baseProps} inventory={inventory} tab="inventory" />);

      expect(screen.getByText('#A-04')).toBeInTheDocument();
      expect(screen.queryByText('#PIG-2032')).not.toBeInTheDocument();
    });

    it('shows the code on a garment back in stock, which is when it is needed most', () => {
      // The old condition hid it on `delivered` - the garment sitting on the
      // rack waiting to be found again.
      const inventory = [
        {
          id: 'listing:2',
          listingId: '2',
          title: 'Silk slip dress',
          currentRack: null,
          readinessStatus: 'available',
          laundryCode: 'B-11',
          state: 'delivered',
          cleaningPhase: null,
          imageUrl: null,
        },
      ];
      render(<LaundryOpsPageComponent {...baseProps} inventory={inventory} tab="inventory" />);

      expect(screen.getByText('#B-11')).toBeInTheDocument();
    });

    // ---------------------------------------------------------------------------
    //   > "no hay ninguna manera en que un provider pueda recoger la prenda y se pueda
    //   >  cambiar ese status (...) laundry siempre tiene que estar ahi para recolectar la
    //   >  prenda" (Jonathan, 2026-09-07)
    //
    // The endpoint and its authorization already existed; NOTHING CALLED THEM, which is
    // indistinguishable from a missing feature and is what the client reported. These pin
    // the wiring, which is the half that was missing.
    // ---------------------------------------------------------------------------
    it('offers to hand a garment back once it is on the rack with no rental', async () => {
      const onHandBackToOwner = jest.fn();
      const inventory = [
        {
          id: 'listing:1',
          listingId: 'listing-1',
          title: 'Camel hair wrap coat',
          onLaundry: true,
          readinessStatus: 'available',
          state: null,
          cleaningPhase: null,
          imageUrl: null,
        },
      ];
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          inventory={inventory}
          tab="inventory"
          onHandBackToOwner={onHandBackToOwner}
        />,
        { withPortals: true }
      );

      await handBack();

      expect(onHandBackToOwner).toHaveBeenCalledWith({ listingId: 'listing-1' });
    });

    // ---------------------------------------------------------------------------
    //   > "el botón para devolver la prenda en el lado de laundry debe aparecer en order,
    //   >  handover o inventory"
    //   > "si la transacción aparece como cancelada tambien puedo devolver la prenda"
    //   >   (Jonathan, 2026-09-07)
    //
    // Both halves of what the client reported. The button was gated on the garment having NO
    // transaction at all, so a cancelled rental hid it - and it existed on one screen out of
    // the three where a studio does this work.
    // ---------------------------------------------------------------------------
    it('offers it when the rental was cancelled', async () => {
      const onHandBackToOwner = jest.fn();
      const inventory = [
        {
          id: 'listing:1',
          listingId: 'listing-1',
          title: 'Camel hair wrap coat',
          onLaundry: true,
          readinessStatus: 'available',
          state: 'canceled',
          cleaningPhase: null,
          imageUrl: null,
        },
      ];
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          inventory={inventory}
          tab="inventory"
          onHandBackToOwner={onHandBackToOwner}
        />,
        { withPortals: true }
      );

      await handBack();

      expect(onHandBackToOwner).toHaveBeenCalledWith({ listingId: 'listing-1' });
    });

    it('offers it from the orders worklist too, on the row that was cancelled', async () => {
      // The screen a studio is looking at when it reads that a rental was cancelled. Sending
      // it to another tab to release the garment is the trip this removes.
      const onHandBackToOwner = jest.fn();
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          orders={[orderRow({ state: 'canceled', onLaundry: true })]}
          tab="orders"
          onHandBackToOwner={onHandBackToOwner}
        />,
        { withPortals: true }
      );

      await userEvent.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));
      await handBack();

      expect(onHandBackToOwner).toHaveBeenCalledWith({ listingId: 'listing-1' });
    });

    it('does not offer it on a worklist row whose rental is still running', async () => {
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          orders={[orderRow({ state: 'cleaning', onLaundry: true })]}
          tab="orders"
          onHandBackToOwner={jest.fn()}
        />
      );

      await userEvent.click(screen.getByRole('button', { name: 'LaundryOpsPage.table.open' }));

      expect(screen.queryByText('HandBackToOwnerButton.trigger')).not.toBeInTheDocument();
    });

    it('does not offer it on a garment that is out on a rental', () => {
      // The server refuses with 409 anyway - `cleaning` counts as an active transaction and
      // `delivered` does not, which is what enforces "una vez que finalice la limpieza" -
      // but a button that is going to be refused is its own kind of wrong.
      const inventory = [
        {
          id: 'listing:1',
          listingId: 'listing-1',
          title: 'Camel hair wrap coat',
          onLaundry: true,
          readinessStatus: 'stored',
          state: 'picked-up',
          cleaningPhase: null,
          imageUrl: null,
        },
      ];
      render(<LaundryOpsPageComponent {...baseProps} inventory={inventory} tab="inventory" />);

      expect(screen.queryByText('HandBackToOwnerButton.trigger')).not.toBeInTheDocument();
    });

    it('does not offer it on a garment the studio is not holding', () => {
      const inventory = [
        {
          id: 'listing:2',
          listingId: 'listing-2',
          title: 'Silk slip dress',
          onLaundry: false,
          readinessStatus: 'available',
          state: null,
          cleaningPhase: null,
          imageUrl: null,
        },
      ];
      render(<LaundryOpsPageComponent {...baseProps} inventory={inventory} tab="inventory" />);

      expect(screen.queryByText('HandBackToOwnerButton.trigger')).not.toBeInTheDocument();
    });

    it('explains a 409 as an active rental rather than as a generic failure', () => {
      // The one refusal an operator will actually hit. A generic error there reads as a
      // broken button.
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          inventory={[{ id: 'listing:1', listingId: 'listing-1', title: 'Coat' }]}
          tab="inventory"
          handBackError={{ status: 409 }}
        />
      );

      expect(screen.getByText('LaundryOpsPage.inventory.handBackActiveRental')).toBeInTheDocument();
    });

    it('shows an empty state with no garments', () => {
      render(<LaundryOpsPageComponent {...baseProps} inventory={[]} tab="inventory" />);
      expect(screen.getByText('LaundryOpsPage.inventory.empty')).toBeInTheDocument();
    });
  });

  describe('loading and error states', () => {
    it('surfaces a fetch error', () => {
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          orders={[]}
          fetchOrdersError={{ type: 'error' }}
          tab="orders"
        />
      );
      expect(screen.getByText('LaundryOpsPage.fetchFailed')).toBeInTheDocument();
    });

    it('surfaces an advance-status error', () => {
      render(
        <LaundryOpsPageComponent
          {...baseProps}
          advanceStatusError={{ type: 'error' }}
          tab="orders"
        />
      );
      expect(screen.getByText('LaundryOpsPage.advanceFailed')).toBeInTheDocument();
    });

    it('warns when the endpoint truncated the result', () => {
      render(<LaundryOpsPageComponent {...baseProps} truncated tab="orders" />);
      expect(screen.getByText('LaundryOpsPage.truncated')).toBeInTheDocument();
    });
  });

  describe('navigation', () => {
    it('links Settings to the existing LaundryProfilePage rather than duplicating it', () => {
      render(<LaundryOpsPageComponent {...baseProps} tab="orders" />);
      const settings = screen.getByText('LaundryOpsPage.nav.settings').closest('a');
      expect(settings).toHaveAttribute('href', '/laundry-profile');
    });

    it('links to each ops screen', () => {
      render(<LaundryOpsPageComponent {...baseProps} tab="orders" />);
      expect(screen.getByText('LaundryOpsPage.nav.dashboard').closest('a')).toHaveAttribute(
        'href',
        '/laundry/dashboard'
      );
      expect(screen.getByText('LaundryOpsPage.nav.inventory').closest('a')).toHaveAttribute(
        'href',
        '/laundry/inventory'
      );
    });
  });
});
