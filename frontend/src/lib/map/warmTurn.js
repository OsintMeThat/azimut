/**
 * A tilted map's turn, read ahead (engine/tilewarm.py).
 *
 * Every tile comes through the app, over the six connections a browser keeps
 * to one host. Tilted toward the horizon, a quick half turn uncovers dozens of
 * tiles at once; each one Esri or Mapterhorn has to send first waits a few
 * hundred milliseconds, and the ground arrives in patches. One already on the
 * app's disk takes a few.
 *
 * So when a tilted view settles, this asks the engine which tiles the same
 * view would cover facing each of eight headings, and sends the ones it is
 * not already showing to the app, which fetches them into its disk caches.
 * The engine is asked rather than imitated: its level of detail falls with
 * distance in ways a copy would drift from.
 *
 * Only proxied free imagery and the relief are listed. A billed provider goes
 * through the quota guard (`quotaGuard.js`) and is never read ahead, and the
 * app refuses one anyway.
 */

import { BATCH_PROTOCOL } from './tileBatch.js';

/** Below this tilt the view is near enough flat that a turn uncovers little. */
export const WARM_MIN_PITCH = 30;
/** Headings a turn is read at, the one on screen included. */
export const WARM_HEADINGS = 8;
/** ms the view must rest before its turn is read ahead. */
export const WARM_DELAY = 500;
/** The app's bounds on one list (api/satellite.py `WARM_MAX_*`). */
export const WARM_MAX_TILES = 1200;
export const WARM_MAX_TERRAIN = 400;

// the app's proxy as an address, or as the batches a map asks in (`tileBatch.js`)
const PROXIED = new RegExp(`^(?:/api/tiles|${BATCH_PROTOCOL}://[^/]+/imagery)/([^/]+)/\\{z\\}/\\{x\\}/\\{y\\}$`);
const TERRAIN = new RegExp(`^(?:/api/terrain/tiles|${BATCH_PROTOCOL}://[^/]+/terrain)/\\{z\\}/\\{x\\}/\\{y\\}$`);

/** The provider a tile address template is proxied for, or null. */
export function proxiedProvider(template) {
  const found = PROXIED.exec(template ?? '');
  return found ? decodeURIComponent(found[1]) : null;
}

/** Whether a template is the app's own relief tiles. */
export function isTerrainTemplate(template) {
  return TERRAIN.test(template ?? '');
}

/** The headings after the one on screen, alternating sides outward: 1, −1, 2, −2… */
export function headingOrder(count) {
  const order = [];
  for (let step = 1; order.length < count - 1; step += 1) {
    order.push(step);
    if (order.length < count - 1) order.push(-step);
  }
  return order;
}

/**
 * Where the view's centre lands when the camera orbits `pivot` to `bearing`.
 *
 * An orbit keeps the pivot under the hand and swings the centre round it, so
 * the centre stays as far from the pivot as it was, in the direction the
 * camera now faces. Local metres are plenty for the few kilometres a tilted
 * view's near ground spans.
 */
export function orbitCentre(centre, pivot, bearing) {
  const rad = Math.PI / 180;
  const metresPerDegree = 111320;
  const east = (centre.lng - pivot.lng) * metresPerDegree * Math.cos(pivot.lat * rad);
  const north = (centre.lat - pivot.lat) * metresPerDegree;
  const reach = Math.hypot(east, north);
  return {
    lng: pivot.lng + (reach * Math.sin(bearing * rad)) / (metresPerDegree * Math.cos(pivot.lat * rad)),
    lat: pivot.lat + (reach * Math.cos(bearing * rad)) / metresPerDegree,
  };
}

/**
 * Where a middle-drag usually grabs: the ground in the lower part of the view,
 * as a share of its height. A turn about it brings ground near the eye that a
 * turn about the centre only shows from afar.
 */
export const NEAR_PIVOT = 0.8;

/**
 * The tiles of one source a full turn of this view covers, nearest headings
 * first, the ones the view on screen already covers left out.
 *
 * The engine's own covering is asked of a copy of the camera turned to each
 * heading, through the same method the map answers for its own camera. Two
 * turns are read: about the centre, and about the near ground a hand grabs
 * (`NEAR_PIVOT`), since the orbit swings the view round the point it holds.
 * A relief source is covered the way the engine covers terrain: tiles twice
 * the size, and each one's parent with it.
 *
 * @returns {number[][]} `[z, x, y]` per tile
 */
export function turnTiles(map, sourceId, { headings = WARM_HEADINGS, terrain = false } = {}) {
  const source = map.getSource?.(sourceId);
  const transform = map._camera?.transform;
  if (!source || typeof transform?.clone !== 'function' || typeof map.coveringTiles !== 'function') {
    return [];
  }
  const options = {
    tileSize: terrain ? source.tileSize * 2 : source.tileSize,
    minzoom: source.minzoom,
    maxzoom: source.maxzoom,
    roundZoom: terrain ? false : source.roundZoom,
    terrain: map.terrain,
    calculateTileZoom: source.calculateTileZoom,
  };
  const LngLat = transform.center?.constructor;
  const facing = (bearing, pivot = null) => {
    const turned = transform.clone();
    turned.setBearing(bearing);
    if (pivot && LngLat) {
      const { lng, lat } = orbitCentre(transform.center, pivot, bearing);
      turned.setCenter(new LngLat(lng, lat));
    }
    return map.coveringTiles.call({ _camera: { transform: turned } }, options);
  };
  const tilesOf = (id) => {
    const { z, x, y } = id.canonical;
    const own = [[z, x, y]];
    if (terrain && z > (source.minzoom ?? 0)) own.push([z - 1, x >> 1, y >> 1]);
    return own;
  };
  const seen = new Set();
  const key = ([z, x, y]) => `${z}/${x}/${y}`;
  for (const id of facing(transform.bearing)) for (const tile of tilesOf(id)) seen.add(key(tile));
  const box = map.getContainer?.();
  const grabbed = box && map.unproject?.([box.clientWidth / 2, box.clientHeight * NEAR_PIVOT]);
  const pivots = [null];
  if (grabbed && Number.isFinite(grabbed.lat) && Number.isFinite(grabbed.lng)) pivots.push(grabbed);
  const listed = [];
  const step = 360 / headings;
  for (const turn of headingOrder(headings)) {
    for (const pivot of pivots) {
      for (const id of facing(transform.bearing + turn * step, pivot)) {
        for (const tile of tilesOf(id)) {
          if (seen.has(key(tile))) continue;
          seen.add(key(tile));
          listed.push(tile);
        }
      }
    }
  }
  return listed;
}

/**
 * What to send the app for this view, or null when there is nothing to read
 * ahead: a flat or barely tilted map, no relief, or only billed imagery.
 *
 * @param {object} map the engine's own map
 * @param {{ imagery: string, relief: string }} sources the two source ids
 */
export function warmRequest(map, { imagery, relief }) {
  if (!map.getTerrain?.() || !(map.getPitch() >= WARM_MIN_PITCH)) return null;
  const body = { provider: null, tiles: [], terrain: [] };
  const picture = map.getSource?.(imagery);
  const provider = proxiedProvider(picture?.tiles?.[0]);
  if (provider) {
    body.provider = provider;
    body.tiles = turnTiles(map, imagery).slice(0, WARM_MAX_TILES);
  }
  if (isTerrainTemplate(map.getSource?.(relief)?.tiles?.[0])) {
    body.terrain = turnTiles(map, relief, { terrain: true }).slice(0, WARM_MAX_TERRAIN);
  }
  return body.tiles.length || body.terrain.length ? body : null;
}

/**
 * Read the turn ahead each time a tilted view comes to rest.
 *
 * @param {object} map the engine's own map
 * @param {{ imagery: string, relief: string }} sources
 * @param {(body: object) => Promise<unknown>} send posts the list to the app
 */
export function createTurnWarmer(map, sources, send) {
  let timer = null;
  let last = '';
  const run = () => {
    timer = null;
    const body = warmRequest(map, sources);
    if (!body) return;
    // the same list twice is the same view settling twice
    const signature = JSON.stringify(body);
    if (signature === last) return;
    last = signature;
    send(body)?.catch?.(() => {
      // a read-ahead that fails is only a slower turn
      last = '';
    });
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, WARM_DELAY);
  };
  // a gesture under way pushes the read-ahead back until it ends
  const hold = () => {
    clearTimeout(timer);
    timer = null;
  };
  map.on('moveend', schedule);
  map.on('movestart', hold);
  return {
    dispose() {
      clearTimeout(timer);
      map.off('moveend', schedule);
      map.off('movestart', hold);
    },
  };
}
