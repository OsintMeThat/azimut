import { describe, expect, it, vi } from 'vitest';
import { coveringTile, createTileSources, describeSource, readOnce, tileUrl } from './sources.js';

const RAILWAY = describeSource({ type: 'raster', tiles: ['https://a/{z}/{x}/{y}.png', 'https://b/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19 });
const BORDERS = describeSource({ type: 'vector', tiles: ['https://t/{z}/{x}/{y}.pbf'], maxzoom: 14 });

describe('the flat map’s sources, fetched for the globe', () => {
  it('has nothing to fetch from a source without tiles (its TileJSON not read yet)', () => {
    expect(describeSource({ type: 'vector', url: 'https://t/planet' })).toBeNull();
    expect(BORDERS.tileSize).toBe(512);
  });

  it('reads a 512 px source a level up, and its last level past it', () => {
    expect(coveringTile(RAILWAY, 10, 532, 361)).toEqual({ z: 10, x: 532, y: 361, up: 0 });
    expect(coveringTile(BORDERS, 10, 532, 361)).toEqual({ z: 9, x: 266, y: 180, up: 1 });
    expect(coveringTile(BORDERS, 18, 1000, 2000)).toEqual({ z: 14, x: 62, y: 125, up: 4 });
    // shallower than a source starts, none
    expect(coveringTile({ ...RAILWAY, minzoom: 5 }, 3, 1, 1)).toBeNull();
  });

  it('fills the address in and shares the tiles between the hosts', () => {
    expect(tileUrl(RAILWAY, { z: 3, x: 1, y: 2 })).toBe('https://b/3/1/2.png');
    expect(tileUrl(RAILWAY, { z: 3, x: 2, y: 2 })).toBe('https://a/3/2/2.png');
    expect(tileUrl({ ...BORDERS, tms: true }, { z: 2, x: 1, y: 0 })).toBe('https://t/2/1/3.pbf');
  });

  it('asks each tile once, says none where the server has none, and asks a failure again only later', async () => {
    let now = 0;
    const fetch = vi.fn(async (url) => {
      if (url.includes('/1/')) return { ok: false, status: 503 };
      if (url.includes('/2/')) return { ok: false, status: 204 };
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
    });
    const sources = createTileSources({ fetch, decodeVector: () => ({ layers: {} }), now: () => now });
    const tile = { z: 3, x: 4, y: 5 };
    const [a, b] = await Promise.all([sources.get(BORDERS, tile), sources.get(BORDERS, tile)]);
    expect(a).toEqual({ layers: {} });
    expect(b).toBe(a);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sources.peek(BORDERS, tile)).toBe(a);
    expect(sources.peek(BORDERS, { z: 3, x: 0, y: 0 })).toBeUndefined();

    expect(await sources.get(BORDERS, { z: 2, x: 0, y: 0 })).toBeNull();
    expect(await sources.get(BORDERS, { z: 1, x: 0, y: 0 })).toBeNull();
    await sources.get(BORDERS, { z: 1, x: 0, y: 0 });
    expect(fetch).toHaveBeenCalledTimes(3);
    now = 60000;
    await sources.get(BORDERS, { z: 1, x: 0, y: 0 });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('reads a vector tile’s features and their geometry once, whoever asks', () => {
    const reads = { feature: 0, geometry: 0 };
    const raw = {
      layers: {
        place: {
          extent: 4096,
          length: 2,
          feature: (i) => {
            reads.feature += 1;
            return { type: 1, id: i, properties: { name: `p${i}` }, extent: 4096, loadGeometry: () => (reads.geometry += 1, [[{ x: i, y: i }]]) };
          },
        },
      },
    };
    const tile = readOnce(raw);
    expect(tile.layers.place).toMatchObject({ name: 'place', extent: 4096, length: 2 });
    const first = tile.layers.place.feature(1);
    expect(first).toMatchObject({ type: 1, id: 1, properties: { name: 'p1' } });
    expect(first.loadGeometry()).toEqual([[{ x: 1, y: 1 }]]);
    expect(tile.layers.place.feature(1).loadGeometry()).toBe(first.loadGeometry());
    expect(reads).toEqual({ feature: 1, geometry: 1 });
    expect(readOnce(null)).toEqual({ layers: {} });
  });

  it('keeps only so many tiles, the least recently read let go', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) }));
    const sources = createTileSources({ fetch, decodeVector: () => ({}), keep: 2 });
    for (const x of [0, 1, 2]) await sources.get(BORDERS, { z: 5, x, y: 0 });
    expect(sources.size).toBe(2);
    expect(sources.peek(BORDERS, { z: 5, x: 0, y: 0 })).toBeUndefined();
  });
});
