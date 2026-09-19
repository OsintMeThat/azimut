import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const tool = readFileSync(new URL('./Coordinates.svelte', import.meta.url), 'utf8');
const map = readFileSync(new URL('./Satellite.svelte', import.meta.url), 'utf8');
const state = readFileSync(new URL('../lib/state.svelte.js', import.meta.url), 'utf8');

describe('the tab opens on the point the map is on', () => {
  it('is handed that point by the map, once the map has been moved off its home view', () => {
    expect(state).toContain('mapPoint: null,');
    expect(map).toContain(
      'uiState.mapPoint = { lat: displayCoords.lat, lon: displayCoords.lon, zoom: center.zoom };'
    );
    // a window still sitting on the saved home view has no point to offer, while a
    // view the address named is one: it came from a link or from case work
    expect(map).toContain('const asked = openingView?.lat != null;');
    expect(map).toContain(
      'if (!asked && center.lat === home.lat && center.lon === home.lon && center.zoom === home.zoom) return;'
    );
  });

  it('follows that point, and only while the tab is the one on screen', () => {
    expect(tool).toContain("if (uiState.tool !== 'coordinates') return;");
    // the tab is never unmounted once visited, so the point it last opened on is
    // what says whether the map has moved since (Coordinates.render.test.js)
    expect(tool).toContain('if (asked === openedOn) return;');
    expect(tool).toContain("const held = openedOn === null && (point || text.trim());");
  });

  it('converts locally and leaves the place name to a press', () => {
    // Nominatim on mount would be a network call nobody asked for
    expect(tool).toContain('void parse({ name: false });');
    expect(tool).toContain('if (name) lookupPlace();');
    expect(tool).toContain('<button class="name-place" onclick={lookupPlace}>Name this place</button>');
  });
});
