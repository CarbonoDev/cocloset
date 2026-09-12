import React from 'react';
import { Form as FinalForm, FormSpy } from 'react-final-form';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../../../util/reactIntl';
import { propTypes } from '../../../../../util/types';
import {
  composeValidators,
  emailFormatValid,
  maxLength,
  minLength,
  numberAtLeast,
  required,
} from '../../../../../util/validators';

import { Form, Button, FieldTextInput, H3 } from '../../../../../components';

import css from './PartnerApplicationForm.module.css';

/**
 * Field length caps. These MUST stay in sync with `FIELD_SPECS` in
 * `server/api-util/laundryPartnerApplication.js` — the server is the authority and will
 * reject anything longer, so the client caps exist purely to give a better error than
 * a 400.
 */
export const MAX_LENGTHS = {
  studioName: 120,
  contactName: 120,
  email: 160,
  phone: 40,
  address: 300,
  businessHours: 200,
  acceptedCategories: 300,
  notes: 2000,
};

export const MAX_TURNAROUND_DAYS = 30;

/**
 * Name of the honeypot input. It is rendered off-screen, hidden from assistive
 * technology and removed from the tab order, so no human ever fills it. Naive spam
 * bots fill every input they can find; the server drops any submission where this is
 * non-empty. This is a cheap first line of defence, not a substitute for a real
 * challenge — see the notes in `server/api/laundry-partner-application.js`.
 */
export const HONEYPOT_FIELD = 'website';

/**
 * PartnerApplicationForm
 *
 * Public, unauthenticated application form for laundries that want to become
 * operational partners of the marketplace.
 *
 * Field names deliberately match `LaundryProfileForm` where they overlap
 * (`studioName`, `businessHours`, `turnaroundDays`, `acceptedCategories`, including
 * the comma-separated-string convention for categories) so an approved application
 * maps onto a real laundry profile without renaming anything. Turnaround is stated in
 * DAYS for the same reason: that is the unit the profile field it becomes
 * (`privateData.turnaroundDays`) is in, and an application quoting hours would need an
 * operator to convert it by hand.
 *
 * `address` is the one exception: the real profile stores a geocoded `location` place
 * object via FieldLocationAutocompleteInput, which needs a configured map provider.
 * An anonymous marketing page should not depend on that, so the application collects a
 * plain-text address that an operator geocodes during onboarding.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.formId] - The form id
 * @param {Function} props.onSubmit - The function to handle form submission
 * @param {boolean} [props.inProgress] - Whether the submission is in progress
 * @param {propTypes.error} [props.submitApplicationError] - The submission error
 * @returns {JSX.Element}
 */
const PartnerApplicationForm = props => (
  <FinalForm
    {...props}
    render={fieldRenderProps => {
      const {
        className,
        formId = 'PartnerApplicationForm',
        handleSubmit,
        invalid,
        pristine,
        rootClassName,
        inProgress,
        submitApplicationError,
        onChange,
      } = fieldRenderProps;

      const intl = useIntl();

      // Clear a previous submit error as soon as the applicant starts editing again.
      const handleFormChange = () => {
        if (submitApplicationError && onChange) {
          onChange();
        }
      };

      const tooLongMessage = (field, max) =>
        intl.formatMessage({ id: `PartnerApplicationForm.${field}TooLong` }, { max });

      const submitErrorMessage = submitApplicationError ? (
        <p className={css.error} role="alert">
          <FormattedMessage id="PartnerApplicationForm.submitFailed" />
        </p>
      ) : null;

      const classes = classNames(rootClassName || css.root, className);
      const submitInProgress = inProgress;
      const submitDisabled = invalid || pristine || submitInProgress;

      return (
        <Form className={classes} onSubmit={handleSubmit}>
          <FormSpy subscription={{ values: true }} onChange={handleFormChange} />

          <H3 className={css.fieldsetLegend}>
            <FormattedMessage id="PartnerApplicationForm.businessDetailsTitle" />
          </H3>

          <FieldTextInput
            className={css.field}
            type="text"
            id={`${formId}.studioName`}
            name="studioName"
            autoComplete="organization"
            label={intl.formatMessage({ id: 'PartnerApplicationForm.studioNameLabel' })}
            placeholder={intl.formatMessage({
              id: 'PartnerApplicationForm.studioNamePlaceholder',
            })}
            validate={composeValidators(
              required(intl.formatMessage({ id: 'PartnerApplicationForm.studioNameRequired' })),
              maxLength(
                tooLongMessage('studioName', MAX_LENGTHS.studioName),
                MAX_LENGTHS.studioName
              )
            )}
          />

          <FieldTextInput
            className={css.field}
            type="text"
            id={`${formId}.address`}
            name="address"
            autoComplete="street-address"
            label={intl.formatMessage({ id: 'PartnerApplicationForm.addressLabel' })}
            placeholder={intl.formatMessage({ id: 'PartnerApplicationForm.addressPlaceholder' })}
            validate={composeValidators(
              required(intl.formatMessage({ id: 'PartnerApplicationForm.addressRequired' })),
              maxLength(tooLongMessage('address', MAX_LENGTHS.address), MAX_LENGTHS.address)
            )}
          />

          <FieldTextInput
            className={css.field}
            type="text"
            id={`${formId}.businessHours`}
            name="businessHours"
            label={intl.formatMessage({ id: 'PartnerApplicationForm.businessHoursLabel' })}
            placeholder={intl.formatMessage({
              id: 'PartnerApplicationForm.businessHoursPlaceholder',
            })}
            validate={composeValidators(
              required(intl.formatMessage({ id: 'PartnerApplicationForm.businessHoursRequired' })),
              maxLength(
                tooLongMessage('businessHours', MAX_LENGTHS.businessHours),
                MAX_LENGTHS.businessHours
              )
            )}
          />

          <H3 className={css.fieldsetLegend}>
            <FormattedMessage id="PartnerApplicationForm.contactTitle" />
          </H3>

          <FieldTextInput
            className={css.field}
            type="text"
            id={`${formId}.contactName`}
            name="contactName"
            autoComplete="name"
            label={intl.formatMessage({ id: 'PartnerApplicationForm.contactNameLabel' })}
            placeholder={intl.formatMessage({
              id: 'PartnerApplicationForm.contactNamePlaceholder',
            })}
            validate={composeValidators(
              required(intl.formatMessage({ id: 'PartnerApplicationForm.contactNameRequired' })),
              maxLength(
                tooLongMessage('contactName', MAX_LENGTHS.contactName),
                MAX_LENGTHS.contactName
              )
            )}
          />

          <FieldTextInput
            className={css.field}
            type="email"
            id={`${formId}.email`}
            name="email"
            autoComplete="email"
            label={intl.formatMessage({ id: 'PartnerApplicationForm.emailLabel' })}
            placeholder={intl.formatMessage({ id: 'PartnerApplicationForm.emailPlaceholder' })}
            validate={composeValidators(
              required(intl.formatMessage({ id: 'PartnerApplicationForm.emailRequired' })),
              emailFormatValid(intl.formatMessage({ id: 'PartnerApplicationForm.emailInvalid' })),
              maxLength(tooLongMessage('email', MAX_LENGTHS.email), MAX_LENGTHS.email)
            )}
          />

          <FieldTextInput
            className={css.field}
            type="tel"
            id={`${formId}.phone`}
            name="phone"
            autoComplete="tel"
            label={intl.formatMessage({ id: 'PartnerApplicationForm.phoneLabel' })}
            placeholder={intl.formatMessage({ id: 'PartnerApplicationForm.phonePlaceholder' })}
            validate={composeValidators(
              required(intl.formatMessage({ id: 'PartnerApplicationForm.phoneRequired' })),
              minLength(intl.formatMessage({ id: 'PartnerApplicationForm.phoneInvalid' }), 5),
              maxLength(tooLongMessage('phone', MAX_LENGTHS.phone), MAX_LENGTHS.phone)
            )}
          />

          <H3 className={css.fieldsetLegend}>
            <FormattedMessage id="PartnerApplicationForm.capabilitiesTitle" />
          </H3>
{/* 
          <FieldTextInput
            className={css.field}
            type="text"
            id={`${formId}.acceptedCategories`}
            name="acceptedCategories"
            label={intl.formatMessage({ id: 'PartnerApplicationForm.acceptedCategoriesLabel' })}
            placeholder={intl.formatMessage({
              id: 'PartnerApplicationForm.acceptedCategoriesPlaceholder',
            })}
            helpText={intl.formatMessage({ id: 'PartnerApplicationForm.acceptedCategoriesHelp' })}
            validate={composeValidators(
              required(
                intl.formatMessage({ id: 'PartnerApplicationForm.acceptedCategoriesRequired' })
              ),
              maxLength(
                tooLongMessage('acceptedCategories', MAX_LENGTHS.acceptedCategories),
                MAX_LENGTHS.acceptedCategories
              )
            )}
          />

          <FieldTextInput
            className={css.field}
            type="number"
            step="1"
            min="1"
            max={String(MAX_TURNAROUND_DAYS)}
            id={`${formId}.turnaroundDays`}
            name="turnaroundDays"
            label={intl.formatMessage({ id: 'PartnerApplicationForm.turnaroundDaysLabel' })}
            placeholder={intl.formatMessage({
              id: 'PartnerApplicationForm.turnaroundDaysPlaceholder',
            })}
            helpText={intl.formatMessage({ id: 'PartnerApplicationForm.turnaroundDaysHelp' })}
            parse={value => {
              const parsed = Number.parseInt(value, 10);
              return Number.isNaN(parsed) ? null : parsed;
            }}
            validate={composeValidators(
              required(intl.formatMessage({ id: 'PartnerApplicationForm.turnaroundDaysRequired' })),
              numberAtLeast(
                intl.formatMessage({ id: 'PartnerApplicationForm.turnaroundDaysInvalid' }),
                1
              )
            )}
          /> */}

          <FieldTextInput
            className={css.field}
            type="textarea"
            id={`${formId}.notes`}
            name="notes"
            label={intl.formatMessage({ id: 'PartnerApplicationForm.notesLabel' })}
            placeholder={intl.formatMessage({ id: 'PartnerApplicationForm.notesPlaceholder' })}
            validate={maxLength(tooLongMessage('notes', MAX_LENGTHS.notes), MAX_LENGTHS.notes)}
          />

          {/* Honeypot. Hidden from sight, from assistive tech and from the tab order. */}
          <div className={css.honeypot} aria-hidden="true">
            <FieldTextInput
              type="text"
              id={`${formId}.${HONEYPOT_FIELD}`}
              name={HONEYPOT_FIELD}
              label={intl.formatMessage({ id: 'PartnerApplicationForm.honeypotLabel' })}
              tabIndex="-1"
              autoComplete="off"
            />
          </div>

          {submitErrorMessage}

          {/* `rootClassName`, not `className`: see the note on `.submitButton`. It replaces the
              template's `buttonPrimary` root rather than competing with it at equal specificity. */}
          <Button
            rootClassName={css.submitButton}
            spinnerClassName={css.submitSpinner}
            type="submit"
            inProgress={submitInProgress}
            disabled={submitDisabled}
          >
            <FormattedMessage id="PartnerApplicationForm.submit" />
          </Button>

          <p className={css.finePrint}>
            <FormattedMessage id="PartnerApplicationForm.finePrint" />
          </p>
        </Form>
      );
    }}
  />
);

export default PartnerApplicationForm;
