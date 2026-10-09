/**
 * The ground's own shape under the imagery: the 3D map (SPEC v3).
 *
 * Relief is a raster-dem source the engine lifts the whole map onto, and the
 * tilt it unlocks. Both are engine work, so they live on this side of the
 * façade; the tool only says on or off and how much to exaggerate. Three rules
 * come on with it, each in its own module: where the camera sits as the ground
 * arrives (`groundHold.js`), the eye kept out of the ground (`eyeGuard.js`),
 * and the drag handed to the tool, which holds the grabbed ground under the
 * hand (`gestures.js` startGroundPan).
 *
 * The heights come through the app (`/api/terrain/tiles`), from Mapterhorn's
 * open terrain with AWS's set as a fallback (engine/terrain.py). Nothing is
 * asked for until relief is switched on, so a map that stays flat reaches no
 * terrain server at all.
 *
 * Real scale is the default. An exaggeration is offered for reading a gentle
 * slope, and the tool says on screen when one is on: a picture of the ground
 * at twice its height is a reading aid, never evidence of how it looks.
 */

import { browserHeights, createEyeGuard } from './eyeGuard.js';
import { createGroundHold } from './groundHold.js';
import { batchedTerrainTemplate } from './tileBatch.js';
import { createTurnWarmer } from './warmTurn.js';

export const RELIEF_SOURCE = 'relief-dem';
/** How far the camera may tilt with relief on. Flat maps stay at zero. */
export const MAX_TILT = 85;
/** What the analyst may pick; 1 is the ground as it is. */
export const EXAGGERATIONS = [1, 1.5, 2, 3];
/**
 * How many tiles a tilted view may load against a flat one. The engine allows
 * three times as many by default, which toward the horizon is a wall of tiles
 * nobody can read and a stutter while they arrive; with relief on it gets one
 * and a half. Its own default zoom fall-off is kept.
 */
export const TILT_TILE_RATIO = 1.5;
const ENGINE_LEVELS_ON_SCREEN = 9.314;
const ENGINE_TILE_RATIO = 3;

/** The sky over a tilted map: the app's dark chrome fading to a pale horizon. */
export const SKY = {
  'sky-color': '#5d7da3',
  'horizon-color': '#c9d6e3',
  'fog-color': '#c9d6e3',
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.4,
  'fog-ground-blend': 0.85,
  'atmosphere-blend': 0,
};

/**
 * The raster-dem source, from what `/api/terrain/sources` answers. On a map of
 * the app's (`mapId`), its tiles come in the batches a tilted map asks in
 * (`tileBatch.js`).
 *
 * Pure, so the shape the engine is handed is read off a test.
 */
export function demSource(info, mapId = '') {
  return {
    type: 'raster-dem',
    tiles: [mapId ? batchedTerrainTemplate(mapId) : info.tiles],
    tileSize: info.tile_size,
    maxzoom: info.max_zoom,
    encoding: info.encoding,
    // the primary source's credit; the fallback is credited where it is read
    attribution: info.sources?.[0]?.attribution ?? '',
  };
}

/** Levels the view's zoom must move over relief before the imagery is chosen again. */
export const STEADY_LEVELS = 2;

/**
 * The zoom a tilted map chooses its imagery at.
 *
 * Over relief the zoom is the centre's, and the centre is seated on the ground
 * under the middle of the view at the end of every move: a fraction of a level
 * either way, which rounds to the next whole level as often as not. A billed
 * basemap steps aside for free imagery below a zoom (eco) and changes its grid
 * at z17 (the detail bracket), and each change rebuilds the whole imagery layer:
 * every tile on screen dropped and asked again for a view that barely moved. So
 * the choice holds until the zoom has moved `STEADY_LEVELS` from where it was
 * made.
 */
export function steadyZoom(held, next) {
  if (!Number.isFinite(held) || !Number.isFinite(next)) return next;
  return Math.abs(next - held) >= STEADY_LEVELS ? next : held;
}

/** An exaggeration the engine may be handed: one of the offered steps, else 1. */
export function exaggerationOf(value) {
  const n = Number(value);
  return EXAGGERATIONS.includes(n) ? n : 1;
}

/**
 * Relief on one map.
 *
 * @param {object} map the engine's own map (façade `impl`)
 * @param {() => Promise<object>} sources what `/api/terrain/sources` answers
 * @param {{ imagery: string, send: (body: object) => Promise<unknown> }} [warm]
 *   the imagery's source id, and how a turn's tiles are posted to the app to
 *   fetch ahead (`warmTurn.js`); without it nothing is read ahead
 * @param {{ mapId?: string }} [opts] the map's name to the tile protocols (`engine.js`)
 */
export function createRelief(map, sources, warm = null, { mapId = '' } = {}) {
  let on = false;
  let info = null;
  let warmer = null;
  // Built now rather than when the relief comes on: its end-of-move seating has
  // to run before anything that reports where a move ended (`groundHold.js`).
  const ground = createGroundHold(map, { relief: RELIEF_SOURCE });
  // the ground under the eye, which a tilted view never loads (`eyeGuard.js`)
  let eye = null;
  const stopWarming = () => {
    warmer?.dispose();
    warmer = null;
  };
  // Over relief the drag and the wheel are the tool's (`gestures.js`
  // startGroundPan, createReliefWheel): the engine's own let the ground under
  // the hand slip away at a steep tilt. Its touch pan stays, and an engine
  // without the separate handle loses its whole drag pan instead.
  const engineGestures = (enabled) => {
    for (const gesture of [map.dragPan?._mousePan ?? map.dragPan, map.scrollZoom]) {
      if (enabled) gesture?.enable?.();
      else gesture?.disable?.();
    }
  };
  // The engine applies tile LOD to the sources it has when asked, so a basemap
  // switched while relief is on is told again as it arrives.
  const tiltLod = () => map.setSourceTileLodParams?.(ENGINE_LEVELS_ON_SCREEN, TILT_TILE_RATIO);
  const flatLod = () => map.setSourceTileLodParams?.(ENGINE_LEVELS_ON_SCREEN, ENGINE_TILE_RATIO);
  // A switch flipped while the sources are still being read wins over the one
  // before it: the last `show` is the one that lands.
  let asked = 0;

  async function show(next, { exaggeration: scale = 1 } = {}) {
    const mine = ++asked;
    if (!next) {
      on = false;
      stopWarming();
      // before the terrain goes, so the flat map seats its centre at sea level
      ground.stop();
      eye?.stop();
      engineGestures(true);
      map.setTerrain(null);
      // lowering the ceiling brings a tilted camera back down with it
      map.setMaxPitch(0);
      map.off('styledata', tiltLod);
      flatLod();
      return;
    }
    info ??= await sources();
    if (mine !== asked) return;
    if (!map.getSource(RELIEF_SOURCE)) map.addSource(RELIEF_SOURCE, demSource(info, mapId));
    map.setMaxPitch(MAX_TILT);
    tiltLod();
    map.off('styledata', tiltLod);
    map.on('styledata', tiltLod);
    map.setTerrain({ source: RELIEF_SOURCE, exaggeration: exaggerationOf(scale) });
    // new ground, or the same ground taller: the eye rides it until it is in
    ground.start();
    eye ??= createEyeGuard(map, browserHeights(info.tiles));
    eye.start();
    engineGestures(false);
    map.setSky(SKY);
    if (warm && !warmer) {
      warmer = createTurnWarmer(map, { imagery: warm.imagery, relief: RELIEF_SOURCE }, warm.send);
    }
    on = true;
  }

  return {
    show,
    get on() {
      return on;
    },
    dispose() {
      asked += 1;
      on = false;
      stopWarming();
      ground.dispose();
      eye?.dispose();
      map.off('styledata', tiltLod);
    },
  };
}
