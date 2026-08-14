/**
 * READING THE LANDING PAGE'S CONTENT OUT OF THE SHAPES CONSOLE CAN AUTHOR.
 *
 * The Pages editor gives an operator a title, a description, and per block a title plus one
 * markdown field. The Cocloset design needs things markdown has no notion of - a pair of
 * buttons, a grid of labelled tiles, a two-tone headline - so the operator expressed them in
 * the only vocabulary available (links at the end of a paragraph, fenced code blocks, a line
 * break inside a heading) and this module reads them back out.
 *
 * Every function here is EXPLICIT rather than a CSS trick on the rendered markdown. The
 * alternative - styling `p:last-child a` as a button, say - works until somebody adds a
 * closing sentence in Console and the buttons silently become links again, with nothing to
 * test and nothing to notice. Parsing means the failure is visible and the rule is pinned.
 *
 * All of it degrades to "render the markdown as written": an input that does not match a
 * pattern comes back as body text with an empty extraction, never as an error and never as
 * a dropped paragraph. Losing a sentence the operator typed is worse than losing a layout.
 */

// A markdown link alone on its line: `[Browse the wardrobe](/s)`. Anchored at both ends, so
// a link inside a sentence is prose and stays in the body where the operator put it.
const STANDALONE_LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

// A fenced block, with an optional language tag. The `text` tag is what Console's editor
// inserts, but the tag is not load-bearing here - the fence is.
const FENCED_BLOCK = /```[^\n]*\n([\s\S]*?)```/g;

/**
 * Split a block's markdown into prose and the call-to-action links that follow it.
 *
 *   > "[Browse the wardrobe](/)\n[Lend a piece](/)"
 *
 * The design renders those two as a filled button and an outlined one. Only links in the
 * TRAILING run of link-only lines are taken: scanning from the end and stopping at the first
 * line that is anything else means a link in the middle of the copy is never yanked out of
 * its sentence and turned into a button.
 *
 * @param {string} [markdown] - a block's `text.content`
 * @returns {{body: string, links: Array<{label: string, href: string}>}}
 *   `body` is the markdown with the trailing links removed, ready to render as written.
 */
export const splitTrailingLinks = markdown => {
  if (typeof markdown !== 'string') {
    return { body: '', links: [] };
  }

  const lines = markdown.split('\n');
  const links = [];

  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1].trim();
    if (line === '') {
      end -= 1;
      continue;
    }
    const match = line.match(STANDALONE_LINK);
    if (!match) {
      break;
    }
    links.unshift({ label: match[1], href: match[2] });
    end -= 1;
  }

  return {
    body: lines
      .slice(0, end)
      .join('\n')
      .trim(),
    links,
  };
};

/**
 * Read the labelled tiles out of a block of fenced code.
 *
 * The operator wrote the live-tile grid as six fenced blocks, each holding a label line and a
 * title line:
 *
 * ```text
 * LIVE TILE
 * Incoming garments
 * ```
 *
 * Rendered as authored these come out as monospaced code blocks, which is what the page does
 * today. A fence is the only Console primitive that groups two lines into one unit, so it is
 * a reasonable thing for the operator to have reached for - and reading it back is a smaller
 * change than asking for the content to be re-authored.
 *
 * A fence holding a single line yields a tile with a title and no label, rather than being
 * discarded: the title is the part a reader needs.
 *
 * @param {string} [markdown] - a block's `text.content`
 * @returns {Array<{label: string|null, title: string}>}
 */
export const parseTiles = markdown => {
  if (typeof markdown !== 'string') {
    return [];
  }

  const tiles = [];
  let match;
  // `FENCED_BLOCK` is a module-level /g regex, so its lastIndex has to be reset before each
  // use or the second call on the same string would start mid-way through it.
  FENCED_BLOCK.lastIndex = 0;
  while ((match = FENCED_BLOCK.exec(markdown)) !== null) {
    const lines = match[1]
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      continue;
    }
    tiles.push(
      lines.length === 1
        ? { label: null, title: lines[0] }
        : { label: lines[0], title: lines.slice(1).join(' ') }
    );
  }
  return tiles;
};

/**
 * Split a headline into its plain first line and its accented remainder.
 *
 *   > "Borrow the dress.\nSkip the dry cleaning."
 *
 * The design sets the first line in ink and the rest in terracotta italic. The line break the
 * operator typed is the whole instruction; a headline with no break is simply all plain,
 * which is what any other page's heading already does.
 *
 * @param {string} [content] - a title field's `content`
 * @returns {{lead: string, accent: string|null}}
 */
export const splitHeadline = content => {
  if (typeof content !== 'string' || content.trim() === '') {
    return { lead: '', accent: null };
  }
  const [lead, ...rest] = content.split('\n');
  const accent = rest.join(' ').trim();
  return { lead: lead.trim(), accent: accent === '' ? null : accent };
};

/**
 * Strip the leading markdown heading from a block's text.
 *
 * The numbered steps repeat their own name inside the markdown (`#### Lend a piece you love`)
 * because the block's `title` field is holding the numeral instead. Rendering both would
 * print the heading twice at two different sizes.
 *
 * Returns the heading separately rather than dropping it, so the layout can place it where
 * the design wants it instead of where markdown would.
 *
 * @param {string} [markdown]
 * @returns {{heading: string|null, body: string}}
 */
export const splitLeadingHeading = markdown => {
  if (typeof markdown !== 'string') {
    return { heading: null, body: '' };
  }
  const lines = markdown.split('\n');
  const firstIndex = lines.findIndex(line => line.trim() !== '');
  const first = firstIndex === -1 ? '' : lines[firstIndex].trim();
  const match = first.match(/^#{1,6}\s+(.*)$/);

  return match
    ? {
        heading: match[1].trim(),
        body: lines
          .slice(firstIndex + 1)
          .join('\n')
          .trim(),
      }
    : { heading: null, body: markdown.trim() };
};
