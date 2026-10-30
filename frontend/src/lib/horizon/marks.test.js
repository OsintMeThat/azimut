import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONE_PX, coneMark, HZ } from './marks.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../../app.css');
const tab = read('../../tools/Horizon.svelte');

/** The value a custom property is given first in a stylesheet. */
const token = (css, name) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1].trim();

describe('the Horizon marks, in CSS and in the map', () => {
  it('the view and the map paint the same colours', () => {
    // the marks the view borrows from the annotation palette, which both themes share
    expect(token(tab, '--hz-mark')).toBe('var(--anno-3)');
    expect(token(app, '--anno-3')).toBe(HZ.mark);
    expect(token(tab, '--hz-seen')).toBe('var(--anno-4)');
    expect(token(app, '--anno-4')).toBe(HZ.seen);
    expect(token(tab, '--hz-hidden')).toBe('var(--anno-1)');
    expect(token(app, '--anno-1')).toBe(HZ.hidden);
    // the lens is the selection's amber
    expect(token(app, '--accent')).toBe(HZ.lens);
  });
});

describe('a view\'s cone on the map', () => {
  it('opens upward from the eye in the middle, as wide as the lens', () => {
    const { html, size } = coneMark(60);
    expect(size).toEqual([CONE_PX * 2, CONE_PX * 2]);
    // from the eye, to 30° either side of up, 43 px out
    expect(html).toContain(`M${CONE_PX} ${CONE_PX}L22.5 6.76A43 43 0 0 1 65.5 6.76Z`);
    expect(html).toContain('fill-opacity="0.22"');
  });

  it('takes the long way round past a half turn, and is a ring for the whole turn', () => {
    expect(coneMark(240).html).toMatch(/A43 43 0 1 1/);
    expect(coneMark(360).html).toContain('<circle');
  });

  it('draws the eye no save has kept as a dashed outline', () => {
    const { html } = coneMark(60, { dashed: true });
    expect(html).toContain('stroke-dasharray="4 3"');
    expect(html).toContain('fill="none"');
  });
});
