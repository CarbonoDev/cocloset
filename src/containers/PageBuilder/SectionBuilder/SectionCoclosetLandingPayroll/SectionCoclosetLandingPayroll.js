import React from 'react';
import classNames from 'classnames';

import Field, { hasDataInFields } from '../../Field';
import SectionContainer from '../SectionContainer';

import css from './SectionCoclosetLandingPayroll.module.css';

/**
 * THE GARMENT-OWNER LENDING PITCH, "PUT YOUR CLOSET ON PAYROLL."
 *
 * Console section: `steps` (authored as `columns`, 3 blocks). DO NOT CONFUSE THE NAME WITH
 * `SectionCoclosetSteps` (the numbered how-it-works list) - despite the name, the content here
 * is the garment-owner pitch: a cream title band, then a full-bleed photo of a closet with
 * three white cards and a CTA overlaid on it. See the long comment in
 * `coclosetLandingSections.js` for why this got its own type instead.
 *
 *   section title       - "Put your closet on payroll." (cream band, teal serif)
 *   section description - the subtitle under it. Console currently duplicates the title text
 *     here rather than the screenshot's "Turn your clothes into monthly passive income" -
 *     a content bug, not something this component papers over; see the activity log.
 *   section callToAction - "START LISTING" -> /l/new, rendered as the pink pill below the
 *     cards, still over the photo.
 *   appearance.customAppearance.backgroundImage - the closet/rack photo. `SectionContainer`
 *     already renders any `customAppearance` as a full-bleed absolutely-positioned background
 *     behind this component's children (see SectionContainer.js) - passing `appearance`
 *     straight through is all that is needed to get the photo full-bleed behind the whole
 *     section, title band included, which is why the title band below is given its own
 *     opaque background to sit on top of the part of the photo it needs to hide.
 *   blocks (`step-block` x3) - title + text only, no media. Rendered as plain white cards.
 */
const SectionCoclosetLandingPayroll = props => {
  const {
    sectionId,
    className,
    rootClassName,
    defaultClasses,
    title,
    description,
    callToAction,
    appearance,
    blocks = [],
    options,
  } = props;

  const fieldComponents = options?.fieldComponents;
  const fieldOptions = { fieldComponents };
  const hasCta = hasDataInFields([callToAction], fieldOptions);

  return (
    <SectionContainer
      id={sectionId}
      className={className}
      rootClassName={classNames(rootClassName || css.root)}
      appearance={appearance}
      options={fieldOptions}
    >
      <div className={css.titleBand}>
        <Field data={title} className={css.headline} options={fieldOptions} />
        <Field data={description} className={css.subtitle} options={fieldOptions} />
      </div>

      <div className={css.photoArea}>
        {blocks.length > 0 ? (
          <div className={css.cards}>
            {blocks.map((block, index) => (
              <div className={css.card} key={block?.blockId || `step-block-${index}`}>
                <Field data={block?.title} className={css.cardTitle} options={fieldOptions} />
                <Field data={block?.text} className={css.cardBody} options={fieldOptions} />
              </div>
            ))}
          </div>
        ) : null}

        {hasCta ? <Field data={callToAction} className={css.cta} options={fieldOptions} /> : null}
      </div>
    </SectionContainer>
  );
};

export default SectionCoclosetLandingPayroll;
