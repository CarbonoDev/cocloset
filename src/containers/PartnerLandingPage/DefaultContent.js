import React from 'react';

import { FormattedMessage } from '../../util/reactIntl';
import { H1, H2, H3 } from '../../components';

import css from './PartnerLandingPage.module.css';

/**
 * Built-in marketing copy for PartnerLandingPage.
 *
 * This is the FALLBACK. The preferred source of this content is a Console-managed
 * hosted page (asset `content/pages/laundry-partners.json`), so the operator can edit
 * it without a deploy — see the comment block at the top of PartnerLandingPage.js.
 * Everything here renders only when that page does not exist yet.
 *
 * COPY PROVENANCE — read before editing:
 * - The role description, the rental workflow and the cleaning-buffer behaviour are
 *   taken from the project requirements (Project Overview §1, §2.3, §3.1, §3.3, §3.8).
 * - Anything commercially specific (commission, payout schedule, contract terms,
 *   insurance, storage minimums, review times, the contact address) is NOT defined
 *   anywhere yet. Those strings are marked `[TBC]` in `src/translations/en.json` and
 *   must be replaced with the real terms before this page goes live.
 */

const RESPONSIBILITY_KEYS = [
  'receiveFromOwners',
  'storeBetweenRentals',
  'handOverToRenters',
  'receiveReturns',
  'registerCondition',
  'setTurnaround',
  'cleanAndPrepare',
  'trackOrders',
];

const STEP_KEYS = ['assign', 'confirm', 'book', 'handover', 'returnAndClean'];

const REQUIREMENT_KEYS = ['storage', 'hours', 'capabilities', 'device', 'compliance'];

const COMMERCIAL_KEYS = ['turnaround', 'cleaningFee', 'commission', 'payouts', 'contract'];

const FAQ_KEYS = [
  'whatIsTheRole',
  'payments',
  'turnaround',
  'categories',
  'damage',
  'orders',
  'cost',
  'afterApplying',
];

const Hero = () => (
  <section className={css.hero}>
    <H1 className={css.heroTitle}>
      <FormattedMessage id="PartnerLandingPage.heroTitle" />
    </H1>
    <p className={css.heroSubtitle}>
      <FormattedMessage id="PartnerLandingPage.heroSubtitle" />
    </p>
    <a className={css.heroCta} href="#apply">
      <FormattedMessage id="PartnerLandingPage.heroCta" />
    </a>
  </section>
);

const BulletSection = props => {
  const { titleId, introId, keys, keyPrefix } = props;
  return (
    <section className={css.section}>
      <H2 className={css.sectionTitle}>
        <FormattedMessage id={titleId} />
      </H2>
      {introId ? (
        <p className={css.sectionIntro}>
          <FormattedMessage id={introId} />
        </p>
      ) : null}
      <ul className={css.list}>
        {keys.map(key => (
          <li className={css.listItem} key={key}>
            <FormattedMessage id={`${keyPrefix}.${key}`} />
          </li>
        ))}
      </ul>
    </section>
  );
};

const HowItWorks = () => (
  <section className={css.section}>
    <H2 className={css.sectionTitle}>
      <FormattedMessage id="PartnerLandingPage.howItWorksTitle" />
    </H2>
    <ol className={css.steps}>
      {STEP_KEYS.map((key, index) => (
        <li className={css.step} key={key}>
          <span className={css.stepNumber}>{index + 1}</span>
          <span className={css.stepText}>
            <FormattedMessage id={`PartnerLandingPage.step.${key}`} />
          </span>
        </li>
      ))}
    </ol>
  </section>
);

const Faq = () => (
  <section className={css.section}>
    <H2 className={css.sectionTitle}>
      <FormattedMessage id="PartnerLandingPage.faqTitle" />
    </H2>
    {FAQ_KEYS.map(key => (
      <div className={css.faqItem} key={key}>
        <H3 className={css.faqQuestion}>
          <FormattedMessage id={`PartnerLandingPage.faq.${key}.question`} />
        </H3>
        <p className={css.faqAnswer}>
          <FormattedMessage id={`PartnerLandingPage.faq.${key}.answer`} />
        </p>
      </div>
    ))}
  </section>
);

/**
 * The whole built-in content stack: hero, what the role involves, how a rental flows
 * through a partner location, commercial information, requirements and FAQ.
 *
 * The application form is NOT part of this component — it is always rendered by
 * PartnerLandingPage, whether the copy comes from Console or from here.
 *
 * @component
 * @returns {JSX.Element}
 */
const DefaultContent = () => (
  <>
    <Hero />
    <BulletSection
      titleId="PartnerLandingPage.responsibilitiesTitle"
      introId="PartnerLandingPage.responsibilitiesIntro"
      keys={RESPONSIBILITY_KEYS}
      keyPrefix="PartnerLandingPage.responsibility"
    />
    <HowItWorks />
    <BulletSection
      titleId="PartnerLandingPage.commercialTitle"
      introId="PartnerLandingPage.commercialIntro"
      keys={COMMERCIAL_KEYS}
      keyPrefix="PartnerLandingPage.commercial"
    />
    <BulletSection
      titleId="PartnerLandingPage.requirementsTitle"
      introId="PartnerLandingPage.requirementsIntro"
      keys={REQUIREMENT_KEYS}
      keyPrefix="PartnerLandingPage.requirement"
    />
    <Faq />
  </>
);

export default DefaultContent;
