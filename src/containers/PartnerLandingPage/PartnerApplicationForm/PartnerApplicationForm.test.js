import React, { act } from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../util/testHelpers';

import PartnerApplicationForm, { HONEYPOT_FIELD } from './PartnerApplicationForm';

const { screen, userEvent } = testingLibrary;

const noop = () => null;

const VALID_VALUES = {
  studioName: 'Spin Cycle',
  address: 'Calle Mayor 1, Madrid',
  businessHours: 'Mon-Fri 9:00-19:00',
  contactName: 'Ana Ruiz',
  email: 'ana@example.com',
  phone: '+34600111222',
  acceptedCategories: 'Dresses, Coats',
  turnaroundHours: '48',
};

const label = key => `PartnerApplicationForm.${key}`;

const fillValidForm = async user => {
  await user.type(screen.getByLabelText(label('studioNameLabel')), VALID_VALUES.studioName);
  await user.type(screen.getByLabelText(label('addressLabel')), VALID_VALUES.address);
  await user.type(screen.getByLabelText(label('businessHoursLabel')), VALID_VALUES.businessHours);
  await user.type(screen.getByLabelText(label('contactNameLabel')), VALID_VALUES.contactName);
  await user.type(screen.getByLabelText(label('emailLabel')), VALID_VALUES.email);
  await user.type(screen.getByLabelText(label('phoneLabel')), VALID_VALUES.phone);
  await user.type(
    screen.getByLabelText(label('acceptedCategoriesLabel')),
    VALID_VALUES.acceptedCategories
  );
  await user.type(
    screen.getByLabelText(label('turnaroundHoursLabel')),
    VALID_VALUES.turnaroundHours
  );
};

describe('PartnerApplicationForm', () => {
  it('renders a labelled control for every application field', () => {
    render(<PartnerApplicationForm onSubmit={noop} />);

    [
      'studioNameLabel',
      'addressLabel',
      'businessHoursLabel',
      'contactNameLabel',
      'emailLabel',
      'phoneLabel',
      'acceptedCategoriesLabel',
      'turnaroundHoursLabel',
      'notesLabel',
    ].forEach(key => {
      expect(screen.getByLabelText(label(key))).toBeInTheDocument();
    });
  });

  it('groups the fields under headings', () => {
    render(<PartnerApplicationForm onSubmit={noop} />);

    expect(
      screen.getByRole('heading', { name: label('businessDetailsTitle'), level: 3 })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: label('contactTitle'), level: 3 })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: label('capabilitiesTitle'), level: 3 })
    ).toBeInTheDocument();
  });

  it('keeps submit disabled until the form is valid', async () => {
    const user = userEvent.setup();
    render(<PartnerApplicationForm onSubmit={noop} />);

    const submit = screen.getByRole('button', { name: label('submit') });
    expect(submit).toBeDisabled();

    await fillValidForm(user);

    expect(submit).toBeEnabled();
  });

  it('shows a validation error for a malformed email', async () => {
    const user = userEvent.setup();
    render(<PartnerApplicationForm onSubmit={noop} />);

    const emailInput = screen.getByLabelText(label('emailLabel'));
    await user.type(emailInput, 'not-an-email');
    await act(async () => {
      emailInput.blur();
    });

    expect(screen.getByText(label('emailInvalid'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: label('submit') })).toBeDisabled();
  });

  it('shows a validation error when a required field is emptied', async () => {
    const user = userEvent.setup();
    render(<PartnerApplicationForm onSubmit={noop} />);

    const studioNameInput = screen.getByLabelText(label('studioNameLabel'));
    await user.type(studioNameInput, 'x');
    await user.clear(studioNameInput);
    await act(async () => {
      studioNameInput.blur();
    });

    expect(screen.getByText(label('studioNameRequired'))).toBeInTheDocument();
  });

  it('rejects a studio name over the length cap', async () => {
    const user = userEvent.setup();
    render(<PartnerApplicationForm onSubmit={noop} />);

    const studioNameInput = screen.getByLabelText(label('studioNameLabel'));
    await user.type(studioNameInput, 'a'.repeat(121));
    await act(async () => {
      studioNameInput.blur();
    });

    expect(screen.getByText(label('studioNameTooLong'))).toBeInTheDocument();
  });

  it('submits the values with turnaroundHours parsed to a number', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<PartnerApplicationForm onSubmit={onSubmit} />);

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: label('submit') }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        ...VALID_VALUES,
        turnaroundHours: 48,
      })
    );
  });

  it('renders a honeypot field that is hidden from assistive tech and the tab order', () => {
    render(<PartnerApplicationForm onSubmit={noop} />);

    const honeypot = screen.getByLabelText(label('honeypotLabel'));
    expect(honeypot).toHaveAttribute('name', HONEYPOT_FIELD);
    expect(honeypot).toHaveAttribute('tabindex', '-1');
    expect(honeypot).toHaveAttribute('autocomplete', 'off');
    expect(honeypot.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('does not submit the honeypot value when a human leaves it alone', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<PartnerApplicationForm onSubmit={onSubmit} />);

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: label('submit') }));

    expect(onSubmit.mock.calls[0][0][HONEYPOT_FIELD]).toBeUndefined();
  });

  it('shows a submit error and clears it once the applicant edits again', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(
      <PartnerApplicationForm
        onSubmit={noop}
        onChange={onChange}
        submitApplicationError={new Error('failed')}
      />
    );

    expect(screen.getByText(label('submitFailed'))).toBeInTheDocument();

    await user.type(screen.getByLabelText(label('studioNameLabel')), 'a');

    expect(onChange).toHaveBeenCalled();
  });

  it('disables submit while a submission is in progress', async () => {
    const user = userEvent.setup();
    render(<PartnerApplicationForm onSubmit={noop} inProgress />);

    await fillValidForm(user);

    // The Button swaps its label for a spinner while in progress, so query by role only.
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
