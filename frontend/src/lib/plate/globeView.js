/**
 * A plate's map drawn in 3D on the app's globe (`lib/globe`): what it is handed
 * and what it hands back, in the plate's own terms.
 *
 * A plate keeps its view as the flat engine reads one (`PlateMap.cameraOf`): the
 * engine's zoom, a level under the app's, and its bearing, turned the other way.
 * The globe takes and gives the app's. The plate's plain grounds are drawn by the
 * globe itself where it has no picture: their colour, their heights tinted, and
 * their relief shaded (`plainBasemap.js`), the roads, water and names laid over
 * them as the flat map draws them.
 *
 * Pure, so the conversions are read off a test.
 */
import { groundStyle, paletteOf, present, shadeStrength, TINTS } from './plainBasemap.js';

/** The page's own colour under a map, where imagery is faded or not yet in. */
export const PAGE_GROUND = '#e9e6df';

/** A bearing in degrees, between -180 (excluded) and 180. */
const turn = (deg) => {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
};

/** A plate's view as the globe takes a camera. */
export function globeCamera(view) {
  return { lat: view.lat, lon: view.lon, zoom: view.zoom + 1, bearing: turn(-(view.bearing ?? 0)), pitch: view.pitch ?? 0 };
}

/** The globe's camera, and its unrounded zoom, as a plate keeps a view. */
export function plateView(camera, zoom) {
  return { lat: camera.lat, lon: turn(camera.lon), zoom: zoom - 1, bearing: turn(-(camera.bearing ?? 0)), pitch: camera.pitch ?? 0 };
}

/**
 * The ground the globe draws where it has no picture, for a plate's ground: a
 * plain one in its colours, tints and shading, or under imagery the page's own
 * colour, which a faded picture shows through.
 */
export function globeGround(basemap, { plain = {}, shaded = false, intensity = 1 } = {}) {
  const ground = basemap || 'plain';
  if (!ground.startsWith('plain')) return { colour: PAGE_GROUND, shade: 0 };
  const style = groundStyle(ground);
  const colours = present(paletteOf(style.palette, plain.colours), plain.presence);
  // the flat map's hillshade exaggeration (`showPlain`), read on the globe's own light
  const strength = shadeStrength(ground, { shaded, intensity });
  return {
    colour: colours.ground,
    tints: style.tints && plain.tints !== false ? TINTS[style.tints] : null,
    tintOpacity: 0.85,
    shade: Math.min(1, strength * 1.6),
  };
}

/** Eased in and out, as a camera flight starts and lands. */
export const eased = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** A view part of the way `t` (0 to 1) from `a` to `b`, turning the short way round. */
export function between(a, b, t) {
  const lerp = (x, y) => x + (y - x) * t;
  return {
    lat: lerp(a.lat, b.lat),
    lon: lerp(a.lon, a.lon + turn(b.lon - a.lon)),
    zoom: lerp(a.zoom, b.zoom),
    bearing: turn(lerp(a.bearing ?? 0, (a.bearing ?? 0) + turn((b.bearing ?? 0) - (a.bearing ?? 0)))),
    pitch: lerp(a.pitch ?? 0, b.pitch ?? 0),
  };
}
