import React from 'react';
import '@testing-library/jest-dom';
import Decimal from 'decimal.js';

import { types as sdkTypes } from '../../util/sdkLoader';
import {
  LINE_ITEM_DAY,
  LINE_ITEM_HOUR,
  LINE_ITEM_ITEM,
  LINE_ITEM_NIGHT,
  LINE_ITEM_PROVIDER_COMMISSION,
} from '../../util/types';
import {
  createUser,
  createCurrentUser,
  createListing,
  fakeIntl,
  createTransaction,
  createBooking,
} from '../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import {
  TX_TRANSITION_ACTOR_CUSTOMER,
  TX_TRANSITION_ACTOR_PROVIDER,
  getProcess,
} from '../../transactions/transaction';

import { getStateData } from './InboxPage.stateData';
import InboxPage, { InboxItem, InboxPageComponent } from './InboxPage';

const { Money } = sdkTypes;
const { screen, waitFor, within } = testingLibrary;
const noop = () => null;

const bookingTransitions = getProcess('default-booking')?.transitions;
const purchaseTransitions = getProcess('default-purchase')?.transitions;
const inquiryTransitions = getProcess('default-inquiry')?.transitions;

// ---------------------------------------------------------------------------
//   > "Puedes agregar el total de earnings visible solo para el provider por sus transacciones
//   >  completadas"
//
// "Solo para el provider" is guarded twice: this block renders only on the sales tab, and the
// number comes from a query the API scopes to the caller's own sales. These pin the first
// guard - the second one cannot be tested from here, which is rather the point of it.
// ---------------------------------------------------------------------------
describe("InboxPage: the owner's earnings", () => {
  const earnings = { amount: 12500, currency: 'USD', count: 3, skippedCount: 0, truncated: false };

  const renderInbox = (props = {}) =>
    render(
      <InboxPageComponent
        params={{ tab: 'sales' }}
        currentUser={createCurrentUser('me')}
        fetchInProgress={false}
        fetchOrdersOrSalesError={null}
        pagination={null}
        transactions={[]}
        scrollingDisabled={false}
        providerEarnings={earnings}
        intl={fakeIntl}
        {...props}
      />
    );

  const label = () => screen.queryByText('InboxPage.earningsLabel');

  it('shows the total on the sales tab', () => {
    renderInbox();

    expect(label()).toBeInTheDocument();
    expect(screen.getByText('$125.00')).toBeInTheDocument();
  });

  // The orders tab is the same page with a different tab param, and it is the customer's view
  // of their own rentals. An earnings figure there would be somebody else's business.
  it('shows nothing on the orders tab', () => {
    renderInbox({ params: { tab: 'orders' } });

    expect(label()).not.toBeInTheDocument();
  });

  // A new owner is better served by a tab that looks like a tab than by a large confident
  // $0.00, and a walk that failed has no business inventing a number. Both are "render
  // nothing".
  it('shows nothing before there is anything to show', () => {
    [null, { ...earnings, count: 0, amount: 0 }, { ...earnings, currency: null }].forEach(
      providerEarnings => {
        const view = renderInbox({ providerEarnings });
        expect(label()).not.toBeInTheDocument();
        view.unmount();
      }
    );
  });

  // An owner whose sales did not all fit in the walk, or who has been paid in a second
  // currency, is told the total is partial rather than shown a smaller number with no
  // explanation.
  it('says so when the total is only part of the story', () => {
    const view = renderInbox({ providerEarnings: { ...earnings, truncated: true } });
    expect(screen.getByText('InboxPage.earningsPartial')).toBeInTheDocument();
    view.unmount();

    renderInbox({ providerEarnings: { ...earnings, skippedCount: 2 } });
    expect(screen.getByText('InboxPage.earningsPartial')).toBeInTheDocument();
  });

  it('does not cry partial when nothing was left out', () => {
    renderInbox();

    expect(screen.queryByText('InboxPage.earningsPartial')).not.toBeInTheDocument();
  });
});

describe('InboxPage', () => {
  const provider = createUser('provider');
  const customer = createUser('customer');
  const listing = createListing('listing1', {
    publicData: {
      listingType: 'sell-bikes',
      transactionProcessAlias: 'default-purchase',
      unitType: 'item',
    },
  });
  const booking = createBooking('booking1', {
    start: new Date(Date.UTC(2023, 5, 14)),
    end: new Date(Date.UTC(2023, 5, 16)),
  });
  const lineItemUnitTypeItem = {
    code: LINE_ITEM_ITEM,
    includeFor: ['customer', 'provider'],
    quantity: new Decimal(1),
    unitPrice: new Money(1000, 'USD'),
    lineTotal: new Money(1000, 'USD'),
    reversal: false,
  };
  const lineItemProviderCommission = {
    code: LINE_ITEM_PROVIDER_COMMISSION,
    includeFor: ['provider'],
    unitPrice: new Money(100 * -1, 'USD'),
    lineTotal: new Money(100 * -1, 'USD'),
    reversal: false,
  };

  const lineItems = [lineItemUnitTypeItem, lineItemProviderCommission];

  describe('with initial state in store', () => {
    const currentUserProvider = createCurrentUser('provider-user-id');
    const currentUserCustomer = createCurrentUser('customer-user-id');

    // ORDERS
    it('has tabs and inbox items for orders on InboxPage', async () => {
      const order1 = createTransaction({
        id: 'order1',
        lastTransition: purchaseTransitions.CONFIRM_PAYMENT,
        customer,
        provider,
        listing,
        lastTransitionedAt: new Date(Date.UTC(2023, 0, 15)),
        lineItems,
        availabilityType: 'oneSeat',
      });
      const order2 = createTransaction({
        id: 'order2',
        lastTransition: bookingTransitions.CONFIRM_PAYMENT,
        customer,
        provider,
        listing,
        booking,
        lastTransitionedAt: new Date(Date.UTC(2022, 0, 15)),
        lineItems,
        availabilityType: 'oneSeat',
      });

      // We'll initialize the store with relevant data for Inbox
      const initialState = {
        InboxPage: {
          fetchInProgress: false,
          fetchOrdersOrSalesError: null,
          pagination: {
            page: 1,
            perPage: 1,
            totalItems: 2,
            totalPages: 2,
          },
          transactionRefs: [
            { id: order1.id, type: order1.type },
            { id: order2.id, type: order2.type },
          ],
        },
        marketplaceData: {
          entities: {
            booking: {
              booking1: booking,
            },
            transaction: {
              order1,
              order2,
            },
            user: {
              customer,
              provider,
            },
            listing: {
              listing1: listing,
            },
          },
        },
        user: {
          currentUser: currentUserProvider,
          currentUserHasListings: false,
          sendVerificationEmailInProgress: false,
        },
      };

      const ordersProps = {
        params: {
          tab: 'orders',
        },
        scrollingDisabled: false,
        onManageDisableScrolling: noop,
        sendVerificationEmailInProgress: false,
        onResendVerificationEmail: noop,
      };

      render(<InboxPage {...ordersProps} />, {
        initialState,
      });

      await waitFor(() => {
        // Has links to orders tab
        const ordersTabTitle = screen.getByRole('link', { name: 'InboxPage.ordersTabTitle' });
        expect(ordersTabTitle).toBeInTheDocument();
        expect(ordersTabTitle.getAttribute('href')).toContain('/inbox/orders');

        // Has links to sales tab
        const salesTabTitle = screen.getByRole('link', { name: 'InboxPage.salesTabTitle' });
        expect(salesTabTitle).toBeInTheDocument();
        expect(salesTabTitle.getAttribute('href')).toContain('/inbox/sales');

        // Has 2 items. BUTTONS, not links, and that is the redesign: selecting a rental
        // opens the detail beside this list rather than navigating away from it
        // ("al seleccionar uno, abre el detalle de la transacción sin ocultar el listado").
        // The route to the page that can ACT on a rental now lives in that panel - see the
        // note at the top of InboxTransactionPanel.js for why it had to be given back.
        const items = screen.queryAllByRole('button', { name: /listing1/i });
        expect(items).toHaveLength(2);

        const item1 = items[0];
        const status1 = within(item1).getByText('InboxPage.default-purchase.purchased.status');
        expect(status1).toBeInTheDocument();

        const item2 = items[1];
        const status2 = within(item2).getByText('InboxPage.default-purchase.purchased.status');
        expect(status2).toBeInTheDocument();

        // Nothing is open yet, so the reader is told what to do rather than shown a blank
        // column.
        expect(screen.getByText('InboxPage.selectATransaction')).toBeInTheDocument();
      });
    });

    // SALES
    it('has tabs and inbox items for sales on InboxPage', async () => {
      const sale1 = createTransaction({
        id: 'sale1',
        lastTransition: purchaseTransitions.CONFIRM_PAYMENT,
        customer,
        provider,
        listing,
        lastTransitionedAt: new Date(Date.UTC(2023, 0, 15)),
        lineItems,
      });
      const sale2 = createTransaction({
        id: 'sale2',
        lastTransition: bookingTransitions.CONFIRM_PAYMENT,
        customer,
        provider,
        listing,
        booking,
        lastTransitionedAt: new Date(Date.UTC(2022, 0, 15)),
        lineItems,
      });
      // We'll initialize the store with relevant data for Inbox
      const initialState = {
        InboxPage: {
          fetchInProgress: false,
          fetchOrdersOrSalesError: null,
          pagination: {
            page: 1,
            perPage: 1,
            totalItems: 2,
            totalPages: 2,
          },
          transactionRefs: [{ id: sale1.id, type: sale1.type }, { id: sale2.id, type: sale2.type }],
        },
        marketplaceData: {
          entities: {
            transaction: {
              sale1,
              sale2,
            },
            user: {
              customer,
              provider,
            },
            listing: {
              listing1: listing,
            },
          },
        },
        user: {
          currentUser: currentUserCustomer,
          currentUserHasListings: false,
          sendVerificationEmailInProgress: false,
        },
      };

      const salesProps = {
        params: {
          tab: 'sales',
        },
        scrollingDisabled: false,
        onManageDisableScrolling: noop,
        sendVerificationEmailInProgress: false,
        onResendVerificationEmail: noop,
      };

      render(<InboxPage {...salesProps} />, {
        initialState,
      });

      await waitFor(() => {
        // Has links to orders tab
        const ordersTabTitle = screen.getByRole('link', { name: 'InboxPage.ordersTabTitle' });
        expect(ordersTabTitle).toBeInTheDocument();
        expect(ordersTabTitle.getAttribute('href')).toContain('/inbox/orders');

        // Has links to sales tab
        const salesTabTitle = screen.getByRole('link', { name: 'InboxPage.salesTabTitle' });
        expect(salesTabTitle).toBeInTheDocument();
        expect(salesTabTitle.getAttribute('href')).toContain('/inbox/sales');

        // Has 2 items
        // Buttons, not links - see the note on the orders case above.
        const items = screen.queryAllByRole('button', { name: /listing1/i });
        expect(items).toHaveLength(2);

        const item1 = items[0];
        const status1 = within(item1).getByText('InboxPage.default-purchase.purchased.status');
        expect(status1).toBeInTheDocument();

        const item2 = items[1];
        const status2 = within(item2).getByText('InboxPage.default-purchase.purchased.status');
        expect(status2).toBeInTheDocument();
      });
    });
  });

  describe('InboxItem: default-inquiry process with "inquiry" item', () => {
    const listingInquiryItem = createListing('listing1', {
      publicData: {
        listingType: 'inquire-bikes',
        transactionProcessAlias: 'default-inquiry',
        unitType: 'inquiry',
      },
    });

    const inquiries = Object.keys(inquiryTransitions).map(trKey => {
      const lineItemsMaybe = trKey !== 'INQUIRE_WITHOUT_PAYMENT' ? lineItems : [];
      return {
        tr: inquiryTransitions[trKey],
        tx: createTransaction({
          id: `id-inquiry-${trKey}-sale`,
          customer,
          provider,
          listing: listingInquiryItem,
          processName: 'default-inquiry',
          lastTransition: inquiryTransitions[trKey],
          lastTransitionedAt: new Date(Date.UTC(2022, 0, 15)),
          lineItems: lineItemsMaybe,
        }),
      };
    });

    test.each(inquiries)('check inquiry: $tr', ({ tr, tx }) => {
      const transactionRole = TX_TRANSITION_ACTOR_PROVIDER;
      const stateDataOrder = getStateData({
        transaction: tx,
        transactionRole,
      });

      const tree = render(
        <InboxItem
          tx={tx}
          transactionRole={transactionRole}
          intl={fakeIntl}
          stateData={stateDataOrder}
          isBooking={false}
          isPurchase={false}
        />
      );
      expect(tree.asFragment().firstChild).toMatchSnapshot();
      const quantityFound = screen.queryAllByText('InboxPage.quantity');
      expect(quantityFound).toHaveLength(0);
    });
  });

  describe('InboxItem: default-purchase process with "item"', () => {
    const listingItem = createListing('listing1', {
      publicData: {
        listingType: 'sell-bikes',
        transactionProcessAlias: 'default-purchase',
        unitType: 'item',
      },
    });

    const purchases = Object.keys(purchaseTransitions).map(trKey => {
      const lineItemsMaybe = trKey !== 'INQUIRE' ? lineItems : [];
      return {
        tr: purchaseTransitions[trKey],
        tx: createTransaction({
          id: `id-purchase-${trKey}-sale`,
          customer,
          provider,
          listing: listingItem,
          processName: 'default-purchase',
          lastTransition: purchaseTransitions[trKey],
          lastTransitionedAt: new Date(Date.UTC(2022, 0, 15)),
          lineItems: lineItemsMaybe,
        }),
      };
    });

    test.each(purchases)('check purchase: $tr', ({ tr, tx }) => {
      const transactionRole = TX_TRANSITION_ACTOR_PROVIDER;
      const stateDataOrder = getStateData({
        transaction: tx,
        transactionRole,
      });

      const tree = render(
        <InboxItem
          tx={tx}
          transactionRole={transactionRole}
          intl={fakeIntl}
          stateData={stateDataOrder}
          isBooking={false}
          isPurchase={true}
          stockType="multipleItems"
        />
      );
      expect(tree.asFragment().firstChild).toMatchSnapshot();
      const quantityFound = screen.queryAllByText('InboxPage.quantity');
      const expected = tr !== 'transition/inquire' ? 1 : 0;
      expect(quantityFound).toHaveLength(expected);
    });

    // This is quite small component what comes to rendered HTML
    // For now, we rely on snapshot-testing and checking quantity.
    it('InboxItem with stockType "oneItem" matches snapshot of purchase sale', () => {
      const sale = createTransaction({
        id: 'oneItem-sale',
        lastTransition: bookingTransitions.CONFIRM_PAYMENT,
        customer,
        provider,
        listing,
        booking,
        lastTransitionedAt: new Date(Date.UTC(2022, 0, 15)),
        lineItems,
      });

      const stateDataOrder = getStateData({
        transaction: sale,
        transactionRole: TX_TRANSITION_ACTOR_PROVIDER,
      });

      const tree = render(
        <InboxItem
          tx={sale}
          transactionRole={TX_TRANSITION_ACTOR_PROVIDER}
          intl={fakeIntl}
          stateData={stateDataOrder}
          isBooking={false}
          isPurchase={true}
          stockType="oneItem"
        />
      );
      expect(tree.asFragment().firstChild).toMatchSnapshot();
      expect(screen.queryByText('InboxPage.quantity')).not.toBeInTheDocument();
    });
  });

  describe('InboxItem: default-booking process with "day"', () => {
    const listingDay = createListing('listing-day', {
      publicData: {
        listingType: 'rent-bikes',
        transactionProcessAlias: 'default-booking',
        unitType: 'day',
      },
    });
    const lineItemUnitTypeDay = {
      code: LINE_ITEM_DAY,
      includeFor: ['customer', 'provider'],
      quantity: new Decimal(1), // 1 day
      unitPrice: new Money(1000, 'USD'),
      lineTotal: new Money(1000, 'USD'),
      reversal: false,
    };

    const bookings = Object.keys(bookingTransitions).map(trKey => {
      const lineItemsMaybe =
        trKey !== 'INQUIRE' ? [lineItemUnitTypeDay, lineItemProviderCommission] : [];
      return {
        tr: bookingTransitions[trKey],
        tx: createTransaction({
          id: `id-booking-${trKey}-sale`,
          customer,
          provider,
          listing: listingDay,
          booking: createBooking('booking-id', {
            start: new Date(Date.UTC(2022, 5, 14)),
            end: new Date(Date.UTC(2022, 5, 15)),
          }),
          processName: 'default-booking',
          lastTransition: bookingTransitions[trKey],
          lastTransitionedAt: new Date(Date.UTC(2022, 0, 15)),
          lineItems: lineItemsMaybe,
        }),
      };
    });

    test.each(bookings)('check booking: $tr', ({ tr, tx }) => {
      const transactionRole = TX_TRANSITION_ACTOR_PROVIDER;
      const stateDataBooking = getStateData({
        transaction: tx,
        transactionRole,
      });

      const tree = render(
        <InboxItem
          tx={tx}
          transactionRole={transactionRole}
          intl={fakeIntl}
          stateData={stateDataBooking}
          isBooking={true}
          isPurchase={false}
        />
      );
      expect(tree.asFragment().firstChild).toMatchSnapshot();

      const quantityFound = screen.queryAllByText('Jun 14, 2022');
      const expected = tr !== 'transition/inquire' ? 1 : 0;
      expect(quantityFound).toHaveLength(expected);
    });
  });

  describe('InboxItem: default-booking process with "night"', () => {
    const listingNight = createListing('listing-night', {
      publicData: {
        listingType: 'rent-bikes',
        transactionProcessAlias: 'default-booking',
        unitType: 'night',
      },
    });

    const lineItemUnitTypeNight = {
      code: LINE_ITEM_NIGHT,
      includeFor: ['customer', 'provider'],
      quantity: new Decimal(2), // 2 nights
      unitPrice: new Money(1000, 'USD'),
      lineTotal: new Money(2000, 'USD'),
      reversal: false,
    };

    const bookings = Object.keys(bookingTransitions).map(trKey => {
      const lineItemsMaybe =
        trKey !== 'INQUIRE' ? [lineItemUnitTypeNight, lineItemProviderCommission] : [];
      return {
        tr: bookingTransitions[trKey],
        tx: createTransaction({
          id: `id-booking-${trKey}-order`,
          customer,
          provider,
          listing: listingNight,
          booking: createBooking('booking-id', {
            start: new Date(Date.UTC(2021, 5, 14)),
            end: new Date(Date.UTC(2021, 5, 16)),
          }),
          processName: 'default-booking',
          lastTransition: bookingTransitions[trKey],
          lastTransitionedAt: new Date(Date.UTC(2022, 0, 15)),
          lineItems: lineItemsMaybe,
        }),
      };
    });

    test.each(bookings)('check booking: $tr', ({ tr, tx }) => {
      const transactionRole = TX_TRANSITION_ACTOR_CUSTOMER;
      const stateDataBooking = getStateData({
        transaction: tx,
        transactionRole,
      });

      const tree = render(
        <InboxItem
          tx={tx}
          transactionRole={transactionRole}
          intl={fakeIntl}
          stateData={stateDataBooking}
          isBooking={true}
          isPurchase={false}
        />
      );

      const quantityFound = screen.queryAllByText('Jun 14 – 16');
      const expected = tr !== 'transition/inquire' ? 1 : 0;
      expect(quantityFound).toHaveLength(expected);
    });
  });

  describe('InboxItem: default-booking process with "hour"', () => {
    const listingHour = createListing('listing-hour', {
      publicData: {
        listingType: 'rent-bikes',
        transactionProcessAlias: 'default-booking',
        unitType: 'hour',
      },
    });

    const lineItemUnitTypeHour = {
      code: LINE_ITEM_HOUR,
      includeFor: ['customer', 'provider'],
      quantity: new Decimal(3), // 3 hours
      unitPrice: new Money(1000, 'USD'),
      lineTotal: new Money(3000, 'USD'),
      reversal: false,
    };

    const bookings = Object.keys(bookingTransitions).map(trKey => {
      const lineItemsMaybe =
        trKey !== 'INQUIRE' ? [lineItemUnitTypeHour, lineItemProviderCommission] : [];
      return {
        tr: bookingTransitions[trKey],
        tx: createTransaction({
          id: `id-booking-${trKey}-order`,
          customer,
          provider,
          listing: listingHour,
          booking: createBooking('booking-id', {
            start: new Date(Date.UTC(2022, 5, 14, 10, 0)),
            end: new Date(Date.UTC(2022, 5, 14, 13, 0)),
          }),
          processName: 'default-booking',
          lastTransition: bookingTransitions[trKey],
          lastTransitionedAt: new Date(Date.UTC(2022, 0, 15)),
          lineItems: lineItemsMaybe,
        }),
      };
    });

    test.each(bookings)('check booking: $tr', ({ tr, tx }) => {
      const transactionRole = TX_TRANSITION_ACTOR_CUSTOMER;
      const stateDataBooking = getStateData({
        transaction: tx,
        transactionRole,
      });

      const tree = render(
        <InboxItem
          tx={tx}
          transactionRole={transactionRole}
          intl={fakeIntl}
          stateData={stateDataBooking}
          isBooking={true}
          isPurchase={false}
        />
      );
      expect(tree.asFragment().firstChild).toMatchSnapshot();

      const quantityFound = screen.queryAllByText('Jun 14, 2022, 10:00 AM - 1:00 PM');
      const expected = tr !== 'transition/inquire' ? 1 : 0;
      expect(quantityFound).toHaveLength(expected);
    });
  });

  describe('InboxItem: default-negotiation process with "request"', () => {
    const listingRequest = createListing('listing-request', {
      publicData: {
        listingType: 'request',
        transactionProcessAlias: 'default-negotiation',
        unitType: 'request',
      },
    });

    const negotiationTransitions = getProcess('default-negotiation')?.transitions;

    const negotiations = Object.keys(negotiationTransitions).map(trKey => {
      const lineItemsMaybe = trKey !== 'INQUIRE' ? lineItems : [];
      return {
        tr: negotiationTransitions[trKey],
        tx: createTransaction({
          id: `id-negotiation-${trKey}-request`,
          customer,
          provider,
          listing: listingRequest,
          processName: 'default-negotiation',
          processVersion: 1,
          lastTransition: negotiationTransitions[trKey],
          lastTransitionedAt: new Date(Date.UTC(2022, 0, 15)),
          lineItems: lineItemsMaybe,
        }),
      };
    });

    test.each(negotiations)('check negotiation: $tr', ({ tr, tx }) => {
      const transactionRole = TX_TRANSITION_ACTOR_CUSTOMER;
      const stateDataNegotiation = getStateData({
        transaction: tx,
        transactionRole,
      });

      const tree = render(
        <InboxItem
          tx={tx}
          transactionRole={transactionRole}
          intl={fakeIntl}
          stateData={stateDataNegotiation}
          isBooking={false}
          isPurchase={false}
        />
      );
      expect(tree.asFragment().firstChild).toMatchSnapshot();

      const quantityNotFound = screen.queryAllByText('InboxPage.quantity');
      const expected = 0;
      expect(quantityNotFound).toHaveLength(expected);
    });
  });
});
