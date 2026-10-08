/**
 * The Horizon view drawn from terrain meshes: the workers that read and build
 * the tiles (worker.js), the tree that says which are drawn (tiles.js), the
 * renderer (renderer.js), and where the eye stands among them.
 * HorizonView.svelte keeps one per canvas.
 *
 * Placing the eye somewhere new lands it: everything of the last place is let
 * go and the ground all round is loaded behind a progress (`progress`), after
 * which turning never waits. A step of a walk, or a new height, only moves the
 * eye inside the tiles it has: past `WALK_REACH` from where it landed, or for
 * a longer reach, it lands again.
 *
 * Shadows are cast from height grids round the eye, read once the turn is in
 * (or at once when a light asks for them first, `draw`'s `shaded`); the light
 * is marched on the GPU for each position of the sun, so switching the sun on
 * or moving the hour slider shows them at once.
 *
 * While the hand moves the view (`moving`), a card that cannot keep up draws
 * the coarser tiles it holds; at rest the view sharpens again.
 */
import { rayFor } from '../camera.js';
import { distanceBetween } from '../geometry.js';
import { RAD, eyeAltitude, eyeFrame } from './geo.js';
import { createMeshRenderer } from './renderer.js';
import { createTiles } from './tiles.js';

/** The shadows' height grids round the eye, fine near and coarse far: metres each way, cells a side, terrain zoom. */
export const GRIDS = [
  { reach: 6000, size: 1536, zoom: 13 },
  { reach: 30000, size: 1536, zoom: 11 },
  { reach: 200000, size: 1024, zoom: 8 },
];
/** Metres the eye may walk from where it landed before the ground is laid round it again. */
export const WALK_REACH = 1500;
/** Screen pixels a picture pixel may cover in the lens at rest, and at most while the hand moves on a slow card. */
export const SHARP = 1.5;
export const MOTION_MAX = 6;
/** ms the hand must rest before the view is drawn sharp again. */
export const REST_MS = 250;
/** How sharply a picture seen edge-on may be read (renderer.js `sharpen`). */
const SHARPEN = 4;

/** Workers building tiles: one per four threads, three at most, so the page and the app keep theirs. */
export function workerCount(threads = globalThis.navigator?.hardwareConcurrency || 4) {
  return Math.max(1, Math.min(3, Math.floor(threads / 4)));
}

/**
 * What the view says while it loads, from what one frame found: `phase` is
 * 'landing' (the ground all round), 'imagery' (its pictures), 'shadows' (the
 * grids the light is marched on), 'sharpening' (the lens), or '' when done.
 */
export function progressOf({ landed, base, sharpening, shadows }) {
  if (!landed) return { phase: 'landing', share: 0 };
  if (base.meshed < base.total) return { phase: 'landing', share: base.meshed / base.total };
  if (base.done < base.total) return { phase: 'imagery', share: base.done / base.total };
  if (shadows) return { phase: 'shadows', share: 1 };
  if (sharpening) return { phase: 'sharpening', share: 1 };
  return { phase: '', share: 1 };
}

const sameImagery = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function moduleWorker() {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}

/**
 * A scene on a canvas, or null where the browser cannot draw it (no WebGL2,
 * no float targets).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [o]
 * @param {() => void} [o.onChange] something came that wants a new frame
 * @param {(refusal: { provider: string, status: number, message: string }) => void} [o.onRefused]
 *   the app refused a provider's imagery (a paused quota, a key gone)
 * @param {() => Worker} [o.makeWorker] @param {(canvas: any) => any} [o.makeRenderer] for tests
 */
export function createScene(
  canvas,
  { onChange = () => {}, onRefused = () => {}, makeWorker = moduleWorker, makeRenderer = createMeshRenderer } = {}
) {
  let renderer = makeRenderer(canvas);
  if (!renderer) return null;
  const workers = Array.from({ length: workerCount() }, () => makeWorker());
  let turn = 0;
  const next = () => workers[turn++ % workers.length];

  let eyeId = 0;
  /**
   * `{ id, lat, lon, mode, height, far, frame, ground, offset, at, underfoot, grids, laid, failed }`:
   * where it landed (`lat`, `lon`, the frame and the `ground` there), and where it stands now
   * (`at`, the ground `underfoot`, its `offset` in the frame).
   */
  let eye = null;
  let tiles = null;
  let imagery = null;
  let photo = null;
  let lost = false;
  let progress = { phase: 'landing', share: 0 };
  let heightAsked = 0;

  let interacting = false;
  let restTimer = 0;
  let lastFrame = 0;
  let motion = SHARP;

  function land({ lat, lon, mode, height }, far) {
    eyeId += 1;
    tiles?.dispose();
    renderer.setGrids(null);
    const id = eyeId;
    eye = { id, lat, lon, mode, height, far, frame: null, ground: 0, offset: [0, 0, 0], at: { lat, lon }, grids: 'none', laid: false, failed: false };
    tiles = createTiles({
      lat,
      lon,
      far,
      imagery,
      send: (list) => next().postMessage({ type: 'tiles', id, tiles: list }),
      sendImages: (list) => next().postMessage({ type: 'images', id, tiles: list }),
      release: (tile) => renderer.dropTile(tile),
      attach: (tile, image) => renderer.setImage(tile, image),
    });
    for (const worker of workers) worker.postMessage({ type: 'eye', id, lat, lon, mode, height });
    progress = { phase: 'landing', share: 0 };
    onChange();
  }

  const pendingHeights = new Map();

  /** The eye moved within the tiles it has: stood there, as high as asked, once the ground there is known. */
  async function shift({ lat, lon, mode, height }) {
    const ask = ++heightAsked;
    const here = eye;
    let ground = here.underfoot;
    if (lat !== here.at.lat || lon !== here.at.lon) {
      ground = await new Promise((resolve) => {
        pendingHeights.set(ask, resolve);
        workers[0].postMessage({ type: 'height', id: here.id, ask, lat, lon });
      });
    }
    if (ask !== heightAsked || here !== eye || ground == null) return;
    const out = [0, 0, 0];
    here.frame.place(lat, lon, eyeAltitude(mode, height, ground), out, 0);
    here.offset = out;
    here.at = { lat, lon };
    here.underfoot = ground;
    here.mode = mode;
    here.height = height;
    onChange();
  }

  /** What a distance read under a pixel says: which way, how far from the eye, where. */
  function reading(camera, x, y, metres) {
    const ray = rayFor(camera, x, y);
    if (metres == null) return { azimuth: ray.azimuth, elevation: ray.elevation, distance: null };
    const across = metres * Math.cos(ray.elevation * RAD);
    const at = eye.frame.locate(
      eye.offset[0] + across * Math.sin(ray.azimuth * RAD),
      eye.offset[1] + across * Math.cos(ray.azimuth * RAD),
      eye.offset[2] + metres * Math.sin(ray.elevation * RAD)
    );
    return { azimuth: ray.azimuth, elevation: ray.elevation, distance: distanceBetween(eye.at, at), lat: at.lat, lon: at.lon };
  }

  /** The eye as it stands now, for landing it again where it is. */
  const standing = () => ({ ...eye.at, mode: eye.mode, height: eye.height });

  function onMessage({ data }) {
    if (data.type === 'refused') return onRefused(data);
    if (data.type === 'error') return console.warn('Horizon worker:', data.message);
    if (data.type === 'height') {
      pendingHeights.get(data.ask)?.(data.ground);
      pendingHeights.delete(data.ask);
      return;
    }
    if (!eye || data.id !== eye.id) {
      data.image?.close?.();
      return;
    }
    if (data.type === 'eye') {
      if (eye.frame || eye.failed) return;
      if (data.alt == null) eye.failed = true;
      else {
        eye.frame = eyeFrame({ lat: eye.lat, lon: eye.lon, alt: data.alt });
        eye.ground = data.ground;
        eye.underfoot = data.ground;
      }
    } else if (data.type === 'tile') {
      const range = data.failed ? null : { low: data.low, high: data.high };
      tiles.arrived(data.key, data.failed ? null : renderer.addTile(data), data.provider ?? null, range);
    } else if (data.type === 'image') {
      tiles.imaged(data.key, data.provider, data.image);
    } else if (data.type === 'grids') {
      if (data.failed) eye.grids = 'failed';
      else {
        renderer.setGrids({
          list: data.grids.map((grid, i) => ({ ...GRIDS[i], heights: grid.heights })),
          top: Math.max(...data.grids.map((grid) => grid.top)) + 5,
        });
        eye.grids = 'ready';
      }
    }
    onChange();
  }
  for (const worker of workers) worker.onmessage = onMessage;

  function onLost(event) {
    event.preventDefault();
    lost = true;
  }
  function onRestored() {
    lost = false;
    renderer = makeRenderer(canvas);
    if (renderer && photo) renderer.setPhoto(photo);
    // every tile held was on the lost context: the eye lands again
    if (renderer && eye) land(standing(), eye.far);
  }
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    /**
     * Where the eye stands (`{ lat, lon, mode, height }`) and how far it sees:
     * a new place lands, a step or a new height moves the eye among the tiles.
     */
    place(observer, far) {
      if (!renderer) return;
      const near = eye?.frame && !eye.failed && eye.far === far ? eye.frame.inverse(observer.lat, observer.lon)[0] : Infinity;
      if (near <= WALK_REACH) {
        if (observer.lat !== eye.at.lat || observer.lon !== eye.at.lon || observer.mode !== eye.mode || observer.height !== eye.height) {
          shift(observer);
        }
        return;
      }
      land(observer, far);
    },

    /** The imagery the ground is drawn in, `{ provider, near: { provider, reach } | null }`, or null for none. */
    setImagery(next) {
      if (sameImagery(next, imagery)) return;
      imagery = next;
      tiles?.setImagery(next);
      onChange();
    },

    setPhoto(source) {
      photo = source;
      renderer?.setPhoto(source);
    },

    /** The hand is moving the view: a slow card may draw coarser until it rests. */
    moving() {
      interacting = true;
      clearTimeout(restTimer);
      restTimer = setTimeout(() => {
        interacting = false;
        lastFrame = 0;
        onChange();
      }, REST_MS);
    },

    /**
     * One frame through `camera` (camera.js, CSS pixels): the options are the
     * renderer's (`ground`, `lines`, `sky`, `shaded`, `keep`, `visibility`,
     * `near`, `jump`, `photo`, `bend`); the eye's place and reach are the scene's.
     */
    draw(camera, options = {}) {
      if (!renderer || lost) return progress;
      const now = performance.now();
      if (interacting && lastFrame && now - lastFrame < 250) {
        const spent = now - lastFrame;
        if (spent > 22) motion = Math.min(MOTION_MAX, motion * 1.25);
        else if (spent < 12) motion = Math.max(SHARP, motion / 1.15);
      }
      lastFrame = interacting ? now : 0;
      const common = { ...options, sharpen: SHARPEN, far: eye?.far ?? 200000 };
      if (!eye?.frame) {
        renderer.draw(camera, [], { ...common, shaded: false });
        progress = progressOf({ landed: false });
        return progress;
      }
      if (!eye.laid) {
        tiles.land(camera, Math.max(0, eye.frame.alt - eye.ground));
        eye.laid = true;
      }
      const wantsShade = Boolean(options.shaded);
      const sharp = interacting ? Math.max(motion, SHARP) : SHARP;
      const walked = Math.hypot(eye.offset[0], eye.offset[1]);
      const alt = eye.frame.alt + eye.offset[2];
      const { drawn, sharpening, base } = tiles.frame(camera, sharp, { shift: walked, alt });
      // the shadows' grids: at once when a light asks, ahead once the turn is in otherwise,
      // so switching the sun on later casts them without a wait
      if (eye.grids === 'none' && (wantsShade || base.meshed === base.total)) {
        eye.grids = 'loading';
        workers[0].postMessage({ type: 'grids', id: eye.id, grids: GRIDS });
      }
      renderer.draw(camera, drawn, { ...common, shaded: wantsShade && eye.grids === 'ready', eye: eye.offset });
      progress = progressOf({ landed: true, base, sharpening, shadows: wantsShade && eye.grids === 'loading' });
      return progress;
    },

    /**
     * The ground under a CSS pixel of the last frame: `{ azimuth, elevation,
     * distance, lat, lon }` from the eye, `distance` null for the sky; null
     * before the eye has landed.
     */
    groundAt(camera, x, y) {
      if (!renderer || lost || !eye?.frame) return null;
      return reading(camera, x, y, renderer.pick(x, y));
    },

    /**
     * As `groundAt`, a moment later, without making the page wait for the GPU:
     * for the reading that follows the pointer. Undefined when a newer one was asked.
     */
    async groundSoon(camera, x, y) {
      if (!renderer || lost || !eye?.frame) return null;
      const here = eye;
      const metres = await renderer.pickSoon(x, y);
      if (metres === undefined || here !== eye) return undefined;
      return reading(camera, x, y, metres);
    },

    /** Whether the eye has landed: the ground under it is known and tiles are coming. */
    get landed() {
      return Boolean(eye?.frame);
    },
    /** Whether the ground under the eye could not be read (the app was not reached). */
    get failed() {
      return Boolean(eye?.failed);
    },
    /** What the last frame found still loading (`progressOf`). */
    get progress() {
      return progress;
    },

    /** Everything that came back empty asked again: the eye's ground, tiles, pictures, the grids. */
    retry() {
      if (!eye) return;
      if (eye.failed) return land(standing(), eye.far);
      if (eye.grids === 'failed') eye.grids = 'none';
      tiles?.retry();
      onChange();
    },

    dispose() {
      clearTimeout(restTimer);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      for (const worker of workers) worker.terminate();
      if (renderer) {
        tiles?.dispose();
        renderer.dispose();
      }
      renderer = null;
      eye = null;
    },
  };
}
