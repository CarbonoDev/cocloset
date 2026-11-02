import React from 'react';
import classNames from 'classnames';

import { splitHeadline, splitTrailingLinks } from '../../../../util/coclosetLandingContent';
import Field, { hasDataInFields } from '../../Field';
import SectionContainer from '../SectionContainer';

import css from './SectionCoclosetHero.module.css';

/**
 * THE LANDING PAGE'S OPENING SPLIT.
 *
 * Console section: `tittle-section` (authored as `columns`, two blocks).
 *
 *   block 0 - the eyebrow, the two-tone headline, the standfirst and two buttons
 *   block 1 - the garment imagery, with a "how it works" card floated over its lower edge
 *
 * The stock `columns` renderer puts those two side by side as equals, each with its heading
 * above its text. The design is not two columns of the same thing: the left side is type and
 * the right is a picture with a card lying across it, and the card has to overlap the image
 * rather than sit under it. That overlap is the whole reason this is a component instead of
 * a stylesheet on `SectionColumns` - it needs the two blocks in different roles.
 *
 * WHAT IS READ FROM CONTENT RATHER THAN HARDCODED
 * Everything. The eyebrow is the section title, the headline's two tones are the two lines
 * the operator typed, the buttons are the trailing markdown links, and the card is block 1's
 * own title and text. Nothing on this page is spelled in the code, so the copy stays
 * editable in Console - which is the point of it being a hosted page at all.
 *
 * Both blocks are optional and independent. A section with only block 0 renders as a
 * type-only hero rather than as a hole where an image should be.
 */
const SectionCoclosetHero = props => {
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

  const [mainBlock, mediaBlock] = blocks;

  // The headline carries its own two-tone instruction as a line break; see splitHeadline.
  const { lead, accent } = splitHeadline(mainBlock?.title?.content);
  // ...and its buttons as trailing links, which markdown would otherwise render inline.
  const { body, links } = splitTrailingLinks(mainBlock?.text?.content);

  const hasEyebrow = hasDataInFields([title, description], fieldOptions);
  const hasMedia = hasDataInFields([mediaBlock?.media], fieldOptions);
  const cardText = mediaBlock?.text?.content;
  const cardTitle = mediaBlock?.title?.content;
  const hasCard = !!(cardTitle || cardText);

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
          {hasEyebrow ? (
            <p className={css.eyebrow}>
              <Field data={title} options={fieldOptions} />
              <Field data={description} options={fieldOptions} />
            </p>
          ) : null}

          {lead ? (
            <h1 className={css.headline}>
              <span className={css.headlineLead}>{lead}</span>
              {/* The second line is the accent. Rendered inside the same h1 so the whole
                  headline is one heading to a screen reader, and carries no meaning of its
                  own beyond the styling - which is why it is a span and not an <em>. */}
              {accent ? <span className={css.headlineAccent}>{accent}</span> : null}
            </h1>
          ) : null}

          {body ? (
            <Field
              data={{ fieldType: 'markdown', content: body }}
              className={css.standfirst}
              options={fieldOptions}
            />
          ) : null}

          {links.length > 0 ? (
            <div className={css.actions}>
              {links.map((link, index) => (
                <Field
                  key={`${link.href}_${index}`}
                  // The first link is the page's primary action and the rest are secondary,
                  // matching the design's filled-then-outlined pair. Order in Console is the
                  // only thing that decides this, which is the least surprising rule
                  // available - there is no field in the editor for button emphasis.
                  data={{ fieldType: 'internalButtonLink', content: link.label, href: link.href }}
                  className={index === 0 ? css.primaryAction : css.secondaryAction}
                  options={fieldOptions}
                />
              ))}
            </div>
          ) : null}
        </div>

        {hasMedia || hasCard ? (
          <div className={css.showcase}>
            {hasMedia ? (
              <div className={css.media}>
                <Field
                  data={mediaBlock.media}
                  sizes="(max-width: 1023px) 100vw, 560px"
                  options={fieldOptions}
                />
              </div>
            ) : null}

            {hasCard ? (
              <aside className={classNames(css.card, { [css.cardFloating]: hasMedia })}>
                {cardTitle ? <p className={css.cardLabel}>{cardTitle}</p> : null}
                {cardText ? (
                  <Field
                    data={{ fieldType: 'markdown', content: cardText }}
                    className={css.cardBody}
                    options={fieldOptions}
                  />
                ) : null}
              </aside>
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionContainer>
  );
};

export default SectionCoclosetHero;
