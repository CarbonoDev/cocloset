import React from 'react';
import classNames from 'classnames';

import css from './coclosetSkin.module.css';

/**
 * THE COCLOSET LOOK, ON THE SECTIONS NOBODY DESIGNED A BESPOKE LAYOUT FOR.
 *
 *   > "usa la misma inspiración para adecuar el sitio provider_landing_page"
 *
 * The landing page has four sections with layouts of their own. Every other hosted section -
 * `/p/about`, `/p/provider_landing_page`, the two named `ignore`, and anything an operator
 * adds next year - renders through the stock component for its type. Those components are
 * fine; what they lacked was the page's voice. This wraps them so they get it.
 *
 * A WRAPPER, NOT A FORK. Each stock section is rendered as-is, with two things substituted:
 *
 *   - `className`, COMPOSED with whatever SectionBuilder passed rather than replacing it.
 *     That matters: SectionBuilder puts the dark-theme class there when an operator picks a
 *     white text colour in Console, and overwriting it would silently drop their choice.
 *   - `defaultClasses`, the shared styles a section applies to its title, description and CTA.
 *     Substituting them is what makes a stock section speak in eyebrow-and-headline without
 *     touching a single stock file.
 *
 * Block-level copy is deliberately left alone. Body text is body text, and restyling it here
 * would mean re-deciding typography the template has already settled, in a file that cannot
 * see the content it is restyling.
 *
 * WHY NOT A STYLESHEET OVER THE WHOLE PAGE. CSS Modules hash their class names, so a
 * page-level stylesheet cannot reach `SectionColumns`' own classes at all. Passing classes IN
 * is the only hook the template actually offers, and it is the one it was designed around -
 * `defaultClasses` exists precisely so a marketplace can restyle sections without forking
 * them.
 */

// The Cocloset replacements for SectionBuilder's DEFAULT_CLASSES. Same keys, so every stock
// section finds what it expects; a key added upstream simply falls back to undefined and
// renders unstyled rather than crashing.
const COCLOSET_CLASSES = {
  sectionDetails: css.sectionDetails,
  title: css.title,
  description: css.description,
  ctaButton: css.ctaButton,
  blockContainer: css.blockContainer,
  defaultLink: css.defaultLink,
};

/**
 * Sections the skin must not touch, by the name the operator gave them in Console.
 *
 *   > "hay dos secciones que llamé ignore, esas deben permanecer tal cual"
 *
 * Taken literally: "as they are" means as they RENDER, not merely as they are authored. A
 * page-wide restyle would still have changed their background and their headings, which is
 * the one thing that was asked not to happen. So the skin is decided per section rather than
 * per section type, and a section named `ignore` comes out byte for byte what it is today.
 */
const UNSKINNED_SECTION_NAMES = ['ignore'];

const isUnskinned = sectionName =>
  typeof sectionName === 'string' &&
  UNSKINNED_SECTION_NAMES.includes(sectionName.trim().toLowerCase());

/**
 * Wrap a section component so it renders in the Cocloset skin.
 *
 * @param {React.ComponentType} Section - a stock section component
 * @returns {React.ComponentType}
 */
export const withCoclosetSkin = Section => {
  const Skinned = props =>
    isUnskinned(props.sectionName) ? (
      <Section {...props} />
    ) : (
      <Section
        {...props}
        className={classNames(props.className, css.section)}
        defaultClasses={{ ...props.defaultClasses, ...COCLOSET_CLASSES }}
      />
    );
  Skinned.displayName = `WithCoclosetSkin(${Section.displayName || Section.name || 'Section'})`;
  return Skinned;
};

export default withCoclosetSkin;
