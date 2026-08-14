import React from 'react';
import classNames from 'classnames';

import { parseTiles, splitTrailingLinks } from '../../../../util/coclosetLandingContent';
import Field, { hasDataInFields } from '../../Field';
import SectionContainer from '../SectionContainer';

import css from './SectionCoclosetLaundry.module.css';

/**
 * THE PANEL ADDRESSED TO LAUNDRY PARTNERS.
 *
 * Console section: `laundry-section` (authored as `columns`, two blocks).
 *
 *   block 0 - the pitch and a link to the ops dashboard
 *   block 1 - six tiles, written as fenced code because a fence is the only thing in the
 *             editor that groups a label and a title into one unit
 *
 * Today the fences render as monospaced code blocks - literally the marketplace's pitch to
 * its partners printed as source. `parseTiles` reads them back into label/title pairs.
 *
 * THE TILES ARE STATIC, AND SAY SO. They read "LIVE TILE" because in the design they stand in
 * for the counts on the real ops dashboard, and this is a public marketing page: the numbers
 * behind them are one studio's private workload, not something to publish to anonymous
 * visitors, and there is no "current user's laundry" on a page a logged-out reader is meant
 * to see. They are rendered as the labelled placeholders the content describes - a promise of
 * what the dashboard shows, behind the button that opens it.
 */
const SectionCoclosetLaundry = props => {
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

  const [pitchBlock, tilesBlock] = blocks;
  const { body, links } = splitTrailingLinks(pitchBlock?.text?.content);
  const tiles = parseTiles(tilesBlock?.text?.content);
  const hasEyebrow = hasDataInFields([title, description], fieldOptions);

  return (
    <SectionContainer
      id={sectionId}
      className={className}
      rootClassName={classNames(rootClassName || css.root)}
      appearance={appearance}
      options={fieldOptions}
    >
      <div className={css.panel}>
        <div className={css.pitch}>
          {hasEyebrow ? (
            <p className={css.eyebrow}>
              <Field data={title} options={fieldOptions} />
              <Field data={description} options={fieldOptions} />
            </p>
          ) : null}

          {pitchBlock?.title?.content ? (
            <h2 className={css.headline}>{pitchBlock.title.content}</h2>
          ) : null}

          {body ? (
            <Field
              data={{ fieldType: 'markdown', content: body }}
              className={css.body}
              options={fieldOptions}
            />
          ) : null}

          {links.length > 0 ? (
            <div className={css.actions}>
              {links.map((link, index) => (
                <Field
                  key={`${link.href}_${index}`}
                  data={{ fieldType: 'internalButtonLink', content: link.label, href: link.href }}
                  className={css.action}
                  options={fieldOptions}
                />
              ))}
            </div>
          ) : null}
        </div>

        {tiles.length > 0 ? (
          <ul className={css.tiles}>
            {tiles.map((tile, index) => (
              <li className={css.tile} key={`${tile.title}_${index}`}>
                {tile.label ? <p className={css.tileLabel}>{tile.label}</p> : null}
                <p className={css.tileTitle}>{tile.title}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </SectionContainer>
  );
};

export default SectionCoclosetLaundry;
