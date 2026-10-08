/**
 * The work that would stall the page, done beside it: terrain and imagery read
 * from the app in batches (api/horizon.py `/tiles/*`), each tile's mesh built
 * in the eye's frame, the ground under a point, the shadows' height grids.
 *
 * Messages in, each naming the eye (`id`) it is for; work for an eye the page
 * has left is dropped:
 * - `{ type: 'eye', id, lat, lon, mode, height }` → `{ type: 'eye', id, ground, alt }`
 *   once the ground under it is read (`alt` null when the app could not be reached).
 * - `{ type: 'tiles', id, tiles: [{ key, z, x, y, provider }] }` → one
 *   `{ type: 'tile', id, key, data, size, low, high, image, provider }` a tile (or `failed: true`);
 *   `provider` null builds the mesh without a picture.
 * - `{ type: 'images', id, tiles: [...] }` → one `{ type: 'image', id, key, provider, image }` a tile.
 * - `{ type: 'grids', id, grids: [{ reach, size, zoom }] }` → `{ type: 'grids', id, grids: [{ heights, top }] }`
 *   (or `failed: true`).
 * - `{ type: 'height', id, ask, lat, lon }` → `{ type: 'height', id, ask, ground }`.
 *
 * And `{ type: 'refused', provider, status, message }` when the app refuses a
 * provider's imagery (a paused quota, a key gone), said once a provider.
 */
import { buildGrid, buildMesh, createTerrain, demRange } from './build.js';
import { DEM_TILE, eyeAltitude, eyeFrame, terrarium } from './geo.js';

const TERRAIN = '/api/horizon/tiles/terrain';
const IMAGERY = '/api/horizon/tiles/imagery';
/** Tiles one answer may hold (api/horizon.py `TILES_MAX`). */
const BATCH = 64;

class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Many tiles in one answer: a little-endian u32 length a tile (0 for none), then its bytes. */
async function batch(path, keys) {
  const out = new Map();
  for (let i = 0; i < keys.length; i += BATCH) {
    const part = keys.slice(i, i + BATCH);
    const answer = await fetch(`${path}${path.includes('?') ? '&' : '?'}t=${part.join(',')}`);
    if (!answer.ok) {
      let message = `The app answered ${answer.status}`;
      try {
        message = (await answer.json()).detail ?? message;
      } catch {
        // the status says enough
      }
      throw new Refused(answer.status, message);
    }
    const view = new DataView(await answer.arrayBuffer());
    let at = 0;
    for (const key of part) {
      const length = view.getUint32(at, true);
      at += 4;
      out.set(key, length ? new Uint8Array(view.buffer, at, length) : null);
      at += length;
    }
  }
  return out;
}

async function decodeTerrain(bytes) {
  const bitmap = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(DEM_TILE, DEM_TILE);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, DEM_TILE, DEM_TILE);
  bitmap.close();
  return terrarium(context.getImageData(0, 0, DEM_TILE, DEM_TILE).data, DEM_TILE * DEM_TILE);
}

const terrain = createTerrain(async (keys) => {
  const got = await batch(TERRAIN, keys);
  const out = new Map();
  await Promise.all(
    keys.map(async (key) => {
      const bytes = got.get(key);
      out.set(key, bytes ? await decodeTerrain(bytes).catch(() => null) : null);
    })
  );
  return out;
});

// -- the eye ------------------------------------------------------------------------

/** The eye the page looks from now: once the ground under it is read, `{ frame, ground }` (null when it could not be). */
let eye = { id: 0, standing: Promise.resolve(null) };

async function stand({ lat, lon, mode, height }) {
  const ground = await terrain.groundAt(lat, lon);
  if (ground == null) return null;
  return { frame: eyeFrame({ lat, lon, alt: eyeAltitude(mode, height, ground) }), ground };
}

// -- imagery ------------------------------------------------------------------------

const refusedOnce = new Set();

/** The pictures of these tiles, by key; a refusal is said to the page once and leaves them empty. */
async function pictures(list) {
  const out = new Map();
  const byProvider = new Map();
  for (const t of list) {
    if (!t.provider) continue;
    if (!byProvider.has(t.provider)) byProvider.set(t.provider, []);
    byProvider.get(t.provider).push(t);
  }
  await Promise.all(
    [...byProvider].map(async ([provider, tiles]) => {
      let got;
      try {
        got = await batch(`${IMAGERY}?provider=${encodeURIComponent(provider)}`, tiles.map((t) => `${t.z}/${t.x}/${t.y}`));
        refusedOnce.delete(provider);
      } catch (failure) {
        if (failure instanceof Refused && !refusedOnce.has(provider)) {
          refusedOnce.add(provider);
          self.postMessage({ type: 'refused', provider, status: failure.status, message: failure.message });
        }
        return;
      }
      await Promise.all(
        tiles.map(async (t) => {
          const bytes = got.get(`${t.z}/${t.x}/${t.y}`);
          out.set(t.key, bytes ? await createImageBitmap(new Blob([bytes])).catch(() => null) : null);
        })
      );
    })
  );
  return out;
}

// -- tiles --------------------------------------------------------------------------

async function tiles(id, list) {
  const frame = (await eye.standing)?.frame;
  if (id !== eye.id) return;
  const fail = (t) => self.postMessage({ type: 'tile', id, key: t.key, failed: true });
  if (!frame) return list.forEach(fail);
  const imagery = pictures(list);
  // each tile's terrain a level coarser than itself, then every terrain tile it touches
  const zooms = await terrain.zoomsFor(list, (t) => t.z - 1);
  if (!zooms) {
    await imagery.then((got) => got.forEach((image) => image?.close()));
    return list.forEach(fail);
  }
  const needed = [];
  list.forEach((t, i) => {
    if (zooms[i] >= 0) needed.push(...demRange(t.z, t.x - 1 / 64, t.y - 1 / 64, t.x + 1 + 1 / 64, t.y + 1 + 1 / 64, zooms[i]));
  });
  // kept while the pictures come, however many other tiles are read meanwhile
  await terrain.pinning(needed, async () => {
    const [images, held] = await Promise.all([imagery, terrain.load(needed)]);
    for (let i = 0; i < list.length; i += 1) {
      const t = list[i];
      const image = images.get(t.key) ?? null;
      if (id !== eye.id || !held || zooms[i] < 0) {
        image?.close();
        if (id === eye.id) fail(t);
        continue;
      }
      const { data, size, low, high } = buildMesh(frame, terrain, t, zooms[i]);
      self.postMessage(
        { type: 'tile', id, key: t.key, data, size, low, high, image, provider: t.provider ?? null },
        image ? [data.buffer, image] : [data.buffer]
      );
    }
  });
}

async function images(id, list) {
  const got = await pictures(list);
  for (const t of list) {
    const image = got.get(t.key) ?? null;
    if (id !== eye.id) {
      image?.close();
      continue;
    }
    self.postMessage({ type: 'image', id, key: t.key, provider: t.provider, image }, image ? [image] : []);
  }
}

async function grids(id, list) {
  const frame = (await eye.standing)?.frame;
  if (id !== eye.id) return;
  const built = [];
  for (const g of list) {
    const grid = frame ? await buildGrid(frame, terrain, g).catch(() => null) : null;
    if (id !== eye.id) return;
    if (!grid) return self.postMessage({ type: 'grids', id, failed: true });
    built.push(grid);
  }
  self.postMessage({ type: 'grids', id, grids: built }, built.map((g) => g.heights.buffer));
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'eye') {
      eye = { id: data.id, standing: stand(data) };
      const standing = await eye.standing;
      if (data.id === eye.id) {
        self.postMessage({ type: 'eye', id: data.id, ground: standing?.ground ?? null, alt: standing?.frame.alt ?? null });
      }
    } else if (data.type === 'tiles') await tiles(data.id, data.tiles);
    else if (data.type === 'images') await images(data.id, data.tiles);
    else if (data.type === 'grids') await grids(data.id, data.grids);
    else if (data.type === 'height') {
      self.postMessage({ type: 'height', id: data.id, ask: data.ask, ground: await terrain.groundAt(data.lat, data.lon) });
    }
  } catch (failure) {
    self.postMessage({ type: 'error', message: String(failure?.message ?? failure) });
  }
};
