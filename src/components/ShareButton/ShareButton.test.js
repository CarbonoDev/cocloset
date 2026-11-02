import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import ShareButton from './ShareButton';

const { screen, fireEvent, waitFor } = testingLibrary;

//   > "al dar click me permitirá ver el share nativo o bien, copiar el enlace de la página
//   >  actual" (Jonathan, 2026-09-08)
//
// Two behaviours behind one button, chosen from what the device can do. What is worth pinning
// is that the choice happens at CLICK time - a component that decided while rendering would
// decide on the server, where there is never a share sheet - and that dismissing the sheet is
// not treated as a failure to fall back from.

const URL = 'https://cocloset.test/l/silk-slip-dress/123';

const shareButton = () => screen.getByRole('button', { name: 'ShareButton.share' });

describe('ShareButton', () => {
  const originalShare = navigator.share;
  const originalClipboard = navigator.clipboard;

  const setNavigator = ({ share, writeText }) => {
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: writeText ? { writeText } : undefined,
      configurable: true,
    });
  };

  afterEach(() => {
    Object.defineProperty(navigator, 'share', { value: originalShare, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  });

  it('opens the device share sheet when there is one', () => {
    const share = jest.fn(() => Promise.resolve());
    setNavigator({ share, writeText: jest.fn() });
    render(<ShareButton url={URL} title="Silk slip dress" />);

    fireEvent.click(shareButton());

    expect(share).toHaveBeenCalledWith({ title: 'Silk slip dress', url: URL });
  });

  it('copies the link when there is no share sheet', async () => {
    const writeText = jest.fn(() => Promise.resolve());
    setNavigator({ share: undefined, writeText });
    render(<ShareButton url={URL} />);

    fireEvent.click(shareButton());

    expect(writeText).toHaveBeenCalledWith(URL);
    await waitFor(() => expect(screen.getByText('ShareButton.copied')).toBeInTheDocument());
  });

  it('treats a dismissed share sheet as a decision, not a failure', async () => {
    // Falling back to copying a link somebody just declined to share is the app arguing with
    // them, and it would put "Link copied" on screen for an action they cancelled.
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const writeText = jest.fn(() => Promise.resolve());
    setNavigator({ share: jest.fn(() => Promise.reject(abort)), writeText });
    render(<ShareButton url={URL} />);

    fireEvent.click(shareButton());
    await Promise.resolve();

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByText('ShareButton.copied')).not.toBeInTheDocument();
  });

  it('falls back to the link when the share sheet genuinely fails', async () => {
    const writeText = jest.fn(() => Promise.resolve());
    setNavigator({ share: jest.fn(() => Promise.reject(new Error('no can do'))), writeText });
    render(<ShareButton url={URL} />);

    fireEvent.click(shareButton());

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL));
  });

  it('says so when it cannot copy, instead of appearing to work', async () => {
    // `navigator.clipboard` is absent outside a secure context, which includes some local
    // development. A button that does nothing silently is worse than one that reports it.
    setNavigator({ share: undefined, writeText: undefined });
    render(<ShareButton url={URL} />);

    fireEvent.click(shareButton());

    await waitFor(() => expect(screen.getByText('ShareButton.copyFailed')).toBeInTheDocument());
  });

  it('keeps a live region on the page so the result is announced', () => {
    setNavigator({ share: undefined, writeText: jest.fn(() => Promise.resolve()) });
    render(<ShareButton url={URL} />);

    // Present before anything happens: a live region added at the moment it has something to
    // say is a live region screen readers do not read.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
