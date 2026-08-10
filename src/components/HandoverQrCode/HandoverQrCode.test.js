import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders, testingLibrary } from '../../util/testHelpers';
import en from '../../translations/en.json';

import HandoverQrCode from './HandoverQrCode';

const { screen } = testingLibrary;

const PAYLOAD = '6a74b530-a104-42b6-a586-b35efb5dee79';

// testHelpers maps every translation key to itself by default, which is fine for
// most assertions but useless for the two things under test here: an accessible
// NAME and an interpolated payload. So the real en.json strings are used.
// NOTE: at runtime Console's hosted translation asset overrides en.json, so these
// assertions pin the local default copy, not necessarily what a user sees.
const render = ui => renderWithProviders(ui, { messages: en });

describe('HandoverQrCode', () => {
  it('renders an image served by the server-side renderer', () => {
    render(<HandoverQrCode payload={PAYLOAD} />);

    const img = screen.getByRole('img');
    // Generated server-side, not in the browser: the src is the endpoint, and
    // the payload is the transaction id (design §11).
    expect(img).toHaveAttribute('src', `/api/transaction-qr?id=${PAYLOAD}`);
  });

  it('always gives the image a text alternative', () => {
    // A QR is a picture of a string. It must never be announced as decorative
    // (alt="") or as a URL.
    render(<HandoverQrCode payload={PAYLOAD} />);

    const img = screen.getByRole('img');
    expect(img).toHaveAccessibleName('Handover QR code');
  });

  it('does not put the raw payload in the alt text', () => {
    // A screen reader spelling out a UUID is noise, not an alternative.
    render(<HandoverQrCode payload={PAYLOAD} />);

    expect(screen.getByRole('img').getAttribute('alt')).not.toContain(PAYLOAD);
  });

  it('offers the payload as selectable text when asked, for a broken scanner', () => {
    render(<HandoverQrCode payload={PAYLOAD} showPayload={true} />);

    // Selectable text, not just an image: a studio whose scanner is down still
    // has to be able to read, copy or type the code.
    const payloadEl = screen.getByText(PAYLOAD);
    expect(payloadEl).toBeInTheDocument();
    expect(payloadEl.tagName).toBe('CODE');
  });

  it('ties the payload text to the image with aria-describedby', () => {
    render(<HandoverQrCode payload={PAYLOAD} showPayload={true} id="tx-1" />);

    const img = screen.getByRole('img');
    const describedBy = img.getAttribute('aria-describedby');
    expect(describedBy).toBe('tx-1-payload');
    expect(document.getElementById(describedBy)).toHaveTextContent(PAYLOAD);
  });

  it('omits the payload text by default, and then describes nothing', () => {
    render(<HandoverQrCode payload={PAYLOAD} />);

    expect(screen.queryByText(PAYLOAD)).not.toBeInTheDocument();
    expect(screen.getByRole('img')).not.toHaveAttribute('aria-describedby');
  });

  it('renders nothing without a payload', () => {
    const { container } = render(<HandoverQrCode payload={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a small variant for the ops table', () => {
    render(<HandoverQrCode payload={PAYLOAD} size="small" />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('width', '48');
    expect(img).toHaveAttribute('height', '48');
  });

  it('has no notion of which handover it is for', () => {
    // One code serves both the collection and the return. Two renders of the
    // same payload must be indistinguishable - if a "which event" prop is ever
    // added, this is where it shows up.
    const { container: a, unmount } = render(<HandoverQrCode payload={PAYLOAD} id="x" />);
    const html = a.innerHTML;
    unmount();

    const { container: b } = render(<HandoverQrCode payload={PAYLOAD} id="x" />);
    expect(b.innerHTML).toBe(html);
  });
});
