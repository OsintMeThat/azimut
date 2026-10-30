import { describe, expect, it } from 'vitest';
import { BLOCK_ADDS, TEXT_STYLES, block, mutedOf, styled } from './design.js';
import { findAdds } from './adds.js';
import { mix } from './plainBasemap.js';

const theme = { paper: '#ffffff', ink: '#15181e', accent: '#c8102e', font: 'inter' };

describe('the text styles', () => {
  it('write the quieter words in the ink drawn toward the paper', () => {
    expect(mutedOf(theme)).toBe(mix(theme.ink, theme.paper, 0.42));
  });

  it('set a text at once in the page\'s own colours, its words left as they were', () => {
    const kicker = styled({ id: 't', kind: 'text', text: 'Mine', italic: true }, 'kicker', theme);
    expect(kicker).toMatchObject({ text: 'Mine', role: 'kicker', upper: true, weight: 700, colour: theme.accent, fill: null, italic: false });
    const badge = styled({ id: 't', kind: 'text', text: 'x' }, 'badge', theme);
    expect(badge).toMatchObject({ colour: theme.paper, fill: theme.accent, align: 'center', valign: 'middle' });
    expect(styled({ id: 't', kind: 'text' }, 'dek', theme).colour).toBe(mutedOf(theme));
    expect(styled({ id: 't', kind: 'text' }, 'title', theme).colour).toBe(null);
    // set by hand again: only the style's name goes
    expect(styled({ id: 't', kind: 'text', size: 31, role: 'title' }, '', theme)).toEqual({ id: 't', kind: 'text', size: 31, role: '' });
    for (const style of Object.values(TEXT_STYLES)) expect(style.label).toBeTruthy();
  });
});

describe('the blocks', () => {
  let next = 0;
  const id = (kind) => `${kind}${(next += 1)}`;
  const page = { width: 297, height: 210, map: [10, 30, 200, 160], theme, id };

  it('lay out their elements on the page, grouped where they go together', () => {
    for (const [kind] of BLOCK_ADDS) {
      const made = block(kind, page);
      expect(made.length, kind).toBeGreaterThan(0);
      for (const element of made) {
        const [x, y, w, h] = element.box;
        expect(x >= 0 && y >= 0 && x + w <= 297.1 && y + h <= 210.1, `${kind} ${element.box}`).toBe(true);
        expect(element.kind).toBe('text');
      }
    }
    const title = block('title-block', page);
    expect(title.map((element) => element.role)).toEqual(['kicker', 'title', 'dek']);
    expect(new Set(title.map((element) => element.group)).size).toBe(1);
    // a classification band runs across the page, in the ink
    const band = block('classification', page)[0];
    expect(band.box[2]).toBe(297);
    expect(band.fill).toBe(theme.ink);
    expect(block('nothing', page)).toEqual([]);
  });

  it('are found in the Add panel by the words they are called by', () => {
    const kinds = findAdds('badge').flatMap((group) => group.items.map(([kind]) => kind));
    expect(kinds).toContain('date-badge');
    expect(findAdds('').find((group) => group.title === 'Blocks').items).toBe(BLOCK_ADDS);
  });
});
