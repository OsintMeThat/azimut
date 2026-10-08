import { describe, expect, it, vi } from 'vitest';
import { buildGrid, buildMesh, createTerrain, demRange, meshSize } from './build.js';
import { DEM_TILE, eyeFrame, latToY, lonToX, tileLat, tileLon } from './geo.js';

/** Terrain tiles from a height function of global pixel coordinates; `missing(z)` tiles do not exist. */
function terrainOf(height, missing = () => false) {
  return vi.fn(async (keys) => {
    const out = new Map();
    for (const key of keys) {
      const [z, x, y] = key.split('/').map(Number);
      if (missing(z, x, y)) {
        out.set(key, null);
        continue;
      }
      const tile = new Float32Array(DEM_TILE * DEM_TILE);
      for (let j = 0; j < DEM_TILE; j += 1) {
        for (let i = 0; i < DEM_TILE; i += 1) tile[j * DEM_TILE + i] = height(z, x * DEM_TILE + i, y * DEM_TILE + j);
      }
      out.set(key, tile);
    }
    return out;
  });
}

const flat = (metres) => terrainOf(() => metres);

describe('the terrain a worker holds', () => {
  it('asks only for what it does not hold, and keeps what failed unknown to ask again', async () => {
    const read = flat(10);
    const terrain = createTerrain(read);
    expect(await terrain.load(['10/1/1', '10/1/2'])).toBe(true);
    expect(await terrain.load(['10/1/2', '10/1/3'])).toBe(true);
    expect(read.mock.calls.map(([keys]) => keys)).toEqual([['10/1/1', '10/1/2'], ['10/1/3']]);
    const failing = createTerrain(vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(flat(5)));
    expect(await failing.load(['10/1/1'])).toBe(false);
    expect(failing.tile('10/1/1')).toBeUndefined();
    expect(await failing.load(['10/1/1'])).toBe(true);
    expect(failing.tile('10/1/1')[0]).toBe(5);
  });

  it('lets the least recently used go past what it keeps, never a tile in use', async () => {
    const terrain = createTerrain(flat(1), { keep: 2 });
    await terrain.load(['9/0/0', '9/0/1']);
    await terrain.load(['9/0/0']); // used again: the newest now
    await terrain.load(['9/0/2']);
    expect(terrain.tile('9/0/1')).toBeUndefined();
    expect(terrain.tile('9/0/0')).toBeDefined();
    await terrain.pinning(['9/0/0', '9/0/2'], async () => {
      await terrain.load(['9/0/3', '9/0/4']);
      expect(terrain.tile('9/0/0')).toBeDefined();
      expect(terrain.tile('9/0/2')).toBeDefined();
    });
    expect(terrain.size).toBe(2);
  });

  it('finds each tile its finest terrain, every level asked together', async () => {
    // no terrain finer than zoom 11 east of x = 1000 at zoom 11
    const read = terrainOf(() => 0, (z, x) => z > 11 && x >= 1000 * 2 ** (z - 11));
    const terrain = createTerrain(read);
    const list = [
      { z: 14, x: 900 * 8, y: 5000 },
      { z: 14, x: 1001 * 8, y: 5000 },
    ];
    expect(await terrain.zoomsFor(list, (t) => t.z - 1)).toEqual([13, 11]);
    // a level a call: both tiles' 13, then the one left at 12, then at 11
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls[0][0]).toHaveLength(2);
  });

  it('reads heights between pixels, across a tile edge too', async () => {
    const plane = (z, gx, gy) => 100 + gx * 0.5 - gy * 0.25;
    const terrain = createTerrain(terrainOf(plane));
    await terrain.load(['12/10/10', '12/11/10', '12/10/11']);
    const home = [10, 10];
    const at = (gx, gy) => terrain.heightAt(12, gx, gy, home);
    // pixel centres sit at half pixels
    expect(at(10 * DEM_TILE + 3.5, 10 * DEM_TILE + 7.5)).toBeCloseTo(plane(12, 10 * DEM_TILE + 3, 10 * DEM_TILE + 7), 4);
    expect(at(10 * DEM_TILE + 3.75, 10 * DEM_TILE + 7.5)).toBeCloseTo(plane(12, 10 * DEM_TILE + 3.25, 10 * DEM_TILE + 7), 4);
    expect(at(11 * DEM_TILE, 10 * DEM_TILE + 7.5)).toBeCloseTo(plane(12, 11 * DEM_TILE - 0.5, 10 * DEM_TILE + 7), 3);
  });

  it('reads the ground under a point from the finest terrain there', async () => {
    const terrain = createTerrain(flat(1234.5));
    expect(await terrain.groundAt(45.94, 7.82)).toBeCloseTo(1234.5, 6);
    const offline = createTerrain(vi.fn().mockRejectedValue(new Error('offline')));
    expect(await offline.groundAt(45.94, 7.82)).toBeNull();
  });

  it('names the tiles a rectangle touches, a pixel round', () => {
    expect(demRange(10, 5, 5, 6, 6, 9)).toEqual(['9/2/2', '9/3/2', '9/2/3', '9/3/3']);
    expect(demRange(10, 4.5, 4.5, 4.6, 4.6, 9)).toEqual(['9/2/2']);
  });
});

describe('a tile\'s mesh', () => {
  it('is no finer than its terrain, from 4 to 64 vertices a side', () => {
    expect(meshSize(10, 9)).toBe(64);
    expect(meshSize(17, 14)).toBe(64);
    expect(meshSize(18, 14)).toBe(32);
    expect(meshSize(22, 14)).toBe(4);
  });

  it('places its vertices on the ground in the eye\'s frame, faces up on level ground, and hangs its skirts', async () => {
    const lat = tileLat(5795.5, 14);
    const lon = tileLon(8513.5, 14);
    const frame = eyeFrame({ lat, lon, alt: 500 });
    const terrain = createTerrain(flat(500));
    const t = { z: 15, x: 8513 * 2, y: 5795 * 2 };
    await terrain.load(demRange(t.z, t.x - 0.02, t.y - 0.02, t.x + 1.02, t.y + 1.02, 14));
    const { data, size } = buildMesh(frame, terrain, t, 14, { skirtMin: 3, skirtScale: 3, skirtSpacing: 0 });
    const side = size + 1;
    expect(size).toBe(64);
    expect(data.length).toBe((side * side + 4 * side) * 8);
    const corner = [0, 0, 0];
    frame.place(tileLat(t.y, t.z), tileLon(t.x, t.z), 500, corner, 0);
    for (let k = 0; k < 3; k += 1) expect(data[k]).toBeCloseTo(corner[k], 2);
    // level ground faces straight up, its picture spread corner to corner
    expect(data[5]).toBeCloseTo(1, 9);
    expect([data[6], data[7]]).toEqual([0, 0]);
    const last = (side * side - 1) * 8;
    expect([data[last + 6], data[last + 7]]).toEqual([1, 1]);
    // the first skirt vertex hangs under the first corner, as deep as the least skirt on level ground
    const skirt = side * side * 8;
    expect(data[skirt]).toBe(data[0]);
    expect(data[skirt + 2]).toBeCloseTo(data[2] - 3, 4);
  });

  it('hangs its skirts deeper where a coarser neighbour can open the seam', async () => {
    const lat = tileLat(5795.5, 14);
    const lon = tileLon(8513.5, 14);
    const frame = eyeFrame({ lat, lon, alt: 500 });
    // along the north edge, every other vertex stands 100 m higher than its neighbours
    const ridged = terrainOf((z, gx, gy) => (Math.abs(gy - 5795 * DEM_TILE) < 4 && Math.floor((gx + 4) / 8) % 2 ? 600 : 500));
    const terrain = createTerrain(ridged);
    const t = { z: 14, x: 8513, y: 5795 };
    await terrain.load(demRange(t.z, t.x - 0.02, t.y - 0.02, t.x + 1.02, t.y + 1.02, 14));
    const { data, size } = buildMesh(frame, terrain, t, 14);
    const side = size + 1;
    const north = side * side * 8;
    const south = (side * side + side) * 8;
    // and a tenth of the spacing of its vertices deeper, for the coarser terrain next door
    const spacing = (40075016.686 / 2 ** 14) * Math.cos((tileLat(t.y + 0.5, 14) * Math.PI) / 180) / size;
    expect(data[north + 2 + 8] - data[8 + 2]).toBeCloseTo(-303 - spacing / 10, 0);
    expect(data[south + 2] - data[size * side * 8 + 2]).toBeCloseTo(-3 - spacing / 10, 3);
  });
});

describe('the shadow grids', () => {
  it('holds the ground round the eye in its frame, the curve of the Earth in it', async () => {
    const frame = eyeFrame({ lat: 45.94, lon: 7.82, alt: 500 });
    const terrain = createTerrain(flat(500));
    const grid = await buildGrid(frame, terrain, { reach: 6000, size: 64, zoom: 12 });
    expect(grid.heights).toHaveLength(64 * 64);
    const middle = grid.heights[32 * 64 + 32];
    const corner = grid.heights[0];
    expect(Math.abs(middle)).toBeLessThan(0.1);
    // a corner is 6 km × √2 away, so it lies d² / 2R under the eye
    expect(corner).toBeCloseTo(-((6000 - 6000 / 64 / 2) ** 2 * 2) / (2 * frame.R), 0);
    expect(grid.top).toBeCloseTo(Math.max(...grid.heights), 6);
    const offline = createTerrain(vi.fn().mockRejectedValue(new Error('offline')));
    expect(await buildGrid(frame, offline, { reach: 6000, size: 64, zoom: 12 })).toBeNull();
  });

  it('reads coarser terrain where the zoom asked has none', async () => {
    const frame = eyeFrame({ lat: 45.94, lon: 7.82, alt: 0 });
    const read = terrainOf((z) => z * 100, (z) => z > 9);
    const grid = await buildGrid(frame, createTerrain(read), { reach: 30000, size: 32, zoom: 11 });
    expect(grid.heights[16 * 32 + 16]).toBeCloseTo(900, 0);
    expect(lonToX(7.82, 9)).toBeGreaterThan(0);
    expect(latToY(45.94, 9)).toBeGreaterThan(0);
  });
});
