import React from 'react';
import classNames from 'classnames';

import Field, { hasDataInFields } from '../../Field';
import SectionContainer from '../SectionContainer';

import css from './SectionCoclosetLandingFlow.module.css';

/**
 * THE ICON-ILLUSTRATED "HOW IT WORKS".
 *
 * Console section: `flow-section` (authored as `columns`, 3 blocks).
 *
 *   section title - "How it Works", rendered large and centered (a real display heading, not
 *     the small tracked eyebrow the OTHER numbered-steps component, SectionCoclosetSteps,
 *     uses for its own header - see that component and coclosetLandingSections.js for why
 *     this is a separate component rather than a shape bolted onto that one).
 *   blocks (`flow-block` x3) - each with a real `media.image` (a Console-hosted icon that
 *     already IS a filled circular badge - see the block's image asset directly; there is no
 *     circle drawn by this component), a `title` that already contains its own numeral
 *     ("1. Find your style") and a plain-paragraph `text`.
 *
 * NOTHING IS SPLIT OUT OF THE TITLE. Unlike SectionCoclosetSteps, which pulls a numeral out of
 * one field and a heading out of another because that is how ITS content is authored, this
 * section's title already reads as one phrase ("1. Find your style") and is printed exactly
 * as typed.
 */
const SectionCoclosetLandingFlow = props => {
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
  const hasHeader = hasDataInFields([title, description], fieldOptions);

  return (
    <SectionContainer
      id={sectionId}
      className={className}
      rootClassName={classNames(rootClassName || css.root)}
      appearance={appearance}
      options={fieldOptions}
    >
      <div className={css.layout}>
        {hasHeader ? (
          <header className={css.header}>
            <Field data={title} className={css.sectionTitle} options={fieldOptions} />
            <Field data={description} className={css.sectionDescription} options={fieldOptions} />
          </header>
        ) : null}

        <ol className={css.steps}>
          {blocks.map((block, index) => {
            const hasIcon = hasDataInFields([block?.media], fieldOptions);

            return (
              <li className={css.step} key={block?.blockId || `flow-block-${index}`}>
                {hasIcon ? (
                  <Field
                    data={block.media}
                    className={css.icon}
                    sizes="112px"
                    options={fieldOptions}
                  />
                ) : null}
                <Field data={block?.title} className={css.stepTitle} options={fieldOptions} />
                <Field data={block?.text} className={css.stepBody} options={fieldOptions} />
              </li>
            );
          })}
        </ol>
      </div>
    </SectionContainer>
  );
};

export default SectionCoclosetLandingFlow;
