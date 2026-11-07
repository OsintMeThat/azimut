/**
 * The extension's copy of the app's map hosts (extension/mapsites.js).
 *
 * The toolbar button decides "map or not" inside the press, before the app can be
 * asked, because a side panel opens only there. So the hosts are copied, and the
 * copy is held to the app's table through one shared file of addresses:
 * `tests/test_mapsites.py` reads it against `engine/mapsites.py`, this reads it
 * against the copy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const source = readFileSync(join(root, 'extension/mapsites.js'), 'utf8');
const { addresses } = JSON.parse(readFileSync(join(root, 'tests/fixtures/map-site-hosts.json'), 'utf8'));

const scope = {};
new Function('globalThis', source)(scope);
const { SITES, siteOf } = scope.AzimutMapSites;

describe('which pages are maps', () => {
  it.each(addresses)('%s is %s, as the app reads it', (url, site) => {
    expect(siteOf(url)).toBe(site);
  });

  it('has an address for every site it knows, so none goes unchecked', () => {
    const covered = new Set(addresses.map(([, site]) => site));
    for (const { id } of SITES) expect(covered.has(id), id).toBe(true);
  });

  it('answers null for what is not an address at all', () => {
    expect(siteOf(undefined)).toBe(null);
    expect(siteOf('')).toBe(null);
  });
});
