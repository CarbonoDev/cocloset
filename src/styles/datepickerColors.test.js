import fs from 'fs';
import path from 'path';

import defaultConfig from '../config/configDefault';
import { mergeBranding } from '../util/configHelpers';
import { getCustomCSSPropertiesFromConfig } from '../util/style';

// A test that MEASURES the booking calendar's colours instead of eyeballing them.
//
// The bug it exists for: `--datepickerDisabledFgColor` was `var(--marketplaceColorDark)`
// while `--datepickerBgColor` was `var(--marketplaceColor)`. Both come from the same
// hosted `mainColor`, and `marketplaceColorDark` is just that colour with 10 lightness
// points subtracted - unclamped (src/util/configHelpers.js `hexToCssHsl`). Cocloset's
// Dev branding sets `mainColor: "#000000"`, so the disabled foreground evaluated to
// `hsl(0, 0%, -10%)`, which clamps to black: the same colour as the background. Every
// unavailable day in the calendar was invisible, and the client sent a screenshot of a
// black rectangle with nothing in it but the selected range.
//
// A snapshot could not have caught that, because the CSS was never wrong as text - it
// was wrong only once the brand colour was substituted into it. So this test does the
// substitution: it takes the REAL branding pipeline (hosted branding.json -> mergeBranding
// -> getCustomCSSPropertiesFromConfig, which is what writes these custom properties onto
// the document in src/util/style.js), resolves the datepicker variables out of the
// actual CSS file against it, composites any alpha, and computes WCAG contrast ratios.
//
// It is run for a BLACK brand colour (the one that broke) and for mid-tone purples (the
// stock defaults, where the old value was merely bad rather than fatal), so a future
// change cannot fix one and re-break the other.

const CSS_FILE = path.join(__dirname, 'marketplaceDefaults.css');
const DATEPICKER_CSS_FILE = path.join(
  __dirname,
  '..',
  'components',
  'DatePicker',
  'DatePickers',
  'DatePicker.module.css'
);

// Comments have to go before anything is parsed: these stylesheets document the
// variables they declare, in prose that quotes declarations verbatim, and a commented
// `--datepickerFgColor: var(--colorWhite)` would otherwise be read as the real one.
const readFile = file => fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Every `--foo: value;` declaration in a file, last one winning. Good enough because
// these variables are declared exactly once each, in one block per theme.
const parseCustomProperties = css => {
  const declarations = {};
  const re = /(--[A-Za-z0-9-]+)\s*:\s*([^;}]+)[;}]/g;
  let match;
  while ((match = re.exec(css)) !== null) {
    declarations[match[1]] = match[2].trim();
  }
  return declarations;
};

// Resolve `var(--x)` chains against a property table. Throws rather than returning a
// half-resolved string: a typo'd variable name silently resolving to `var(--typo)` would
// let this test pass while the calendar rendered with no colour at all.
const resolveValue = (value, properties, seen = []) => {
  const match = /^var\(\s*(--[A-Za-z0-9-]+)\s*\)$/.exec(value.trim());
  if (!match) {
    return value.trim();
  }
  const name = match[1];
  if (seen.includes(name)) {
    throw new Error(`Circular custom property reference: ${seen.concat(name).join(' -> ')}`);
  }
  if (!(name in properties)) {
    throw new Error(
      `Unknown custom property ${name} (referenced by ${seen.join(' -> ') || value})`
    );
  }
  return resolveValue(properties[name], properties, seen.concat(name));
};

// Does this value depend on the brand colour at all? The invariant the fix rests on:
// a foreground painted ON the brand colour must not be DERIVED from the brand colour.
const dependsOnMarketplaceColor = (value, properties, seen = []) => {
  const match = /^var\(\s*(--[A-Za-z0-9-]+)\s*\)$/.exec(value.trim());
  if (!match) {
    return false;
  }
  const name = match[1];
  if (/^--marketplaceColor(Dark|Light)?$/.test(name)) {
    return true;
  }
  if (seen.includes(name) || !(name in properties)) {
    return false;
  }
  return dependsOnMarketplaceColor(properties[name], properties, seen.concat(name));
};

// ---------------------------------------------------------------------------
// Colour maths. Only the notations this codebase actually writes: #rrggbb,
// space-separated `hsl(h s% l%)` (the grey palette), comma-separated
// `hsl(h, s%, l%)` (what hexToCssHsl emits), and rgb/rgba(). Anything else throws, so
// an unparsed colour fails loudly instead of being scored as black.
// ---------------------------------------------------------------------------

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const hslToRgb = (h, s, l) => {
  // Browsers clamp out-of-range lightness. Reproducing that is the whole point: it is
  // why `hsl(0, 0%, -10%)` renders as black rather than as an error.
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
      ? [x, c, 0]
      : hue < 180
      ? [0, c, x]
      : hue < 240
      ? [0, x, c]
      : hue < 300
      ? [x, 0, c]
      : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
};

const parseColor = value => {
  const input = value.trim().toLowerCase();

  const hex = /^#([0-9a-f]{6})$/.exec(input);
  if (hex) {
    const int = parseInt(hex[1], 16);
    // eslint-disable-next-line no-bitwise
    return { rgb: [(int >> 16) & 255, (int >> 8) & 255, int & 255], alpha: 1 };
  }

  const hsl = /^hsla?\(([^)]+)\)$/.exec(input);
  if (hsl) {
    const parts = hsl[1]
      .split(/[,/\s]+/)
      .map(part => part.trim())
      .filter(part => part !== '');
    const [h, s, l, a] = parts.map(part => Number.parseFloat(part));
    return { rgb: hslToRgb(h, s, l), alpha: parts.length > 3 ? a : 1 };
  }

  const rgb = /^rgba?\(([^)]+)\)$/.exec(input);
  if (rgb) {
    const parts = rgb[1]
      .split(/[,/\s]+/)
      .map(part => Number.parseFloat(part))
      .filter(part => !Number.isNaN(part));
    return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
  }

  throw new Error(`Cannot parse colour: ${value}`);
};

// What the eye actually receives: a translucent foreground composited over its
// background. Skipping this step is how a test would "prove" that
// rgba(255,255,255,0.6) has 21:1 contrast on black.
const composite = (foreground, background) => {
  const { rgb: fg, alpha } = parseColor(foreground);
  const { rgb: bg } = parseColor(background);
  return fg.map((channel, i) => alpha * channel + (1 - alpha) * bg[i]);
};

const relativeLuminance = rgb => {
  const [r, g, b] = rgb.map(channel => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (a, b) => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

// ---------------------------------------------------------------------------
// The theme, resolved for one hosted brand colour, exactly as the app does it.
// ---------------------------------------------------------------------------

const themeForBrandColor = mainColor => {
  // The real derivation: hosted branding.json -> mergeBranding (which computes
  // marketplaceColorDark/Light with hexToCssHsl) -> getCustomCSSPropertiesFromConfig,
  // which is exactly what src/util/style.js writes onto the document element. Nothing
  // here restates the -10 lightness offset, so a change to it is measured rather than
  // duplicated.
  const branding = mergeBranding({ marketplaceColors: { mainColor } }, defaultConfig.branding);
  const brandProperties = getCustomCSSPropertiesFromConfig(branding);
  const properties = { ...parseCustomProperties(readFile(CSS_FILE)), ...brandProperties };

  const resolve = name => resolveValue(`var(${name})`, properties);

  const background = resolve('--datepickerBgColor');
  const disabled = resolve('--datepickerDisabledFgColor');
  const enabled = resolve('--datepickerFgColor');

  return {
    properties,
    background,
    disabled,
    enabled,
    backgroundRgb: composite(background, background),
    disabledRgb: composite(disabled, background),
    enabledRgb: composite(enabled, background),
  };
};

// '#000000' is Cocloset's hosted Dev branding - the case that produced the bug report.
// The two purples are the template's own default and the shade named in the brief; a
// mid-tone is where a brand-derived foreground is bad-but-alive, so it is exactly where
// a regression would hide.
const BRAND_COLORS = [
  ['a black brand colour (Cocloset Dev)', '#000000'],
  ['the template default purple', '#6938ef'],
  ['a mid-tone purple', '#7c3aed'],
];

describe('the booking calendar tells unavailable days apart from bookable ones', () => {
  describe.each(BRAND_COLORS)('with %s', (_label, mainColor) => {
    const theme = themeForBrandColor(mainColor);

    it('does not paint disabled days in the background colour', () => {
      expect(theme.disabledRgb).not.toEqual(theme.backgroundRgb);
    });

    // 3:1 is WCAG 1.4.11's threshold for non-text and large-text contrast. Disabled
    // controls are formally exempt from 1.4.3, but "exempt" is not what the client
    // asked for: the day numbers have to be READABLE, or the customer cannot tell
    // which days exist.
    it('keeps disabled days readable against the calendar background', () => {
      expect(contrastRatio(theme.disabledRgb, theme.backgroundRgb)).toBeGreaterThanOrEqual(3);
    });

    // The actual user-facing requirement: a selectable day and an unavailable day must
    // not look the same. 1.75:1 is a deliberately modest floor - colour is not carrying
    // this signal alone (see the line-through assertion below), and demanding more here
    // would force the disabled colour so far from white that it stopped reading as
    // de-emphasised.
    it('keeps selectable days visibly distinct from disabled ones', () => {
      expect(contrastRatio(theme.disabledRgb, theme.enabledRgb)).toBeGreaterThanOrEqual(1.75);
    });

    // Ordering, not just distance: disabled must sit BETWEEN the background and the
    // enabled text. A disabled colour that is brighter than the enabled one would pass
    // both ratio checks above while reading as emphasis.
    it('places disabled days between the background and the selectable days', () => {
      const background = relativeLuminance(theme.backgroundRgb);
      const disabled = relativeLuminance(theme.disabledRgb);
      const enabled = relativeLuminance(theme.enabledRgb);
      expect(disabled).toBeGreaterThan(background);
      expect(disabled).toBeLessThan(enabled);
    });

    // The invariant, stated directly. Every check above is a measurement that a clever
    // enough brand-derived value could happen to pass for these three colours; this one
    // is the rule.
    it('never derives the disabled colour from the brand colour', () => {
      expect(
        dependsOnMarketplaceColor(theme.properties['--datepickerDisabledFgColor'], theme.properties)
      ).toBe(false);
    });
  });

  // THE MUTATION CHECK, kept as a test rather than a comment: this is the old value,
  // scored by the same code. It proves the assertions above are load-bearing and would
  // have failed on the shipped bug - which is the only way to know a colour test is
  // measuring anything at all.
  it('would have failed on the old brand-derived value', () => {
    const black = themeForBrandColor('#000000');
    const oldDisabled = composite(
      resolveValue('var(--marketplaceColorDark)', black.properties),
      black.background
    );
    expect(oldDisabled).toEqual(black.backgroundRgb);
    expect(contrastRatio(oldDisabled, black.backgroundRgb)).toBeCloseTo(1, 5);

    // And on a mid-tone it was legible-ish but nowhere near the 3:1 asserted above,
    // so the old value fails for every brand colour rather than only for black.
    const purple = themeForBrandColor('#7c3aed');
    const oldOnPurple = composite(
      resolveValue('var(--marketplaceColorDark)', purple.properties),
      purple.background
    );
    expect(contrastRatio(oldOnPurple, purple.backgroundRgb)).toBeLessThan(1.6);
  });

  // Colour cannot be the only signal (WCAG 1.4.1). The `light` theme has always had
  // line-through; the default theme said `unset`, so on the default theme "unavailable"
  // was a shade of grey and nothing else.
  describe('unavailability is not signalled by colour alone', () => {
    const isRealDecoration = value =>
      typeof value === 'string' && !['', 'unset', 'none', 'initial'].includes(value.trim());

    it('the default theme strikes disabled days through', () => {
      const properties = parseCustomProperties(readFile(CSS_FILE));
      expect(isRealDecoration(properties['--datepickerDisabledTextDeco'])).toBe(true);
    });

    it('the light theme still does too', () => {
      const lightBlock = /\.light\s*\{([^}]*)\}/.exec(readFile(DATEPICKER_CSS_FILE));
      const properties = parseCustomProperties(lightBlock[1]);
      expect(isRealDecoration(properties['--datepickerDisabledTextDeco'])).toBe(true);
    });

    // The rule the DatePicker stylesheet has to actually apply, not just declare. A
    // variable nobody reads is a comment.
    it('the disabled day rule consumes both the colour and the decoration', () => {
      const css = readFile(DATEPICKER_CSS_FILE);
      const rule = /\.dateDisabled\s*\{([\s\S]*?)\n\}/.exec(css)[1];
      expect(rule).toContain('color: var(--datepickerDisabledFgColor)');
      expect(rule).toContain('text-decoration: var(--datepickerDisabledTextDeco)');
    });
  });
});
