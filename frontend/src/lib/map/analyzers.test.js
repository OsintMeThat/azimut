import { describe, expect, it } from 'vitest';
import { analyzerGroups, analyzerLock, coverage, describeMeasure, displayGroups, framesPerTile, mapSource, marksToZones, readableDuration, sizeBand, sizeOf, sourceLabel, viewZone, zoneMarks, zoneRing } from './analyzers.js';

describe('saved analysis geometry', () => {
  it('keeps geographic points and names when drawings are edited', () => {
    const zones = [{ id: 'one', name: 'Port', kind: 'polygon', points: [[0, 0], [1, 0], [1, 1]] }];
    const marks = zoneMarks(zones);
    expect(marksToZones(marks, zones)).toEqual(zones);
    expect(marksToZones([{ ...marks[0], points: [[2, 2], [3, 2], [3, 3]] }], zones)[0].name).toBe('Port');
  });
  it('takes only Sentinel-2 from the maps, because Detect reads its bands', () => {
    expect(mapSource({ provider: 'google' })).toBeNull();
    expect(mapSource({ provider: 'esri-wayback', wayback_release: 123 })).toBeNull();
    expect(mapSource({ provider: 'sentinel2', sentinel: { date: '2026-05-11', layer: 'SWIR', maxcc: 20 } }))
      .toEqual({ provider: 'sentinel2', date: '2026-05-11', layer: 'SWIR', maxcc: 20 });
    expect(sourceLabel({ provider: 'sentinel2', date: '2026-05-11' })).toBe('2026-05-11');
    // runs saved before still say what they read
    expect(sourceLabel({ provider: 'esri-wayback', release: 7 })).toBe('Wayback release 7');
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
    // Sentinel's 512px level-13 tiles are 4.9 km across; a finer grid counts more.
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
    // Every date fetches the picture reviewed and the bands measured.
    expect(framesPerTile({ single: true })).toBe(2);
    expect(framesPerTile({ single: false })).toBe(4);
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

describe('what a candidate says about itself', () => {
  it('fills the words its method gives with its own reading', () => {
    expect(describeMeasure('{value}× brighter than the water around it', { value: 6.24 }))
      .toBe('6.2× brighter than the water around it');
    expect(describeMeasure('Reflectance {signed}% in every band', { signed: -12.4 }))
      .toBe('Reflectance −12% in every band');
    expect(describeMeasure('{index} {before} → {after}', { before: 0.612, after: 0.104 }, 'nbr'))
      .toBe('NBR 0.61 → 0.10');
  });

  it('says nothing rather than half a sentence', () => {
    expect(describeMeasure('{value}× brighter', undefined)).toBe('');
    expect(describeMeasure('{index} {before} → {after}', { before: 0.5 }, 'ndvi')).toBe('');
    expect(describeMeasure('', { value: 1 })).toBe('');
  });

  it('knows which size a recipe is at, and when it was tuned by hand', () => {
    const sizes = { small: { min_area: 0, cleanup: 0 }, medium: { min_area: 250, cleanup: 0 } };
    expect(sizeOf({ min_area: 250.0, cleanup: 0, sensitivity: 70 }, sizes)).toBe('medium');
    expect(sizeOf({ min_area: 300, cleanup: 0 }, sizes)).toBe('');
    expect(sizeOf({ min_area: 0 }, undefined)).toBe('');
  });

  it('says what a size actually accepts, in ground terms', () => {
    // The buttons read as "how sensitive"; what they set is a floor and a
    // ceiling on area, and a mark outside the band is found and then dropped.
    expect(sizeBand({ min_area: 0, max_area: 800 })).toContain('Up to 800 m²');
    expect(sizeBand({ min_area: 0, max_area: 800 })).toContain('28 m across');
    expect(sizeBand({ min_area: 20_000, max_area: 0 })).toContain('From 2 ha up');
    expect(sizeBand({ min_area: 400, max_area: 8000 })).toContain('400 m² to 8000 m²');
    expect(sizeBand({ min_area: 0, max_area: 0 })).toContain('Any size');
  });
});

describe('the analyzer list', () => {
  const catalogue = {
    builtins: [{ id: 'boats', method: 'vessels' }, { id: 'radar-vessels', method: 'sar-vessels' }, { id: 'new', method: 'surface' }],
    custom: [{ id: 'custom-1', method: 'vessels' }],
    methods: [{ id: 'vessels', sensor: 'sentinel2' }, { id: 'sar-vessels', sensor: 'sentinel1' }, { id: 'surface', sensor: 'sentinel2' }],
    groups: [{ id: 'vessels', label: 'Vessels', recipes: ['radar-vessels', 'boats'] }],
    copernicus_key: true,
    radar_layer: '',
  };

  it('groups the built-ins by what they look for, and shows one no group names', () => {
    expect(analyzerGroups(catalogue).map((group) => [group.label, group.list.map((entry) => entry.id)])).toEqual([
      ['Vessels', ['radar-vessels', 'boats']], ['Other', ['new']], ['Mine', ['custom-1']]]);
    expect(analyzerGroups({ builtins: [{ id: 'a' }] })).toEqual([{ label: 'Built in', list: [{ id: 'a' }] }]);
  });

  it('locks every analyzer without a key, and radar ones without their layer', () => {
    expect(analyzerLock(catalogue.builtins[0], catalogue)).toBe('');
    expect(analyzerLock(catalogue.builtins[1], catalogue)).toBe('Needs the Sentinel-1 layer');
    expect(analyzerLock(catalogue.builtins[1], { ...catalogue, radar_layer: 'RADAR' })).toBe('');
    expect(analyzerLock(catalogue.builtins[0], { ...catalogue, copernicus_key: false })).toBe('Needs a free Copernicus key');
  });
});
