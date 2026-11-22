import { describe, expect, it } from 'vitest';
import { drawnAs, landAt } from './landings.js';

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

  it('carries a name put by hand with a move sent with no date, and leaves it where it was put on a dated one', () => {
    const zone = (key, at) => feature(key, { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, { label_at: at });
    const [moved, dated, edge] = landAt([zone('moved', [0.5, 0.5]), zone('dated', [0.5, 0.5]), zone('edge', [179.9, 0.5])], [
      { keys: ['moved', 'edge'], offset: [0.25, 1] }, { keys: ['dated'], offset: [0.25, 1], dated: true }]);
    expect(moved.properties.label_at).toEqual([0.75, 1.5]);
    expect(dated.properties.label_at).toEqual([0.5, 0.5]);
    // off the map, it goes back to its middle, as the layer saves it
    expect('label_at' in edge.properties).toBe(false);
  });

  it('puts a name where it was let go, and back to its middle with a null', () => {
    const zone = feature('zone', { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, { label_at: [0.5, 0.5] });
    expect(landAt([zone], [{ keys: ['zone'], properties: { label_at: [2, 3] } }])[0].properties.label_at).toEqual([2, 3]);
    expect('label_at' in landAt([zone], [{ keys: ['zone'], properties: { label_at: null } }])[0].properties).toBe(false);
  });

  it('hands the features back untouched when nothing landed', () => {
    const features = [point('a', 0, 0)];
    expect(landAt(features, [])).toBe(features);
    expect(landAt(features, null)).toBe(features);
  });
});

describe('a feature just added', () => {
  it('is drawn on top, an empty layer included, and the others are left as they were', () => {
    const added = point('$new-1', 5, 5);
    const still = point('still', 9, 9);
    const numbered = (index) => ({ ...added, properties: { ...added.properties, index } });
    expect(landAt([still], [{ keys: [], feature: added }])).toEqual([still, numbered(1)]);
    expect(landAt([], [{ keys: [], feature: added }])).toEqual([numbered(0)]);
    // its key names nothing the layer holds: a move made meanwhile is not put on it
    expect(landAt([still], [{ keys: ['$new-1'], feature: added }, { keys: ['still'], offset: [1, 1] }]).map((one) => one.geometry.coordinates))
      .toEqual([[10, 10], [5, 5]]);
  });

  it('says what the layer will draw it with, from its group and the icons it holds', () => {
    const group = { id: 'g', name: 'Strikes', mode: 'individual', colour: '#0072b2', size: 2, stroke: 3, labels: true, events: true, area_fill: 'hatch' };
    expect(drawnAs({ key: 'k', colour: '#d55e00', symbol: 'flag', icon: 'aaaaaaaaaaaaaaaa' }, group, { aaaaaaaaaaaaaaaa: { mode: 'disc', name: 'Tank' } }))
      .toEqual({ key: 'k', colour: '#d55e00', symbol: 'flag', icon: 'aaaaaaaaaaaaaaaa', category: 'Strikes', icon_scale: 2, stroke_width: 3,
        area_fill: 'hatch', show_label: true, event: true, icon_mode: 'disc', icon_name: 'Tank' });
    expect(drawnAs({ key: 'k', colour: '#d55e00', symbol: 'flag', label: 'off' }, { ...group, mode: 'uniform', symbol: 'star', icon: '' }))
      .toMatchObject({ colour: '#0072b2', symbol: 'star', icon: '' });
    expect(drawnAs({ key: 'k', colour: '#d55e00', symbol: 'flag' }, { ...group, mode: 'colour' })).toMatchObject({ colour: '#0072b2', symbol: 'flag' });
    expect(drawnAs({ key: 'k', label: 'off' }, group).show_label).toBeUndefined();
  });
});
