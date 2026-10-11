import { describe, expect, it } from 'vitest';
import { BURY, CELLS, STRIDE, buildChunk, burnRoofs, cellCode, cellRange, chunkSpan, decodeChunk, runOver } from './buildingMesh.js';

/** A wire.py tile, written the way the backend writes it. */
function wireTile(buildings, strings) {
  const header = new TextEncoder().encode(JSON.stringify({ strings }));
  let size = 8 + header.length + 4;
  for (const b of buildings) size += 16 + 2 * b.rings.length + b.rings.reduce((n, r) => n + r.length * 4, 0);
  const view = new DataView(new ArrayBuffer(size));
  [65, 90, 66, 49].forEach((c, i) => view.setUint8(i, c));
  view.setUint32(4, header.length, true);
  new Uint8Array(view.buffer).set(header, 8);
  let at = 8 + header.length;
  view.setUint32(at, buildings.length, true);
  at += 4;
  for (const b of buildings) {
    [b.kind, b.source, b.heightSource ?? 255, b.date ?? 255, b.heightDate ?? 255, 0].forEach((v, i) => view.setUint8(at + i, v));
    view.setUint16(at + 6, b.rings.length, true);
    view.setFloat32(at + 8, b.height ?? NaN, true);
    view.setFloat32(at + 12, b.minHeight ?? 0, true);
    at += 16;
    for (const ring of b.rings) {
      view.setUint16(at, ring.length / 2, true);
      at += 2;
    }
    for (const ring of b.rings) {
      for (const v of ring) {
        view.setFloat32(at, v, true);
        at += 4;
      }
    }
  }
  return view.buffer;
}

/** A square ring of tile fractions, `side` wide, with its north-west corner at (x, y). */
const square = (x, y, side) => [x, y, x + side, y, x + side, y + side, x, y + side];

/** A frame that keeps fractions apart from one another: enough to check what goes where. */
const frame = { place: (lat, lon, h, out, o) => ((out[o] = lon * 1e4), (out[o + 1] = lat * 1e4), (out[o + 2] = h)) };

describe('the cells of a building tile', () => {
  it('numbers cells along a Morton curve', () => {
    expect([cellCode(0, 0), cellCode(1, 0), cellCode(0, 1), cellCode(1, 1), cellCode(2, 0)]).toEqual([0, 1, 2, 3, 4]);
    expect(cellCode(CELLS - 1, CELLS - 1)).toBe(CELLS * CELLS - 1);
  });

  it('gives a ground tile the run of cells under it, the whole tile for a coarser one', () => {
    expect(cellRange(14, 100, 200, 100, 200)).toEqual([0, CELLS * CELLS]);
    expect(cellRange(12, 25, 50, 100, 200)).toEqual([0, CELLS * CELLS]);
    expect(cellRange(15, 201, 400, 100, 200)).toEqual([64, 128]);
    expect(cellRange(18, 1600 + 15, 3200 + 15, 100, 200)).toEqual([255, 256]);
    expect(cellRange(15, 203, 400, 100, 200)).toBeNull();
    expect(cellRange(13, 51, 100, 100, 200)).toBeNull();
  });
});

describe('a tile of buildings from the app', () => {
  it('is read back with its kinds, sources, dates, heights and courtyards', () => {
    const tile = wireTile(
      [
        { kind: 0, source: 0, date: 1, height: 18.5, rings: [square(0.1, 0.1, 0.2), square(0.15, 0.15, 0.05)] },
        { kind: 1, source: 2, heightSource: 3, date: 4, heightDate: 5, height: 7.25, rings: [square(0.5, 0.5, 0.1)] },
        { kind: 3, source: 2, height: null, minHeight: 0, rings: [square(0.8, 0.8, 0.05)] },
      ],
      ['ign', '2022-08-10', 'osm', 'globfp', '2026-10-04', '2020']
    );
    const { buildings } = decodeChunk(tile);
    expect(buildings.map((b) => [b.kind, b.source, b.heightSource, b.date, b.heightDate, b.height])).toEqual([
      ['measured', 'ign', 'ign', '2022-08-10', '2022-08-10', 18.5],
      ['estimated', 'osm', 'globfp', '2026-10-04', '2020', 7.25],
      ['unknown', 'osm', 'osm', '', '', null],
    ]);
    expect(buildings[0].rings).toHaveLength(2);
    expect(Array.from(buildings[0].rings[1])).toEqual(square(0.15, 0.15, 0.05).map(Math.fround));
  });

  it('refuses bytes that are not one', () => {
    expect(() => decodeChunk(new ArrayBuffer(16))).toThrow('not a buildings tile');
  });
});

describe('a tile of buildings as a mesh', () => {
  const one = (extra = {}) => ({ kind: 'measured', minHeight: 0, height: 12, rings: [new Float32Array(square(0.4, 0.4, 0.01))], ...extra });

  it('raises a footprint from below its lowest ground to its roof', () => {
    const built = buildChunk({ x: 10, y: 20, buildings: [one()], frame, ground: () => 100 });
    expect(built.count).toBe(1);
    expect(built.vertices.length).toBe(8 * STRIDE);
    const heights = Array.from({ length: 8 }, (_, i) => built.vertices[i * STRIDE + 2]);
    expect(heights).toEqual([100 - BURY, 100 - BURY, 100 - BURY, 100 - BURY, 112, 112, 112, 112]);
    // four walls of two triangles, and a roof of two
    expect(built.indices.length).toBe(4 * 6 + 2 * 3);
    // the Mercator place and the footprint's middle, in metres from the tile's corner
    expect(built.vertices[3]).toBeCloseTo(0.4 * chunkSpan(), 3);
    expect(built.vertices[5]).toBeCloseTo(0.405 * chunkSpan(), 3);
    expect(built.vertices[4 * STRIDE + 7]).toBe(12);
  });

  it('keeps a roof over the highest ground under it, the bump a surface model makes of a block', () => {
    // the ground rises to 120 in the footprint's middle, 100 at its corners
    const ground = (fx, fy) => (Math.abs(fx - 0.405) < 1e-4 && Math.abs(fy - 0.405) < 1e-4 ? 120 : 100);
    const built = buildChunk({ x: 0, y: 0, buildings: [one({ height: 4 })], frame, ground });
    expect(built.vertices[4 * STRIDE + 2]).toBe(120 + 2);
  });

  it('lifts a part that starts above the ground, without burying it', () => {
    const built = buildChunk({ x: 0, y: 0, buildings: [one({ height: 30, minHeight: 20 })], frame, ground: () => 50 });
    expect(built.vertices[2]).toBe(70);
    expect(built.vertices[4 * STRIDE + 2]).toBe(80);
  });

  it('leaves a courtyard open in the roof and walls it in', () => {
    const rings = [new Float32Array(square(0.4, 0.4, 0.02)), new Float32Array(square(0.405, 0.405, 0.01))];
    const built = buildChunk({ x: 0, y: 0, buildings: [one({ rings })], frame, ground: () => 0 });
    // eight walls; a square with a square hole fills with eight triangles
    expect(built.indices.length).toBe(8 * 6 + 8 * 3);
    const roof = Array.from(built.indices.slice(8 * 6));
    // no roof triangle uses only the courtyard's corners
    const courtyardTops = new Set([12, 13, 14, 15]);
    for (let i = 0; i < roof.length; i += 3) {
      expect(roof.slice(i, i + 3).every((v) => courtyardTops.has(v))).toBe(false);
    }
  });

  it('draws a building nobody knows the height of at the height asked, or not at all', () => {
    const unknown = one({ kind: 'unknown', height: null });
    const drawn = buildChunk({ x: 0, y: 0, buildings: [unknown], frame, ground: () => 0, unknownHeight: 9 });
    expect(drawn.vertices[4 * STRIDE + 2]).toBe(9);
    expect(drawn.vertices[8]).toBe(3);
    const hidden = buildChunk({ x: 0, y: 0, buildings: [unknown], frame, ground: () => 0, unknown: 'hide' });
    expect(hidden.count).toBe(0);
    expect(hidden.indices.length).toBe(0);
  });

  it('orders the triangles by cell, listing a building in every cell its box touches', () => {
    const inCell0 = one({ rings: [new Float32Array(square(0.01, 0.01, 0.01))] });
    // across the line between cells 0 and 1 (x = 1/16)
    const across = one({ rings: [new Float32Array(square(0.06, 0.01, 0.01))] });
    const far = one({ rings: [new Float32Array(square(0.9, 0.9, 0.01))] });
    const built = buildChunk({ x: 0, y: 0, buildings: [inCell0, across, far], frame, ground: () => 0 });
    expect(Array.from(built.cells)).toEqual([0, 1, cellCode(14, 14)]);
    const per = 30;
    expect(Array.from(built.cellStart)).toEqual([0, 2 * per, 3 * per, 4 * per]);
    const chunk = { ...built, x: 0, y: 0 };
    expect(runOver(chunk, 14, 0, 0)).toEqual([0, 4 * per]);
    expect(runOver(chunk, 18, 1, 0)).toEqual([2 * per, per]);
    expect(runOver(chunk, 18, 5, 5)).toBeNull();
    expect(runOver(chunk, 14, 1, 0)).toBeNull();
  });

  it('keeps each drawn building’s outline and roof for the shadows', () => {
    const built = buildChunk({ x: 0, y: 0, buildings: [one()], frame, ground: () => 10 });
    expect(built.roofs[0]).toBe(4);
    expect(built.roofs[1]).toBe(22);
    expect(built.roofs.length).toBe(2 + 2 * 4);
  });
});

describe('buildings in the shadows', () => {
  it('raises the cells under a footprint to its roof, and a tiny house’s middle cell', () => {
    const size = 10;
    const ground = new Float32Array(size * size).fill(5);
    // a 30 m square centred 15 m east and north of the eye, roof at 40; a 2 m hut far west
    const big = new Float32Array([4, 40, 0, 0, 30, 0, 30, 30, 0, 30]);
    const hut = new Float32Array([4, 12, -81, 9, -79, 9, -79, 11, -81, 11]);
    const { heights, top } = burnRoofs(ground, size, 100, [big, hut]);
    expect(top).toBe(40);
    // cells are 20 m: centres at -90, -70 … 90; the square covers the cells centred at 10
    expect(heights[4 * size + 5]).toBe(40);
    expect(heights[3 * size + 5]).toBe(5);
    expect(heights[4 * size + 1]).toBe(12);
    expect(ground[4 * size + 5]).toBe(5);
  });

  it('leaves the grid alone for buildings beyond it', () => {
    const ground = new Float32Array(16).fill(1);
    const far = new Float32Array([3, 50, 1000, 1000, 1010, 1000, 1000, 1010]);
    expect(Array.from(burnRoofs(ground, 4, 100, [far]).heights)).toEqual(Array.from(ground));
  });
});
