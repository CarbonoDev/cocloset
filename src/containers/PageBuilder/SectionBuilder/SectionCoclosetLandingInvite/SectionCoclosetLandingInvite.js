import React from 'react';
import classNames from 'classnames';
import { bool, func, object } from 'prop-types';
import { connect } from 'react-redux';

import { FormattedMessage } from '../../../../util/reactIntl';
import { propTypes } from '../../../../util/types';
import { H3 } from '../../../../components';
import Field, { hasDataInFields } from '../../Field';
import SectionContainer from '../SectionContainer';

import EmailSignupForm from './EmailSignupForm/EmailSignupForm';
import { submitSignup, clearSubmitError } from './SectionCoclosetLandingInvite.duck';

import css from './SectionCoclosetLandingInvite.module.css';

/**
 * THE "COMING SOON" EMAIL-LIST SIGNUP.
 *
 * Console section: `invite` (authored as `columns`, 2 blocks).
 *
 *   block 0 (`invite-text`) - "CoCloset is coming soon to a city near you." + a paragraph,
 *     rendered as white type against a full-bleed dark-teal band (left, on wide viewports).
 *   block 1 (`invite-form`) - an empty Console placeholder, exactly like `form-block` on
 *     /p/become-a-partner: its own title/text are never read. The REAL signup form
 *     (`EmailSignupForm`) renders here instead, inside a cream/white card, per the reference
 *     screenshot.
 *
 * UNLIKE the other bespoke landing-page sections, this one is `connect()`-ed - it needs
 * submit-in-progress/error/submitted state, and PageBuilder's SectionBuilder renders a section
 * component as a plain `<Component {...section} />`, which does not care whether the
 * component happens to read from the Redux store. Same pattern as
 * `SectionCoclosetPartnerForm`, which this file mirrors closely - see that component's own
 * header for more on why the connected form needs this shape.
 *
 * The dark-teal background is this component's OWN CSS, not dependent on Console's
 * `appearance` (currently the plain default) - same approach SectionCoclosetHero/Laundry/
 * PartnerForm use for their own fixed backgrounds. It reuses `--coclosetPartnerTealDark`
 * (become-a-partner, 2026-09-12): sampled by eye against this refresh's own screenshot, the
 * shade reads as the same deep teal rather than a different one worth a new token.
 */

const SignupSubmitted = () => (
  <div className={css.submitted} role="status">
    <H3 className={css.submittedTitle}>
      <FormattedMessage id="SectionCoclosetLandingInvite.submittedTitle" />
    </H3>
    <p className={css.submittedMessage}>
      <FormattedMessage id="SectionCoclosetLandingInvite.submittedMessage" />
    </p>
  </div>
);

// Final Form's array-checkbox convention puts the consent checkbox's checked value into an
// array (see EmailSignupForm's CONSENT_VALUE) - the duck / server expect a strict boolean, so
// the shape is collapsed here, at the one seam between the form and the submit thunk.
const toSignupPayload = values => ({
  ...values,
  consent: Array.isArray(values.consent) && values.consent.includes('true'),
});

export const SectionCoclosetLandingInviteComponent = props => {
  const {
    sectionId,
    className,
    rootClassName,
    defaultClasses,
    appearance,
    blocks = [],
    options,
    submitInProgress,
    submitError,
    signupSubmitted,
    onSubmitSignup,
    onFormChange,
  } = props;

  const fieldComponents = options?.fieldComponents;
  const fieldOptions = { fieldComponents };

  const [textBlock] = blocks;
  const hasBody = hasDataInFields([textBlock?.text], fieldOptions);

  return (
    <SectionContainer
      id={sectionId}
      className={className}
      rootClassName={classNames(rootClassName || css.root)}
      appearance={appearance}
      options={fieldOptions}
    >
      <div className={css.layout}>
        <div className={css.info}>
          {textBlock?.title?.content ? (
            <h2 className={css.headline}>{textBlock.title.content}</h2>
          ) : null}
          {hasBody ? (
            <Field data={textBlock.text} className={css.body} options={fieldOptions} />
          ) : null}
        </div>

        <div className={css.card}>
          {signupSubmitted ? (
            <SignupSubmitted />
          ) : (
            <EmailSignupForm
              onSubmit={values => onSubmitSignup(toSignupPayload(values))}
              onChange={onFormChange}
              inProgress={submitInProgress}
              submitSignupError={submitError}
            />
          )}
        </div>
      </div>
    </SectionContainer>
  );
};

SectionCoclosetLandingInviteComponent.propTypes = {
  submitInProgress: bool,
  submitError: propTypes.error,
  signupSubmitted: bool,
  onSubmitSignup: func.isRequired,
  onFormChange: func.isRequired,
  options: object,
};

const mapStateToProps = state => {
  const { submitInProgress, submitError, signupSubmitted } = state.landingInviteForm;
  return { submitInProgress, submitError, signupSubmitted };
};

const mapDispatchToProps = dispatch => ({
  onSubmitSignup: values => dispatch(submitSignup(values)),
  onFormChange: () => dispatch(clearSubmitError()),
});

const SectionCoclosetLandingInvite = connect(
  mapStateToProps,
  mapDispatchToProps
)(SectionCoclosetLandingInviteComponent);

export default SectionCoclosetLandingInvite;
