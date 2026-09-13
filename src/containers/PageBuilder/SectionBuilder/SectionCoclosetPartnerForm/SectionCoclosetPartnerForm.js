import React from 'react';
import classNames from 'classnames';
import { bool, func, object } from 'prop-types';
import { connect } from 'react-redux';

import { FormattedMessage } from '../../../../util/reactIntl';
import { propTypes } from '../../../../util/types';
import { H3 } from '../../../../components';
import Field, { hasDataInFields } from '../../Field';
import SectionContainer from '../SectionContainer';

import PartnerApplicationForm from './PartnerApplicationForm/PartnerApplicationForm';
import { submitApplication, clearSubmitError } from './SectionCoclosetPartnerForm.duck';

import css from './SectionCoclosetPartnerForm.module.css';

/**
 * THE PARTNER-APPLICATION FORM SECTION.
 *
 * Console section: `form` (authored as `columns`, 2 blocks).
 *
 *   block 0 (`form-info`) - "Learn more about partnership" + a paragraph, rendered on the
 *     left as white type against a full-bleed dark-teal band.
 *   block 1 (`form-block`) - an empty Console placeholder. Its own title/text are ignored on
 *     purpose: this is where the REAL PartnerApplicationForm renders instead, inside a white
 *     card floating on the dark band, per the reference screenshot. The screenshot's own
 *     field labels ("Preferred day(s)", the "Consultation Booking Form" title, the "EXAMPLE
 *     FORM ONLY" watermark) are a throwaway Canva mockup and are not reproduced - only the
 *     card's chrome (white, rounded, shadow, label-above-input, full-width dark submit
 *     button) is copied.
 *
 * UNLIKE every other bespoke section on this page, this one is `connect()`-ed: the form
 * needs submit-in-progress/error/submitted state, and PageBuilder's SectionBuilder renders a
 * section component as a plain `<Component {...section} />`, which does not care whether
 * that component happens to read from the Redux store.
 *
 * The dark-teal background is this component's OWN CSS (`--coclosetPartnerTealDark`), not
 * dependent on Console's `appearance` (currently the plain default) - the same pattern
 * SectionCoclosetHero/Laundry use for their own backgrounds.
 */

const ApplicationSubmitted = () => (
  <div className={css.submitted} role="status">
    <H3 className={css.submittedTitle}>
      <FormattedMessage id="SectionCoclosetPartnerForm.submittedTitle" />
    </H3>
    <p className={css.submittedMessage}>
      <FormattedMessage id="SectionCoclosetPartnerForm.submittedMessage" />
    </p>
  </div>
);

export const SectionCoclosetPartnerFormComponent = props => {
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
    applicationSubmitted,
    onSubmitApplication,
    onFormChange,
  } = props;

  const fieldComponents = options?.fieldComponents;
  const fieldOptions = { fieldComponents };

  const [infoBlock] = blocks;
  const hasBody = hasDataInFields([infoBlock?.text], fieldOptions);

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
          {infoBlock?.title?.content ? (
            <h2 className={css.headline}>{infoBlock.title.content}</h2>
          ) : null}
          {hasBody ? (
            <Field data={infoBlock.text} className={css.body} options={fieldOptions} />
          ) : null}
        </div>

        <div className={css.card}>
          {applicationSubmitted ? (
            <ApplicationSubmitted />
          ) : (
            <PartnerApplicationForm
              onSubmit={onSubmitApplication}
              onChange={onFormChange}
              inProgress={submitInProgress}
              submitApplicationError={submitError}
            />
          )}
        </div>
      </div>
    </SectionContainer>
  );
};

SectionCoclosetPartnerFormComponent.propTypes = {
  submitInProgress: bool,
  submitError: propTypes.error,
  applicationSubmitted: bool,
  onSubmitApplication: func.isRequired,
  onFormChange: func.isRequired,
  options: object,
};

const mapStateToProps = state => {
  const { submitInProgress, submitError, applicationSubmitted } = state.partnerApplicationForm;
  return { submitInProgress, submitError, applicationSubmitted };
};

const mapDispatchToProps = dispatch => ({
  onSubmitApplication: values => dispatch(submitApplication(values)),
  onFormChange: () => dispatch(clearSubmitError()),
});

const SectionCoclosetPartnerForm = connect(
  mapStateToProps,
  mapDispatchToProps
)(SectionCoclosetPartnerFormComponent);

export default SectionCoclosetPartnerForm;
