/**
 * The globe's work that would stall the page, done beside it: the terrain read
 * from the app in batches (api/terrain.py `/batch`, the 3D map's own), decoded,
 * and each tile's mesh built from it (mesh.js).
 *
 * In: `{ type: 'mesh', tiles: [{ key, z, x, y }] }`, most wanted first.
 * Out, one a tile: `{ type: 'mesh', key, vertices, centre, heights, low, high, fallback }`,
 * or `{ type: 'mesh', key, failed: true }` when its terrain could not be read.
 * `fallback` says the fallback source drew its terrain (api/terrain.py 203),
 * which a capture credits.
 */
import { createTileBatcher } from '../map/tileBatch.js';
import { terrarium } from '../horizon/mesh/geo.js';
import { DEM_SIZE, buildTile, demSampler, demZoomFor } from './mesh.js';

const TERRAIN = '/api/terrain/batch';
/** Terrain tiles kept decoded, a megabyte each: the least recently used go first. */
const KEEP = 40;
/** The status of a terrain tile the fallback source drew (api/terrain.py). */
const FALLBACK_STATUS = 203;

const batcher = createTileBatcher();
const terrain = new Map();

async function decode(data) {
  const bitmap = await createImageBitmap(new Blob([data]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(DEM_SIZE, DEM_SIZE);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, DEM_SIZE, DEM_SIZE);
  bitmap.close();
  return terrarium(context.getImageData(0, 0, DEM_SIZE, DEM_SIZE).data, DEM_SIZE * DEM_SIZE);
}

/** One terrain tile's heights, read once and kept while it is used. */
function terrainTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  const held = terrain.get(key);
  if (held) {
    terrain.delete(key);
    terrain.set(key, held);
    return held;
  }
  const job = batcher.get(TERRAIN, z, x, y).then(async ({ status, data }) => {
    if (status !== 200 && status !== FALLBACK_STATUS) throw new Error(`terrain answered ${status}`);
    return { heights: await decode(data), fallback: status === FALLBACK_STATUS };
  });
  // a tile that could not be read is asked again the next time
  job.catch(() => terrain.get(key) === job && terrain.delete(key));
  terrain.set(key, job);
  while (terrain.size > KEEP) terrain.delete(terrain.keys().next().value);
  return job;
}

async function build({ key, z, x, y }) {
  const zd = demZoomFor(z);
  const span = 2 ** (z - zd);
  const dx = Math.floor(x / span);
  const dy = Math.floor(y / span);
  try {
    const dem = await terrainTile(zd, dx, dy);
    const built = buildTile(z, x, y, demSampler(dem.heights, zd, dx, dy, z, x, y));
    self.postMessage({ type: 'mesh', key, ...built, fallback: dem.fallback }, [built.vertices.buffer, built.heights.buffer]);
  } catch {
    self.postMessage({ type: 'mesh', key, failed: true });
  }
}

self.onmessage = ({ data }) => {
  if (data.type === 'mesh') for (const tile of data.tiles) build(tile);
};
