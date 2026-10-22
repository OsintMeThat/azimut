import { describe, expect, it } from 'vitest';
import { DEM_SIZE, QUARTER, SEG, STRIDE, VERTICES, buildTile, demSampler, demZoomFor, skirtFor, tileCentre, tileIndices } from './mesh.js';
import { add, dot, geodetic, localFrame } from './earth.js';
import { tileLat } from '../horizon/mesh/geo.js';

const flat = (h) => () => h;
const vertex = (data, k) => Array.from(data.slice(k * STRIDE, (k + 1) * STRIDE));

describe('a tile of the globe', () => {
  it('holds its grid and a skirt down each edge, drawn by indices every tile shares', () => {
    const { vertices, heights } = buildTile(12, 2130, 1450, flat(100));
    expect(vertices.length).toBe(VERTICES * STRIDE);
    expect(heights.length).toBe((SEG + 1) ** 2);
    const indices = tileIndices();
    expect(indices.length).toBe(SEG * SEG * 6 + 4 * SEG * 6);
    expect(Math.max(...indices)).toBe(VERTICES - 1);
  });

  it('lays its triangles a quarter at a time, each quarter its own ground and the skirts of its outer edges', () => {
    const indices = tileIndices();
    expect(4 * QUARTER).toBe(indices.length);
    const side = SEG + 1;
    const grid = side * side;
    for (let q = 0; q < 4; q += 1) {
      const qx = q % 2;
      const qy = Math.floor(q / 2);
      for (const k of indices.subarray(q * QUARTER, (q + 1) * QUARTER)) {
        if (k >= grid) continue;
        const i = k % side;
        const j = Math.floor(k / side);
        // a grid vertex of this quarter, its shared edge included
        expect(i >= qx * (SEG / 2) && i <= (qx + 1) * (SEG / 2)).toBe(true);
        expect(j >= qy * (SEG / 2) && j <= (qy + 1) * (SEG / 2)).toBe(true);
      }
    }
  });

  it('places its corners on the sphere where the grid says, relative to its centre', () => {
    const z = 10;
    const x = 532;
    const y = 361;
    const { vertices, centre } = buildTile(z, x, y, flat(0));
    const first = vertex(vertices, 0);
    const at = geodetic(add(centre, first.slice(0, 3)));
    expect(at.lat).toBeCloseTo(tileLat(y, z), 8);
    expect(at.lon).toBeCloseTo((x / 2 ** z) * 360 - 180, 8);
    expect(at.h).toBeCloseTo(0, 3);
    expect(centre).toEqual(tileCentre(z, x, y));
    // picture coordinates run from the north-west corner
    expect(first.slice(10)).toEqual([0, 0]);
    expect(vertex(vertices, (SEG + 1) ** 2 - 1).slice(10)).toEqual([1, 1]);
  });

  it('keeps the height apart from the point, so the relief can be exaggerated on the GPU', () => {
    const { vertices, low, high } = buildTile(12, 2130, 1450, (i, j) => 100 + i + j);
    expect(vertex(vertices, 0)[6]).toBe(100);
    expect(low).toBe(100);
    expect(high).toBe(100 + 2 * SEG);
  });

  it('hangs each skirt below its edge by about one of its cells', () => {
    const z = 14;
    const y = 5800;
    const { vertices } = buildTile(z, 8500, y, flat(500));
    const skirt = vertex(vertices, (SEG + 1) ** 2);
    expect(skirt[6]).toBeCloseTo(500 - skirtFor(z, tileLat(y + 0.5, z)), 3);
    expect(skirt.slice(0, 6)).toEqual(vertex(vertices, 0).slice(0, 6));
  });

  it('lights flat ground straight up and a slope tilted away from its rise', () => {
    const z = 12;
    const level = vertex(buildTile(z, 2130, 1450, flat(0)).vertices, 40);
    const up = level.slice(3, 6);
    expect(dot(level.slice(7, 10), up)).toBeCloseTo(1, 6);
    // ground rising eastward: its normal leans west
    const { vertices, centre } = buildTile(z, 2130, 1450, (i) => i * 50);
    const v = vertex(vertices, 40);
    const { east } = localFrame(add(centre, v.slice(0, 3)));
    expect(dot(v.slice(7, 10), east)).toBeLessThan(-0.1);
  });
});

describe('heights read from a terrain tile', () => {
  it('takes a tile four levels up for about a terrain pixel a cell, never past the app', () => {
    expect(demZoomFor(1)).toBe(0);
    expect(demZoomFor(10)).toBe(6);
    expect(demZoomFor(20)).toBe(12);
  });

  it('reads between pixels, and carries the slope on past the terrain tile edge', () => {
    // heights rising one metre a pixel eastward
    const dem = new Float32Array(DEM_SIZE * DEM_SIZE);
    for (let r = 0; r < DEM_SIZE; r += 1) for (let c = 0; c < DEM_SIZE; c += 1) dem[r * DEM_SIZE + c] = c;
    // the terrain tile itself, read by a mesh tile of the same zoom
    const read = demSampler(dem, 8, 100, 90, 8, 100, 90);
    expect(read(0, 0)).toBeCloseTo(-0.5, 6);
    expect(read(SEG / 2, 0)).toBeCloseTo(DEM_SIZE / 2 - 0.5, 6);
    // one cell past the east edge, the rise goes on rather than flattening
    const step = DEM_SIZE / SEG;
    expect(read(SEG + 1, 0) - read(SEG, 0)).toBeCloseTo(step, 6);
    // a mesh tile four levels down reads its sixteenth of the terrain tile
    const deep = demSampler(dem, 8, 100, 90, 12, 1601, 1440);
    expect(deep(0, 0)).toBeCloseTo(DEM_SIZE / 16 - 0.5, 6);
  });
});
