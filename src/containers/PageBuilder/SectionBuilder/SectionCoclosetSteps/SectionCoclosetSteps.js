import React from 'react';
import classNames from 'classnames';

import { splitLeadingHeading } from '../../../../util/coclosetLandingContent';
import Field, { hasDataInFields } from '../../Field';
import SectionContainer from '../SectionContainer';

import css from './SectionCoclosetSteps.module.css';

/**
 * THE THREE NUMBERED STEPS.
 *
 * Console section: `guide` (authored as `columns`, three blocks). Each block holds its
 * numeral in the `title` field and its own name again as a markdown heading:
 *
 *   title: "01"
 *   text:  "#### Lend a piece you love\n\nDrop your garment at any partner laundry..."
 *
 * Rendered by the stock `columns` component that comes out as a large "01" with the step
 * name printed underneath it at heading size - the numeral dominating the thing it is
 * supposed to be numbering. Here the numeral is the small terracotta marker the design asks
 * for, the markdown heading is lifted out and set as the step's real title, and the rest of
 * the markdown is the body.
 *
 * THE NUMERAL IS PRINTED AS AUTHORED, NOT AS AN INDEX. The blocks currently read "01", "2",
 * "03" - the second one is inconsistent, and it would be easy to "fix" that here by
 * numbering from the array index. That would be a silent override of content: an operator
 * reordering the blocks in Console would then see numbers that disagree with what they
 * typed, and no way to tell which one the page was going to believe.
 */
const SectionCoclosetSteps = props => {
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
            const { heading, body } = splitLeadingHeading(block?.text?.content);
            // The markdown heading is the step's name; the block's own `blockName` is the
            // fallback because Console shows it in the editor's block list and an operator
            // who fills that in but not the markdown still means it as the name.
            const stepTitle = heading || block?.blockName || null;
            const numeral = block?.title?.content;

            return (
              <li className={css.step} key={block?.blockId || `step-${index}`}>
                {numeral ? <p className={css.numeral}>{numeral}</p> : null}
                {stepTitle ? <h3 className={css.stepTitle}>{stepTitle}</h3> : null}
                {body ? (
                  <Field
                    data={{ fieldType: 'markdown', content: body }}
                    className={css.stepBody}
                    options={fieldOptions}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </SectionContainer>
  );
};

export default SectionCoclosetSteps;
