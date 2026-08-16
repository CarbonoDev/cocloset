import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';

import css from './ListingPage.module.css';

/**
 * WHY THE CALENDAR HOLDS DAYS AFTER A RENTAL, said in a sentence.
 *
 * The design puts this directly under the pickup location, and it earns its place: the
 * calendar refuses days that look free, the booking summary announces an "available again"
 * date later than the return date, and without this paragraph a customer has to infer the
 * reason from two numbers that never explain themselves.
 *
 * IT STATES THE REAL NUMBER OR IT SAYS NOTHING. `cleaningTurnaroundDays` is the studio's live
 * turnaround, resolved by the same server call that produces the calendar's blocked days - so
 * the sentence and the squares cannot disagree. With no number resolved (no studio assigned,
 * or a failed read) the whole section is omitted rather than printed with a guess: a
 * marketing sentence about cleaning that quotes the wrong duration is worse than no sentence.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className]
 * @param {number} [props.cleaningTurnaroundDays]
 * @param {string} [props.laundryName] - the studio's own name, when the listing carries one
 * @returns {JSX.Element|null}
 */
const SectionCleaningWorks = props => {
  const { className, cleaningTurnaroundDays, laundryName } = props;

  if (!(cleaningTurnaroundDays > 0)) {
    return null;
  }

  // Two sentences, chosen by whether we can name the studio. Not one string with an
  // interpolated "the laundry" fallback: that reads as a placeholder nobody filled in.
  const messageId = laundryName
    ? 'ListingPage.cleaningWorksBodyNamed'
    : 'ListingPage.cleaningWorksBody';

  return (
    <section className={classNames(css.sectionCleaningWorks, className)}>
      <h2 className={css.sectionHeadingWithExtraMargin}>
        <FormattedMessage id="ListingPage.cleaningWorksTitle" />
      </h2>
      <p className={css.cleaningWorksBody}>
        <FormattedMessage id={messageId} values={{ days: cleaningTurnaroundDays, laundryName }} />
      </p>
    </section>
  );
};

export default SectionCleaningWorks;
