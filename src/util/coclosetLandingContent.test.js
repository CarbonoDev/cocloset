import {
  parseTiles,
  splitHeadline,
  splitLeadingHeading,
  splitTrailingLinks,
} from './coclosetLandingContent';

// These read layout out of content an operator authored in Console, so the inputs below are
// the REAL strings from the landing-page asset rather than invented ones. Every function has
// a test for the case where the pattern is absent, because the fallback - render what the
// operator wrote - is the behaviour that keeps a Console edit from blanking the page.

describe('splitTrailingLinks', () => {
  const HERO_TEXT =
    'Cocloset is a designer rental wardrobe with a twist: every piece is stored, cleaned and ' +
    'exchanged at a neighborhood laundry partner. Lend what you love. Rent what you need.\n\n' +
    '[Browse the wardrobe](/)\n[Lend a piece](/)';

  it('pulls the two hero buttons off the end, in order', () => {
    const { links } = splitTrailingLinks(HERO_TEXT);
    expect(links).toEqual([
      { label: 'Browse the wardrobe', href: '/' },
      { label: 'Lend a piece', href: '/' },
    ]);
  });

  it('leaves the prose intact and unpadded', () => {
    const { body } = splitTrailingLinks(HERO_TEXT);
    expect(body).toContain('Lend what you love. Rent what you need.');
    expect(body).not.toContain('[Browse the wardrobe]');
    expect(body.endsWith('need.')).toBe(true);
  });

  it('does not yank a link out of the middle of a sentence', () => {
    // The load-bearing one. A link inside prose is prose - promoting it to a button would
    // both break the sentence and put a button where nobody asked for one.
    const text = 'Read our [terms](/terms) before you book.\n\n[Browse](/s)';
    const { body, links } = splitTrailingLinks(text);

    expect(links).toEqual([{ label: 'Browse', href: '/s' }]);
    expect(body).toBe('Read our [terms](/terms) before you book.');
  });

  it('stops at the first trailing line that is not a link', () => {
    const text = '[Browse](/s)\n\nOne more thing.';
    const { body, links } = splitTrailingLinks(text);

    expect(links).toEqual([]);
    expect(body).toBe(text);
  });

  it('returns the text untouched when there are no links at all', () => {
    expect(splitTrailingLinks('Just a paragraph.')).toEqual({
      body: 'Just a paragraph.',
      links: [],
    });
  });

  it.each([[undefined], [null], [''], [42], [{}]])('survives %p', input => {
    expect(splitTrailingLinks(input)).toEqual({ body: '', links: [] });
  });

  it('handles a block that is nothing but links', () => {
    expect(splitTrailingLinks('[One](/a)\n[Two](/b)')).toEqual({
      body: '',
      links: [{ label: 'One', href: '/a' }, { label: 'Two', href: '/b' }],
    });
  });
});

describe('parseTiles', () => {
  const LIVE_TILES =
    '```text\nLIVE TILE\nIncoming garments\n```\n\n```text\nLIVE TILE\nPickups today\n```\n\n' +
    '```text\nLIVE TILE\nReturns today\n```';

  it('reads every fence as a labelled tile', () => {
    expect(parseTiles(LIVE_TILES)).toEqual([
      { label: 'LIVE TILE', title: 'Incoming garments' },
      { label: 'LIVE TILE', title: 'Pickups today' },
      { label: 'LIVE TILE', title: 'Returns today' },
    ]);
  });

  it('reads the same string twice, which a stateful /g regex would not', () => {
    // FENCED_BLOCK is a module-level regex with the global flag, so its lastIndex survives
    // between calls. Without a reset the second render of the same section - a re-render, a
    // second page visit - would silently return fewer tiles, or none.
    expect(parseTiles(LIVE_TILES)).toEqual(parseTiles(LIVE_TILES));
  });

  it('keeps a single-line fence as a title rather than dropping it', () => {
    expect(parseTiles('```text\nPickups today\n```')).toEqual([
      { label: null, title: 'Pickups today' },
    ]);
  });

  it('ignores an empty fence', () => {
    expect(parseTiles('```text\n\n```')).toEqual([]);
  });

  it('does not care which language tag the editor inserted', () => {
    expect(parseTiles('```\nLIVE TILE\nReady\n```')).toEqual([
      { label: 'LIVE TILE', title: 'Ready' },
    ]);
  });

  it.each([[undefined], [null], [''], ['no fences here at all'], [7]])(
    'returns nothing for %p',
    input => {
      expect(parseTiles(input)).toEqual([]);
    }
  );
});

describe('splitHeadline', () => {
  it('splits the hero headline on the break the operator typed', () => {
    expect(splitHeadline('Borrow the dress.\nSkip the dry cleaning.')).toEqual({
      lead: 'Borrow the dress.',
      accent: 'Skip the dry cleaning.',
    });
  });

  it('leaves a single-line headline entirely plain', () => {
    // No break means no instruction, and the heading renders like any other heading.
    expect(splitHeadline('A storefront for every neighborhood laundry.')).toEqual({
      lead: 'A storefront for every neighborhood laundry.',
      accent: null,
    });
  });

  it('joins three or more lines into one accent', () => {
    expect(splitHeadline('One\nTwo\nThree')).toEqual({ lead: 'One', accent: 'Two Three' });
  });

  it.each([[undefined], [null], [''], ['   ']])('survives %p', input => {
    expect(splitHeadline(input)).toEqual({ lead: '', accent: null });
  });
});

describe('splitLeadingHeading', () => {
  const STEP = '#### Lend a piece you love\n\nDrop your garment at any partner laundry.';

  it('lifts the repeated step name out of the markdown', () => {
    // The block's own `title` field holds "01", so the name lives in the markdown. Rendering
    // both would print it twice at two different sizes.
    expect(splitLeadingHeading(STEP)).toEqual({
      heading: 'Lend a piece you love',
      body: 'Drop your garment at any partner laundry.',
    });
  });

  it.each([['#'], ['##'], ['######']])('accepts a %s heading', hashes => {
    expect(splitLeadingHeading(`${hashes} Title\n\nBody`).heading).toBe('Title');
  });

  it('leaves text with no heading completely alone', () => {
    expect(splitLeadingHeading('Just a paragraph.')).toEqual({
      heading: null,
      body: 'Just a paragraph.',
    });
  });

  it('does not treat a hash mid-text as a heading', () => {
    expect(splitLeadingHeading('Call us on #1\n\n# Not the first line').heading).toBeNull();
  });

  it('requires a space after the hashes, so #hashtag is not a heading', () => {
    expect(splitLeadingHeading('#hashtag rules').heading).toBeNull();
  });

  it.each([[undefined], [null], [{}]])('survives %p', input => {
    expect(splitLeadingHeading(input)).toEqual({ heading: null, body: '' });
  });
});
