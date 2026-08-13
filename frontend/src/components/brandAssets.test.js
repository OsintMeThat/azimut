import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The mark ships four times: as a component for the app, as a standalone
// favicon for surfaces with no CSS context, and as the two README lockups
// GitHub and PyPI fetch on their own. Nothing links the files, so this asserts
// they still draw the same arrow and the same six letters.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const WEST = 'd="M12 1.8 5.8 21.4 12 16.4Z"';
const EAST = 'd="M12 1.8 18.2 21.4 12 16.4Z"';

const LOCKUPS = ['../../../docs/media/lockup-light.svg', '../../../docs/media/lockup-dark.svg'];

/** The `d` of every path in a file, in document order. */
const paths = (svg) => [...svg.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);

describe('brand assets', () => {
  it('the component and the favicon draw the same two flanks', () => {
    const logo = read('./Logo.svelte');
    const favicon = read('../../public/favicon.svg');
    for (const flank of [WEST, EAST]) {
      expect(logo).toContain(flank);
      expect(favicon).toContain(flank);
    }
  });

  it('the favicon plates the mark, since it cannot know its background', () => {
    const favicon = read('../../public/favicon.svg');
    expect(favicon).toContain('fill="#14171b"');
    expect(favicon).toContain('#e8a33d');
  });

  it('both README lockups draw the mark and the wordmark of the app', () => {
    const letters = paths(read('./Wordmark.svelte'));
    expect(letters).toHaveLength(7); // six letters, the A wearing its crossbar
    for (const rel of LOCKUPS) {
      const lockup = read(rel);
      for (const flank of [WEST, EAST]) expect(lockup).toContain(flank);
      // The mark's two flanks come first, then the letters, unchanged.
      expect(paths(lockup).slice(2)).toEqual(letters);
    }
  });

  it('each lockup carries the ink of the background it is served on', () => {
    // A file fetched outside the app has no theme to read, so the pair exists
    // precisely to spell the ink out: the light one dark, the dark one light.
    expect(read(LOCKUPS[0])).toContain('#23262b');
    expect(read(LOCKUPS[0])).not.toContain('#e3e3e3');
    expect(read(LOCKUPS[1])).toContain('#e3e3e3');
    expect(read(LOCKUPS[1])).not.toContain('#23262b');
    for (const rel of LOCKUPS) expect(read(rel)).toContain('#e8a33d');
  });
});
