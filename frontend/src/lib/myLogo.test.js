import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { myLogoUrl } from './myLogo.js';
import { prefs } from './state.svelte.js';

const SRC = new URL('..', import.meta.url).pathname;

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(svelte|js)$/.test(name) && !/\.test\.js$/.test(name) ? [path] : [];
  });
}

describe('where the tools read the logo', () => {
  it('changes with the logo on disk and with a save in this tab', () => {
    const kept = { logoRev: prefs.logoRev, picturesRev: prefs.picturesRev };
    prefs.logoRev = '100';
    prefs.picturesRev = 0;
    const first = myLogoUrl();
    prefs.picturesRev = 1;
    const saved = myLogoUrl();
    prefs.logoRev = '200';
    const read = myLogoUrl();
    expect(new Set([first, saved, read]).size).toBe(3);
    expect(first).toMatch(/^\/api\/settings\/signature\.png\?rev=/);
    Object.assign(prefs, kept);
  });

  it('is the only address a tool draws the logo from', () => {
    // A fixed address let a browser hand a proof the logo it read first (`myLogo.js`).
    // The editor's own read asks past the cache, `cache: 'no-store'`.
    const fixed = sources(SRC).filter((path) => readFileSync(path, 'utf8')
      .split('\n')
      .some((line) => line.includes("'/api/settings/signature.png'") && !line.includes("logoLook ? '/api/settings/logo-original.png'")));
    expect(fixed).toEqual([]);
  });
});
