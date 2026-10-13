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
import { burnRoofs } from './buildingMesh.js';
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
// Five aircraft steps, fifty of a drone's: a walk round one place never reads it all again.
export const WALK_REACH = 5000;
/** Screen pixels a picture pixel may cover in the lens at rest, and at most while the hand moves on a slow card. */
export const SHARP = 1.5;
export const MOTION_MAX = 6;
/** ms the hand must rest before the view is drawn sharp again. */
export const REST_MS = 250;
/** How sharply a picture seen edge-on may be read (renderer.js `sharpen`). */
const SHARPEN = 4;
/**
 * Pictures kept from tiles let go, on the GPU, for the same tiles built again
 * for a new eye: a step past the walk's reach or a jump nearby reads the ground
 * again but not its imagery. About 50 MB of 256-pixel pictures at most.
 */
export const KEEP_PICTURES = 160;
/** Tiles of buildings sent to a worker in one message. */
const BUILDINGS_BATCH = 4;
/** ms the shadows wait for more buildings before their grid is raised again. */
const BURN_DELAY = 250;

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
  // the eye's turn as the app marched it, which says what nearer ground hides (tiles.js)
  let marched = null;
  let lost = false;
  let progress = { phase: 'landing', share: 0 };
  let heightAsked = 0;

  let interacting = false;
  let restTimer = 0;
  let lastFrame = 0;
  let motion = SHARP;

  // the buildings asked for (`setBuildings`): key → { x, y, bytes, version }, how unknown
  // heights are drawn, each built tile's outlines for the shadows, and the terrain's own grids
  let buildingTiles = new Map();
  let buildingOptions = { unknown: 'draw', unknownHeight: undefined };
  // switched off, the buildings are hidden, not let go: switched on again, they show at once
  let buildingsShown = true;
  // the version each tile was built at for this eye
  const builtFor = new Map();
  const roofs = new Map();
  let terrainGrids = null;
  let burnTimer = 0;

  /** The buildings' tiles built in the eye's frame, a few to each worker. */
  function buildBuildings(entries) {
    if (!buildingsShown || !eye?.frame || !eye.groundIn || !entries.length) return;
    for (let i = 0; i < entries.length; i += BUILDINGS_BATCH) {
      const chunks = entries
        .slice(i, i + BUILDINGS_BATCH)
        .map(([key, t]) => ({ key, x: t.x, y: t.y, bytes: t.bytes, version: t.version }));
      next().postMessage({ type: 'buildings', id: eye.id, chunks, ...buildingOptions });
    }
  }

  /** The shadows' grids, the finest one with the buildings raised in it. */
  function sendGrids() {
    clearTimeout(burnTimer);
    burnTimer = 0;
    if (!terrainGrids || !renderer) return;
    const list = terrainGrids.map((grid, i) => ({ ...GRIDS[i], heights: grid.heights }));
    let top = Math.max(...terrainGrids.map((grid) => grid.top));
    let buildings = 0;
    if (roofs.size && buildingsShown) {
      const burnt = burnRoofs(list[0].heights, list[0].size, list[0].reach, [...roofs.values()]);
      list[0] = { ...list[0], heights: burnt.heights };
      top = Math.max(top, burnt.top);
      buildings = burnt.reach;
    }
    renderer.setGrids({ list, top: top + 5, buildings });
    onChange();
  }

  function burnSoon() {
    if (!terrainGrids || burnTimer) return;
    burnTimer = setTimeout(sendGrids, BURN_DELAY);
  }

  // pictures kept from tiles let go (`provider|key` → texture), oldest first, and the tiles of
  // this eye asked without a picture because one is kept (key → provider)
  const keptPictures = new Map();
  let reusing = new Map();

  function keepPicture(tile, keep) {
    if (!keep || !renderer) {
      renderer?.dropTile(tile);
      return;
    }
    const texture = renderer.dropTile(tile, true);
    if (!texture) return;
    renderer.deleteTexture(keptPictures.get(keep));
    keptPictures.delete(keep);
    keptPictures.set(keep, texture);
    while (keptPictures.size > KEEP_PICTURES) {
      const [oldest, gone] = keptPictures.entries().next().value;
      keptPictures.delete(oldest);
      renderer.deleteTexture(gone);
    }
  }

  /** Mesh asks, a tile whose picture is kept asked without one. */
  function sendTiles(id, list) {
    const asked = list.map((t) => {
      if (!t.provider || !keptPictures.has(`${t.provider}|${t.key}`)) return t;
      reusing.set(t.key, t.provider);
      return { ...t, provider: null };
    });
    next().postMessage({ type: 'tiles', id, tiles: asked });
  }

  function land({ lat, lon, mode, height }, far) {
    eyeId += 1;
    tiles?.dispose();
    reusing = new Map();
    renderer.setGrids(null);
    renderer.clearBuildingChunks();
    builtFor.clear();
    roofs.clear();
    terrainGrids = null;
    clearTimeout(burnTimer);
    burnTimer = 0;
    const id = eyeId;
    eye = { id, lat, lon, mode, height, far, frame: null, ground: 0, offset: [0, 0, 0], at: { lat, lon }, grids: 'none', laid: false, failed: false };
    tiles = createTiles({
      lat,
      lon,
      far,
      imagery,
      send: (list) => sendTiles(id, list),
      sendImages: (list) => next().postMessage({ type: 'images', id, tiles: list }),
      release: keepPicture,
      attach: (tile, image) => renderer.setImage(tile, image),
    });
    tiles.setOccluder(marched);
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
        buildBuildings([...buildingTiles]);
      }
    } else if (data.type === 'tile') {
      const range = data.failed ? null : { low: data.low, high: data.high };
      const tile = data.failed ? null : renderer.addTile(data);
      let provider = data.provider ?? null;
      const reused = reusing.get(data.key);
      reusing.delete(data.key);
      const kept = reused && keptPictures.get(`${reused}|${data.key}`);
      if (tile && kept) {
        keptPictures.delete(`${reused}|${data.key}`);
        renderer.adoptTexture(tile, kept);
        provider = reused;
      }
      tiles.arrived(data.key, tile, provider, range);
    } else if (data.type === 'image') {
      tiles.imaged(data.key, data.provider, data.image);
    } else if (data.type === 'grids') {
      if (data.failed) eye.grids = 'failed';
      else {
        terrainGrids = data.grids;
        sendGrids();
        eye.grids = 'ready';
      }
    } else if (data.type === 'building-chunk') {
      // a tile let go meanwhile, or asked for again since, is not drawn
      if (buildingTiles.get(data.key)?.version !== data.version) return;
      renderer.addBuildingChunk(data.key, data);
      builtFor.set(data.key, data.version);
      roofs.set(data.key, data.roofs);
      burnSoon();
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
    // every tile held, and every picture kept, was on the lost context: the eye lands again
    tiles = null;
    keptPictures.clear();
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
      const near = eye?.frame && !eye.failed ? eye.frame.inverse(observer.lat, observer.lon)[0] : Infinity;
      if (near <= WALK_REACH) {
        // a new reach (an aircraft sees farther) keeps every tile held and adds the farther ones
        if (eye.far !== far) {
          eye.far = far;
          tiles.setFar(far);
          eye.laid = false;
          onChange();
        }
        if (observer.lat !== eye.at.lat || observer.lon !== eye.at.lon || observer.mode !== eye.mode || observer.height !== eye.height) {
          shift(observer);
        }
        return;
      }
      land(observer, far);
    },

    /**
     * The buildings round the eye, `[{ key, x, y, bytes, version }]` (engine/buildings/wire.py
     * tiles at buildingMesh.js CHUNK_Z), or null for none. Tiles kept from the last call
     * under the same version are not built again.
     */
    setBuildings(list) {
      const nextTiles = new Map((list ?? []).map((t) => [t.key, t]));
      const fresh = [];
      for (const [key, t] of nextTiles) {
        if (buildingTiles.get(key)?.version !== t.version) fresh.push([key, t]);
      }
      let dropped = false;
      for (const key of buildingTiles.keys()) {
        if (!nextTiles.has(key)) {
          renderer?.dropBuildingChunk(key);
          builtFor.delete(key);
          roofs.delete(key);
          dropped = true;
        }
      }
      buildingTiles = nextTiles;
      buildBuildings(fresh);
      if (dropped) {
        burnSoon();
        onChange();
      }
    },

    /** How a building nobody knows the height of is drawn: `{ unknown: 'draw'|'hide', unknownHeight }`. */
    setBuildingOptions(options) {
      const next = { unknown: options?.unknown ?? 'draw', unknownHeight: options?.unknownHeight };
      if (next.unknown === buildingOptions.unknown && next.unknownHeight === buildingOptions.unknownHeight) return;
      buildingOptions = next;
      builtFor.clear();
      buildBuildings([...buildingTiles]);
    },

    /**
     * Whether the buildings show. Hidden ones are kept, built, in the scene: shown again,
     * only the tiles that changed meanwhile are built.
     */
    setBuildingsShown(shown) {
      if (Boolean(shown) === buildingsShown) return;
      buildingsShown = Boolean(shown);
      if (buildingsShown) buildBuildings([...buildingTiles].filter(([key, t]) => builtFor.get(key) !== t.version));
      if (terrainGrids) burnSoon();
      onChange();
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

    /**
     * The eye's turn as the app marched it (`/api/horizon/panorama`, decoded):
     * ground a nearer ridge hides is not sharpened. Ignored for any eye but
     * the one the tiles were laid round.
     */
    setOccluder(panorama) {
      marched = panorama ?? null;
      tiles?.setOccluder(marched);
      onChange();
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
      // the buildings once the ground all round and its pictures are in: they never hold the relief up
      if (!eye.groundIn && base.meshed === base.total && base.done === base.total) {
        eye.groundIn = true;
        buildBuildings([...buildingTiles]);
      }
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
        for (const texture of keptPictures.values()) renderer.deleteTexture(texture);
        keptPictures.clear();
        renderer.dispose();
      }
      renderer = null;
      eye = null;
    },
  };
}
