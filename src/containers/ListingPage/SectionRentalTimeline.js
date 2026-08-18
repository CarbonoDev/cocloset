import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';
import { RENTAL_TIMELINE_STEPS } from '../../util/rentalTimeline';

import css from './ListingPage.module.css';

/**
 * WHAT HAPPENS AFTER "Request to book", as a row of steps.
 *
 * A Cocloset rental is not the two-party handover a renter expects: the garment goes to a
 * studio, waits, is collected there, comes back there, is cleaned, and only then is on the
 * market again. Every one of those is a real state in the `cocloset-booking` process, and the
 * page has so far explained none of them before the customer pays.
 *
 * THE ORDER IS THE PROCESS'S, and it is transcribed rather than derived. Deriving it from the
 * process module would look rigorous and be worse: that module's transition table exists to
 * decide what a transaction may do next, and it contains branches - late returns, damage,
 * cancellations - that are not a story anybody wants told on a listing page. This is the
 * happy path, stated as such.
 *
 * NOT a status display. Nothing here reflects any particular transaction; the page is public
 * and there is no booking yet. Every step is drawn the same way, deliberately - a highlighted
 * "current" step would be a lie about a rental that does not exist.
 *
 * THE LIST ITSELF LIVES IN util/rentalTimeline.js, because the inbox marks the SAME eight
 * steps against a real rental. Two copies would drift the first time a step was renamed, and
 * the two surfaces sit one click apart - a reader told about "Returned to laundry" here and
 * something else there has been told about two things.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className]
 * @returns {JSX.Element}
 */

const SectionRentalTimeline = props => {
  const { className } = props;

  return (
    <section className={classNames(css.sectionRentalTimeline, className)}>
      <h2 className={css.sectionHeadingWithExtraMargin}>
        <FormattedMessage id="ListingPage.rentalTimelineTitle" />
      </h2>
      <ol className={css.timelineSteps}>
        {RENTAL_TIMELINE_STEPS.map((step, index) => (
          <li key={step.key} className={css.timelineStep}>
            <span className={css.timelineStepNumber} aria-hidden="true">
              {index + 1}
            </span>
            <FormattedMessage id={`ListingPage.rentalTimeline.${step.key}`} />
          </li>
        ))}
      </ol>
    </section>
  );
};

export default SectionRentalTimeline;
