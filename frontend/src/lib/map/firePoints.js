/**
 * FIRMS detections, drawn by the map from vector tiles (`engine/firmspoints.py`).
 *
 * A picture of squares is stretched with its pixels until the next picture of
 * the zoom lands, so every square swelled and snapped back at each level, or
 * had to be hidden while it did. Drawn by the map, a mark keeps its size on
 * screen through a zoom and stays where it is while the next tiles come, and
 * grows only once the ground it stands for is bigger than it: `MARK_PX` far
 * out, the pixel FIRMS measured close in.
 *
 * Every zoom and every question comes this way. Close in, the tiles carry
 * footprints with the marks, and across `HANDOVER` the marks give way to them,
 * each with its own ring and edge and the ground showing inside. A rolling
 * window's come from the detections themselves; far out, and for a dated
 * range, the backend reads the marks off FIRMS's own picture of the tile, and
 * close in gives each one a square of the sensor's footprint.
 */

/** The shallowest zoom whose tiles carry the detections themselves, and the
 *  deepest tile there is, as the backend serves them. */
export const POINTS_MIN_ZOOM = 8;
export const POINTS_MAX_ZOOM = 13;
/** The smallest a detection is drawn, on screen: the size FIRMS's pictures use. */
export const MARK_PX = 7;
/** Web Mercator metres under one pixel at zoom 0, on the map's 512 px world. */
const METRES_PER_PX_AT_ZERO = (2 * 20037508.342789244) / 512;
/** The zooms over which the marks fade out and the footprints in. */
export const HANDOVER = [11.5, 12];
/** The deepest zoom a mark's size is worked out for; it is gone by then. */
const LAST_SIZED_ZOOM = 14;

/** The colours of `engine/firms.py`: FIRMS's "24 h" red over the rest in amber. */
const RECENT = '#ff3000';
const EARLIER = '#ffba00';
const RING = 'rgba(24, 12, 6, 0.86)';
const RING_PX = 2;
const colour = ['case', ['==', ['get', 'recent'], 1], RECENT, EARLIER];

/** The one image the marks are drawn with, tinted to either colour. */
export const SQUARE = 'firms-square';

/**
 * The tiles' format, in their address. The browser keeps a past range's tiles
 * for hours, so after a change to what a tile carries the old ones would come
 * back from its cache beside the new. Raise it with any such change.
 */
export const TILE_REVISION = '2';

/** Where the tiles of one question are asked: its sensor and window, and a
 *  dated range's days (`firms.js` `tileParams`). */
export function marksUrl(params = {}) {
  return `/api/firms/points/{z}/{x}/{y}?${new URLSearchParams({ ...params, v: TILE_REVISION })}`;
}

/**
 * How big a mark is drawn, as an `icon-size`: its footprint on screen, never
 * under `MARK_PX`. `side` is the footprint's side in Mercator metres, so its
 * pixels double with every zoom. A stop every half zoom keeps that exact, and
 * the bend where the footprint outgrows the mark within a tenth of a pixel.
 */
export function markSize() {
  const stops = [];
  for (let zoom = 0; zoom <= LAST_SIZED_ZOOM; zoom += 0.5) {
    stops.push(zoom, ['max', 1, ['*', ['get', 'side'], 2 ** zoom / METRES_PER_PX_AT_ZERO / MARK_PX]]);
  }
  return ['interpolate', ['exponential', 2], ['zoom'], ...stops];
}

const fadeIn = (top) => ['interpolate', ['linear'], ['zoom'], HANDOVER[0], 0, HANDOVER[1], top];

/**
 * The style: footprints under the marks, which fade out over them where a
 * footprint came with the mark (`foot`), and stay where none did.
 *
 * A footprint's ring sits just outside it and its edge just inside, both
 * offsets from a ring the tile writes clockwise, which is outward to the left.
 * Every fill is drawn before any edge, so an edge under another square still
 * shows. Red is drawn over amber in each layer.
 */
export const POINT_LAYERS = [
  {
    id: 'foot-fill',
    type: 'fill',
    source: 'marks',
    'source-layer': 'footprints',
    minzoom: HANDOVER[0],
    layout: { 'fill-sort-key': ['get', 'recent'] },
    paint: { 'fill-color': colour, 'fill-opacity': fadeIn(0.35), 'fill-antialias': false },
  },
  {
    id: 'foot-ring',
    type: 'line',
    source: 'marks',
    'source-layer': 'footprints',
    minzoom: HANDOVER[0],
    paint: { 'line-color': RING, 'line-width': RING_PX, 'line-offset': -RING_PX / 2, 'line-opacity': fadeIn(1) },
  },
  {
    id: 'foot-edge',
    type: 'line',
    source: 'marks',
    'source-layer': 'footprints',
    minzoom: HANDOVER[0],
    layout: { 'line-sort-key': ['get', 'recent'] },
    paint: { 'line-color': colour, 'line-width': 2, 'line-offset': 1, 'line-opacity': fadeIn(1) },
  },
  {
    id: 'mark',
    type: 'symbol',
    source: 'marks',
    'source-layer': 'marks',
    layout: {
      'icon-image': SQUARE,
      'icon-size': markSize(),
      // every detection is drawn: a fire hidden behind another is still a fire
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      // squares of ground, so they turn and tilt with it
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'symbol-sort-key': ['get', 'recent'],
    },
    paint: {
      'icon-color': colour,
      'icon-halo-color': RING,
      'icon-halo-width': RING_PX,
      'icon-opacity': ['interpolate', ['linear'], ['zoom'],
        HANDOVER[0], 1, HANDOVER[1], ['case', ['==', ['get', 'foot'], 1], 0, 1]],
    },
  },
];

/**
 * The square as a signed distance field: MapLibre reads alpha 0.75 as the
 * edge and an eighth less per pixel outwards, which is what lets one image take
 * either colour and a ring (`icon-halo-*`) of any width up to `spread`.
 */
export function squareImage(side = MARK_PX, spread = 4) {
  const size = side + 2 * spread;
  const data = new Uint8ClampedArray(size * size * 4);
  const half = side / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const qx = Math.abs(x + 0.5 - size / 2) - half;
      const qy = Math.abs(y + 0.5 - size / 2) - half;
      const distance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
      const at = (y * size + x) * 4;
      data[at] = data[at + 1] = data[at + 2] = 255;
      data[at + 3] = Math.round(Math.min(1, Math.max(0, 0.75 - distance / 8)) * 255);
    }
  }
  return { width: size, height: size, data };
}

/** The FIRMS overlay's vector style (`basemap.js`): one source, asked the question. */
export const FIRE_MARKS = {
  sources: (params) => ({ marks: marksUrl(params) }),
  maxZoom: POINTS_MAX_ZOOM,
  layers: POINT_LAYERS,
  images: [[SQUARE, squareImage, { sdf: true }]],
};
