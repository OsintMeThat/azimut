/**
 * Buildings as meshes: one z14 tile's buildings (engine/buildings/wire.py), raised
 * on the ground the view draws and placed in the eye's frame. The pure half of
 * what worker.js does with them, apart so it is tested without one.
 *
 * Each building is its footprint pushed up: a ring of bottom vertices buried a
 * few metres under the lowest ground it stands on (so a slope never shows a gap
 * under a wall), a ring of top vertices at the roof, walls between them, and the
 * roof filled by earcut with its courtyards left open.
 *
 * The roof is the ground's mean plus the building's height, and never under the
 * highest ground the footprint covers: where the terrain is a surface model
 * (Copernicus GLO-30 outside the national lidar surveys), a dense block is
 * already a bump in it, and a roof set under that bump would vanish.
 *
 * The triangles are ordered by the zoom-18 cells each building touches (one
 * building over two cells is listed twice), so the triangles over any ground
 * tile of zoom 14 to 18 are one run: the renderer draws each ground tile's
 * buildings in that tile's own picture, which is what puts a roof's photo on it.
 *
 * Every vertex is 9 floats: its place in the eye's frame (x, y, z), its place in
 * Web Mercator metres from the tile's north-west corner (x east, y south), the
 * footprint's middle in the same metres, how far above the footprint's lowest
 * ground it stands, and where the building's height comes from (`KIND_CODES`).
 */
import earcut from 'earcut';
import { MERC, tileLat, tileLon } from './geo.js';

export const CHUNK_Z = 14;
export const CELL_Z = 18;
/** Cells a side in one tile. */
export const CELLS = 2 ** (CELL_Z - CHUNK_Z);
/** Metres a wall reaches under the lowest ground of its footprint. */
export const BURY = 4;
export const STRIDE = 9;
/** wire.py's kinds, in its order. */
export const KINDS = ['measured', 'estimated', 'range', 'unknown'];
export const KIND_CODES = { measured: 0, estimated: 1, range: 2, unknown: 3 };
/** The height an unknown building is drawn at when it is drawn, metres. */
export const UNKNOWN_HEIGHT = 6;

/** A tile's side in Web Mercator metres. */
export const chunkSpan = () => MERC / 2 ** CHUNK_Z;

/** Morton code of a cell `(cx, cy)` of a tile, 0 to CELLS² − 1. */
export function cellCode(cx, cy) {
  let code = 0;
  for (let bit = 0; bit < CELL_Z - CHUNK_Z; bit += 1) {
    code |= ((cx >> bit) & 1) << (2 * bit);
    code |= ((cy >> bit) & 1) << (2 * bit + 1);
  }
  return code;
}

/**
 * The cells a ground tile `(z, x, y)` covers in the building tile `(cx, cy)` at
 * CHUNK_Z, as a Morton range `[first, end)`; null when it lies elsewhere. A
 * ground tile coarser than CHUNK_Z covers the whole tile.
 */
export function cellRange(z, x, y, chunkX, chunkY) {
  if (z <= CHUNK_Z) {
    const s = CHUNK_Z - z;
    return chunkX >> s === x && chunkY >> s === y ? [0, CELLS * CELLS] : null;
  }
  if (z > CELL_Z) return null;
  const s = z - CHUNK_Z;
  if (x >> s !== chunkX || y >> s !== chunkY) return null;
  const k = CELL_Z - z;
  const lx = (x - (chunkX << s)) << k;
  const ly = (y - (chunkY << s)) << k;
  const first = cellCode(lx, ly);
  return [first, first + 4 ** k];
}

/** One wire.py tile: its buildings, each ring a Float32Array of tile fractions (x east, y south). */
export function decodeChunk(buffer) {
  const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset ?? 0, buffer.byteLength);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'AZB1') throw new Error('not a buildings tile');
  const headerLength = view.getUint32(4, true);
  const bytes = new Uint8Array(view.buffer, view.byteOffset + 8, headerLength);
  const { strings } = JSON.parse(new TextDecoder().decode(bytes));
  const text = (i) => (i === 255 ? '' : strings[i] ?? '');
  let at = 8 + headerLength;
  const count = view.getUint32(at, true);
  at += 4;
  const buildings = [];
  for (let n = 0; n < count; n += 1) {
    const kind = KINDS[view.getUint8(at)] ?? 'unknown';
    const source = text(view.getUint8(at + 1));
    const heightSource = text(view.getUint8(at + 2)) || source;
    const date = text(view.getUint8(at + 3));
    const heightDate = text(view.getUint8(at + 4)) || date;
    const ringCount = view.getUint16(at + 6, true);
    const height = view.getFloat32(at + 8, true);
    const minHeight = view.getFloat32(at + 12, true);
    at += 16;
    const sizes = [];
    for (let r = 0; r < ringCount; r += 1) {
      sizes.push(view.getUint16(at, true));
      at += 2;
    }
    const rings = sizes.map((size) => {
      const ring = new Float32Array(size * 2);
      for (let i = 0; i < size * 2; i += 1) {
        ring[i] = view.getFloat32(at, true);
        at += 4;
      }
      return ring;
    });
    buildings.push({ kind, source, heightSource, date, heightDate, height: Number.isNaN(height) ? null : height, minHeight, rings });
  }
  return { buildings };
}

/**
 * One tile's buildings as a mesh.
 *
 * @param {object} o
 * @param {number} o.x @param {number} o.y the tile at CHUNK_Z
 * @param {Array} o.buildings as `decodeChunk` gives them
 * @param {object} o.frame the eye's frame (geo.js `eyeFrame`)
 * @param {(fx: number, fy: number) => number} o.ground the ground's height at fractions of the tile
 * @param {'draw'|'hide'} [o.unknown] whether a building of unknown height is drawn, at `unknownHeight`
 * @param {number} [o.unknownHeight]
 * @returns {{ vertices: Float32Array, indices: Uint32Array, cells: Uint16Array, cellStart: Uint32Array,
 *   roofs: Float32Array, count: number }} `cells` the sorted cells that hold triangles and
 *   `cellStart` where each one's run starts in `indices` (one more entry than cells, for the end);
 *   `roofs` each drawn building's outline in the frame for the shadows: its point count, its roof's
 *   height in the frame, then x, y pairs.
 */
export function buildChunk({ x, y, buildings, frame, ground, unknown = 'draw', unknownHeight = UNKNOWN_HEIGHT }) {
  const span = chunkSpan();
  const vertices = [];
  const perCell = new Map();
  const roofs = [];
  const out = [0, 0, 0];
  let next = 0;
  let count = 0;

  for (const building of buildings) {
    let height = building.height;
    if (height == null) {
      if (unknown === 'hide') continue;
      height = unknownHeight;
    }
    const rings = building.rings.filter((ring) => ring.length >= 6);
    if (!rings.length) continue;
    // the ground under every point, and under the footprint's middle
    const outer = rings[0];
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < outer.length; i += 2) {
      cx += outer[i];
      cy += outer[i + 1];
    }
    cx /= outer.length / 2;
    cy /= outer.length / 2;
    let low = Infinity;
    let high = ground(cx, cy);
    let sum = 0;
    let points = 0;
    const grounds = rings.map((ring) => {
      const g = new Float64Array(ring.length / 2);
      for (let i = 0; i < g.length; i += 1) {
        g[i] = ground(ring[2 * i], ring[2 * i + 1]);
        if (g[i] < low) low = g[i];
        if (g[i] > high) high = g[i];
        sum += g[i];
        points += 1;
      }
      return g;
    });
    const mean = sum / points;
    const floating = building.minHeight > 0 && building.minHeight < height;
    const roof = floating ? mean + height : Math.max(mean + height, high + Math.max(1, 0.5 * height));
    const base = floating ? mean + building.minHeight : low - BURY;
    const kind = KIND_CODES[building.kind] ?? KIND_CODES.unknown;

    const first = next;
    const tri = [];
    const flat = [];
    const holes = [];
    let roofOutline = null;
    for (const ring of rings) {
      const n = ring.length / 2;
      const bottom = next;
      const top = next + n;
      for (const [z, above] of [
        [base, floating ? building.minHeight : -BURY],
        [roof, roof - low],
      ]) {
        for (let i = 0; i < n; i += 1) {
          const fx = ring[2 * i];
          const fy = ring[2 * i + 1];
          frame.place(tileLat(y + fy, CHUNK_Z), tileLon(x + fx, CHUNK_Z), z, out, 0);
          vertices.push(out[0], out[1], out[2], fx * span, fy * span, cx * span, cy * span, above, kind);
        }
      }
      for (let i = 0; i < n; i += 1) {
        const j = (i + 1) % n;
        tri.push(bottom + i, bottom + j, top + j, bottom + i, top + j, top + i);
      }
      if (flat.length) holes.push(flat.length / 2);
      for (let i = 0; i < ring.length; i += 1) flat.push(ring[i]);
      if (!roofOutline) {
        // the outer ring's top in the frame, for the shadows: its count, its height, then x, y pairs
        roofOutline = [n, 0];
        let topZ = -Infinity;
        for (let i = 0; i < n; i += 1) {
          const o = (top + i) * STRIDE;
          roofOutline.push(vertices[o], vertices[o + 1]);
          if (vertices[o + 2] > topZ) topZ = vertices[o + 2];
        }
        roofOutline[1] = topZ;
      }
      next += 2 * n;
    }
    // the roof over the top rings, courtyards open
    const tops = [];
    let offset = first;
    for (const ring of rings) {
      const n = ring.length / 2;
      for (let i = 0; i < n; i += 1) tops.push(offset + n + i);
      offset += 2 * n;
    }
    const roofTriangles = earcut(flat, holes, 2);
    for (const k of roofTriangles) tri.push(tops[k]);
    roofs.push(...roofOutline);
    count += 1;

    // the cells its box touches, in this tile only
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < outer.length; i += 2) {
      minX = Math.min(minX, outer[i]);
      maxX = Math.max(maxX, outer[i]);
      minY = Math.min(minY, outer[i + 1]);
      maxY = Math.max(maxY, outer[i + 1]);
    }
    const c0x = Math.max(0, Math.floor(minX * CELLS));
    const c1x = Math.min(CELLS - 1, Math.floor(maxX * CELLS));
    const c0y = Math.max(0, Math.floor(minY * CELLS));
    const c1y = Math.min(CELLS - 1, Math.floor(maxY * CELLS));
    for (let gx = c0x; gx <= c1x; gx += 1) {
      for (let gy = c0y; gy <= c1y; gy += 1) {
        const code = cellCode(gx, gy);
        if (!perCell.has(code)) perCell.set(code, []);
        perCell.get(code).push(tri);
      }
    }
  }

  const cells = [...perCell.keys()].sort((a, b) => a - b);
  const cellStart = new Uint32Array(cells.length + 1);
  let total = 0;
  cells.forEach((code, i) => {
    cellStart[i] = total;
    for (const tri of perCell.get(code)) total += tri.length;
  });
  cellStart[cells.length] = total;
  const indices = new Uint32Array(total);
  let at = 0;
  for (const code of cells) {
    for (const tri of perCell.get(code)) {
      indices.set(tri, at);
      at += tri.length;
    }
  }
  return {
    vertices: new Float32Array(vertices),
    indices,
    cells: new Uint16Array(cells),
    cellStart,
    roofs: new Float32Array(roofs),
    count,
  };
}

/** Where the triangles over a ground tile lie in a built tile: `[start, count]` in indices, or null. */
export function runOver(chunk, z, x, y) {
  const range = cellRange(z, x, y, chunk.x, chunk.y);
  if (!range) return null;
  const firstAtLeast = (value) => {
    let lo = 0;
    let hi = chunk.cells.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (chunk.cells[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const a = firstAtLeast(range[0]);
  const b = firstAtLeast(range[1]);
  const start = chunk.cellStart[a];
  const count = chunk.cellStart[b] - start;
  return count > 0 ? [start, count] : null;
}

/**
 * The shadows' finest height grid (build.js `buildGrid`: `size` cells a side over
 * `reach` metres each way of the eye, rows from the north) with every building
 * raised to its roof, so the light marched over it casts their shadows too.
 * `roofs` is a list of `buildChunk` roofs arrays. Returns a new grid and its top.
 */
export function burnRoofs(heights, size, reach, roofs) {
  const out = Float32Array.from(heights);
  const cell = (2 * reach) / size;
  let top = -Infinity;
  for (const packed of roofs) {
    for (let at = 0; at < packed.length; ) {
      const n = packed[at];
      const roof = packed[at + 1];
      const xs = packed.subarray(at + 2, at + 2 + 2 * n);
      at += 2 + 2 * n;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < n; i += 1) {
        const x = xs[2 * i];
        const y = xs[2 * i + 1];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        cx += x / n;
        cy += y / n;
      }
      if (maxX < -reach || minX > reach || maxY < -reach || minY > reach) continue;
      const c0 = Math.max(0, Math.ceil((minX + reach) / cell - 0.5));
      const c1 = Math.min(size - 1, Math.floor((maxX + reach) / cell - 0.5));
      const r0 = Math.max(0, Math.ceil((reach - maxY) / cell - 0.5));
      const r1 = Math.min(size - 1, Math.floor((reach - minY) / cell - 0.5));
      let hit = false;
      for (let r = r0; r <= r1; r += 1) {
        const y = reach - (r + 0.5) * cell;
        for (let c = c0; c <= c1; c += 1) {
          const x = -reach + (c + 0.5) * cell;
          let inside = false;
          for (let k = 0, j = n - 1; k < n; j = k++) {
            const yk = xs[2 * k + 1];
            const yj = xs[2 * j + 1];
            if (yk > y !== yj > y && x < ((xs[2 * j] - xs[2 * k]) * (y - yk)) / (yj - yk) + xs[2 * k]) inside = !inside;
          }
          if (inside) {
            hit = true;
            if (roof > out[r * size + c]) out[r * size + c] = roof;
          }
        }
      }
      // a house smaller than a cell still casts a shadow: its middle's cell is raised
      if (!hit) {
        const c = Math.floor((cx + reach) / cell);
        const r = Math.floor((reach - cy) / cell);
        if (c >= 0 && c < size && r >= 0 && r < size && roof > out[r * size + c]) out[r * size + c] = roof;
      }
      if (roof > top) top = roof;
    }
  }
  return { heights: out, top };
}
