import { describe, expect, it } from 'vitest';
// The engine's own validator and expression evaluator, which ship inside
// maplibre-gl, so what is asserted is what the engine will do with the style.
import { createExpression, featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { BORDER_LINES, NAMED_CLASSES } from './borders.js';
import { PLACE_NAMES } from './placeNames.js';

const layer = (id) => BORDER_LINES.layers.find((entry) => entry.id === id);
const NAMES = layer('names');

/** A line of OpenFreeMap's `boundary` layer, or a point of its `place` layer. */
const line = (properties) => ({ type: 2, properties });
const place = (properties) => ({ type: 1, properties });

const drawn = (id, feature, zoom = 10) =>
  featureFilter(layer(id).filter, `layers.${id}.filter`).filter({ zoom }, feature);
const evaluate = (key, feature, zoom = 8) =>
  createExpression(NAMES.layout[key], `layers.names.layout.${key}`).value.evaluate({ zoom }, feature);

const YEMEN_SAUDI = line({ admin_level: 2, maritime: 0, disputed: 0 });
const SANAA = place({ class: 'city', name: 'صنعاء', 'name:en': "Sana'a", 'name:latin': 'Ṣanʿāʾ', rank: 3 });

describe('the borders over relief', () => {
  it('is a style the engine accepts with no glyph URL at all', () => {
    const style = {
      version: 8,
      sources: { openmaptiles: { type: 'vector', ...BORDER_LINES.sources.openmaptiles, maxzoom: BORDER_LINES.maxZoom } },
      layers: BORDER_LINES.layers,
    };
    expect(style).not.toHaveProperty('glyphs');
    expect(validateStyleMin(style)).toEqual([]);
  });

  it('reads the same OpenFreeMap build as the place names', () => {
    expect(BORDER_LINES.sources).toEqual(PLACE_NAMES.sources);
    expect(BORDER_LINES.maxZoom).toBe(PLACE_NAMES.maxZoom);
  });

  it('draws country, region and district lines, each in its own weight', () => {
    expect(drawn('country', YEMEN_SAUDI)).toBe(true);
    expect(drawn('country-edge', YEMEN_SAUDI)).toBe(true);
    expect(drawn('region', line({ admin_level: 4 }))).toBe(true);
    expect(drawn('district', line({ admin_level: 6 }))).toBe(true);
    expect(drawn('region', YEMEN_SAUDI)).toBe(false);
    // municipalities are finer than the borders Esri draws
    expect(['district', 'region', 'country'].some((id) => drawn(id, line({ admin_level: 8 })))).toBe(false);
  });

  it('leaves sea borders out and dashes a disputed one', () => {
    const atSea = line({ admin_level: 2, maritime: 1 });
    expect(['country', 'country-edge', 'disputed'].some((id) => drawn(id, atSea))).toBe(false);
    const disputed = line({ admin_level: 2, disputed: 1 });
    expect(drawn('disputed', disputed)).toBe(true);
    expect(drawn('country', disputed)).toBe(false);
    expect(layer('disputed').paint['line-dasharray']).toBeDefined();
    expect(layer('country').paint).not.toHaveProperty('line-dasharray');
  });

  it('draws the dark edge under the country line', () => {
    const ids = BORDER_LINES.layers.map((entry) => entry.id);
    expect(ids.indexOf('country-edge')).toBeLessThan(ids.indexOf('country'));
    expect(ids.at(-1)).toBe('names');
  });

  it('names countries, regions and cities, and leaves towns to the place names', () => {
    const shown = (feature) => featureFilter(NAMES.filter, 'layers.names.filter').filter({ zoom: 8 }, feature);
    expect(shown(SANAA)).toBe(true);
    expect(shown(place({ class: 'country', 'name:en': 'Yemen' }))).toBe(true);
    expect(shown(place({ class: 'state', 'name:latin': 'Amanat al Asimah' }))).toBe(true);
    expect(shown(place({ class: 'town', 'name:en': 'Thula' }))).toBe(false);
    // a name the engine could not join up is left out rather than drawn wrong
    expect(shown(place({ class: 'city', name: 'تعز' }))).toBe(false);
  });

  it('writes the English name first, as Esri did, else the Latin one', () => {
    expect(evaluate('text-field', SANAA)).toBe("Sana'a");
    expect(evaluate('text-field', place({ class: 'city', 'name:latin': 'Taizz' }))).toBe('Taizz');
    expect(evaluate('text-transform', place({ class: 'country', 'name:en': 'Yemen' }))).toBe('uppercase');
    expect(evaluate('text-transform', SANAA)).toBe('none');
  });

  it('keeps the larger place when two names collide', () => {
    const key = (feature) => evaluate('symbol-sort-key', feature);
    expect(key(place({ class: 'country', rank: 50 }))).toBeLessThan(key(SANAA));
    expect(NAMED_CLASSES[0]).toBe('country');
    expect(NAMED_CLASSES.at(-1)).toBe('city');
  });
});
