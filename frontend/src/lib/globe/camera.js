/**
 * The globe's camera: an eye in space, never a point on the ground.
 *
 * The flat map's camera is a centre on the ground with a zoom, a tilt and a
 * turn, and the eye is wherever those put it: when the ground under the centre
 * changes height, the eye jumps. Here the eye is the camera. It stands at a
 * point of the Earth-centred frame (earth.js) and looks along a heading (degrees
 * clockwise from north) and a tilt (degrees from straight down), measured in the
 * frame of the ground under it. It has no roll: the horizon stays level.
 *
 * Every move is a rigid turn or a slide of that eye, so nothing the ground does
 * can move it. The view the rest of the app speaks of (a centre, a zoom, a turn
 * and a tilt) is read off the eye and the ground under the middle of the screen,
 * and a view handed in is turned into an eye once.
 *
 * The lens is the flat map's: the same vertical angle, so a view handed between
 * the two frames the same ground.
 */
import {
  CIRCUMFERENCE,
  EARTH,
  RAD,
  add,
  cross,
  dot,
  ecef,
  geodetic,
  length,
  localFrame,
  normalize,
  rotate,
  scale,
  sub,
  wrap360,
  wrapLon,
} from './earth.js';

/** The flat map's vertical field of view, degrees (its own default). */
export const FOV = 36.86989764584402;
/** The steepest tilt, degrees from straight down: the horizon, nearly level. */
export const MAX_TILT = 88;

/**
 * The steepest tilt an eye this many metres up may take and still look at the
 * Earth: short of the horizon by two degrees near the ground, and by more as it
 * rises, so a view seen from space keeps the globe in its middle.
 */
export function tiltCeiling(altitude) {
  const h = Math.max(0, altitude);
  const horizon = Math.asin(EARTH / (EARTH + h)) / RAD;
  const room = 2 + 10 * Math.min(1, Math.max(0, (h - 20000) / 2e6));
  return Math.max(0, Math.min(MAX_TILT, horizon - room));
}

/** Pixels from the eye to the screen, for a view this many CSS pixels tall. */
export const focalOf = (height) => height / 2 / Math.tan((FOV / 2) * RAD);

/**
 * The camera's own axes in the Earth-centred frame: where it looks
 * (`forward`), the screen's right and the screen's up.
 */
export function axes({ eye, heading, tilt }) {
  const { up, east, north } = localFrame(eye);
  const h = heading * RAD;
  const t = tilt * RAD;
  const level = add(scale(north, Math.cos(h)), scale(east, Math.sin(h)));
  const forward = add(scale(up, -Math.cos(t)), scale(level, Math.sin(t)));
  const right = sub(scale(east, Math.cos(h)), scale(north, Math.sin(h)));
  return { forward, right, up: cross(right, forward) };
}

/**
 * The way a camera faces over the ground in a frame, and its tilt there: the
 * level parts of where it looks and of the screen's up, added. Looking down,
 * the screen's up says it; toward the horizon, the line of sight does; and a
 * camera looking a little behind straight down keeps its heading, its tilt
 * then below zero.
 */
function facing(frame, forward, up) {
  const level = (v) => sub(v, scale(frame.up, dot(v, frame.up)));
  const f = normalize(forward);
  let way = add(level(f), level(normalize(up)));
  if (length(way) < 1e-12) way = level(normalize(up));
  way = normalize(way);
  return {
    heading: wrap360(Math.atan2(dot(way, frame.east), dot(way, frame.north)) / RAD),
    tilt: Math.atan2(dot(f, way), -dot(f, frame.up)) / RAD,
  };
}

/**
 * The camera an eye at `eye` has when it looks along `forward` with `up` toward
 * the top of the screen: the heading and tilt read in the frame under that eye,
 * any roll left out. A turn about the Earth's centre keeps a level camera level,
 * and one about a point near the eye leaves a roll too small to see.
 */
export function levelled(eye, forward, up) {
  return { eye: [...eye], ...facing(localFrame(eye), forward, up) };
}

/** The ray from the eye through a pixel of a view `size` ({ width, height }) CSS pixels big. */
export function rayAt(camera, size, x, y) {
  const { forward, right, up } = axes(camera);
  const f = focalOf(size.height);
  const dx = (x - size.width / 2) / f;
  const dy = (size.height / 2 - y) / f;
  return normalize(add(forward, add(scale(right, dx), scale(up, dy))));
}

/** Where a point of the frame falls on the screen, and how far ahead it is; null behind the eye. */
export function project(camera, size, point) {
  const { forward, right, up } = axes(camera);
  const v = sub(point, camera.eye);
  const depth = dot(v, forward);
  if (depth <= 0) return null;
  const f = focalOf(size.height);
  return {
    x: size.width / 2 + (dot(v, right) / depth) * f,
    y: size.height / 2 - (dot(v, up) / depth) * f,
    depth,
  };
}

/** Metres from the eye to the ground a flat view at this app zoom shows, at its centre. */
export function distanceFor(lat, zoom, height) {
  return (focalOf(height) * CIRCUMFERENCE * Math.cos(lat * RAD)) / (256 * 2 ** zoom);
}

/** …and the app zoom a view stood this far from its centre has. */
export function zoomFor(lat, distance, height) {
  return Math.log2((focalOf(height) * CIRCUMFERENCE * Math.cos(lat * RAD)) / (256 * Math.max(distance, 1e-3)));
}

/**
 * The eye that shows a view of the app's: `{ lat, lon }` in the middle of the
 * screen, `elevation` metres up (the ground's height there), from as far as the
 * flat map at `zoom` would be, turned by `bearing` (the app's, so the heading is
 * its opposite) and tilted by `pitch`.
 */
export function cameraFor({ lat, lon, zoom, bearing = 0, pitch = 0, elevation = 0 }, size) {
  const target = ecef(lat, lon, elevation ?? 0);
  const frame = localFrame(target);
  const h = wrap360(-(bearing ?? 0)) * RAD;
  const t = Math.min(MAX_TILT, Math.max(0, pitch ?? 0)) * RAD;
  const level = add(scale(frame.north, Math.cos(h)), scale(frame.east, Math.sin(h)));
  const forward = add(scale(frame.up, -Math.cos(t)), scale(level, Math.sin(t)));
  const screenUp = add(scale(frame.up, Math.sin(t)), scale(level, Math.cos(t)));
  const eye = sub(target, scale(forward, distanceFor(lat, zoom, size.height)));
  return levelled(eye, forward, screenUp);
}

/**
 * The view of the app's a camera shows, read at `target`, the ground under the
 * middle of the screen: its place and height, the zoom the flat map would need
 * to frame it from as far, and the turn and tilt seen from there.
 */
export function viewOf(camera, size, target) {
  const at = geodetic(target);
  const { forward, up } = axes(camera);
  const { heading, tilt } = facing(localFrame(target), forward, up);
  return {
    lat: at.lat,
    lon: wrapLon(at.lon),
    zoom: zoomFor(at.lat, length(sub(camera.eye, target)), size.height),
    bearing: wrap360(-heading),
    // the flat map has no tilt behind straight down
    pitch: Math.max(0, tilt),
    elevation: at.h,
  };
}

/** The camera turned rigidly by `angle` radians about the unit `axis` through `origin`. */
export function turned(camera, origin, axis, angle) {
  const { forward, up } = axes(camera);
  const eye = add(origin, rotate(sub(camera.eye, origin), axis, angle));
  return levelled(eye, rotate(forward, axis, angle), rotate(up, axis, angle));
}

/**
 * The turn about the Earth's centre that brings the ground point `from` to
 * `to`, both on one sphere about it: what keeps a grabbed point under the hand.
 * Null when they are the same point.
 */
export function turnBetween(from, to) {
  const axis = cross(from, to);
  const sin = length(axis);
  if (sin < 1e-12 * length(from) * length(to)) return null;
  const angle = Math.atan2(sin, dot(from, to));
  return { axis: scale(axis, 1 / sin), angle };
}

/**
 * The camera swung about a `pivot` on the ground: `dHeading` degrees round it
 * (clockwise from above turns the view right) and `dTilt` degrees toward the
 * horizon, the tilt as seen at the pivot kept within `[0, MAX_TILT]`.
 */
export function orbit(camera, pivot, dHeading, dTilt) {
  const { up } = localFrame(pivot);
  let next = camera;
  if (dHeading) next = turned(next, pivot, up, -dHeading * RAD);
  if (dTilt) {
    const { forward, right } = axes(next);
    const now = Math.acos(Math.max(-1, Math.min(1, -dot(forward, up)))) / RAD;
    const wanted = Math.min(MAX_TILT, Math.max(0, now + dTilt));
    if (Math.abs(wanted - now) > 1e-9) next = turned(next, pivot, right, (wanted - now) * RAD);
  }
  return next;
}

/** The eye slid along the line to `target`: `share` of the way there, below 0 backing off. */
export function dolly(camera, target, share) {
  const { forward, up } = axes(camera);
  const eye = add(camera.eye, scale(sub(target, camera.eye), share));
  return levelled(eye, forward, up);
}

/**
 * The camera turned where it stands, heading and tilt only, so that `point`
 * falls on pixel (x, y).
 *
 * A move that keeps the line of sight (`dolly`) or swings round a point
 * (`orbit`) keeps that point on its pixel only until the roll is levelled out
 * again, which turns the picture a little about its middle; seen from far off,
 * a lot. A few Newton steps on the heading and the tilt bring it back, under a
 * hundredth of a pixel. A point in the very middle needs none.
 */
export function aimed(camera, size, point, x, y) {
  const miss = (c) => {
    const at = project(c, size, point);
    return at ? Math.hypot(x - at.x, y - at.y) : Infinity;
  };
  let next = camera;
  const step = 1e-4;
  for (let round = 0; round < 6; round += 1) {
    const at = project(next, size, point);
    if (!at) break;
    const ex = x - at.x;
    const ey = y - at.y;
    if (Math.hypot(ex, ey) < 1e-3) break;
    const byHeading = project({ ...next, heading: next.heading + step }, size, point);
    const byTilt = project({ ...next, tilt: next.tilt + step }, size, point);
    if (!byHeading || !byTilt) break;
    const a = (byHeading.x - at.x) / step;
    const c = (byHeading.y - at.y) / step;
    const b = (byTilt.x - at.x) / step;
    const d = (byTilt.y - at.y) / step;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-9) break;
    // a step of a few degrees at most: the correction is small, and a wild one is a wrong one
    const clampStep = (v) => Math.max(-5, Math.min(5, v));
    next = {
      eye: next.eye,
      heading: wrap360(next.heading + clampStep((ex * d - b * ey) / det)),
      tilt: next.tilt + clampStep((a * ey - c * ex) / det),
    };
  }
  // never worse than the move alone
  return miss(next) <= miss(camera) ? next : camera;
}

/** The eye raised or lowered straight up by `metres`, the way it looks kept. */
export function lifted(camera, metres) {
  const { forward, up } = axes(camera);
  const eye = add(camera.eye, scale(normalize(camera.eye), metres));
  return levelled(eye, forward, up);
}
