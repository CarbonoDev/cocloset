import React, { act } from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../../../util/testHelpers';

import EmailSignupForm, { HONEYPOT_FIELD } from './EmailSignupForm';

const { screen, userEvent } = testingLibrary;

const noop = () => null;

const VALID_VALUES = {
  name: 'Jamie Rivera',
  email: 'jamie@example.com',
  zipCode: '78701',
};

const label = key => `EmailSignupForm.${key}`;

const fillValidForm = async user => {
  await user.type(screen.getByLabelText(label('nameLabel')), VALID_VALUES.name);
  await user.type(screen.getByLabelText(label('emailLabel')), VALID_VALUES.email);
  await user.type(screen.getByLabelText(label('zipCodeLabel')), VALID_VALUES.zipCode);
  await user.click(screen.getByLabelText(label('consentLabel')));
};

describe('EmailSignupForm', () => {
  it('renders a labelled control for every signup field', () => {
    render(<EmailSignupForm onSubmit={noop} />);

    ['nameLabel', 'emailLabel', 'zipCodeLabel', 'consentLabel'].forEach(key => {
      expect(screen.getByLabelText(label(key))).toBeInTheDocument();
    });
  });

  it('keeps submit disabled until the form is valid, consent included', async () => {
    const user = userEvent.setup();
    render(<EmailSignupForm onSubmit={noop} />);

    const submit = screen.getByRole('button', { name: label('submit') });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(label('nameLabel')), VALID_VALUES.name);
    await user.type(screen.getByLabelText(label('emailLabel')), VALID_VALUES.email);
    await user.type(screen.getByLabelText(label('zipCodeLabel')), VALID_VALUES.zipCode);
    expect(submit).toBeDisabled();

    await user.click(screen.getByLabelText(label('consentLabel')));
    expect(submit).toBeEnabled();
  });

  it('shows a validation error for a malformed email', async () => {
    const user = userEvent.setup();
    render(<EmailSignupForm onSubmit={noop} />);

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
    render(<EmailSignupForm onSubmit={noop} />);

    const nameInput = screen.getByLabelText(label('nameLabel'));
    await user.type(nameInput, 'x');
    await user.clear(nameInput);
    await act(async () => {
      nameInput.blur();
    });

    expect(screen.getByText(label('nameRequired'))).toBeInTheDocument();
  });

  it('rejects a name over the length cap', async () => {
    const user = userEvent.setup();
    render(<EmailSignupForm onSubmit={noop} />);

    const nameInput = screen.getByLabelText(label('nameLabel'));
    await user.type(nameInput, 'a'.repeat(121));
    await act(async () => {
      nameInput.blur();
    });

    expect(screen.getByText(label('nameTooLong'))).toBeInTheDocument();
  });

  it('does not submit without consent, even with every other field filled', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<EmailSignupForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(label('nameLabel')), VALID_VALUES.name);
    await user.type(screen.getByLabelText(label('emailLabel')), VALID_VALUES.email);
    await user.type(screen.getByLabelText(label('zipCodeLabel')), VALID_VALUES.zipCode);

    expect(screen.getByRole('button', { name: label('submit') })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the values the visitor entered, consent included', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<EmailSignupForm onSubmit={onSubmit} />);

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: label('submit') }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted).toEqual(expect.objectContaining(VALID_VALUES));
    expect(submitted.consent).toEqual(expect.arrayContaining(['true']));
  });

  it('renders a honeypot field that is hidden from assistive tech and the tab order', () => {
    render(<EmailSignupForm onSubmit={noop} />);

    const honeypot = screen.getByLabelText(label('honeypotLabel'));
    expect(honeypot).toHaveAttribute('name', HONEYPOT_FIELD);
    expect(honeypot).toHaveAttribute('tabindex', '-1');
    expect(honeypot).toHaveAttribute('autocomplete', 'off');
    expect(honeypot.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('does not submit the honeypot value when a human leaves it alone', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<EmailSignupForm onSubmit={onSubmit} />);

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: label('submit') }));

    expect(onSubmit.mock.calls[0][0][HONEYPOT_FIELD]).toBeUndefined();
  });

  it('shows a submit error and clears it once the visitor edits again', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(
      <EmailSignupForm onSubmit={noop} onChange={onChange} submitSignupError={new Error('failed')} />
    );

    expect(screen.getByText(label('submitFailed'))).toBeInTheDocument();

    await user.type(screen.getByLabelText(label('nameLabel')), 'a');

    expect(onChange).toHaveBeenCalled();
  });

  it('disables submit while a submission is in progress', async () => {
    const user = userEvent.setup();
    render(<EmailSignupForm onSubmit={noop} inProgress />);

    await fillValidForm(user);

    expect(screen.getByRole('button')).toBeDisabled();
  });
});
