import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders, testingLibrary } from '../../../util/testHelpers';
import en from '../../../translations/en.json';

import ReviewModal from './ReviewModal';

const { screen } = testingLibrary;

// The real English strings, not key-as-value: these assertions are about the
// copy the renter reads (Jonathan, 2026-09-02), so a test against the keys
// would pass on any wording at all.
// `withPortals` is load-bearing: the modal renders through #portal-root, and
// without it the component mounts to nothing and every assertion below passes
// or fails for the wrong reason.
const render = ui => renderWithProviders(ui, { messages: en, withPortals: true });

const renderModal = (props = {}) =>
  render(
    <ReviewModal
      id="ReviewOrderModal"
      isOpen
      onCloseModal={() => null}
      onManageDisableScrolling={() => null}
      onSubmitReview={() => null}
      revieweeName="Dana"
      marketplaceName="Cocloset"
      {...props}
    />
  );

describe('ReviewModal', () => {
  it('prompts the renter on fit and on the lender', () => {
    renderModal({ isCustomerRole: true });

    expect(screen.getByText(/keeps our community running smoothly/i)).toBeInTheDocument();
    expect(screen.getByText(/How true to size was the item\?/i)).toBeInTheDocument();
    expect(screen.getByText(/were they responsive and helpful\?/i)).toBeInTheDocument();
    // Sharetribe holds a review back until both sides have written one or the
    // review period ends, so the renter is told before they wonder.
    expect(screen.getByText(/up to 7 days for your review to appear/i)).toBeInTheDocument();

    // ...and none of the generic prompt, which this replaces for the renter.
    expect(screen.queryByText(/what went well and what could be improved/i)).toBeNull();
  });

  it('leaves the owner with the generic prompt', () => {
    renderModal({ isCustomerRole: false });

    expect(screen.getByText(/what went well and what could be improved/i)).toBeInTheDocument();
    expect(screen.queryByText(/How true to size was the item\?/i)).toBeNull();
    expect(screen.queryByText(/up to 7 days for your review to appear/i)).toBeNull();
  });

  it('names the reviewee to both roles', () => {
    renderModal({ isCustomerRole: true });
    expect(screen.getByText(/Dana/)).toBeInTheDocument();
  });

  it('shows no decorative icon above the title', () => {
    // "hay que quitar el icono que se muestra en este modal" - the modal used
    // to open with <IconReviewUser>. Asserting on the rendered <svg> rather
    // than on the import is what makes this survive a re-add by another route.
    const { container } = renderModal({ isCustomerRole: true });

    // Two SVGs in this modal are not the one being removed: the close button's
    // X (inside a <button>) and the star rating inside ReviewForm (after the
    // title). What is left is decoration above the title, which is exactly what
    // <IconReviewUser> was.
    const title = screen.getByText(/Leave a review for/i);
    const decorative = Array.from(container.querySelectorAll('svg'))
      .filter(svg => !svg.closest('button'))
      .filter(svg => title.compareDocumentPosition(svg) & Node.DOCUMENT_POSITION_PRECEDING);

    expect(decorative).toEqual([]);
  });
});
