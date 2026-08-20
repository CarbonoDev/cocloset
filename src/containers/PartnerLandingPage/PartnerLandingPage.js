import React from 'react';
import loadable from '@loadable/component';
import classNames from 'classnames';
import { bool, func, object } from 'prop-types';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { propTypes } from '../../util/types';
import { isScrollingDisabled } from '../../ducks/ui.duck';

import { ExternalLink, H2, H3, IconSpinner, LayoutSingleColumn, Page } from '../../components';

import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import DefaultContent from './DefaultContent';
import PartnerApplicationForm from './PartnerApplicationForm/PartnerApplicationForm';
import { ASSET_NAME, submitApplication, clearSubmitError } from './PartnerLandingPage.duck';
import css from './PartnerLandingPage.module.css';

/**
 * PartnerLandingPage — the public "become a laundry partner" page.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A REACT CONTAINER AND NOT A PLAIN CONSOLE PAGE
 * ---------------------------------------------------------------------------
 * The project convention is to prefer Console/hosted configuration wherever it can
 * express the requirement, and marketing copy is exactly that kind of thing. It cannot
 * be a *pure* hosted page though: Sharetribe Pages can only emit the built-in section
 * and field types, its markdown pipeline strips raw HTML (`remark-rehype` runs without
 * `allowDangerousHtml`, then `rehype-sanitize`), and PageBuilder's custom
 * section/block/field extension points can only be triggered from code, never from
 * Console. There is no way for an operator to place a lead-capture form on a hosted
 * page.
 *
 * So this page is the hybrid the template itself supports (the same pattern
 * `FooterContainer` and `TermsOfServicePage` use): the *copy* comes from the hosted
 * page asset `content/pages/laundry-partners.json`, rendered through `SectionBuilder`,
 * and the *form* is code. The operator owns the words; we own the interaction.
 *
 * Until that Console page exists the page still works: it renders `DefaultContent`,
 * the built-in copy under `PartnerLandingPage.*` in the translation files. That matters
 * because Console access for this marketplace is still pending, and a page that renders
 * blank until someone gets credentials is not shippable.
 *
 * TO MOVE THE COPY INTO CONSOLE: create a new page in Console with the exact URL slug
 * `laundry-partners`, add hero / text / FAQ sections, and publish. No deploy is needed —
 * this route picks it up on the next load and stops rendering the built-in copy. Link
 * the hero CTA at `<marketplace URL>/become-a-partner#apply` to jump to the form.
 */

const SectionBuilder = loadable(
  () => import(/* webpackChunkName: "SectionBuilder" */ '../PageBuilder/PageBuilder'),
  {
    resolveComponent: components => components.SectionBuilder,
  }
);

/**
 * Pull an optional string off a hosted page's `meta` block.
 *
 * @param {Object} data denormalized hosted page asset data
 * @param {string} fieldName e.g. 'pageTitle' or 'pageDescription'
 * @returns {string|null}
 */
export const hostedMetaContent = (data, fieldName) => {
  const content = data?.meta?.[fieldName]?.content;
  return typeof content === 'string' && content.trim() !== '' ? content : null;
};

const ApplicationSubmitted = () => (
  <div className={css.submitted} role="status">
    <H3 className={css.submittedTitle}>
      <FormattedMessage id="PartnerLandingPage.submittedTitle" />
    </H3>
    <p className={css.submittedMessage}>
      <FormattedMessage id="PartnerLandingPage.submittedMessage" />
    </p>
  </div>
);

/**
 * @component
 * @param {Object} props
 * @param {Object} [props.pageAssetsData] - Hosted page assets keyed by asset name
 * @param {boolean} [props.inProgress] - Whether the hosted asset fetch is in progress
 * @param {boolean} props.scrollingDisabled - Whether scrolling is disabled
 * @param {boolean} [props.submitInProgress] - Whether the application submit is in progress
 * @param {propTypes.error} [props.submitError] - The application submit error
 * @param {boolean} [props.applicationSubmitted] - Whether an application was submitted
 * @param {Function} props.onSubmitApplication - Submits the application
 * @param {Function} props.onFormChange - Clears a previous submit error
 * @returns {JSX.Element}
 */
export const PartnerLandingPageComponent = props => {
  const intl = useIntl();
  const {
    pageAssetsData,
    inProgress,
    scrollingDisabled,
    submitInProgress,
    submitError,
    applicationSubmitted,
    onSubmitApplication,
    onFormChange,
  } = props;

  const hostedData = pageAssetsData?.[ASSET_NAME]?.data;
  const hostedSections = hostedData?.sections || [];
  const hasHostedContent = hostedSections.length > 0;

  const title =
    hostedMetaContent(hostedData, 'pageTitle') ||
    intl.formatMessage({ id: 'PartnerLandingPage.title' });
  const description =
    hostedMetaContent(hostedData, 'pageDescription') ||
    intl.formatMessage({ id: 'PartnerLandingPage.description' });

  const contactEmail = intl.formatMessage({ id: 'PartnerLandingPage.contactEmail' });

  const content = hasHostedContent ? (
    <SectionBuilder sections={hostedSections} options={{ isInsideContainer: true }} />
  ) : inProgress ? (
    <div className={css.loading}>
      <IconSpinner delay={600} />
    </div>
  ) : (
    <DefaultContent />
  );

  return (
    <Page title={title} description={description} scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn
        mainColumnClassName={css.layoutWrapperMain}
        topbar={<TopbarContainer />}
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          {content}

          {/* Canvas band, white card. The card is what separates the form from whatever
              precedes it, which matters most on the HOSTED path: every skinned section is
              canvas, so without it the form would run straight out of the last one. */}
          <section className={css.band} id="apply">
            <div className={css.bandInner}>
              <H2 className={css.sectionTitle}>
                <FormattedMessage id="PartnerLandingPage.applyTitle" />
              </H2>
              <p className={css.sectionIntro}>
                <FormattedMessage id="PartnerLandingPage.applyIntro" />
              </p>

              <div className={css.applyCard}>
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
          </section>

          <section className={classNames(css.band, css.bandAlt)}>
            <div className={css.bandInner}>
              <H2 className={css.sectionTitle}>
                <FormattedMessage id="PartnerLandingPage.contactTitle" />
              </H2>
              {/* Deliberately not a second form: a general-enquiry form would be the
                  application form minus two fields, and would double both the spam
                  surface and the number of places a message can get lost. */}
              <p className={css.sectionIntro}>
                <FormattedMessage
                  id="PartnerLandingPage.contactText"
                  values={{
                    contactLink: (
                      // target="_self": a mailto: in a new tab leaves an empty tab behind.
                      <ExternalLink
                        className={css.contactLink}
                        href={`mailto:${contactEmail}`}
                        target="_self"
                      >
                        {contactEmail}
                      </ExternalLink>
                    ),
                  }}
                />
              </p>
              <p className={css.placeholderNote}>
                <FormattedMessage id="PartnerLandingPage.contactPlaceholderNote" />
              </p>
            </div>
          </section>
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

PartnerLandingPageComponent.propTypes = {
  pageAssetsData: object,
  inProgress: bool,
  scrollingDisabled: bool.isRequired,
  submitInProgress: bool,
  submitError: propTypes.error,
  applicationSubmitted: bool,
  onSubmitApplication: func.isRequired,
  onFormChange: func.isRequired,
};

const mapStateToProps = state => {
  // Note: `state.hostedAssets.error` is deliberately not read. A missing
  // `laundry-partners` page is an expected state, not a page error — the absence of
  // hosted sections is enough to fall back to the built-in copy.
  const { pageAssetsData, inProgress } = state.hostedAssets || {};
  const { submitInProgress, submitError, applicationSubmitted } = state.PartnerLandingPage;

  return {
    pageAssetsData,
    inProgress,
    scrollingDisabled: isScrollingDisabled(state),
    submitInProgress,
    submitError,
    applicationSubmitted,
  };
};

const mapDispatchToProps = dispatch => ({
  onSubmitApplication: values => dispatch(submitApplication(values)),
  onFormChange: () => dispatch(clearSubmitError()),
});

const PartnerLandingPage = compose(
  connect(
    mapStateToProps,
    mapDispatchToProps
  )
)(PartnerLandingPageComponent);

export default PartnerLandingPage;
