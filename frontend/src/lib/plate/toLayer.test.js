import { describe, expect, it } from 'vitest';
import { annotationsLayer, drawnOn } from './toLayer.js';

const spec = { theme: { accent: '#c8102e' }, elements: [
  { id: 'map', kind: 'map', box: [0, 0, 100, 100] },
  { id: 'z', kind: 'zone', of: 'map', box: [0, 0, 1, 1], points: [[30, 50], [31, 50], [31, 51]], text: 'Held', colour: '#0000ff', onward: '2026-10-01', until: 'now' },
  { id: 'l', kind: 'line', of: 'map', box: [0, 0, 1, 1], points: [[30, 50], [31, 51]], width: 2 },
  { id: 'a', kind: 'arrow', of: 'map', box: [0, 0, 1, 1], at: [30, 50], to: [30.5, 50.5] },
  { id: 'r', kind: 'ring', of: 'map', box: [0, 0, 1, 1], at: [30, 50], radii: [1, 2] },
  { id: 'c', kind: 'cone', of: 'map', box: [0, 0, 1, 1], at: [30, 50], bearing: 90, spread: 40, reach: 2 },
  { id: 's', kind: 'symbol', of: 'map', box: [0, 0, 1, 1], at: [30.1, 50.1], symbol: 'badge-tank', status: 'destroyed' },
  { id: 'n', kind: 'label', of: 'map', box: [0, 0, 1, 1], at: [30.2, 50.2], text: 'Depot' },
  { id: 'tied', kind: 'label', of: 'map', box: [0, 0, 1, 1], at: [30.2, 50.2], text: 'Feature', ref: { layer: 'x', key: 'k' } },
  { id: 'other', kind: 'label', of: 'map2', box: [0, 0, 1, 1], at: [1, 1], text: 'elsewhere' },
  { id: 't', kind: 'text', box: [0, 0, 1, 1], text: 'title' },
] };

describe('what was drawn on a plate\'s map, made into a layer', () => {
  it('takes what stands on that map\'s ground, but a feature\'s own label', () => {
    expect(drawnOn(spec, 'map').map((element) => element.id)).toEqual(['z', 'l', 'a', 'r', 'c', 's', 'n']);
  });

  it('writes each as a personal layer\'s feature, in its group and colour, its days kept', () => {
    const { geojson, used } = annotationsLayer(spec, 'map', 'Drawn');
    expect(geojson).toMatchObject({ type: 'FeatureCollection', name: 'Drawn', azimut_personal_layer: 1 });
    expect(used).toEqual(['z', 'l', 'a', 'r', 'c', 's', 'n']);
    const zone = geojson.features[0];
    expect(zone.geometry.type).toBe('Polygon');
    expect(zone.geometry.coordinates[0].at(-1)).toEqual(zone.geometry.coordinates[0][0]);
    expect(zone.properties).toMatchObject({ name: 'Held', category: 'Zones', colour: '#0000ff', date: '2026-10-01' });
    expect(zone.properties.date_end).toBeUndefined();
    expect(geojson.features.filter((feature) => feature.properties.category === 'Rings')).toHaveLength(2);
    const symbol = geojson.features.find((feature) => feature.properties.category === 'Symbols');
    expect(symbol.properties).toMatchObject({ symbol: 'badge-tank', status: 'destroyed', colour: '#c8102e' });
    expect(geojson.features.find((feature) => feature.properties.category === 'Labels').properties.name).toBe('Depot');
    expect(geojson.features.find((feature) => feature.properties.category === 'Lines').properties.stroke_width).toBe(4);
    expect(geojson.features.find((feature) => feature.properties.category === 'Views').geometry.type).toBe('Polygon');
  });
});
