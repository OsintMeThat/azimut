import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { paths } from '../../components/Icon.svelte';
import { BADGE_GLYPHS } from './markerGlyphs.js';

/**
 * The HTML report draws a layer's markers without the app (`engine/notes_maps.py`), so it
 * reads the same drawings from a copy kept beside the reader's script. This holds the
 * copy to the map's own: a glyph changed here and not there fails, and
 * `UPDATE_MARKERS=1 npx vitest run src/lib/map/markerGlyphs.report.test.js` writes it again.
 */
const FILE = new URL('../../../../src/azimut/engine/notes_html_assets/markers.json', import.meta.url);
const PLAIN = ['pin', 'circle', 'star', 'flag'];

function reportMarkers() {
  return { badges: BADGE_GLYPHS, plain: Object.fromEntries(PLAIN.map((name) => [name, paths[name]])) };
}

describe('the markers an HTML report draws', () => {
  it('are the map’s own, glyph for glyph', () => {
    const wanted = reportMarkers();
    if (process.env.UPDATE_MARKERS) writeFileSync(FILE, `${JSON.stringify(wanted)}\n`);
    expect(JSON.parse(readFileSync(FILE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(wanted)));
  });
});
