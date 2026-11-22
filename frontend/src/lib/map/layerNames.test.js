import { describe, expect, it } from 'vitest';
import { nameMoves, namePlace, namePoints, nameShown, placedName } from './layerNames.js';

const shape = (type, properties = {}) => ({ type: 'Feature', geometry: { type, coordinates: [] },
  properties: { key: 'k', name: 'Held ground', show_label: true, label_at: [2.3, 48.8], ...properties } });

describe('a name put by hand', () => {
  it('is two numbers on the map, and nothing else', () => {
    expect(namePlace({ label_at: [2.3, -48.8] })).toEqual([2.3, -48.8]);
    for (const wrong of [undefined, null, [2.3], [2.3, 48.8, 0], ['2.3', '48.8'], [181, 0], [0, -91], [NaN, 0], [0, Infinity], '2.3,48.8']) {
      expect(namePlace({ label_at: wrong })).toBeNull();
    }
    expect(namePlace(null)).toBeNull();
  });

  it('is a line\'s or an area\'s alone, and only while the map writes its name', () => {
    expect(['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].map((type) => nameMoves(shape(type)))).toEqual([true, true, true, true]);
    expect(['Point', 'MultiPoint', 'GeometryCollection'].map((type) => nameMoves(shape(type)))).toEqual([false, false, false]);
    expect(placedName(shape('Polygon'))).toEqual([2.3, 48.8]);
    for (const properties of [{ show_label: undefined }, { name: '' }, { $trail: true }, { $change: 'gained' }, { label_at: [500, 0] }]) {
      expect(placedName(shape('Polygon', properties))).toBeNull();
    }
    expect(placedName(shape('Point'))).toBeNull();
  });

  it('is written as the layer decides it from its group', () => {
    expect(nameShown({ name: 'A', label: 'on' }, null)).toBe(true);
    expect(nameShown({ name: 'A' }, { labels: true })).toBe(true);
    expect(nameShown({ name: 'A', label: 'off' }, { labels: true })).toBe(false);
    expect(nameShown({ name: 'A' }, {})).toBe(false);
    expect(nameShown({ name: '  ', label: 'on' }, null)).toBe(false);
  });

  it('is a point of its own carrying its feature\'s properties, one for each name put by hand', () => {
    const [point, ...rest] = namePoints([shape('Polygon'), shape('LineString', { label_at: undefined }), shape('Point')]);
    expect(rest).toEqual([]);
    expect(point).toEqual({ type: 'Feature', geometry: { type: 'Point', coordinates: [2.3, 48.8] },
      properties: { key: 'k', name: 'Held ground', show_label: true, label_at: [2.3, 48.8], $label: true } });
    // `$name` is the engine's own key for what its worker is handed: a source carrying one is refused whole
    expect('$name' in point.properties).toBe(false);
    expect(namePoints(undefined)).toEqual([]);
  });
});
