import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SavedOverlay.svelte', import.meta.url), 'utf8');

describe('how precisely a point is pinned', () => {
  it('draws a radius as a circle in metres, not a fixed pixel dot', () => {
    // L.circleMarker is sized in pixels and would lie at every other zoom
    expect(source).toContain("L.circle([mark.lat, mark.lon], { ...style, radius: row.radius_m })");
  });

  it('prefers a traced footprint over the circle around it', () => {
    expect(source).toContain('row.footprint\n      ? [L.geoJSON(row.footprint');
  });

  it('leaves a point with no precision drawing exactly as before', () => {
    // absence is a state, never something to flag
    expect(source).toContain('if (!row) return [];');
    expect(source).toContain('mark.items.find((r) => r.footprint || r.radius_m > 0)');
  });

  it('keeps the shape under the pin and out of the click path', () => {
    expect(source).toContain('interactive: false');
    expect(source).toContain('return [...shapesFor(mark), marker];');
    // one group still holds everything, so a rebuild clears shapes with their pins
    expect(source).toContain('marks.flatMap((mark) => {');
  });
});
