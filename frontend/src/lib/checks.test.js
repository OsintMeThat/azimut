import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACCENTS } from './accent.js';

/**
 * The check boxes app.css draws: weightless, so a box a tool styles itself keeps
 * its look; ticked in the accent; a tick that stays readable on every accent.
 */
const css = readFileSync(fileURLToPath(new URL('../app.css', import.meta.url)), 'utf8');

describe('drawn check boxes', () => {
  it('weigh nothing: every rule on a check box sits in :where()', () => {
    const bare = css.split('\n').filter((line) => /^\s*input\[type='checkbox'\]/.test(line));
    expect(bare).toEqual([]);
    expect(css).toContain(":where(input[type='checkbox']) {");
  });

  it('stay plain inputs drawn by the app, the same in every browser', () => {
    const base = css.slice(css.indexOf(":where(input[type='checkbox']) {"));
    const rule = base.slice(0, base.indexOf('}'));
    expect(rule).toContain('appearance: none;');
    expect(rule).toContain('-webkit-appearance: none;');
  });

  it('fill a ticked or partly ticked box with the accent and slide the cover off its tick', () => {
    const ticked = css.slice(css.indexOf(":where(input[type='checkbox']:checked),"));
    const rule = ticked.slice(0, ticked.indexOf('}'));
    expect(rule).toContain(":where(input[type='checkbox']:indeterminate)");
    expect(rule).toContain('--check-fill: var(--accent);');
    expect(rule).toContain('background-position: 14px 0, center;');
  });

  it('draws a white tick on the quiet accents\' deep ink, and a dark one back on a dark surface', () => {
    const block = css.slice(css.indexOf(":root[data-theme='light'][data-accent='sand'],\n"));
    const selectors = block.slice(0, block.indexOf('{'));
    for (const { id } of ACCENTS.filter((a) => a.quiet)) expect(selectors).toContain(`[data-accent='${id}']`);
    expect(block.slice(0, block.indexOf('}'))).toContain("stroke='%23ffffff'");
    const surface = css.slice(css.indexOf(":root[data-theme='light'] .dark-surface {"));
    expect(surface.slice(0, surface.indexOf('}'))).toContain("--check-tick: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-6.5' fill='none' stroke='%23141414'");
  });

  it('draws the tick at once under reduced motion', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  :root {'));
    expect(reduced.slice(0, reduced.indexOf('\n}\n'))).toContain('--motion-draw: 0ms;');
  });
});
