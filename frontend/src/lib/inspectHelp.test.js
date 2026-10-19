import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { FILTER_HELP, INSPECT_HELP } from './inspectHelp.js';
import { ADJUST_ORDER } from './inspect.js';

/** Inspect's own sources: the tool, its panels and the player. */
const sources = () => {
  const dir = new URL('../tools/inspect/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.svelte')).map((f) => new URL(f, dir));
  files.push(new URL('../tools/Inspector.svelte', import.meta.url));
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
};

describe('what Inspect says on hover', () => {
  const all = { ...INSPECT_HELP, ...FILTER_HELP };

  it('says one short clause per control, in the terse register of the app', () => {
    for (const [key, text] of Object.entries(all)) {
      expect(text, key).toMatch(/^[A-Z]/);
      expect(text, key).not.toMatch(/\.$/);
      expect(text, key).not.toContain('—');
      expect(text.length, key).toBeLessThanOrEqual(120);
    }
  });

  it('has no text left that no control shows', () => {
    const code = sources();
    for (const key of Object.keys(INSPECT_HELP)) {
      expect(code.includes(`INSPECT_HELP.${key}`), key).toBe(true);
    }
  });

  it('explains every slider the pipeline knows', () => {
    const sliders = ADJUST_ORDER.filter((id) => id !== 'rotate');
    for (const id of sliders) expect(FILTER_HELP[id], id).toBeTruthy();
    for (const id of Object.keys(FILTER_HELP)) expect(sliders, id).toContain(id);
  });
});
