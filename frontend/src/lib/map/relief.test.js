import { describe, expect, it, vi } from 'vitest';
import {
  createRelief,
  demSource,
  EXAGGERATIONS,
  exaggerationOf,
  MAX_TILT,
  RELIEF_SOURCE,
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
  const calls = { terrain: [], maxPitch: [], sky: [], lod: [] };
  const listeners = new Map();
  return {
    calls,
    listeners,
    setSourceTileLodParams: (levels, ratio) => calls.lod.push([levels, ratio]),
    on: (name, handler) => listeners.set(name, handler),
    off: (name, handler) => listeners.get(name) === handler && listeners.delete(name),
    getSource: (id) => sources.get(id),
    addSource: (id, spec) => sources.set(id, spec),
    setTerrain: (spec) => calls.terrain.push(spec),
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
    map.listeners.get('styledata')();
    expect(map.calls.lod).toEqual([[expect.any(Number), TILT_TILE_RATIO]]);
    await relief.show(false);
    expect(map.calls.lod.at(-1)[1]).toBe(3);
    expect(map.listeners.has('styledata')).toBe(false);
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
    await createRelief(map, async () => SOURCES).show(true);
    expect(map.listeners.has('moveend')).toBe(false);

    const warmed = stubMap();
    const relief = createRelief(warmed, async () => SOURCES, { imagery: 'basemap-imagery', send: vi.fn() });
    await relief.show(true);
    expect(warmed.listeners.has('moveend')).toBe(true);
    await relief.show(false);
    expect(warmed.listeners.has('moveend')).toBe(false);
    await relief.show(true);
    relief.dispose();
    expect(warmed.listeners.has('moveend')).toBe(false);
  });
});
