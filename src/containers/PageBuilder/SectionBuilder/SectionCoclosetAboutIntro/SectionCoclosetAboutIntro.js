import React from 'react';
import classNames from 'classnames';

import Field, { hasDataInFields } from '../../Field';
import SectionContainer from '../SectionContainer';

import css from './SectionCoclosetAboutIntro.module.css';

/**
 * THE OPENING OF /p/about: "Welcome to CoCloset", then one photo+text block.
 *
 * Console section: `Our story` (authored as `features`, 1 block combining media, a title and
 * a paragraph in one block - unlike `brand-description` on /p/become-a-partner, which is the
 * same visual layout but authored as two SEPARATE blocks, one media-only and one text-only.
 * See SectionCoclosetPartnerAbout for that shape; this is its own component rather than a
 * generalisation of that one so a future edit to either page's block shape cannot silently
 * change the other's.
 *
 * The section's own `title` ("Welcome to CoCloset") is the page's H1 - bold and centred,
 * distinct from the block's own teal serif sub-heading below it.
 */
const SectionCoclosetAboutIntro = props => {
  const {
    sectionId,
    className,
    rootClassName,
    title,
    appearance,
    blocks = [],
    options,
  } = props;

  const fieldComponents = options?.fieldComponents;
  const fieldOptions = { fieldComponents };

  const [block] = blocks;
  const hasMedia = hasDataInFields([block?.media], fieldOptions);
  const hasBody = hasDataInFields([block?.text], fieldOptions);
  const hasTitle = !!title?.content;

  return (
    <SectionContainer
      id={sectionId}
      className={className}
      rootClassName={classNames(rootClassName || css.root)}
      appearance={appearance}
      options={fieldOptions}
    >
      {hasTitle ? <h1 className={css.pageTitle}>{title.content}</h1> : null}

      <div className={css.layout}>
        {/* Copy first in DOM order, so it lands in the LEFT column on desktop (mockup: text
            left, photo right) - the opposite of SectionCoclosetPartnerAbout, which puts its
            media block first because ITS reference screenshot is mirrored the other way. */}
        <div className={css.copy}>
          {block?.title?.content ? <h2 className={css.headline}>{block.title.content}</h2> : null}
          {hasBody ? <Field data={block.text} className={css.body} options={fieldOptions} /> : null}
        </div>

        {hasMedia ? (
          <div className={css.media}>
            <Field
              data={block.media}
              sizes="(max-width: 1023px) 100vw, 560px"
              options={fieldOptions}
            />
          </div>
        ) : null}
      </div>
    </SectionContainer>
  );
};

export default SectionCoclosetAboutIntro;
