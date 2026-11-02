import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders, testingLibrary } from '../../../util/testHelpers';
import en from '../../../translations/en.json';

import DamageReportedMaybe from './DamageReportedMaybe';

const { screen } = testingLibrary;

// The real strings are needed rather than testHelpers' key-as-message default:
// several assertions below are about the *wording* differing per role, which a
// key-only render would make invisible. NOTE: Console's hosted translation asset
// overrides en.json at runtime, so this pins the local default copy.
const render = ui => renderWithProviders(ui, { messages: en });

const NOTE = 'Small pull at left cuff, approx 2cm.';

const damaged = { damageReported: { flag: true, note: NOTE } };

const renderPanel = (props = {}) =>
  render(
    <DamageReportedMaybe
      processName="cocloset-booking"
      transactionRole="provider"
      metadata={damaged}
      {...props}
    />
  );

describe('DamageReportedMaybe', () => {
  // "Sobre los daños, avisa a los dos" (Jonathan, 2026-08-10). Both parties to
  // the transaction see the report, and both see the note verbatim - it is the
  // evidence, and only the framing around it is role-specific.
  describe.each([['provider'], ['customer']])('shown to the %s', role => {
    it('renders the laundry note verbatim', () => {
      renderPanel({ transactionRole: role });

      expect(screen.getByText(NOTE)).toBeInTheDocument();
      expect(
        screen.getByText(en[`TransactionPanel.damageReported.${role}.heading`])
      ).toBeInTheDocument();
      expect(screen.getByText(en['TransactionPanel.damageReported.noteLabel'])).toBeInTheDocument();
    });

    it('renders nothing at all when no damage was reported', () => {
      const { container } = renderPanel({
        transactionRole: role,
        metadata: { damageReported: { flag: false, note: '' } },
      });

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    });

    it('renders nothing when the laundry has not inspected yet', () => {
      // No `damageReported` key at all - every transaction before the return.
      const { container } = renderPanel({ transactionRole: role, metadata: {} });

      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when metadata is missing entirely', () => {
      const { container } = renderPanel({ transactionRole: role, metadata: undefined });

      expect(container).toBeEmptyDOMElement();
    });
  });

  it('gives the two roles different copy', () => {
    // The owner is told what it means for their garment and their payout; the
    // renter is told a report is not a charge. Sharing one string would be wrong
    // for one of them, so assert they actually differ.
    const provider = renderPanel({ transactionRole: 'provider' });
    const providerText = provider.container.textContent;
    provider.unmount();

    const customer = renderPanel({ transactionRole: 'customer' });
    const customerText = customer.container.textContent;

    expect(providerText).not.toEqual(customerText);
    // Both still carry the same evidence.
    expect(providerText).toContain(NOTE);
    expect(customerText).toContain(NOTE);
  });

  it('tells the renter explicitly that a report is not a charge', () => {
    // The renter may end up bearing the cost, and the marketplace has not yet
    // defined how compensation is settled between the owner, the renter and
    // the marketplace. So this panel must not read as a bill.
    renderPanel({ transactionRole: 'customer' });

    expect(
      screen.getByText(en['TransactionPanel.damageReported.customer.description'])
    ).toBeInTheDocument();
    expect(
      screen.getByText(en['TransactionPanel.damageReported.customer.nextSteps'])
    ).toBeInTheDocument();
  });

  it('explains an empty note instead of showing a blank box', () => {
    renderPanel({ metadata: { damageReported: { flag: true, note: '' } } });

    expect(screen.getByText(en['TransactionPanel.damageReported.noteMissing'])).toBeInTheDocument();
  });

  it('does not announce damage on a truthy-but-not-true flag', () => {
    // Guards the `=== true` check. The laundry endpoint only ever writes a
    // boolean, but a string 'false' from a hand-edited metadata write must not
    // read as damage.
    const { container } = renderPanel({
      metadata: { damageReported: { flag: 'false', note: NOTE } },
    });

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a role with no standing in the transaction', () => {
    const { container } = renderPanel({ transactionRole: 'operator' });

    expect(container).toBeEmptyDOMElement();
  });

  it.each([['default-booking'], ['default-purchase'], ['default-inquiry'], [undefined]])(
    'renders nothing for the %s process',
    processName => {
      const { container } = renderPanel({ processName });

      expect(container).toBeEmptyDOMElement();
    }
  );
});
