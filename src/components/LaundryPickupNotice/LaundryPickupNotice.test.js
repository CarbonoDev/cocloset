import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import LaundryPickupNotice from './LaundryPickupNotice';

const { screen, fireEvent } = testingLibrary;

describe('LaundryPickupNotice', () => {
  it('renders the heading, body, and all four steps when not collapsible', () => {
    render(<LaundryPickupNotice />);

    expect(screen.getByText('LaundryPickupNotice.heading')).toBeInTheDocument();
    expect(screen.getByText('LaundryPickupNotice.body')).toBeInTheDocument();
    expect(screen.getByText('LaundryPickupNotice.step1')).toBeInTheDocument();
    expect(screen.getByText('LaundryPickupNotice.step2')).toBeInTheDocument();
    expect(screen.getByText('LaundryPickupNotice.step3')).toBeInTheDocument();
    expect(screen.getByText('LaundryPickupNotice.step4')).toBeInTheDocument();
    // No toggle at all when not collapsible - it's always open.
    expect(screen.queryByText('LaundryPickupNotice.toggleShow')).not.toBeInTheDocument();
  });

  it('starts collapsed behind a toggle when collapsible, and expands on click', () => {
    render(<LaundryPickupNotice collapsible />);

    expect(screen.getByText('LaundryPickupNotice.toggleShow')).toBeInTheDocument();
    expect(screen.queryByText('LaundryPickupNotice.heading')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('LaundryPickupNotice.toggleShow'));

    expect(screen.getByText('LaundryPickupNotice.toggleHide')).toBeInTheDocument();
    expect(screen.getByText('LaundryPickupNotice.heading')).toBeInTheDocument();
  });

  it('collapses again on a second toggle click', () => {
    render(<LaundryPickupNotice collapsible />);

    fireEvent.click(screen.getByText('LaundryPickupNotice.toggleShow'));
    fireEvent.click(screen.getByText('LaundryPickupNotice.toggleHide'));

    expect(screen.getByText('LaundryPickupNotice.toggleShow')).toBeInTheDocument();
    expect(screen.queryByText('LaundryPickupNotice.heading')).not.toBeInTheDocument();
  });
});
