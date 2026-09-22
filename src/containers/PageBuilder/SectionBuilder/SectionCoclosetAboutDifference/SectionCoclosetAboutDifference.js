import React from 'react';
import classNames from 'classnames';

import Field, { hasDataInFields } from '../../Field';
import SectionContainer from '../SectionContainer';

import css from './SectionCoclosetAboutDifference.module.css';

/**
 * TEXT-ONLY SECTION OF /p/about.
 *
 * Console section: `How we're different` (authored as `features`, 1 block containing
 * a title and body text). It uses its own component so the editorial heading can use
 * the Cocloset teal/display treatment without affecting other stock `features` sections.
 */
const SectionCoclosetAboutDifference = props => {
  const { sectionId, className, rootClassName, appearance, blocks = [], options } = props;

  const fieldComponents = options?.fieldComponents;
  const fieldOptions = { fieldComponents };

  const [block] = blocks;
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
          {block?.title?.content ? (
            <h2 className={css.headline}>{block.title.content}</h2>
          ) : null}

          {hasBody ? (
            <Field data={block.text} className={css.body} options={fieldOptions} />
          ) : null}
        </div>
      </div>
    </SectionContainer>
  );
};

export default SectionCoclosetAboutDifference;