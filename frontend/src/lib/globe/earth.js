/**
 * The Earth the globe is drawn on, and the arithmetic of points on it.
 *
 * One frame for everything: Earth-centred, Earth-fixed (ECEF) metres, x toward
 * lon 0 on the equator, y toward lon 90° E, z toward the north pole. The Earth
 * is the sphere of the app's mean radius, the one engine/terrain.py measures on
 * and the flat map counts its zoom by, so a view handed between the two lands
 * at the same scale. Heights are metres above it.
 *
 * Vectors are plain three-element arrays of doubles: the camera and the tiles'
 * centres live here at full precision, and only what is relative to the eye
 * reaches the GPU in single floats.
 */

export const RAD = Math.PI / 180;
/** engine/terrain.py EARTH_RADIUS, and the flat map's earth radius. */
export const EARTH = 6371008.8;
/** The flat map counts zoom on 256 px tiles of this circumference (facade.js `viewZoom`). */
export const CIRCUMFERENCE = 2 * Math.PI * EARTH;
/** Web Mercator's last latitude: the tile grid stops here. */
export const MERC_LAT = 85.0511287798066;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export function normalize(a) {
  const l = length(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

/** A point `h` metres above the sphere at a latitude and longitude, in degrees. */
export function ecef(lat, lon, h = 0) {
  const r = EARTH + h;
  const p = lat * RAD;
  const l = lon * RAD;
  const c = Math.cos(p);
  return [r * c * Math.cos(l), r * c * Math.sin(l), r * Math.sin(p)];
}

/** Where a point stands: latitude and longitude in degrees, height above the sphere. */
export function geodetic(v) {
  const r = length(v);
  return {
    lat: r > 0 ? Math.asin(Math.max(-1, Math.min(1, v[2] / r))) / RAD : 0,
    lon: Math.atan2(v[1], v[0]) / RAD,
    h: r - EARTH,
  };
}

/** Up, east and north at a point of the frame, unit vectors. East is taken as x past the poles. */
export function localFrame(v) {
  const up = normalize(v);
  const flat = Math.hypot(up[0], up[1]);
  const east = flat > 1e-12 ? [-up[1] / flat, up[0] / flat, 0] : [0, 1, 0];
  return { up, east, north: cross(up, east) };
}

/**
 * `v` turned by `angle` radians about the unit `axis` through the origin
 * (Rodrigues), right-handed.
 */
export function rotate(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = dot(axis, v) * (1 - c);
  const x = cross(axis, v);
  return [v[0] * c + x[0] * s + axis[0] * k, v[1] * c + x[1] * s + axis[1] * k, v[2] * c + x[2] * s + axis[2] * k];
}

/**
 * Where a ray first meets a sphere about the Earth's centre: the distance
 * along it, or null when it misses or the sphere is behind. From inside the
 * sphere, the way out.
 */
export function raySphere(origin, dir, radius) {
  const b = dot(origin, dir);
  const c = dot(origin, origin) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const near = -b - root;
  if (near > 0) return near;
  const far = -b + root;
  return far > 0 ? far : null;
}

/** Great-circle distance in metres between two points in degrees. */
export function haversine(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A longitude back inside ±180. */
export const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** 0–360. */
export const wrap360 = (deg) => ((deg % 360) + 360) % 360;

/** Metres a CSS pixel spans at the centre of a flat view at this app zoom (256 px tiles). */
export const metresPerPixel = (lat, zoom) => (CIRCUMFERENCE * Math.cos(lat * RAD)) / (256 * 2 ** zoom);
