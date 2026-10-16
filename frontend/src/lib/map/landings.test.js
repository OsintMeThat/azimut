import { describe, expect, it } from 'vitest';
import { landAt } from './landings.js';

const feature = (key, geometry, properties = {}) => ({ type: 'Feature', geometry, properties: { key, ...properties } });
const point = (key, lon, lat, properties) => feature(key, { type: 'Point', coordinates: [lon, lat] }, properties);

describe('edits drawn where they landed', () => {
  it('shifts every point of what was moved, its height kept, and leaves the rest as it was', () => {
    const area = feature('area', { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] });
    const line = feature('line', { type: 'LineString', coordinates: [[2, 2, 40], [3, 3, 50]] });
    const still = point('still', 9, 9);
    const [movedArea, movedLine, kept] = landAt([area, line, still], [{ keys: ['area', 'line'], offset: [0.5, -1] }]);
    expect(movedArea.geometry.coordinates).toEqual([[[[0.5, -1], [1.5, -1], [1.5, 0], [0.5, -1]]]]);
    expect(movedLine.geometry.coordinates).toEqual([[2.5, 1, 40], [3.5, 2, 50]]);
    expect(kept).toBe(still);
    // what the layer holds is never written to
    expect(area.geometry.coordinates[0][0][0]).toEqual([0, 0]);
  });

  it('puts a reshaped shape in, and a new direction on, with a null taking it off', () => {
    const reshaped = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] };
    const [shape, aimed, cleared] = landAt([
      feature('shape', { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }),
      point('aimed', 1, 1),
      point('cleared', 2, 2, { bearing: 45 }),
    ], [{ keys: ['shape'], geometry: reshaped }, { keys: ['aimed'], properties: { bearing: 90 } }, { keys: ['cleared'], properties: { bearing: null } }]);
    expect(shape.geometry).toBe(reshaped);
    expect(aimed.properties).toEqual({ key: 'aimed', bearing: 90 });
    expect('bearing' in cleared.properties).toBe(false);
  });

  it('adds two moves made one after the other, and keeps a past drawn under a feature where it was', () => {
    const trail = point('pin', 0, 0, { $trail: true });
    const [past, now] = landAt([trail, point('pin', 0, 0)], [{ keys: ['pin'], offset: [1, 0] }, { keys: ['pin'], offset: [0, 2] }]);
    expect(now.geometry.coordinates).toEqual([1, 2]);
    expect(past).toBe(trail);
  });

  it('hands the features back untouched when nothing landed', () => {
    const features = [point('a', 0, 0)];
    expect(landAt(features, [])).toBe(features);
    expect(landAt(features, null)).toBe(features);
  });
});
