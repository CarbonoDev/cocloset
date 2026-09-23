import React from 'react';
import classNames from 'classnames';

import Field, { hasDataInFields } from '../../Field';
import SectionContainer from '../SectionContainer';

import css from './SectionCoclosetPartnerHero.module.css';

/**
 * THE become-a-partner OPENING BANNER.
 *
 * Console section: `partner-hero` (authored as `article`, one block).
 *
 *   section title       - the headline ("Grow your business with CoCloset.")
 *   section description - the standfirst ("Reach new dry cleaning customers at no cost.")
 *   block 0 (`header-title`) - the small-caps eyebrow ("DRY CLEANING PARTNERS")
 *   appearance.backgroundImage - the full-bleed photo
 *
 * Unlike SectionCoclosetHero (the main landing page's split hero), the headline and
 * standfirst here are the SECTION's own title/description fields, not a block's - that is
 * how the become-a-partner asset is authored, and matches the reference screenshot: a small
 * eyebrow label top-left over the photo, and BELOW it a rounded card with the headline and
 * paragraph, both left-aligned rather than centered.
 */
const SectionCoclosetPartnerHero = props => {
  const {
    sectionId,
    className,
    rootClassName,
    defaultClasses,
    title,
    description,
    appearance,
    blocks = [],
    options,
  } = props;

  const fieldComponents = options?.fieldComponents;
  const fieldOptions = { fieldComponents };

  const [eyebrowBlock] = blocks;
  const hasEyebrow = hasDataInFields([eyebrowBlock?.text], fieldOptions);
  const hasCard = hasDataInFields([title, description], fieldOptions);

  return (
    <SectionContainer
      id={sectionId}
      className={className}
      rootClassName={classNames(rootClassName || css.root)}
      appearance={appearance}
      options={fieldOptions}
    >
      <div className={css.layout}>

        {hasCard ? (
          <div className={css.card}>
            {hasEyebrow ? (
              <Field data={eyebrowBlock.text} className={css.eyebrow} options={fieldOptions} />
            ) : null}
            
            <Field data={title} className={css.headline} options={fieldOptions} />
            <Field data={description} className={css.description} options={fieldOptions} />
          </div>
        ) : null}
      </div>
    </SectionContainer>
  );
};

export default SectionCoclosetPartnerHero;
