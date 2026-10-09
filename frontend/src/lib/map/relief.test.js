import { describe, expect, it, vi } from 'vitest';
import {
  createRelief,
  demSource,
  EXAGGERATIONS,
  exaggerationOf,
  MAX_TILT,
  RELIEF_SOURCE,
  STEADY_LEVELS,
  steadyZoom,
  TILT_TILE_RATIO,
} from './relief.js';

/** What `/api/terrain/sources` answers (api/terrain.py). */
const SOURCES = {
  tiles: '/api/terrain/tiles/{z}/{x}/{y}',
  tile_size: 512,
  max_zoom: 12,
  encoding: 'terrarium',
  sources: [
    { id: 'mapterhorn', label: 'Mapterhorn', attribution: '© Mapterhorn', link: 'https://mapterhorn.com/attribution' },
    { id: 'aws-terrain', label: 'AWS Terrain Tiles', attribution: 'Terrain Tiles', link: '' },
  ],
};

function stubMap() {
  const sources = new Map();
  const calls = { terrain: [], maxPitch: [], sky: [], lod: [], clamp: [], mousePan: [], wheel: [] };
  const listeners = new Map();
  const count = (name) => listeners.get(name)?.size ?? 0;
  return {
    calls,
    listeners,
    count,
    fire: (name, event) => [...(listeners.get(name) ?? [])].forEach((handler) => handler(event)),
    _camera: { transformCameraUpdate: null },
    dragPan: {
      _mousePan: { enable: () => calls.mousePan.push(true), disable: () => calls.mousePan.push(false) },
    },
    scrollZoom: { enable: () => calls.wheel.push(true), disable: () => calls.wheel.push(false) },
    setCenterClampedToGround: (on) => calls.clamp.push(on),
    setSourceTileLodParams: (levels, ratio) => calls.lod.push([levels, ratio]),
    on: (name, handler) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    off: (name, handler) => listeners.get(name)?.delete(handler),
    getSource: (id) => sources.get(id),
    addSource: (id, spec) => sources.set(id, spec),
    setTerrain: (spec) => {
      calls.terrain.push(spec);
      // the clamp in force when the terrain changes is what seats the flat map
      calls.clampAtTerrain = calls.clamp.at(-1);
    },
    setMaxPitch: (n) => calls.maxPitch.push(n),
    setSky: (spec) => calls.sky.push(spec),
    sources,
  };
}

describe('relief', () => {
  it('builds the raster-dem source from what the app serves', () => {
    expect(demSource(SOURCES)).toEqual({
      type: 'raster-dem',
      tiles: ['/api/terrain/tiles/{z}/{x}/{y}'],
      tileSize: 512,
      maxzoom: 12,
      encoding: 'terrarium',
      attribution: '© Mapterhorn',
    });
  });

  it('offers real scale first and refuses a made-up exaggeration', () => {
    expect(EXAGGERATIONS[0]).toBe(1);
    expect(exaggerationOf(2)).toBe(2);
    expect(exaggerationOf('1.5')).toBe(1.5);
    expect(exaggerationOf(10)).toBe(1);
    expect(exaggerationOf(undefined)).toBe(1);
  });

  it('asks for nothing until it is switched on', async () => {
    const sources = vi.fn(async () => SOURCES);
    const map = stubMap();
    const relief = createRelief(map, sources);
    expect(sources).not.toHaveBeenCalled();
    await relief.show(true, { exaggeration: 2 });
    expect(sources).toHaveBeenCalledTimes(1);
    expect(map.sources.get(RELIEF_SOURCE).type).toBe('raster-dem');
    expect(map.calls.terrain.at(-1)).toEqual({ source: RELIEF_SOURCE, exaggeration: 2 });
    expect(map.calls.maxPitch.at(-1)).toBe(MAX_TILT);
    expect(relief.on).toBe(true);
  });

  it('flattens the map when switched off, and reads the sources once', async () => {
    const sources = vi.fn(async () => SOURCES);
    const map = stubMap();
    const relief = createRelief(map, sources);
    await relief.show(true);
    await relief.show(false);
    expect(map.calls.terrain.at(-1)).toBeNull();
    expect(map.calls.maxPitch.at(-1)).toBe(0);
    expect(relief.on).toBe(false);
    await relief.show(true);
    expect(sources).toHaveBeenCalledTimes(1);
  });

  it('loads fewer far tiles while tilted, for every source including one added later', async () => {
    const map = stubMap();
    const relief = createRelief(map, async () => SOURCES);
    await relief.show(true);
    expect(map.calls.lod.at(-1)[1]).toBe(TILT_TILE_RATIO);
    // a basemap switched while relief is on arrives as style data
    map.calls.lod.length = 0;
    map.fire('styledata');
    expect(map.calls.lod).toEqual([[expect.any(Number), TILT_TILE_RATIO]]);
    await relief.show(false);
    expect(map.calls.lod.at(-1)[1]).toBe(3);
    expect(map.count('styledata')).toBe(0);
  });

  it('lets the last switch win while the sources are still being read', async () => {
    let release;
    const map = stubMap();
    const relief = createRelief(map, () => new Promise((resolve) => (release = resolve)));
    const turningOn = relief.show(true);
    await relief.show(false);
    release(SOURCES);
    await turningOn;
    expect(relief.on).toBe(false);
    expect(map.calls.terrain.every((spec) => spec === null)).toBe(true);
  });

  it('reads a tilted turn ahead only while the relief is on, and only when asked to', async () => {
    const map = stubMap();
    const plain = createRelief(map, async () => SOURCES);
    // the seating of the centre listens from the start (groundHold.js)
    const seating = map.count('moveend');
    await plain.show(true);
    expect(map.count('moveend')).toBe(seating);

    const warmed = stubMap();
    const relief = createRelief(warmed, async () => SOURCES, { imagery: 'basemap-imagery', send: vi.fn() });
    await relief.show(true);
    expect(warmed.count('moveend')).toBe(seating + 1);
    await relief.show(false);
    expect(warmed.count('moveend')).toBe(seating);
    await relief.show(true);
    relief.dispose();
    expect(warmed.count('moveend')).toBe(0);
  });

  it('asks the relief in the batches a tilted map asks in, on a map of the app’s', async () => {
    expect(demSource(SOURCES, 'm3').tiles).toEqual(['azimut-tiles://m3/terrain/{z}/{x}/{y}']);
    const map = stubMap();
    await createRelief(map, async () => SOURCES, null, { mapId: 'm3' }).show(true);
    expect(map.sources.get(RELIEF_SOURCE).tiles).toEqual(['azimut-tiles://m3/terrain/{z}/{x}/{y}']);
  });

  it('takes the drag and the wheel over from the engine while on, and gives them back', async () => {
    const map = stubMap();
    const relief = createRelief(map, async () => SOURCES);
    await relief.show(true);
    expect(map.calls.mousePan).toEqual([false]);
    expect(map.calls.wheel).toEqual([false]);
    await relief.show(false);
    expect(map.calls.mousePan).toEqual([false, true]);
    expect(map.calls.wheel).toEqual([false, true]);
  });

  it('lets the eye ride new ground in, and seats a flat map at sea level again', async () => {
    const map = stubMap();
    const relief = createRelief(map, async () => SOURCES);
    await relief.show(true);
    // the app placed this ground: the engine's own seating, until the map is idle
    expect(map.calls.clamp.at(-1)).toBe(true);
    map.fire('idle');
    expect(map.calls.clamp.at(-1)).toBe(false);
    await relief.show(false);
    expect(map.calls.clampAtTerrain).toBe(true);
  });

  it('keeps the eye out of the ground while on, and only then', async () => {
    const map = stubMap();
    const relief = createRelief(map, async () => SOURCES);
    await relief.show(true);
    expect(typeof map._camera.transformCameraUpdate).toBe('function');
    await relief.show(false);
    expect(map._camera.transformCameraUpdate).toBeNull();
  });

  it('chooses the imagery again only once the zoom has really moved', () => {
    expect(steadyZoom(15, 16)).toBe(15);
    expect(steadyZoom(15, 14)).toBe(15);
    expect(steadyZoom(15, 15 + STEADY_LEVELS)).toBe(15 + STEADY_LEVELS);
    expect(steadyZoom(15, 15 - STEADY_LEVELS)).toBe(15 - STEADY_LEVELS);
    expect(steadyZoom(undefined, 16)).toBe(16);
  });
});
