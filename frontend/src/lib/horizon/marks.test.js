import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HZ } from './marks.js';

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
