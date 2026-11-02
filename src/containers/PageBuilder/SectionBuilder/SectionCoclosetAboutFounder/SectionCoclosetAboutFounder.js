import React from 'react';
import classNames from 'classnames';

import Field, { hasDataInFields } from '../../Field';
import SectionContainer from '../SectionContainer';

import css from './SectionCoclosetAboutFounder.module.css';

/**
 * THE FOUNDER BIO BAND, at the bottom of /p/about.
 *
 * Console section: `Our team` (authored as `features`, 1 block: a bold name/title heading, a
 * bio paragraph, and a photo). Deliberately its own component rather than the stock
 * `SectionFeatures` block renderer: the reference screenshots set this apart from the rest of
 * the page with a full-bleed tinted band (var(--coclosetCanvas), the same "alt" tone the
 * landing page alternates onto its own sections) and a bold SANS-SERIF name heading - the
 * opposite of SectionCoclosetAboutIntro's teal serif headline just above it on the same page,
 * which is the point: this reads as a person speaking, not as another editorial section.
 */
const SectionCoclosetAboutFounder = props => {
  const { sectionId, className, rootClassName, appearance, blocks = [], options } = props;

  const fieldComponents = options?.fieldComponents;
  const fieldOptions = { fieldComponents };

  const [block] = blocks;
  const hasMedia = hasDataInFields([block?.media], fieldOptions);
  const hasBody = hasDataInFields([block?.text], fieldOptions);

  return (
    <SectionContainer
      id={sectionId}
      className={className}
      rootClassName={classNames(rootClassName || css.root)}
      appearance={appearance}
      options={fieldOptions}
    >
      <div className={css.layout}>
        <div className={css.copy}>
          {block?.title?.content ? <h2 className={css.name}>{block.title.content}</h2> : null}
          {hasBody ? <Field data={block.text} className={css.body} options={fieldOptions} /> : null}
        </div>

        {hasMedia ? (
          <div className={css.media}>
            <Field
              data={block.media}
              sizes="(max-width: 1023px) 100vw, 480px"
              options={fieldOptions}
            />
          </div>
        ) : null}
      </div>
    </SectionContainer>
  );
};

export default SectionCoclosetAboutFounder;
