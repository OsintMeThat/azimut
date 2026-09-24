import { describe, expect, it } from 'vitest';
import {
  HIGH_RESOLUTION, blinkable, candidatePair, candidatePaths, candidateSize, comparePairFor, orderCandidates, pinDefaults,
} from './detectReview.js';

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

describe('how big a candidate is', () => {
  // Pixels about 9.2 m across at 14.8° N: a hull of five of them on the diagonal.
  const step = 0.0000858;
  const pixel = (i) => [[[42.95 + i * step, 14.8 + i * step], [42.95 + (i + 1) * step, 14.8 + i * step],
    [42.95 + (i + 1) * step, 14.8 + (i + 1) * step], [42.95 + i * step, 14.8 + (i + 1) * step],
    [42.95 + i * step, 14.8 + i * step]]];
  const diagonal = { type: 'MultiPolygon', coordinates: [0, 1, 2, 3, 4].map(pixel) };

  it('measures a footprint along its hull rather than its north-up box', () => {
    const { length, width } = candidateSize({ geometry: diagonal });
    // five pixels corner to corner, and one pixel's diagonal across
    expect(length).toBeGreaterThan(60);
    expect(length).toBeLessThan(70);
    expect(width).toBeGreaterThan(12);
    expect(width).toBeLessThan(15);
  });

  it('falls back to the box of a result older than footprints, and has nothing for a point', () => {
    const boxed = candidateSize({ bbox: [2, 48, 2.001, 48.001] });
    expect(boxed.length).toBeCloseTo(111.3, 0);
    expect(boxed.width).toBeCloseTo(74.5, 0);
    expect(candidateSize({ geometry: { type: 'Point', coordinates: [2, 48] }, bbox: [2, 48, 2.001, 48.001] })).toBe(null);
    expect(candidateSize(undefined)).toBe(null);
  });

  it('walks the queue largest first when asked, keeping the run order otherwise', () => {
    const rows = [
      { id: 'strong-small', geometry: { type: 'MultiPolygon', coordinates: [pixel(0)] }, area: 85 },
      { id: 'point', geometry: { type: 'Point', coordinates: [2, 48] }, area: 85 },
      { id: 'weak-long', geometry: diagonal, area: 425 },
    ];
    expect(orderCandidates(rows)).toBe(rows);
    expect(orderCandidates(rows, 'size').map((row) => row.id)).toEqual(['weak-long', 'strong-small', 'point']);
    expect(rows.map((row) => row.id)).toEqual(['strong-small', 'point', 'weak-long']);
  });
});

describe('the two passes behind a candidate', () => {
  const optical = (date) => ({ provider: 'sentinel2', date, layer: 'TRUE_COLOR', maxcc: 30 });
  const radar = (date, time) => ({ provider: 'sentinel1', date, time });
  const run = {
    input: { a: optical('2026-01-01'), b: optical('2026-01-09') },
    area_runs: [
      { area_id: 'north', status: 'failed', a: optical('2026-02-01'), b: optical('2026-02-09') },
      { area_id: 'south', status: 'ready', a: optical('2026-03-01'), b: optical('2026-03-09') },
      { area_id: 'east', status: 'ready', a: optical('2026-04-01'), b: optical('2026-04-09') },
    ],
  };

  it('reads the candidate’s own pair, then its area’s, then the run’s', () => {
    const own = { a: optical('2026-05-01'), b: optical('2026-05-11') };
    expect(candidatePair({ sources: own, area_id: 'east' }, run)).toEqual(own);
    expect(candidatePair({ area_id: 'east' }, run).b.date).toBe('2026-04-09');
    // an area that failed has no pair to lend, so the first one read does
    expect(candidatePair({ area_id: 'north' }, run).a.date).toBe('2026-03-01');
    expect(candidatePair(null, { input: run.input })).toEqual(run.input);
  });

  it('blinks two dated passes of one archive, never one pass twice', () => {
    expect(blinkable({ a: optical('2026-09-08'), b: optical('2026-09-21') })).toBe(true);
    expect(blinkable({ a: radar('2026-09-10', '02:06:40'), b: radar('2026-09-22', '02:06:41') })).toBe(true);
    // one day, two radar passes of the day
    expect(blinkable({ a: radar('2026-09-22', '02:06:41'), b: radar('2026-09-22', '14:10:02') })).toBe(true);
    // a detector that reads one pass
    expect(blinkable({ a: optical('2026-09-21'), b: optical('2026-09-21') })).toBe(false);
    expect(blinkable({ a: optical('2026-09-08'), b: radar('2026-09-21', '02:06:41') })).toBe(false);
    expect(blinkable({ a: { provider: 'esri-wayback', release: 1 }, b: { provider: 'esri-wayback', release: 2 } })).toBe(false);
    expect(blinkable({ a: null, b: optical('2026-09-21') })).toBe(false);
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
