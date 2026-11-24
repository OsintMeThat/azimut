import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SavedOverlay.svelte', import.meta.url), 'utf8');

describe('how precisely a point is pinned', () => {
  it('draws a radius as a circle in metres, not a fixed pixel dot', () => {
    // a dot is sized in pixels and would lie at every other zoom
    expect(source).toContain("kind: 'circle', at: mark, radiusM: row.radius_m");
  });

  it('prefers a traced footprint over the circle around it', () => {
    expect(source).toContain("return row.footprint\n      ? [{\n          id: `${id}:shape`,\n          kind: 'geojson',\n          geometry: row.footprint,");
  });

  it('leaves a point with no precision drawing exactly as before', () => {
    // absence is a state, never something to flag
    expect(source).toContain('if (!row) return [];');
    expect(source).toContain('mark.items.find((r) => r.footprint || r.radius_m > 0)');
  });

  it('keeps the shape under the pin and out of the click path, a zone apart', () => {
    // a comparison's frame and a view's ground never take a click; a place's area
    // opens its card only while no tool owns the map's clicks
    expect(source).toContain('interactive: false');
    expect(source).toContain('interactive: Boolean(opens)');
    expect(source).toContain("const opens = clickable && row.kind === 'place' && row.footprint;");
    expect(source).toContain('...shapesFor(mark, at, clickable),');
    // one surface still holds everything, so a redraw clears shapes with their pins
    expect(source).toContain('surface.set(\n      marks.flatMap((mark, at) => [');
  });
});
