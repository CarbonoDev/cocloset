import React, { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';

import IconShare from '../IconShare/IconShare';
import css from './ShareButton.module.css';

/**
 * Share this page: the device's own share sheet where there is one, a copied link otherwise.
 *
 *   > "El segundo icono es de share, al dar click me permitirá ver el share nativo o bien,
 *   >  copiar el enlace de la página actual" (Jonathan, 2026-09-08)
 *
 * WHY IT DECIDES AT CLICK TIME AND NOT AT RENDER. `navigator.share` does not exist during
 * server rendering and may not exist in the browser either, so a component that picked its
 * behaviour while rendering would have to pick it on the server - where the answer is always
 * "no share sheet" - and then either be wrong on a phone or re-render into a different button.
 * Deciding inside the handler means the first click is already correct.
 *
 * A CANCELLED SHARE IS NOT AN ERROR. Dismissing the OS sheet rejects the promise with an
 * `AbortError`, and reporting that as a failure - or falling back to copying a link the person
 * just declined to share - would be the app arguing with them. It is swallowed.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.title] - shared as the title, e.g. the garment's name
 * @param {string} [props.url] - defaults to the current page
 * @param {string?} props.className
 * @param {string?} props.rootClassName
 * @returns {JSX.Element}
 */
const ShareButton = props => {
  const { title, url, className, rootClassName } = props;
  const intl = useIntl();

  // 'idle' | 'copied' | 'failed' - what to say underneath, if anything.
  const [feedback, setFeedback] = useState('idle');
  const timeoutRef = useRef(null);

  useEffect(() => {
    // Clearing on unmount: the confirmation is a timer, and a card that scrolls out of a
    // virtualised list mid-countdown would otherwise set state on a component that is gone.
    return () => window.clearTimeout(timeoutRef.current);
  }, []);

  const announce = state => {
    setFeedback(state);
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setFeedback('idle'), 3000);
  };

  const resolveUrl = () => url || (typeof window !== 'undefined' ? window.location.href : null);

  const copyToClipboard = shareUrl => {
    // `navigator.clipboard` needs a secure context, so it is absent over plain http - which
    // includes some local development. Reported rather than silently doing nothing: a button
    // that appears to work and does not is worse than one that says it failed.
    if (!navigator?.clipboard?.writeText) {
      announce('failed');
      return;
    }
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => announce('copied'))
      .catch(() => announce('failed'));
  };

  const handleClick = e => {
    // The button can sit on a card that is itself a link.
    e.preventDefault();
    e.stopPropagation();

    const shareUrl = resolveUrl();
    if (!shareUrl) {
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({ title: title || undefined, url: shareUrl }).catch(error => {
        // Dismissing the sheet is a decision, not a failure. Anything else - a share sheet
        // that genuinely could not open - falls back to the link.
        if (error?.name !== 'AbortError') {
          copyToClipboard(shareUrl);
        }
      });
      return;
    }

    copyToClipboard(shareUrl);
  };

  const label = intl.formatMessage({ id: 'ShareButton.share' });

  return (
    <>
      <button
        type="button"
        className={classNames(rootClassName || css.root, className)}
        onClick={handleClick}
        aria-label={label}
        title={label}
      >
        <IconShare className={css.icon} />
        <span className={css.label}>
          <FormattedMessage id="ShareButton.share" />
        </span>
      </button>
      {/* `role="status"` so the result is announced without stealing focus. The element is
          always in the tree - a live region added at the moment it has something to say is a
          live region screen readers do not read. */}
      <p className={css.feedback} role="status">
        {feedback === 'copied' ? <FormattedMessage id="ShareButton.copied" /> : null}
        {feedback === 'failed' ? <FormattedMessage id="ShareButton.copyFailed" /> : null}
      </p>
    </>
  );
};

export default ShareButton;
