/**
 * The eye never goes into the ground (the 3D map, SPEC v3).
 *
 * The engine keeps its camera above the relief it holds, but a tilted view
 * holds no relief under the camera itself: that ground lies behind the bottom
 * edge of the view, so its tile is never asked for, and the engine reads sea
 * level there. A view panned toward a massif at the same height, or swung
 * down by the orbit, then ends with the eye hundreds of metres inside the
 * mountain, drawing the rock it is in as streaks.
 *
 * So the ground under the eye is read here, from the app's own relief tiles at
 * a coarse level (one tile spans tens of kilometres, so a gesture rarely needs
 * a second), and every camera the engine is asked for is lifted clear of it:
 * the eye rises straight up, its tilt and heading kept. The engine's own lift
 * keeps looking at the same point instead, which changes the tilt and the zoom
 * under a gesture that set them: the orbit was tilting toward the horizon while
 * the lift tilted back, and the zoom drifted by levels. Rising straight up,
 * each gesture only has to bring its own point back under the hand. Until the
 * tile under the eye has arrived the engine's own reading is all there is; when
 * it lands under a camera already inside, the camera is lifted then.
 */
import { latToY, lonToX, terrarium } from '../horizon/mesh/geo.js';

/** The relief level the ground under the eye is read at: about 40 m a pixel. */
export const EYE_ZOOM = 11;
/** Metres the eye keeps above the ground under it, at the least… */
export const CLEARANCE = 40;
/** …or this share of how far away the point it looks at is, when that is more. */
export const CLEARANCE_SHARE = 0.01;
/** Tiles of heights held at once, about a megabyte each. */
const KEPT = 8;

const RAD = Math.PI / 180;

/** Metres between two points, near enough for a clearance. */
function metres(a, b) {
  const x = (b.lng - a.lng) * RAD * Math.cos(((a.lat + b.lat) / 2) * RAD);
  const y = (b.lat - a.lat) * RAD;
  return Math.hypot(x, y) * 6371008.8;
}

/**
 * The height at a point of one tile of heights, read between its four nearest
 * samples. `fx` and `fy` are the point's place across the tile, 0 to 1.
 */
export function sampleHeights(heights, size, fx, fy) {
  const px = Math.min(size - 1, Math.max(0, fx * size - 0.5));
  const py = Math.min(size - 1, Math.max(0, fy * size - 0.5));
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const tx = px - x0;
  const ty = py - y0;
  const at = (x, y) => heights[y * size + x];
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/**
 * Heights under any point, read from relief tiles one at a time.
 *
 * `at` answers at once from a tile already held, or null while its tile is
 * being read (it is asked for then, once). `onLoad` hears each tile that
 * arrives. A tile that cannot be read is not asked for again.
 *
 * @param {object} opts
 * @param {(z: number, x: number, y: number) => Promise<Float32Array|null>} opts.load
 *   the heights of one tile, `size` by `size`, row by row
 * @param {number} [opts.zoom]
 * @param {number} [opts.size] samples a side
 */
export function createGroundSampler({ load, zoom = EYE_ZOOM, size = 512 }) {
  const tiles = new Map(); // key → Float32Array | null (unreadable) | 'loading'
  const listeners = new Set();

  function at(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85) return null;
    const gx = lonToX(lon, zoom);
    const gy = latToY(lat, zoom);
    const x = Math.floor(gx);
    const y = Math.floor(gy);
    const key = `${zoom}/${x}/${y}`;
    const held = tiles.get(key);
    if (held instanceof Float32Array) {
      // the most recently read stays longest
      tiles.delete(key);
      tiles.set(key, held);
      return sampleHeights(held, size, gx - x, gy - y);
    }
    if (held === undefined) {
      tiles.set(key, 'loading');
      Promise.resolve()
        .then(() => load(zoom, x, y))
        .catch(() => null)
        .then((heights) => {
          tiles.set(key, heights?.length === size * size ? heights : null);
          while (tiles.size > KEPT) tiles.delete(tiles.keys().next().value);
          for (const listener of listeners) listener();
        });
    }
    return null;
  }

  return {
    at,
    onLoad(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * How the engine's camera has to change for the eye to clear the ground, or
 * `{}` when it already does: the eye rises straight up, tilt and heading kept,
 * which moves the point it looks at and how far off it is (`center`, `zoom`),
 * the centre's height staying what it was.
 *
 * @param {object} tr the engine's camera transform, as a camera update hands it
 * @param {number} ground metres under the eye, before any exaggeration
 * @param {number} [exaggeration]
 */
export function liftFor(tr, ground, exaggeration = 1) {
  if (!Number.isFinite(ground)) return {};
  const eye = tr.getCameraLngLat();
  const altitude = tr.getCameraAltitude();
  const room = Math.max(CLEARANCE, CLEARANCE_SHARE * metres(eye, tr.center));
  const lowest = ground * exaggeration + room;
  if (!(altitude < lowest) || !(lowest > tr.elevation + 1)) return {};
  const lifted = tr.calculateCenterFromCameraLngLatAlt(eye, lowest, tr.bearing, tr.pitch);
  if (!lifted?.center || !Number.isFinite(lifted.zoom) || !Number.isFinite(lifted.elevation)) return {};
  return { center: lifted.center, zoom: lifted.zoom, elevation: lifted.elevation };
}

/**
 * The guard on one map while its relief is on.
 *
 * @param {object} map the engine's own map
 * @param {(z: number, x: number, y: number) => Promise<Float32Array|null>} load
 */
export function createEyeGuard(map, load) {
  const ground = createGroundSampler({ load });
  const camera = map._camera;

  function lift(tr) {
    const terrain = map.terrain;
    if (!terrain) return {};
    const eye = tr.getCameraLngLat();
    const read = ground.at(eye.lat, eye.lng);
    return read == null ? {} : liftFor(tr, read, terrain.exaggeration ?? 1);
  }

  // A tile under a camera that already sank into it: lift it now, by as much
  // as it needs. The centre's height is named in the lift, or the jump would
  // re-seat it on the ground first and carry the whole camera up by that.
  const offLoad = ground.onLoad(() => {
    if (!camera || map.isMoving?.() || camera.elevationFreeze) return;
    const needed = lift(camera.transform);
    if (needed.center) map.jumpTo(needed);
  });

  return {
    /** Lift every camera from now on. */
    start() {
      if (camera) camera.transformCameraUpdate = lift;
    },
    stop() {
      if (camera?.transformCameraUpdate === lift) camera.transformCameraUpdate = null;
    },
    dispose() {
      this.stop();
      offLoad();
    },
    /** The ground under a point as far as it has been read, for a test or a probe. */
    groundAt: (lat, lon) => ground.at(lat, lon),
  };
}

/**
 * The heights of one relief tile in the browser: the image the app serves,
 * decoded without any colour conversion, which would change the heights.
 *
 * @param {string} template `/api/terrain/tiles/{z}/{x}/{y}`
 */
export function browserHeights(template) {
  return async (z, x, y) => {
    const url = template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const response = await fetch(url);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob(), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    return terrarium(data, canvas.width * canvas.height);
  };
}
