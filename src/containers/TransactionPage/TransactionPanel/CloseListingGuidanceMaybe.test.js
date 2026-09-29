import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders, testingLibrary } from '../../../util/testHelpers';
import en from '../../../translations/en.json';

import CloseListingGuidanceMaybe from './CloseListingGuidanceMaybe';

const { screen } = testingLibrary;

// The real strings are needed since one assertion is about which specific
// copy shows up (the laundry warning), not just that something rendered.
const render = ui => renderWithProviders(ui, { messages: en });

const renderPanel = (props = {}) =>
  render(
    <CloseListingGuidanceMaybe
      processName="cocloset-booking"
      transactionRole="provider"
      isAtLaundry={false}
      {...props}
    />
  );

describe('CloseListingGuidanceMaybe', () => {
  it('shows the provider the steps to close a listing', () => {
    renderPanel();

    expect(
      screen.getByText(en['TransactionPanel.closeListingGuidance.heading'])
    ).toBeInTheDocument();
    expect(screen.getByText(en['TransactionPanel.closeListingGuidance.step1'])).toBeInTheDocument();
    expect(screen.getByText(en['TransactionPanel.closeListingGuidance.step2'])).toBeInTheDocument();
    expect(screen.getByText(en['TransactionPanel.closeListingGuidance.step3'])).toBeInTheDocument();
  });

  it('does not warn about the laundry when the garment is not there', () => {
    renderPanel({ isAtLaundry: false });

    expect(
      screen.queryByText(en['TransactionPanel.closeListingGuidance.laundryWarning'])
    ).not.toBeInTheDocument();
  });

  it('warns to collect the garment first when it is still at the laundry', () => {
    renderPanel({ isAtLaundry: true });

    expect(
      screen.getByText(en['TransactionPanel.closeListingGuidance.laundryWarning'])
    ).toBeInTheDocument();
  });

  it('renders nothing for the customer - this is provider-only guidance', () => {
    const { container } = renderPanel({ transactionRole: 'customer' });

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a role with no standing in the transaction', () => {
    const { container } = renderPanel({ transactionRole: 'operator' });

    expect(container).toBeEmptyDOMElement();
  });

  it.each([['default-booking'], ['default-purchase'], ['default-inquiry'], [undefined]])(
    'renders nothing for the %s process - only cocloset-booking routes a garment through a laundry',
    processName => {
      const { container } = renderPanel({ processName });

      expect(container).toBeEmptyDOMElement();
    }
  );
});
