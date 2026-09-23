import { describe, expect, it } from 'vitest';
import { HIGH_RESOLUTION, candidatePaths, comparePairFor, pinDefaults } from './detectReview.js';

const candidate = { phenomenon: 'Change', coordinates: [2, 48], geometry: { type: 'Polygon', coordinates: [] } };
describe('Detect review', () => {
  it('defaults single-image methods to an after image and a point', () => {
    expect(pinDefaults(candidate, true)).toEqual({ title: 'Change · 48.0000, 2.0000', description: '', after_only: true, shape: 'point' });
  });
  it('defaults change methods to paired images and an area', () => {
    expect(pinDefaults(candidate, false)).toMatchObject({ after_only: false, shape: 'area' });
    expect(pinDefaults({ ...candidate, geometry: { type: 'Point' } }, false).shape).toBe('point');
  });
  it('draws all rings and merged parts instead of a bbox', () => {
    const shape = { type: 'MultiPolygon', coordinates: [[[[0, 0], [2, 0], [1, 1], [0, 0]]], [[[3, 3], [4, 3], [4, 4], [3, 3]]]] };
    const path = candidatePaths(shape, ([x, y]) => ({ x, y }));
    expect(path).toBe('M0,0 L2,0 L1,1 L0,0Z M3,3 L4,3 L4,4 L3,3Z');
  });
});

describe('a candidate opened in Compare', () => {
  const found = (sources, extra = {}) => ({ phenomenon: 'Burn scar', coordinates: [44.1, 15.3], sources, ...extra });
  const optical = (date) => ({ provider: 'sentinel2', date, layer: 'TRUE_COLOR', maxcc: 30 });
  const radar = (date, time) => ({ provider: 'sentinel1', date, time, layer: 'SAR_IW', maxcc: 100 });

  it('reads a change on the two passes that found it, framed close', () => {
    const pair = comparePairFor(found({ a: optical('2026-05-04'), b: optical('2026-05-11') }));
    expect(pair).toMatchObject({ lat: 15.3, lon: 44.1, zoom: 16, dates: ['2026-05-04', '2026-05-11'] });
    expect(pair.a).toEqual({ provider: 'sentinel2', sentinel: { date: '2026-05-04', layer: 'TRUE_COLOR', maxcc: 100 }, present: true });
  });

  it('holds a thing present on one pass against today’s high-resolution picture', () => {
    const pass = optical('2026-05-11');
    const pair = comparePairFor(found({ a: pass, b: pass }), { single: true, method: 'hotspots' });
    expect(pair.a).toEqual({ provider: HIGH_RESOLUTION, present: true });
    // a fire is read where the detector saw it, in short-wave infrared
    expect(pair.b.sentinel.layer).toBe('SWIR');
  });

  it('opens radar passes on the radar basemap', () => {
    const pair = comparePairFor(found({ a: radar('2026-05-02', '05:42:10'), b: radar('2026-05-14', '05:42:40') }));
    expect(pair.b).toEqual({ provider: 'sentinel1', radar: { date: '2026-05-14', time: '05:42:40' }, present: true });
    const ship = radar('2026-05-14', '05:42:40');
    expect(comparePairFor(found({ a: ship, b: ship }), { single: true }).a.provider).toBe(HIGH_RESOLUTION);
  });

  it('has nothing to open without a dated pass', () => {
    expect(comparePairFor(found({ a: optical(''), b: optical('') }))).toBe(null);
  });
});
