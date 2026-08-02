import React from 'react';
import '@testing-library/jest-dom';

import { createCurrentUser } from '../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import { LaundryOpsPageComponent } from './LaundryOpsPage';

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
  scrollingDisabled: false,
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
      await userEvent.click(screen.getByText('LaundryOpsPage.table.open'));

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
      await userEvent.click(screen.getByText('LaundryOpsPage.table.open'));
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
      await userEvent.click(screen.getByText('LaundryOpsPage.table.open'));
      await userEvent.click(screen.getByText('LaundryOpsPage.action.returned'));

      expect(onAdvanceStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'returned' }));
    });

    it('offers the damage report only at the returned step', async () => {
      const onAdvanceStatus = jest.fn();
      render(
        <LaundryOpsPageComponent {...baseProps} tab="orders" onAdvanceStatus={onAdvanceStatus} />
      );
      await userEvent.click(screen.getByText('LaundryOpsPage.table.open'));

      const checkbox = screen.getByRole('checkbox');
      await userEvent.click(checkbox);
      await userEvent.type(screen.getByRole('textbox'), 'Small pull at left cuff.');
      await userEvent.click(screen.getByText('LaundryOpsPage.action.returned'));

      expect(onAdvanceStatus).toHaveBeenCalledWith({
        transactionId: 'tx-1',
        status: 'returned',
        damaged: true,
        damageNote: 'Small pull at left cuff.',
      });
    });

    it('does not offer a damage report at a non-returned step', async () => {
      const rows = [orderRow({ state: 'returned' })];
      render(<LaundryOpsPageComponent {...baseProps} orders={rows} tab="orders" />);
      await userEvent.click(screen.getByText('LaundryOpsPage.table.open'));

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('keeps confirm-return and start-cleaning as two separate actions', async () => {
      // The gap between them is the only window in which an operator can
      // cancel with a refund after a damage report, so a returned garment must
      // offer "start cleaning" as its own step - and warn that it pays out.
      const rows = [orderRow({ state: 'returned' })];
      render(<LaundryOpsPageComponent {...baseProps} orders={rows} tab="orders" />);
      await userEvent.click(screen.getByText('LaundryOpsPage.table.open'));

      expect(screen.getByText('LaundryOpsPage.action.pending-cleaning')).toBeInTheDocument();
      expect(screen.getByText('LaundryOpsPage.detail.payoutWarning')).toBeInTheDocument();
    });

    it('does not warn about payout on steps that do not pay out', async () => {
      render(<LaundryOpsPageComponent {...baseProps} tab="orders" />);
      await userEvent.click(screen.getByText('LaundryOpsPage.table.open'));

      expect(screen.queryByText('LaundryOpsPage.detail.payoutWarning')).not.toBeInTheDocument();
    });

    it('offers no advance action once the chain is finished', async () => {
      const rows = [orderRow({ state: 'delivered' })];
      render(<LaundryOpsPageComponent {...baseProps} orders={rows} tab="orders" />);
      await userEvent.click(screen.getByText('LaundryOpsPage.table.open'));

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
      await userEvent.click(screen.getByText('LaundryOpsPage.table.open'));

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

      const rented = screen.getByText('LaundryOpsPage.tile.currentlyRented').closest('div');
      expect(within(rented).getByText('2')).toBeInTheDocument();
      expect(screen.getByText('LaundryOpsPage.tile.damaged')).toBeInTheDocument();
    });

    it('lists damaged garments in the attention panel', () => {
      const rows = [orderRow({ damageReported: { flag: true, note: 'Small pull at left cuff.' } })];
      render(<LaundryOpsPageComponent {...baseProps} orders={rows} tab="dashboard" />);

      expect(screen.getByText('LaundryOpsPage.panel.attention')).toBeInTheDocument();
      expect(screen.getByText('Small pull at left cuff.')).toBeInTheDocument();
    });

    it('shows an empty state when nothing needs attention', () => {
      render(<LaundryOpsPageComponent {...baseProps} tab="dashboard" />);
      expect(screen.getByText('LaundryOpsPage.panel.attentionEmpty')).toBeInTheDocument();
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
