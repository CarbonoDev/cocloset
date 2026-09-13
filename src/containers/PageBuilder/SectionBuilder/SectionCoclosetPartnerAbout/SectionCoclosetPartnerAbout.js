import React from 'react';
import classNames from 'classnames';

import Field, { hasDataInFields } from '../../Field';
import SectionContainer from '../SectionContainer';

import css from './SectionCoclosetPartnerAbout.module.css';

/**
 * THE "WHAT IS COCLOSET?" INTRODUCTION.
 *
 * Console section: `brand-description` (authored as `columns`, 2 blocks).
 *
 *   block 0 (`description-image`) - the rack photo
 *   block 1 (`description-text`)  - "What is CoCloset?" + a paragraph
 *
 * Built as its own component rather than left to the stock `columns` renderer because the
 * reference screenshot sets the block's own title in the page's DISPLAY serif and brand teal,
 * at roughly the same scale as the hero headline, and its body copy noticeably larger than
 * the site's default paragraph size - neither of which `BlockDefault` produces (it renders a
 * block title as a plain bold sans-serif heading, sized for a feature list, not a section
 * introduction).
 */
const SectionCoclosetPartnerAbout = props => {
  const {
    sectionId,
    className,
    rootClassName,
    defaultClasses,
    appearance,
    blocks = [],
    options,
  } = props;

  const fieldComponents = options?.fieldComponents;
  const fieldOptions = { fieldComponents };

  const [mediaBlock, textBlock] = blocks;
  const hasMedia = hasDataInFields([mediaBlock?.media], fieldOptions);
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
        {hasMedia ? (
          <div className={css.media}>
            <Field
              data={mediaBlock.media}
              sizes="(max-width: 1023px) 100vw, 560px"
              options={fieldOptions}
            />
          </div>
        ) : null}

        <div className={css.copy}>
          {textBlock?.title?.content ? (
            <h2 className={css.headline}>{textBlock.title.content}</h2>
          ) : null}
          {hasBody ? (
            <Field data={textBlock.text} className={css.body} options={fieldOptions} />
          ) : null}
        </div>
      </div>
    </SectionContainer>
  );
};

export default SectionCoclosetPartnerAbout;
