import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The mark ships twice: as a component for the app, and as a standalone
// favicon for surfaces with no CSS context. Nothing links the two files, so
// this asserts they still draw the same arrow.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const WEST = 'd="M12 1.8 5.8 21.4 12 16.4Z"';
const EAST = 'd="M12 1.8 18.2 21.4 12 16.4Z"';

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
});
