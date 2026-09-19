import React from 'react';
import { Form as FinalForm, FormSpy } from 'react-final-form';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../../../util/reactIntl';
import {
  composeValidators,
  emailFormatValid,
  maxLength,
  required,
  requiredFieldArrayCheckbox,
} from '../../../../../util/validators';

import { Form, Button, FieldTextInput, FieldCheckbox, NamedLink } from '../../../../../components';

import css from './EmailSignupForm.module.css';

/**
 * Field length caps. These MUST stay in sync with `FIELD_SPECS` in
 * `server/api-util/emailSignup.js` - the server is the authority and will reject anything
 * longer; the client caps just give a better error than a raw 400.
 */
export const MAX_LENGTHS = {
  name: 120,
  email: 160,
  zipCode: 12,
};

/**
 * Name of the honeypot input. Rendered off-screen, hidden from assistive technology and
 * removed from the tab order - see the identical pattern (and its own name-collision story)
 * in `PartnerApplicationForm.js`. This form has no `website` field of its own, so `website`
 * is free to use as the bait name here. Must stay in sync with the server's own
 * `HONEYPOT_FIELD` in `server/api-util/emailSignup.js`.
 */
export const HONEYPOT_FIELD = 'website';

/**
 * Value the consent checkbox submits when checked. Final Form's array-checkbox convention
 * (see `requiredFieldArrayCheckbox`) puts checked values into an array on `values.consent`;
 * `SectionCoclosetLandingInvite` collapses that array to a plain boolean before it reaches
 * the duck / server, which expect a strict `true`.
 */
export const CONSENT_VALUE = 'true';

/**
 * EmailSignupForm
 *
 * Public, unauthenticated email-list signup for the landing page's "CoCloset is coming soon
 * to a city near you" section (`invite`). Structurally a sibling of
 * `PartnerApplicationForm` - same honeypot pattern, same submit-error/in-progress/disabled
 * plumbing - but a distinct, smaller field set: Name, Email, Zip Code and a required consent
 * checkbox with a link to the privacy policy.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.formId] - The form id
 * @param {Function} props.onSubmit - The function to handle form submission
 * @param {boolean} [props.inProgress] - Whether the submission is in progress
 * @param {propTypes.error} [props.submitSignupError] - The submission error
 * @returns {JSX.Element}
 */
const EmailSignupForm = props => (
  <FinalForm
    {...props}
    render={fieldRenderProps => {
      const {
        className,
        formId = 'EmailSignupForm',
        handleSubmit,
        invalid,
        pristine,
        rootClassName,
        inProgress,
        submitSignupError,
        onChange,
      } = fieldRenderProps;

      const intl = useIntl();

      // Clear a previous submit error as soon as the visitor starts editing again.
      const handleFormChange = () => {
        if (submitSignupError && onChange) {
          onChange();
        }
      };

      const tooLongMessage = (field, max) =>
        intl.formatMessage({ id: `EmailSignupForm.${field}TooLong` }, { max });

      const submitErrorMessage = submitSignupError ? (
        <p className={css.error} role="alert">
          <FormattedMessage id="EmailSignupForm.submitFailed" />
        </p>
      ) : null;

      const classes = classNames(rootClassName || css.root, className);
      const submitInProgress = inProgress;
      const submitDisabled = invalid || pristine || submitInProgress;

      const privacyLink = (
        <NamedLink name="PrivacyPolicyPage" className={css.privacyLink} target="_blank">
          <FormattedMessage id="EmailSignupForm.consentPrivacyLinkText" />
        </NamedLink>
      );

      return (
        <Form className={classes} onSubmit={handleSubmit}>
          <FormSpy subscription={{ values: true }} onChange={handleFormChange} />

          <FieldTextInput
            className={css.field}
            labelClassName={css.visuallyHiddenLabel}
            type="text"
            id={`${formId}.name`}
            name="name"
            autoComplete="name"
            label={intl.formatMessage({ id: 'EmailSignupForm.nameLabel' })}
            placeholder={intl.formatMessage({ id: 'EmailSignupForm.namePlaceholder' })}
            validate={composeValidators(
              required(intl.formatMessage({ id: 'EmailSignupForm.nameRequired' })),
              maxLength(tooLongMessage('name', MAX_LENGTHS.name), MAX_LENGTHS.name)
            )}
          />

          <FieldTextInput
            className={css.field}
            labelClassName={css.visuallyHiddenLabel}
            type="email"
            id={`${formId}.email`}
            name="email"
            autoComplete="email"
            label={intl.formatMessage({ id: 'EmailSignupForm.emailLabel' })}
            placeholder={intl.formatMessage({ id: 'EmailSignupForm.emailPlaceholder' })}
            validate={composeValidators(
              required(intl.formatMessage({ id: 'EmailSignupForm.emailRequired' })),
              emailFormatValid(intl.formatMessage({ id: 'EmailSignupForm.emailInvalid' })),
              maxLength(tooLongMessage('email', MAX_LENGTHS.email), MAX_LENGTHS.email)
            )}
          />

          <FieldTextInput
            className={css.field}
            labelClassName={css.visuallyHiddenLabel}
            type="text"
            id={`${formId}.zipCode`}
            name="zipCode"
            autoComplete="postal-code"
            label={intl.formatMessage({ id: 'EmailSignupForm.zipCodeLabel' })}
            placeholder={intl.formatMessage({ id: 'EmailSignupForm.zipCodePlaceholder' })}
            validate={composeValidators(
              required(intl.formatMessage({ id: 'EmailSignupForm.zipCodeRequired' })),
              maxLength(tooLongMessage('zipCode', MAX_LENGTHS.zipCode), MAX_LENGTHS.zipCode)
            )}
          />

          <FieldCheckbox
            rootClassName={css.consent}
            textClassName={css.consentText}
            id={`${formId}.consent`}
            name="consent"
            value={CONSENT_VALUE}
            label={intl.formatMessage({ id: 'EmailSignupForm.consentLabel' }, { privacyLink })}
            validate={requiredFieldArrayCheckbox(
              intl.formatMessage({ id: 'EmailSignupForm.consentRequired' })
            )}
          />

          {/* Honeypot. Hidden from sight, from assistive tech and from the tab order. */}
          <div className={css.honeypot} aria-hidden="true">
            <FieldTextInput
              type="text"
              id={`${formId}.${HONEYPOT_FIELD}`}
              name={HONEYPOT_FIELD}
              label={intl.formatMessage({ id: 'EmailSignupForm.honeypotLabel' })}
              tabIndex="-1"
              autoComplete="off"
            />
          </div>

          {submitErrorMessage}

          <Button
            rootClassName={css.submitButton}
            spinnerClassName={css.submitSpinner}
            type="submit"
            inProgress={submitInProgress}
            disabled={submitDisabled}
          >
            <FormattedMessage id="EmailSignupForm.submit" />
          </Button>
        </Form>
      );
    }}
  />
);

export default EmailSignupForm;
