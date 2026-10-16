/**
 * The ground's heights under a plate's map, as one grid read from the app's terrain
 * tiles (`/api/terrain/tiles`, the ones the relief shading draws): what its contour
 * lines (`contours.js`) and the crests of a 3D map (`ridges.js`) are traced from.
 *
 * The tiles are asked for only when a map shows a ground that needs them, and few of
 * them: the level is the one whose pixels are about the map's own, held to a few tiles.
 */
import { fromWorld, toWorld } from './geo.js';

/** At most this many tiles make a grid, a few million heights at most. */
export const MAX_TILES = 9;

/** A tile's side in the world's pixels (`geo.js`), whatever the size of the heights it holds. */
const WORLD_TILE = 512;

/** The tiles `[x, y, column]` of level `zoom` a box `[west, south, east, north]` covers, `column` unwrapped. */
export function tilesOver([west, south, east, north], zoom) {
  const count = 2 ** zoom;
  const [x0, y0] = toWorld([west, north], zoom).map((value) => Math.floor(value / WORLD_TILE));
  const [x1, y1] = toWorld([east, south], zoom).map((value) => Math.floor(value / WORLD_TILE));
  const out = [];
  for (let y = Math.max(0, y0); y <= Math.min(count - 1, y1); y += 1) {
    for (let x = x0; x <= x1; x += 1) out.push([((x % count) + count) % count, y, x]);
  }
  return out;
}

/** The level a grid is read at for a map at `zoom`: about one height a map pixel, held under `MAX_TILES`. */
export function gridLevel(bounds, zoom, maxZoom = 12) {
  let level = Math.max(0, Math.min(maxZoom, Math.floor(zoom)));
  while (level > 0 && tilesOver(bounds, level).length > MAX_TILES) level -= 1;
  return level;
}

/**
 * The heights over `bounds`, read at `level`: `{ width, height, heights, lonLat(x, y) }`,
 * `heights` row by row from the north-west corner, `lonLat` the ground under a point
 * of the grid. `load(z, x, y)` gives a tile's heights (`eyeGuard.browserHeights`),
 * `tile` of them a side, or null where there are none, which the grid reads as the sea.
 */
export async function heightGrid(bounds, level, load, tile = 512) {
  const tiles = tilesOver(bounds, level);
  if (!tiles.length) return null;
  const xs = tiles.map(([, , x]) => x);
  const ys = tiles.map(([, y]) => y);
  const [left, top] = [Math.min(...xs), Math.min(...ys)];
  const width = (Math.max(...xs) - left + 1) * tile;
  const height = (Math.max(...ys) - top + 1) * tile;
  const heights = new Float32Array(width * height);
  const read = await Promise.all(tiles.map(([x, y]) => load(level, x, y).catch(() => null)));
  tiles.forEach(([, y, column], index) => {
    const data = read[index];
    if (!data) return;
    const ox = (column - left) * tile;
    const oy = (y - top) * tile;
    for (let row = 0; row < tile; row += 1) heights.set(data.subarray(row * tile, (row + 1) * tile), (oy + row) * width + ox);
  });
  return {
    width,
    height,
    heights,
    lonLat: (x, y) => fromWorld([(left + (x + 0.5) / tile) * WORLD_TILE, (top + (y + 0.5) / tile) * WORLD_TILE], level),
  };
}

/** The grid halved along each side, each height the mean of four: what the ridges are traced on. */
export function halved({ width, height, heights, lonLat }) {
  const w = Math.floor(width / 2);
  const h = Math.floor(height / 2);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const at = 2 * y * width + 2 * x;
      out[y * w + x] = (heights[at] + heights[at + 1] + heights[at + width] + heights[at + width + 1]) / 4;
    }
  }
  return { width: w, height: h, heights: out, lonLat: (x, y) => lonLat(2 * x + 0.5, 2 * y + 0.5) };
}
