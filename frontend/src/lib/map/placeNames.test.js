import { describe, expect, it } from 'vitest';
// The engine's own validator and expression evaluator, which ship inside
// maplibre-gl, so what is asserted is what the engine will do with the style.
import { createExpression, featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { PLACE_CLASSES, PLACE_NAMES } from './placeNames.js';

const [LABEL] = PLACE_NAMES.layers;

/** A place point as OpenFreeMap's `place` layer serves it. */
function place(properties) {
  return { type: 1, properties };
}

const QUSHAYHI = place({ class: 'village', name: 'قشيحي', 'name:latin': 'Qushayhi', rank: 12 });
const SAMKAR = place({ class: 'hamlet', name: 'السمكر', 'name:latin': 'As Samkar', rank: 3 });
const TAIZZ = place({ class: 'city', name: 'تعز', 'name:latin': 'Taizz', rank: 4 });

const shown = (feature, zoom = 12) =>
  featureFilter(LABEL.filter, 'layers[0].filter').filter({ zoom }, feature);
const evaluate = (key, feature, zoom = 12) =>
  createExpression(LABEL.layout[key], `layers[0].layout.${key}`).value.evaluate({ zoom }, feature);

describe('the place names style', () => {
  it('is one the engine accepts with no glyph URL at all', () => {
    // the engine draws the characters itself when the style names no glyphs,
    // so a text layer costs no request beyond its tiles
    const style = {
      version: 8,
      sources: { openmaptiles: { type: 'vector', ...PLACE_NAMES.sources.openmaptiles, maxzoom: PLACE_NAMES.maxZoom } },
      layers: PLACE_NAMES.layers,
    };
    expect(style).not.toHaveProperty('glyphs');
    expect(validateStyleMin(style)).toEqual([]);
  });

  it('reads the current build from OpenFreeMap’s TileJSON, over https', () => {
    // the tile paths carry the build date, and an old build is removed
    expect(PLACE_NAMES.sources).toEqual({ openmaptiles: { url: 'https://tiles.openfreemap.org/planet' } });
    expect(LABEL['source-layer']).toBe('place');
    expect(PLACE_NAMES.maxZoom).toBe(14);
  });

  it('names villages and hamlets and leaves cities to the borders', () => {
    expect(shown(QUSHAYHI)).toBe(true);
    expect(shown(SAMKAR)).toBe(true);
    expect(shown(TAIZZ)).toBe(false);
    expect(shown(place({ class: 'country', 'name:latin': 'Yemen' }))).toBe(false);
  });

  it('writes the Latin name, never the Arabic one the engine could not join up', () => {
    expect(evaluate('text-field', QUSHAYHI)).toBe('Qushayhi');
    expect(shown(place({ class: 'village', name: 'قرية' }))).toBe(false);
  });

  it('keeps the larger place when two names collide', () => {
    // a lower key is placed first, and a label placed first is the one kept
    const key = (feature) => evaluate('symbol-sort-key', feature);
    const town = place({ class: 'town', 'name:latin': 'Al Qaidah', rank: 40 });
    expect(key(town)).toBeLessThan(key(QUSHAYHI));
    // a hamlet with a better rank still yields to a village
    expect(key(QUSHAYHI)).toBeLessThan(key(SAMKAR));
    expect(PLACE_CLASSES.slice(0, 2)).toEqual(['town', 'village']);
  });

  it('writes a village larger than a hamlet', () => {
    const size = (feature) => evaluate('text-size', feature, 13);
    expect(size(QUSHAYHI)).toBeGreaterThan(size(SAMKAR));
  });
});
