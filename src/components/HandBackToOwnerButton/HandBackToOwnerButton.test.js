import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import HandBackToOwnerButton from './HandBackToOwnerButton';

const { screen, fireEvent } = testingLibrary;

//   > "Una vez que la laundry de click al button para devolver la prenda al provider, debe
//   >  salir un prompt para confirmar la acción" (Jonathan, 2026-09-08)
//
// The write it guards cannot be undone from the studio's side: the garment leaves the
// inventory and only the owner bringing it back puts it there again. So what these pin is the
// gap between the click and the write - that it exists, that cancelling closes it, and that
// nothing is written on either.

const renderButton = (props = {}) =>
  render(
    <HandBackToOwnerButton
      id="test-hand-back"
      garmentTitle="Camel hair wrap coat"
      onConfirm={() => null}
      onManageDisableScrolling={() => null}
      {...props}
    />,
    { withPortals: true }
  );

describe('HandBackToOwnerButton', () => {
  it('writes nothing until the question is answered', () => {
    const onConfirm = jest.fn();
    renderButton({ onConfirm });

    fireEvent.click(screen.getByText('HandBackToOwnerButton.trigger'));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('writes once the operator confirms', () => {
    const onConfirm = jest.fn();
    renderButton({ onConfirm });

    fireEvent.click(screen.getByText('HandBackToOwnerButton.trigger'));
    fireEvent.click(screen.getByText('HandBackToOwnerButton.confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the operator backs out', () => {
    const onConfirm = jest.fn();
    renderButton({ onConfirm });

    fireEvent.click(screen.getByText('HandBackToOwnerButton.trigger'));
    fireEvent.click(screen.getByText('HandBackToOwnerButton.cancel'));

    expect(onConfirm).not.toHaveBeenCalled();
    // Modal HIDES its children rather than unmounting them, so "gone" here is the closed
    // class rather than an absent node. `identity-obj-proxy` maps CSS Modules to their own
    // key names, which is what makes that assertable at all.
    expect(screen.getByText('HandBackToOwnerButton.confirm').closest('.isClosed')).not.toBeNull();
  });

  it('names the garment in the question', () => {
    // "Are you sure?" over a grid of forty coats is not a question anybody can answer.
    renderButton();

    fireEvent.click(screen.getByText('HandBackToOwnerButton.trigger'));

    expect(screen.getByText('HandBackToOwnerButton.question')).toBeInTheDocument();
    expect(screen.queryByText('HandBackToOwnerButton.questionNoTitle')).not.toBeInTheDocument();
  });

  it('still asks when the garment has no title', () => {
    // A listing with no title is a broken listing, not a reason to skip the confirmation.
    renderButton({ garmentTitle: null });

    fireEvent.click(screen.getByText('HandBackToOwnerButton.trigger'));

    expect(screen.getByText('HandBackToOwnerButton.questionNoTitle')).toBeInTheDocument();
  });

  it('cannot be opened while a hand-back is already in flight', () => {
    renderButton({ inProgress: true });

    expect(screen.getByText('HandBackToOwnerButton.trigger').closest('button')).toBeDisabled();
  });
});
