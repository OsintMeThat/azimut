import { describe, expect, it } from 'vitest';
import { featuresInLoop, hitFeature, hitPart, markerDisc, mergeable, splittable } from './layerHit.js';

const project = (lon, lat) => ({ x: lon * 10, y: lat * 10 });
const point = (key, lon, lat, symbol = 'badge-tank') => ({ geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { key, symbol } });
const line = (key, coordinates) => ({ geometry: { type: 'LineString', coordinates }, properties: { key } });
const area = (key, ring) => ({ geometry: { type: 'Polygon', coordinates: [ring] }, properties: { key } });

describe('what sits under the pointer', () => {
  it('takes a badge round its point and a plain pin by the head standing above it', () => {
    expect(hitFeature([point('badge', 10, 10)], project, { x: 108, y: 105 })).toBe('badge');
    expect(hitFeature([point('pin', 10, 10, 'pin')], project, { x: 100, y: 80 })).toBe('pin');
    expect(hitFeature([point('pin', 10, 10, 'pin')], project, { x: 100, y: 130 })).toBeNull();
  });

  it('prefers a mark to a stroke, a stroke to an area, and the smaller of two areas', () => {
    const features = [area('big', [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]), area('small', [[5, 5], [8, 5], [8, 8], [5, 8], [5, 5]]),
      line('road', [[0, 10], [20, 10]]), point('mark', 10, 10)];
    expect(hitFeature(features, project, { x: 100, y: 100 })).toBe('mark');
    expect(hitFeature(features, project, { x: 150, y: 103 })).toBe('road');
    expect(hitFeature(features, project, { x: 60, y: 60 })).toBe('small');
    expect(hitFeature(features, project, { x: 150, y: 150 })).toBe('big');
  });

  it('says whether an area was pressed on its edge or inside it', () => {
    const features = [area('zone', [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]), line('road', [[30, 0], [30, 20]]), point('mark', 50, 50)];
    expect(hitPart(features, project, { x: 100, y: 3 })).toEqual({ key: 'zone', part: 'stroke' });
    expect(hitPart(features, project, { x: 100, y: 100 })).toEqual({ key: 'zone', part: 'inside' });
    expect(hitPart(features, project, { x: 302, y: 100 })).toEqual({ key: 'road', part: 'stroke' });
    expect(hitPart(features, project, { x: 500, y: 500 })).toEqual({ key: 'mark', part: 'mark' });
    expect(hitPart(features, project, { x: 900, y: 900 })).toBeNull();
  });

  it('picks whatever a loop encloses, a shape by any of its corners', () => {
    const loop = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const keys = featuresInLoop([point('in', 5, 5), point('out', 50, 50), line('half', [[5, 5], [50, 50]])], project, loop);
    expect(keys).toEqual(['in', 'half']);
  });

  it('takes the mark drawn on top where two overlap, not the nearer one', () => {
    const under = point('under', 10, 10), over = point('over', 10.5, 10);
    expect(hitFeature([under, over], project, { x: 101, y: 100 })).toBe('over');
    expect(hitFeature([over, under], project, { x: 104, y: 100 })).toBe('under');
  });

  it('merges two or more lines, or areas, and splits only what has parts', () => {
    expect(mergeable([line('a', []), line('b', [])])).toBe(true);
    expect(mergeable([line('a', []), point('b', 0, 0)])).toBe(false);
    expect(mergeable([point('a', 0, 0), point('b', 0, 0)])).toBe(false);
    expect(splittable({ geometry: { type: 'MultiLineString', coordinates: [[], []] } })).toBe(true);
    expect(splittable({ geometry: { type: 'MultiLineString', coordinates: [[]] } })).toBe(false);
  });
});

describe("a marker wearing one of the analyst's icons", () => {
  const project = (lon, lat) => ({ x: lon * 100, y: -lat * 100 });
  const marker = (properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] },
    properties: { key: 'k', symbol: 'pin', ...properties } });

  it('is ringed on its point, not where the pin it keeps underneath has its head', () => {
    expect(markerDisc(marker({}), project)).toMatchObject({ x: 100, y: -120 });
    expect(markerDisc(marker({ icon: 'abcdef0123456789' }), project)).toMatchObject({ x: 100, y: -100, r: 14 });
  });

  it('is ringed round the painted part of a picture drawn as it is, at its size', () => {
    const own = () => ({ dx: 0, dy: -8, reach: 10 });
    expect(markerDisc(marker({ icon: 'abcdef0123456789', icon_scale: 2 }), project, own)).toMatchObject({ x: 100, y: -116, r: 20 });
  });

  it('is picked by a press on its picture', () => {
    const features = [marker({ icon: 'abcdef0123456789' })];
    expect(hitFeature(features, project, { x: 100, y: -100 })).toBe('k');
    // where the pin's head would be, well above a centred icon, is not it
    expect(hitFeature(features, project, { x: 100, y: -122 })).toBeNull();
  });
});
