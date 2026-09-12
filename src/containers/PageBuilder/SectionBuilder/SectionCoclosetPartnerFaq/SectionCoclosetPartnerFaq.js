import React from 'react';
import classNames from 'classnames';

import Field, { hasDataInFields } from '../../Field';
import SectionContainer from '../SectionContainer';

import css from './SectionCoclosetPartnerFaq.module.css';

/**
 * THE PARTNER FAQ.
 *
 * Console section: `faq` (authored as `article`, 7 `faq-item` blocks, each a question in
 * `title` and its answer in `text`).
 *
 * Split into two columns - first `Math.ceil(n / 2)` blocks down the left, the rest down the
 * right - matching the reference screenshot, which reads top-to-bottom per column rather
 * than left-right per row. No card chrome: this is a plain Q&A list on the page background.
 *
 * The section's own `title` is empty in the live asset today, so the "FAQ" heading in the
 * screenshot has nothing to render from yet - see the activity log for the Console follow-up.
 * This component does not hardcode it: Console owns the words, this file owns the layout.
 */
const SectionCoclosetPartnerFaq = props => {
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

  const hasHeading = hasDataInFields([title, description], fieldOptions);

  const splitPoint = Math.ceil(blocks.length / 2);
  const leftColumn = blocks.slice(0, splitPoint);
  const rightColumn = blocks.slice(splitPoint);

  const renderItem = (block, index) => {
    const hasAnswer = hasDataInFields([block?.text], fieldOptions);
    return (
      <div className={css.item} key={`${block.blockName || 'faq'}_${index}`}>
        {block?.title?.content ? <p className={css.question}>{block.title.content}</p> : null}
        {hasAnswer ? (
          <Field data={block.text} className={css.answer} options={fieldOptions} />
        ) : null}
      </div>
    );
  };

  return (
    <SectionContainer
      id={sectionId}
      className={className}
      rootClassName={classNames(rootClassName || css.root)}
      appearance={appearance}
      options={fieldOptions}
    >
      <div className={css.layout}>
        {hasHeading ? (
          <div className={css.heading}>
            <Field data={title} className={css.title} options={fieldOptions} />
            <Field data={description} className={css.description} options={fieldOptions} />
          </div>
        ) : null}

        {blocks.length > 0 ? (
          <div className={css.columns}>
            <div className={css.column}>{leftColumn.map(renderItem)}</div>
            <div className={css.column}>{rightColumn.map(renderItem)}</div>
          </div>
        ) : null}
      </div>
    </SectionContainer>
  );
};

export default SectionCoclosetPartnerFaq;
