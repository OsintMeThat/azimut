import { describe, expect, it } from 'vitest';
import { arrange, kindOf, legendRows, moveRow } from './legend.js';

const view = { lat: 0, lon: 0, zoom: 10, bearing: 0 };
const frame = { width: 400, height: 300 };
const point = (lon, lat, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties });
const rows = [{ name: 'front', title: 'Front', categories: [{ name: 'Sites', colour: '#0072b2' }, { name: 'Lines', colour: '#d55e00' }] }];
const features = { front: { features: [
  point(0, 0, { category: 'Sites', symbol: 'badge-home', colour: '#0072b2' }),
  point(0.01, 0.01, { category: 'Sites', symbol: 'badge-drone', colour: '#0072b2' }),
  point(0.01, 0.01, { category: 'Sites', symbol: 'badge-home', colour: '#0072b2', status: 'destroyed' }),
  // far off the frame
  point(40, 40, { category: 'Sites', symbol: 'badge-tank', colour: '#0072b2' }),
  { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-1, 0], [1, 0]] }, properties: { category: 'Lines', colour: '#d55e00' } },
] } };
const names = { 'badge-home': 'Home', 'badge-drone': 'Drone', 'badge-tank': 'Tank' };
const context = (extra = {}) => ({ rows, collection: (name) => features[name], view, frame, symbolName: (id) => names[id] ?? id,
  colourName: (hex) => (hex === '#d55e00' ? 'Front line' : ''), ...extra });
const map = { id: 'map', layers: [{ name: 'front', hidden: [] }] };

describe('a plate legend', () => {
  it('lists only what the map draws in its frame, one row a look, named after what it shows', () => {
    const labels = legendRows(map, context()).map((row) => row.label);
    expect(labels).toEqual(['Home', 'Drone', 'Home, destroyed', 'Front line']);
  });

  it('lists what the layers hold off the map when asked', () => {
    const labels = legendRows({ ...map, offmap: true }, context()).map((row) => row.label);
    expect(labels).toContain('Tank');
  });

  it('names a group with one style by the group, and tells two alike apart', () => {
    const uniform = [{ ...rows[0], categories: [{ name: 'Sites', colour: '#0072b2', mode: 'uniform' }, rows[0].categories[1]] }];
    const same = { front: { features: [point(0, 0, { category: 'Sites', symbol: 'badge-home', colour: '#0072b2' }),
      point(0.01, 0, { category: 'Sites', symbol: 'badge-home', colour: '#0072b2' })] } };
    expect(legendRows(map, context({ rows: uniform, collection: (name) => same[name] })).map((row) => row.label)).toEqual(['Sites']);
    const twins = { front: { features: [
      point(0, 0, { category: 'Sites', symbol: 'badge-home', colour: '#0072b2' }),
      point(0, 0, { category: 'Depots', symbol: 'badge-home', colour: '#cc0000' }),
    ] } };
    const said = legendRows(map, context({ collection: (name) => twins[name] })).map((row) => row.label);
    expect(new Set(said).size).toBe(2);
  });

  it('speaks for every day of a played export, so it does not jump', () => {
    const states = { front: { features: [point(0, 0, { category: 'Sites', symbol: 'badge-home', colour: '#0072b2', key: 'a' }),
      point(0, 0, { category: 'Sites', symbol: 'badge-drone', colour: '#0072b2', key: 'b' })] } };
    const standing = (row, feature, day) => (feature.properties.key === 'b' && day === '2026-10-01' ? null : feature);
    const one = legendRows(map, context({ collection: (name) => states[name], standing, days: ['2026-10-01'] }));
    const all = legendRows(map, context({ collection: (name) => states[name], standing, days: ['2026-10-01', '2026-10-02'] }));
    expect(one).toHaveLength(1);
    expect(all).toHaveLength(2);
  });

  it('keeps the analyst\'s order, names, rows left out and rows written by hand', () => {
    const entries = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }];
    const said = arrange(entries, { order: ['c'], off: ['b'], names: { a: 'Alpha' } });
    expect(said.map((entry) => entry.key)).toEqual(['c', 'a', 'b']);
    expect(said.find((entry) => entry.key === 'a').label).toBe('Alpha');
    expect(said.find((entry) => entry.key === 'b').off).toBe(true);
    expect(moveRow(said, 'a', 1)).toEqual(['c', 'b', 'a']);
    const extra = legendRows({ ...map, extra: [{ label: 'Claimed line', kind: 'line', colour: '#000000' }] }, context());
    expect(extra.at(-1)).toMatchObject({ label: 'Claimed line', extra: true });
    expect(kindOf({ type: 'MultiPolygon' })).toBe('area');
  });
});
