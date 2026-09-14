import React from 'react';
import classNames from 'classnames';

import Field, { hasDataInFields } from '../../Field';
import SectionContainer from '../SectionContainer';

import css from './SectionCoclosetLandingHero.module.css';

/**
 * THE MAIN LANDING PAGE'S OPENING SPLIT.
 *
 * Console section: `landing-hero` (authored as `article`, 4 blocks).
 *
 *   section title       - the two-line headline ("The shared closet on your corner.")
 *   section description - the standfirst paragraph
 *   section callToAction - the pink pill button ("BROWSE LISTINGS" -> /s)
 *   blocks (`hero-img` x4) - four photos, media only, no title/text on any of them
 *
 * The stock `article` renderer (SectionArticle) stacks all 4 block images as separate
 * full-width rows down the page, one after another - nothing like the reference screenshot's
 * compact, asymmetric photo collage sitting beside the type. This component reads the same
 * four fields Console already has and lays the four images out as a 2x2 collage instead.
 *
 * `appearance` IS DELIBERATELY NOT FORWARDED to `SectionContainer`. The section's own
 * `appearance` still carries a leftover full-bleed `backgroundImage` + dark overlay +
 * `textColor: white` from an older design of this page - the reference screenshot is a plain
 * cream background, so that appearance is dead content this component ignores rather than
 * renders.
 */
const SectionCoclosetLandingHero = props => {
  const {
    sectionId,
    className,
    rootClassName,
    defaultClasses,
    title,
    description,
    callToAction,
    blocks = [],
    options,
  } = props;

  const fieldComponents = options?.fieldComponents;
  const fieldOptions = { fieldComponents };

  const hasCta = hasDataInFields([callToAction], fieldOptions);
  const hasCollage = blocks.some(block => hasDataInFields([block?.media], fieldOptions));

  return (
    <SectionContainer
      id={sectionId}
      className={className}
      rootClassName={classNames(rootClassName || css.root)}
      options={fieldOptions}
    >
      <div className={css.layout}>
        <div className={css.copy}>
          <Field data={title} className={css.headline} options={fieldOptions} />
          <Field data={description} className={css.standfirst} options={fieldOptions} />
          {hasCta ? <Field data={callToAction} className={css.cta} options={fieldOptions} /> : null}
        </div>

        {hasCollage ? (
          <div className={css.collage}>
            {blocks.map((block, index) => (
              <div className={css.collageItem} key={block?.blockId || `hero-img-${index}`}>
                <Field
                  data={block?.media}
                  className={css.collageMedia}
                  sizes="(max-width: 767px) 45vw, 260px"
                  options={fieldOptions}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </SectionContainer>
  );
};

export default SectionCoclosetLandingHero;
