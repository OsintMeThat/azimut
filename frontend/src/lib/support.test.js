import { describe, expect, it } from 'vitest';
import { DISCORD_URL, FEEDBACK_FORM_URL, KOFI_URL, TIP_LINES, TIP_LINE_SECONDS, drawTipLine } from './support.js';

describe('the support links', () => {
  it('lead to Ko-fi or nowhere, never to a page somebody else could claim', () => {
    expect(KOFI_URL).toMatch(/^$|^https:\/\/ko-fi\.(com|invalid)\/[\w-]+$/);
  });

  it('use https where a form is set', () => {
    expect(FEEDBACK_FORM_URL).toMatch(/^$|^https:\/\//);
  });

  it('invite to Discord through its own invite host or nowhere', () => {
    expect(DISCORD_URL).toMatch(/^$|^https:\/\/discord\.(gg|invalid)\/[\w-]+$/);
  });
});

describe('the line above the tip', () => {
  it('has lines enough to turn, each one different and short enough for its box', () => {
    expect(TIP_LINES.length).toBeGreaterThan(1);
    expect(new Set(TIP_LINES).size).toBe(TIP_LINES.length);
    for (const line of TIP_LINES) {
      expect(line).toBe(line.trim());
      expect(line.length).toBeGreaterThan(0);
      // Three lines of the dialog's width; the browser test measures the real box.
      expect(line.length).toBeLessThanOrEqual(120);
      expect(line).not.toContain('—');
    }
  });

  it('stays long enough to be read', () => {
    expect(TIP_LINE_SECONDS).toBeGreaterThanOrEqual(8);
  });

  it('never draws the line already shown while another exists', () => {
    for (const current of TIP_LINES) {
      for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
        const drawn = drawTipLine(current, TIP_LINES, () => roll);
        expect(TIP_LINES).toContain(drawn);
        expect(drawn).not.toBe(current);
      }
    }
  });

  it('can reach every line', () => {
    const seen = new Set();
    for (let i = 0; i < TIP_LINES.length; i += 1) {
      seen.add(drawTipLine('', TIP_LINES, () => i / TIP_LINES.length));
    }
    expect(seen.size).toBe(TIP_LINES.length);
  });

  it('keeps a single line, and gives nothing from an empty list', () => {
    expect(drawTipLine('only', ['only'], () => 0.5)).toBe('only');
    expect(drawTipLine('', [], () => 0.5)).toBe('');
  });
});
