import React from 'react';
import classNames from 'classnames';

import Field, { hasDataInFields } from '../../Field';
import SectionContainer from '../SectionContainer';

import css from './SectionCoclosetPartnerBenefits.module.css';

/**
 * THE PARTNER-BENEFITS TILE ROW.
 *
 * Console section: `benefits` (authored as `columns`, 3 blocks).
 *
 *   section title - "Benefits" today; the reference screenshots say "Partner Benefits".
 *     This is a Console content mismatch, not something this component can fix - the
 *     Asset Delivery API is read-only from here. Renders whatever title Console holds,
 *     verbatim; see the activity log for the follow-up to give Jonathan.
 *   each block    - an icon image, a title, and a paragraph.
 *
 * NOTE ON THE NAME `benefits`: this exact name is ALSO used, with the same shape and the
 * same three benefits verbatim, by /p/provider_landing_page. Since section-name matching is
 * global (see coclosetLandingSections.js), that page's own "Benefits" section renders
 * through this component too - a deliberate, accepted side effect. See the long comment on
 * `coclosetPartnerBenefits` there.
 */
const SectionCoclosetPartnerBenefits = props => {
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
          <ul className={css.cards}>
            {blocks.map((block, index) => {
              const hasIcon = hasDataInFields([block?.media], fieldOptions);
              const hasText = hasDataInFields([block?.text], fieldOptions);
              return (
                <li className={css.card} key={`${block.blockName || 'benefit'}_${index}`}>
                  {hasIcon ? (
                    <div className={css.badge}>
                      <Field
                        data={block.media}
                        className={css.badgeImage}
                        sizes="64px"
                        options={fieldOptions}
                      />
                    </div>
                  ) : null}
                  {block.title?.content ? (
                    <p className={css.cardTitle}>{block.title.content}</p>
                  ) : null}
                  {hasText ? (
                    <Field data={block.text} className={css.cardText} options={fieldOptions} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </SectionContainer>
  );
};

export default SectionCoclosetPartnerBenefits;
