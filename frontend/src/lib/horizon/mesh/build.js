/**
 * The terrain a worker holds, and what it builds from it: each tile's mesh in
 * the eye's frame, the ground under a point, the height grids the shadows are
 * marched over. The pure half of worker.js, apart so it is tested without one.
 */
import { DEM_MAX, DEM_TILE, MERC, RAD, latToY, lonToX, tileLat, tileLon } from './geo.js';

/** Terrain tiles one worker keeps decoded, a megabyte each: the least recently used go first. */
export const DEM_KEEP = 96;
/** The finest a tile's mesh gets, vertices a side. */
export const MESH_MAX = 64;
/**
 * A skirt hangs this many metres, plus three times how far its seam can open,
 * plus a tenth of the spacing of its vertices: a neighbour a level coarser reads
 * coarser terrain, whose heights differ from these by about that much.
 */
export const SKIRT_MIN = 3;
export const SKIRT_SCALE = 3;
export const SKIRT_SPACING = 0.1;

const keyOf = (z, x, y) => `${z}/${x}/${y}`;

/**
 * Terrain tiles held for the meshes. `read(keys)` resolves to a Map of key to
 * heights (a Float32Array of DEM_TILE², or null where there is no tile), and
 * rejects when the app could not be reached: those keys stay unknown, to be
 * asked again, and `load` says so.
 */
export function createTerrain(read, { keep = DEM_KEEP } = {}) {
  const held = new Map();
  const asking = new Map();
  const pinned = new Map();

  function touch(key) {
    const value = held.get(key);
    held.delete(key);
    held.set(key, value);
  }

  function letGo() {
    for (const key of held.keys()) {
      if (held.size <= keep) return;
      if (!pinned.get(key)) held.delete(key);
    }
  }

  /** Makes sure these tiles are known; false when some could not be read. */
  async function load(keys) {
    const unique = [...new Set(keys)];
    const fresh = [];
    for (const key of unique) {
      if (held.has(key)) touch(key);
      else if (!asking.has(key)) fresh.push(key);
    }
    if (fresh.length) {
      const job = read(fresh).then(
        (got) => {
          for (const key of fresh) held.set(key, got.get(key) ?? null);
          return true;
        },
        () => false
      );
      const settled = job.finally(() => {
        for (const key of fresh) asking.delete(key);
        letGo();
      });
      for (const key of fresh) asking.set(key, settled);
    }
    const answers = await Promise.all(unique.map((key) => asking.get(key)).filter(Boolean));
    return answers.every(Boolean) && unique.every((key) => held.has(key));
  }

  /** Runs `work` with these tiles kept, however many others are read meanwhile. */
  async function pinning(keys, work) {
    for (const key of keys) pinned.set(key, (pinned.get(key) ?? 0) + 1);
    try {
      return await work();
    } finally {
      for (const key of keys) {
        const count = pinned.get(key) - 1;
        if (count > 0) pinned.set(key, count);
        else pinned.delete(key);
      }
      letGo();
    }
  }

  /**
   * The finest terrain zoom, `from` at most, holding the middle of each tile
   * (`{ z, x, y }`), every tile's levels asked together; -1 where there is none,
   * null when the app could not be reached.
   */
  async function zoomsFor(list, from) {
    const zooms = list.map((t, i) => Math.min(from(t, i), DEM_MAX));
    const found = list.map(() => false);
    const keyAt = (t, zd) => {
      const s = 2 ** (zd - t.z);
      return keyOf(zd, Math.floor((t.x + 0.5) * s), Math.floor((t.y + 0.5) * s));
    };
    for (;;) {
      const keys = [];
      list.forEach((t, i) => {
        if (!found[i] && zooms[i] >= 0) keys.push(keyAt(t, zooms[i]));
      });
      if (!keys.length) return zooms;
      if (!(await load(keys))) return null;
      list.forEach((t, i) => {
        if (found[i] || zooms[i] < 0) return;
        if (held.get(keyAt(t, zooms[i]))) found[i] = true;
        else zooms[i] -= 1;
      });
    }
  }

  /**
   * Bilinear height at global pixel coordinates of zoom zd. `home` is the tile
   * the reads mostly fall in, `[x, y]`, its heights cached in `home[2]`; a
   * neighbour not held is read as its nearest edge of home.
   */
  function heightAt(zd, gx, gy, home) {
    const fx = gx - 0.5;
    const fy = gy - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const hx = home[0] * DEM_TILE;
    const hy = home[1] * DEM_TILE;
    const own = home[2] ?? (home[2] = held.get(keyOf(zd, home[0], home[1])));
    const at = (px, py) => {
      if (px >= hx && px < hx + DEM_TILE && py >= hy && py < hy + DEM_TILE) return own[(py - hy) * DEM_TILE + (px - hx)];
      const cx = Math.floor(px / DEM_TILE);
      const cy = Math.floor(py / DEM_TILE);
      const tile = held.get(keyOf(zd, cx, cy));
      if (!tile) {
        const ix = Math.min(Math.max(px, hx), hx + DEM_TILE - 1) - hx;
        const iy = Math.min(Math.max(py, hy), hy + DEM_TILE - 1) - hy;
        return own[iy * DEM_TILE + ix];
      }
      return tile[(py - cy * DEM_TILE) * DEM_TILE + (px - cx * DEM_TILE)];
    };
    const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
    const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  }

  /** The ground's height at a point, from the finest terrain there; null when unreachable. */
  async function groundAt(lat, lon) {
    const X = lonToX(lon, 0);
    const Y = latToY(lat, 0);
    const zooms = await zoomsFor([{ z: 0, x: X - 0.5, y: Y - 0.5 }], () => DEM_MAX);
    if (!zooms) return null;
    const zd = zooms[0];
    if (zd < 0) return 0;
    const keys = demRange(0, X, Y, X, Y, zd);
    return pinning(keys, async () => {
      if (!(await load(keys))) return null;
      const s = 2 ** zd * DEM_TILE;
      return heightAt(zd, X * s, Y * s, [Math.floor(X * 2 ** zd), Math.floor(Y * 2 ** zd)]);
    });
  }

  return { load, pinning, zoomsFor, heightAt, groundAt, tile: (key) => held.get(key), get size() { return held.size; } };
}

/** The terrain tiles a rectangle of tile units at zoom z touches at zoom zd, a pixel round. */
export function demRange(z, x0, y0, x1, y1, zd) {
  const s = 2 ** (zd - z) * DEM_TILE;
  const keys = [];
  for (let ty = Math.floor((y0 * s - 2) / DEM_TILE); ty <= Math.floor((y1 * s + 2) / DEM_TILE); ty += 1) {
    for (let tx = Math.floor((x0 * s - 2) / DEM_TILE); tx <= Math.floor((x1 * s + 2) / DEM_TILE); tx += 1) {
      keys.push(keyOf(zd, tx, ty));
    }
  }
  return keys;
}

/** Vertices a side for a tile at zoom z over terrain of zoom zd: no closer than the terrain's own pixels. */
export function meshSize(z, zd, most = MESH_MAX) {
  const across = DEM_TILE * 2 ** (zd - z);
  return Math.max(4, Math.min(most, 2 ** Math.ceil(Math.log2(Math.max(across, 1)))));
}

/** A tile's own corners at each edge, in the order the renderer's skirts are indexed. */
const edgeOf = (size) => [(k) => k, (k) => size * (size + 1) + k, (k) => k * (size + 1), (k) => k * (size + 1) + size];

/**
 * A tile's vertices in the eye's frame (`frame`, geo.js `eyeFrame`): position,
 * normal and picture coordinates, 8 floats each, the grid first and then a
 * skirt down each edge, and the lowest and highest ground it holds. `terrain`
 * must hold the tiles `demRange` names for it.
 */
export function buildMesh(
  frame,
  terrain,
  t,
  zd,
  { most = MESH_MAX, skirtMin = SKIRT_MIN, skirtScale = SKIRT_SCALE, skirtSpacing = SKIRT_SPACING } = {}
) {
  const size = meshSize(t.z, zd, most);
  const side = size + 1;
  const grid = side * side;
  const M = size + 3;
  const H = new Float64Array(M * M);
  const s = 2 ** (zd - t.z) * DEM_TILE;
  const home = [Math.floor((t.x + 0.5) * 2 ** (zd - t.z)), Math.floor((t.y + 0.5) * 2 ** (zd - t.z))];
  for (let j = -1; j <= size + 1; j += 1) {
    for (let i = -1; i <= size + 1; i += 1) {
      H[(j + 1) * M + i + 1] = terrain.heightAt(zd, (t.x + i / size) * s, (t.y + j / size) * s, home);
    }
  }
  const data = new Float32Array((grid + 4 * side) * 8);
  let low = Infinity;
  let high = -Infinity;
  const width = MERC / 2 ** t.z;
  for (let j = 0; j <= size; j += 1) {
    const lat = tileLat(t.y + j / size, t.z);
    const spacing = (width * Math.cos(lat * RAD)) / size;
    for (let i = 0; i <= size; i += 1) {
      const o = (j * side + i) * 8;
      const h = H[(j + 1) * M + i + 1];
      if (h < low) low = h;
      if (h > high) high = h;
      frame.place(lat, tileLon(t.x + i / size, t.z), h, data, o);
      const east = (H[(j + 1) * M + i + 2] - H[(j + 1) * M + i]) / (2 * spacing);
      const north = (H[j * M + i + 1] - H[(j + 2) * M + i + 1]) / (2 * spacing);
      const length = Math.hypot(east, north, 1);
      data[o + 3] = -east / length;
      data[o + 4] = -north / length;
      data[o + 5] = 1 / length;
      data[o + 6] = i / size;
      data[o + 7] = j / size;
    }
  }
  // A neighbour a level coarser skips every other vertex of an edge, so the seam
  // opens by how far a vertex stands off the line through its two neighbours;
  // the terrain under two levels differs too, by about a tenth of a vertex
  // spacing. The skirt hangs that far down and no farther: a deep one is hidden
  // ground the card still has to fill.
  const edge = edgeOf(size);
  const spacing = (width * Math.cos(tileLat(t.y + 0.5, t.z) * RAD)) / size;
  const at = (e, k) => H[(e === 0 ? 1 : e === 1 ? size + 1 : k + 1) * M + (e === 2 ? 1 : e === 3 ? size + 1 : k + 1)];
  for (let e = 0; e < 4; e += 1) {
    let off = 0;
    for (let k = 1; k < size; k += 1) off = Math.max(off, Math.abs(at(e, k) - (at(e, k - 1) + at(e, k + 1)) / 2));
    const skirt = skirtMin + off * skirtScale + spacing * skirtSpacing;
    for (let k = 0; k <= size; k += 1) {
      const from = edge[e](k) * 8;
      const to = (grid + e * side + k) * 8;
      data.copyWithin(to, from, from + 8);
      data[to + 2] -= skirt;
    }
  }
  return { data, size, low, high };
}

/**
 * The heights of a square grid round the eye, `size` cells a side over ±`reach`
 * metres, in the eye's frame (so the curve of the Earth is in them), from
 * terrain at zoom `zoom` or the finest coarser one there is. Null when the app
 * could not be reached.
 */
export async function buildGrid(frame, terrain, { reach, size, zoom }) {
  const X = lonToX(frame.lon, 0);
  const Y = latToY(frame.lat, 0);
  const zooms = await terrain.zoomsFor([{ z: 0, x: X - 0.5, y: Y - 0.5 }], () => zoom);
  if (!zooms) return null;
  const zd = Math.max(0, zooms[0]);
  const cos0 = Math.cos(frame.lat * RAD);
  // the square's corners, a little over, so the last cells read whole pixels round them
  const dLat = (reach * 1.02) / 111000 + 0.002;
  const dLon = (reach * 1.02) / (111000 * cos0) + 0.002;
  const tx0 = Math.floor(lonToX(frame.lon - dLon, zd));
  const ty0 = Math.floor(latToY(frame.lat + dLat, zd));
  const cols = Math.floor(lonToX(frame.lon + dLon, zd)) - tx0 + 1;
  const rows = Math.floor(latToY(frame.lat - dLat, zd)) - ty0 + 1;
  const keys = [];
  for (let ty = 0; ty < rows; ty += 1) for (let tx = 0; tx < cols; tx += 1) keys.push(keyOf(zd, tx0 + tx, ty0 + ty));
  return terrain.pinning(keys, async () => {
    if (!(await terrain.load(keys))) return null;
    const world = 2 ** zd * DEM_TILE;
    const heights = new Float32Array(size * size);
    const cell = (2 * reach) / size;
    let top = -1e9;
    // the tile under the last cell, kept: neighbouring cells mostly share it
    let last = null;
    let lastX = NaN;
    let lastY = NaN;
    const sample = (px, py) => {
      const cx = Math.floor(px / DEM_TILE);
      const cy = Math.floor(py / DEM_TILE);
      if (cx !== lastX || cy !== lastY) {
        lastX = cx;
        lastY = cy;
        last = terrain.tile(keyOf(zd, cx, cy));
      }
      return last ? last[(py - cy * DEM_TILE) * DEM_TILE + (px - cx * DEM_TILE)] : 0;
    };
    for (let r = 0; r < size; r += 1) {
      const y = reach - (r + 0.5) * cell;
      for (let c = 0; c < size; c += 1) {
        const x = -reach + (c + 0.5) * cell;
        const at = frame.ground(x, y);
        const fx = lonToX(at.lon, 0) * world - 0.5;
        const fy = latToY(at.lat, 0) * world - 0.5;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const h =
          (sample(ix, iy) * (1 - tx) + sample(ix + 1, iy) * tx) * (1 - ty) +
          (sample(ix, iy + 1) * (1 - tx) + sample(ix + 1, iy + 1) * tx) * ty;
        const z = frame.up(h, at.delta);
        heights[r * size + c] = z;
        if (z > top) top = z;
      }
    }
    return { heights, top };
  });
}
