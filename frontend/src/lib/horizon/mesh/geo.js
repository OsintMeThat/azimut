/**
 * The eye's frame and the tile grid's arithmetic, shared by the page and the
 * worker that builds the meshes.
 *
 * Every point of the ground is placed in one Cartesian frame centred on the eye
 * (east, north, up, metres), on the refraction-enlarged sphere engine/horizon.py
 * reads its elevations from: a point `d` metres away along the great circle at
 * bearing `b` sits at an angle d / R' round a sphere of radius R' = R / (1 − k).
 * So a ridge lands at the same azimuth and elevation here as in the app's march
 * (the skyline the names sit on, the strip), and the GPU only has to draw
 * straight lines between such points.
 */

export const RAD = Math.PI / 180;
/** engine/terrain.py EARTH_RADIUS, the mean radius. */
export const EARTH = 6371008.8;
/** engine/horizon.py REFRACTION_K. */
export const REFRACTION = 0.13;
/** Web Mercator's equator, metres. */
export const MERC = 40075016.686;
/** Pixels a terrain tile has a side (Mapterhorn, terrarium). */
export const DEM_TILE = 512;
/** The finest terrain the app serves (engine/terrain.py MAX_ZOOM). */
export const DEM_MAX = 14;

export const tileLon = (x, z) => (x / 2 ** z) * 360 - 180;
export const tileLat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) / RAD;
export const lonToX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
export function latToY(lat, z) {
  const s = Math.sin(lat * RAD);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
}

/** Terrarium pixels (RGBA) to heights in metres. */
export function terrarium(rgba, count) {
  const h = new Float32Array(count);
  for (let i = 0; i < count; i += 1) h[i] = rgba[4 * i] * 256 + rgba[4 * i + 1] + rgba[4 * i + 2] / 256 - 32768;
  return h;
}

/**
 * How high the eye stands above the sea over ground this high: a person or a
 * drone above the ground, an aircraft above the sea (engine/horizon.py
 * `Observer.altitude`), never under the ground.
 */
export function eyeAltitude(mode, height, ground) {
  return mode === 'aircraft' ? Math.max(height, ground + 1) : ground + height;
}

/**
 * The frame of an eye at `lat`, `lon`, `alt` metres above the sea.
 *
 * - `inverse(lat, lon)`: great-circle distance and initial bearing (radians) from the eye.
 * - `destination(bearing, d)`: the point `d` metres away at that bearing.
 * - `place(lat, lon, h, out, o)`: the point in the eye's frame, written at `out[o..o+2]`.
 * - `ground(x, y)`: the latitude and longitude under a point of the frame's
 *   level, its distance, and the angle round the enlarged sphere (for heights
 *   placed back).
 * - `locate(x, y, z)`: where any point of the frame stands, and how high.
 * - `up(h, delta)`: the height in the frame of ground `h` high at that angle.
 */
export function eyeFrame({ lat, lon, alt, k = REFRACTION }) {
  const R = EARTH / (1 - k);
  const phi = lat * RAD;
  const cos0 = Math.cos(phi);
  const sin0 = Math.sin(phi);

  function inverse(la, lo) {
    const p2 = la * RAD;
    const dl = (lo - lon) * RAD;
    const c2 = Math.cos(p2);
    const s2 = Math.sin(p2);
    const a = Math.sin((p2 - phi) / 2) ** 2 + cos0 * c2 * Math.sin(dl / 2) ** 2;
    const d = 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
    return [d, Math.atan2(Math.sin(dl) * c2, cos0 * s2 - sin0 * c2 * Math.cos(dl))];
  }

  function destination(bearing, d) {
    const ang = d / EARTH;
    const sa = Math.sin(ang);
    const ca = Math.cos(ang);
    const la = Math.asin(sin0 * ca + cos0 * sa * Math.cos(bearing));
    const lo = lon + Math.atan2(Math.sin(bearing) * sa * cos0, ca - sin0 * Math.sin(la)) / RAD;
    return [la / RAD, lo];
  }

  function place(la, lo, h, out, o) {
    const [d, b] = inverse(la, lo);
    const delta = d / R;
    const reach = R + h;
    const across = reach * Math.sin(delta);
    out[o] = across * Math.sin(b);
    out[o + 1] = across * Math.cos(b);
    out[o + 2] = reach * Math.cos(delta) - (R + alt);
  }

  function ground(x, y) {
    const delta = Math.asin(Math.min(1, Math.hypot(x, y) / R));
    const d = delta * R;
    const [la, lo] = destination(Math.atan2(x, y), d);
    return { lat: la, lon: lo, d, delta };
  }

  function locate(x, y, z) {
    const centre = z + R + alt;
    const delta = Math.atan2(Math.hypot(x, y), centre);
    const d = delta * R;
    const [la, lo] = destination(Math.atan2(x, y), d);
    return { lat: la, lon: lo, d, delta, h: Math.hypot(x, y, centre) - R };
  }

  const up = (h, delta) => (R + h) * Math.cos(delta) - (R + alt);

  return { lat, lon, alt, R, inverse, destination, place, ground, locate, up };
}
