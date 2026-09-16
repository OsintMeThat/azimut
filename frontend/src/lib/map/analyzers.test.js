import { describe, expect, it } from 'vitest';
import {
  coverage,
  displayGroups,
  framesPerTile,
  mapSource,
  readableDuration,
  marksToZones,
  viewZone,
  zoneMarks,
  zoneRing,
} from './analyzers.js';

describe('saved analysis geometry', () => {
  it('keeps geographic points and names when drawings are edited', () => {
    const zones = [{ id: 'one', name: 'Port', kind: 'polygon', points: [[0, 0], [1, 0], [1, 1]] }];
    const marks = zoneMarks(zones);
    expect(marksToZones(marks, zones)).toEqual(zones);
    expect(marksToZones([{ ...marks[0], points: [[2, 2], [3, 2], [3, 3]] }], zones)[0].name).toBe('Port');
  });
  it('restricts sources without silently converting another provider', () => {
    expect(mapSource({ provider: 'google' })).toBeNull();
    expect(mapSource({ provider: 'esri-world-imagery' })).toBeNull();
    expect(mapSource({ provider: 'esri-wayback', wayback_release: 123 })).toMatchObject({ release: 123 });
  });
  it('changes screen clustering without changing saved detection geometry', () => {
    const rows = [{ id: 1, coordinates: [1, 1] }, { id: 2, coordinates: [2, 1] }];
    const before = JSON.stringify(rows);
    expect(displayGroups(rows, ([x, y]) => ({ x, y }))).toHaveLength(1);
    expect(displayGroups(rows, ([x, y]) => ({ x: x * 100, y }))).toHaveLength(2);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('closes each kind of outline the way the engine does', () => {
    expect(zoneRing({ kind: 'rect', points: [[0, 1], [2, 3]] }))
      .toEqual([[0, 1], [2, 1], [2, 3], [0, 3]]);
    expect(zoneRing({ kind: 'polygon', points: [[0, 0], [1, 0], [1, 1]] })).toHaveLength(3);
    const ellipse = zoneRing({ kind: 'ellipse', points: [[0, 0], [2, 2]] });
    expect(ellipse).toHaveLength(64);
    expect(ellipse[0][0]).toBeCloseTo(2, 6);
    expect(ellipse[16][1]).toBeCloseTo(2, 6);
  });
});

describe('what a run will cost before it starts', () => {
  const kmSquare = (size) => [{ id: 'a', kind: 'rect', points: [[0, 0], [size, size]] }];

  it('reads ground area from the outline, not the bounding box', () => {
    // A tenth of a degree at the equator is 11.132 km, so 123.9 km².
    expect(coverage(kmSquare(0.1), null).km2).toBeCloseTo(123.92, 1);
    const triangle = [{ id: 'a', kind: 'polygon', points: [[0, 0], [0.1, 0], [0.1, 0.1]] }];
    expect(coverage(triangle, null).km2).toBeCloseTo(61.96, 1);
  });

  it('counts native tiles per grid, and never promises less work than the run', () => {
    // Sentinel's 512px level-13 tiles are 4.9 km across; Wayback's are 76 m.
    expect(coverage(kmSquare(0.01), [13, 512]).tiles).toBe(1);
    expect(coverage(kmSquare(0.01), [19, 256]).tiles).toBe(225);
    // Overlapping areas are the same tiles, counted once.
    const twice = [...kmSquare(0.01), { id: 'b', kind: 'rect', points: [[0, 0], [0.005, 0.005]] }];
    expect(coverage(twice, [19, 256]).tiles).toBe(225);
  });

  it('gives up rather than enumerate an impossible area', () => {
    expect(coverage(kmSquare(5), [19, 256]).tiles).toBe(Infinity);
  });

  it('counts the requests a sweep makes, and says how long that is', () => {
    expect(framesPerTile({ single: false })).toBe(2);
    expect(framesPerTile({ single: true })).toBe(1);
    // A band detector fetches the picture reviewed and the bands measured.
    expect(framesPerTile({ single: true, bands: true })).toBe(2);
    expect(framesPerTile({ single: false, bands: true })).toBe(4);
    expect(readableDuration(20)).toBe('20 s');
    expect(readableDuration(600)).toBe('10 min');
    expect(readableDuration(7200)).toBe('2.0 h');
    expect(readableDuration(Infinity)).toBe('a long time');
  });

  it('turns the camera into a rectangle the engine accepts', () => {
    const zone = viewZone({ west: 2, south: 48, east: 3, north: 49 }, 'Harbour');
    expect(zone).toMatchObject({ name: 'Harbour', kind: 'rect', points: [[2, 49], [3, 48]] });
    expect(zone.id).toMatch(/^[a-z0-9-]{8,48}$/);
  });
});
