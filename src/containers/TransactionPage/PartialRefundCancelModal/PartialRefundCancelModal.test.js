import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders, testingLibrary } from '../../../util/testHelpers';
import en from '../../../translations/en.json';

import PartialRefundCancelModal, {
  classifyPartialRefundCancelError,
} from './PartialRefundCancelModal';

const { screen, fireEvent } = testingLibrary;

// `withPortals` is load-bearing here too, same reason as ReviewModal.test.js: the modal
// renders through #portal-root (Modal's `usePortal`), and without it nothing mounts.
const render = ui => renderWithProviders(ui, { messages: en, withPortals: true });

const renderModal = (props = {}) =>
  render(
    <PartialRefundCancelModal
      id="PartialRefundCancelModal"
      isOpen
      onCloseModal={() => null}
      onManageDisableScrolling={() => null}
      onConfirm={() => null}
      {...props}
    />
  );

describe('classifyPartialRefundCancelError', () => {
  it('maps each server error code to its own distinct kind', () => {
    expect(classifyPartialRefundCancelError({ error: 'not-eligible' })).toEqual('not-eligible');
    expect(classifyPartialRefundCancelError({ error: 'no-payment-intent-on-record' })).toEqual(
      'no-payment-intent-on-record'
    );
    expect(classifyPartialRefundCancelError({ error: 'stripe-refund-failed' })).toEqual(
      'stripe-refund-failed'
    );
  });

  it('falls back to unknown for anything else, including no error at all', () => {
    expect(classifyPartialRefundCancelError({ error: 'something-new' })).toEqual('unknown');
    expect(classifyPartialRefundCancelError({})).toEqual('unknown');
    expect(classifyPartialRefundCancelError(undefined)).toEqual('unknown');
  });
});

describe('PartialRefundCancelModal', () => {
  it('shows the confirm step by default, naming the partial-refund tradeoff', () => {
    renderModal();

    expect(screen.getByText(/partial refund/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel booking/i })).toBeInTheDocument();
  });

  it('shows the specific cleaning-fee amount when a line item is supplied', () => {
    // A real SDK Money instance, exactly the shape transaction.attributes.lineItems entries
    // carry - see server/api-util/lineItems.js's own documented shape.
    const Money = require('../../../util/sdkLoader').types.Money;
    renderModal({
      cleaningFeeLineItem: { code: 'line-item/cleaning-fee', lineTotal: new Money(1500, 'USD') },
    });

    expect(screen.getByText(/\$15\.00/)).toBeInTheDocument();
  });

  it('reads fine with no cleaning-fee line item at all - the generic sentence stands alone', () => {
    renderModal({ cleaningFeeLineItem: undefined });

    expect(screen.getByText(/partial refund/i)).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  describe('the invasive loader (inProgress)', () => {
    it('shows a loading state with no confirm/cancel actions at all', () => {
      renderModal({ inProgress: true });

      expect(screen.getByText(/please wait/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /cancel booking/i })).toBeNull();
    });

    it('cannot be dismissed by the close button while in progress', () => {
      const onCloseModal = jest.fn();
      renderModal({ inProgress: true, onCloseModal });

      // Modal's own close button is still in the DOM (same primitive, for visual
      // consistency), but clicking it must do nothing while the refund is in flight - that
      // is the whole point of the non-dismissible sub-state the client asked for.
      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      expect(onCloseModal).not.toHaveBeenCalled();
    });

    it('cannot be dismissed with the Escape key while in progress', () => {
      const onCloseModal = jest.fn();
      renderModal({ inProgress: true, onCloseModal });

      fireEvent.keyUp(document.body, { key: 'Escape' });

      expect(onCloseModal).not.toHaveBeenCalled();
    });

    it('CAN be dismissed normally once not in progress (the confirm step is a plain modal)', () => {
      const onCloseModal = jest.fn();
      renderModal({ inProgress: false, onCloseModal });

      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      expect(onCloseModal).toHaveBeenCalledTimes(1);
    });
  });

  describe('error states, each with its own distinct message', () => {
    it('tells the customer the booking is not eligible any more', () => {
      renderModal({ error: { error: 'not-eligible', reason: 'wrong-state' } });

      expect(screen.getByText(/not eligible/i)).toBeInTheDocument();
    });

    it('tells the customer the refund failed and nothing was charged', () => {
      renderModal({ error: { error: 'stripe-refund-failed' } });

      expect(screen.getByText(/nothing was charged/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('gives the predates-ledger case its own distinct copy, not the generic error', () => {
      renderModal({ error: { error: 'no-payment-intent-on-record', reason: 'predates-ledger' } });

      const notEligibleText = screen.queryByText(/not eligible/i);
      const refundFailedText = screen.queryByText(/nothing was charged/i);
      expect(notEligibleText).toBeNull();
      expect(refundFailedText).toBeNull();
      // Its own message exists and is shown. (Two "close"-ish buttons exist on this
      // screen - Modal's own "CLOSE" icon button and this error step's own "Close" action -
      // the exact-case match picks the latter.)
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });

    it('falls back to a generic error for an unrecognised code', () => {
      renderModal({ error: { error: 'something-nobody-expected' } });

      expect(screen.queryByText(/not eligible/i)).toBeNull();
      expect(screen.queryByText(/nothing was charged/i)).toBeNull();
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });
  });

  it('shows the distinct manual-follow-up message when the refund succeeded but cancellation did not', () => {
    renderModal({ result: { refunded: true, cancelled: false, requiresManualFollowUp: true } });

    expect(screen.getAllByText(/refund/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('prefers an error over a stale result if somehow both are present', () => {
    renderModal({
      error: { error: 'stripe-refund-failed' },
      result: { refunded: true, cancelled: false, requiresManualFollowUp: true },
    });

    expect(screen.getByText(/nothing was charged/i)).toBeInTheDocument();
  });
});
