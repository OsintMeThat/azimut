/**
 * The ground the Horizon tab points at, and the instruments it reads
 * directions on: the azimuth ruler and its heading caret, the elevation scale
 * and the level line.
 *
 * Distances are on the same sphere as the app's horizon (engine/terrain.py,
 * mean radius), so a point clicked on the picture lands on the map where the
 * app's own march met the ground.
 */
import { rayFor, toScreen, verticalFov } from './camera.js';
import { skylineAt, wrap360 } from './panorama.js';

const EARTH = 6371008.8;
const RAD = Math.PI / 180;

/** The point `metres` from `from` along `azimuth` degrees, on the sphere. */
export function groundPoint(from, azimuth, metres) {
  const delta = metres / EARTH;
  const phi = from.lat * RAD;
  const theta = azimuth * RAD;
  const sinPhi2 = Math.sin(phi) * Math.cos(delta) + Math.cos(phi) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.min(1, Math.max(-1, sinPhi2)));
  const lambda =
    from.lon * RAD +
    Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi), Math.cos(delta) - Math.sin(phi) * sinPhi2);
  return { lat: phi2 / RAD, lon: (((lambda / RAD + 540) % 360) + 360) % 360 - 180 };
}

/** Great-circle distance in metres. */
export function distanceBetween(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** How far the other map tabs must look from the eye before Horizon offers to stand there, in metres. */
export const AWAY_M = 1500;

/**
 * Where the other map tabs look (`uiState.mapView`), once another of them or
 * the chain left it more than `AWAY_M` from the eye: `{ lat, lon, zoom,
 * metres }`, else null. Horizon offers to move there; its eye never follows
 * by itself.
 */
export function elsewhere(shared, eye) {
  if (!shared || !eye || shared.by === 'horizon') return null;
  if (!Number.isFinite(shared.lat) || !Number.isFinite(shared.lon)) return null;
  const metres = distanceBetween(eye, shared);
  return metres > AWAY_M ? { lat: shared.lat, lon: shared.lon, zoom: shared.zoom, metres } : null;
}

/** Initial bearing from `a` to `b`, degrees clockwise from north. */
export function bearingBetween(a, b) {
  const p1 = a.lat * RAD;
  const p2 = b.lat * RAD;
  const dl = (b.lon - a.lon) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return wrap360(Math.atan2(y, x) / RAD);
}

/**
 * What the lens takes in, drawn on the map: the eye, then the skyline's ground
 * across the field of view. Where the horizon is far, the shape is long; where
 * a ridge stands close, it stops there, and in thick air it stops where the
 * air does (`limit`, metres), which is the honest picture of what the camera
 * can see.
 *
 * @returns {{lat:number, lon:number}[]} a closed fan, the eye first
 */
export function footprint(observer, panorama, { heading, fov }, { step = 1, limit = Infinity } = {}) {
  if (!observer || !panorama) return [];
  const span = Math.min(fov, 360);
  const count = Math.max(2, Math.ceil(span / step) + 1);
  const points = span >= 360 ? [] : [{ lat: observer.lat, lon: observer.lon }];
  for (let i = 0; i < count; i += 1) {
    const azimuth = wrap360(heading - span / 2 + (span * i) / (count - 1));
    const column = Math.round(wrap360(azimuth - panorama.azimuth.start) / panorama.azimuth.step) % panorama.azimuth.count;
    const reach = Math.min(panorama.skylineDistance?.[column] ?? panorama.far, limit);
    if (skylineAt(panorama, azimuth) == null) continue;
    points.push(groundPoint(observer, azimuth, reach));
  }
  return points;
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** N, NE, E… for the eight compass points, else null. */
export function cardinal(azimuth) {
  const turn = wrap360(Math.round(azimuth * 1000) / 1000);
  return turn % 45 === 0 ? CARDINALS[turn / 45] : null;
}

/** The nearest of the eight winds, for any direction: 212° is SW. */
export function windOf(azimuth) {
  return CARDINALS[Math.round(wrap360(azimuth) / 45) % 8];
}

/**
 * A heading as somebody types it: "212", "212.5°", or one of the eight winds
 * ("sw"). Null for anything else.
 */
export function parseHeading(text) {
  const typed = String(text ?? '').trim().replace(/°$/, '').trim();
  const wind = CARDINALS.indexOf(typed.toUpperCase());
  if (wind >= 0) return wind * 45;
  if (!/^-?\d+(\.\d+)?$/.test(typed)) return null;
  return wrap360(Number(typed));
}

/** A direction as the caret and the readouts say it: "95° E", a decimal under 10° of lens. */
export function headingText(azimuth, fov = 60) {
  const decimals = fov > 10 ? 0 : 1;
  const value = Number(wrap360(azimuth).toFixed(decimals));
  return `${(value >= 360 ? 0 : value).toFixed(decimals)}° ${windOf(azimuth)}`;
}

/**
 * The camera change that faces a direction: the heading always, the tilt only
 * when the direction lies out of the frame's height, so turning to a point
 * near the horizon keeps the view level.
 */
export function faceTowards(camera, { azimuth, elevation }) {
  const half = verticalFov(camera) / 2;
  const tilt = Number.isFinite(elevation) && Math.abs(elevation - camera.tilt) > half * 0.8 ? elevation : camera.tilt;
  return { heading: azimuth, tilt };
}

/** The part of the segment a→b inside the frame, or null when none of it is. */
function clipToFrame(a, b, width, height) {
  let t0 = -Infinity;
  let t1 = Infinity;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x],
    [dx, width - a.x],
    [-dy, a.y],
    [dy, height - a.y],
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
    } else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  if (!(t0 < t1) || !Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return { x1: a.x + t0 * dx, y1: a.y + t0 * dy, x2: a.x + t1 * dx, y2: a.y + t1 * dy };
}

/**
 * Where the level (elevation 0) crosses the frame, as a segment, or null. In
 * a photo the level is a great circle, so a straight line: two of its points
 * give it, rolled or not. In the strip it is a row.
 */
export function levelLine(camera) {
  const { width, height } = camera;
  if (!(width > 0 && height > 0)) return null;
  const a = toScreen(camera, camera.heading - 5, 0);
  const b = toScreen(camera, camera.heading + 5, 0);
  if (!a.visible || !b.visible) return null;
  const far = 4 * (width + height);
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  return clipToFrame(
    { x: a.x - ux * far, y: a.y - uy * far },
    { x: a.x + ux * far, y: a.y + uy * far },
    width,
    height
  );
}

/** Steps the elevation scale may count in, and how close two of its labels may sit. */
const SCALE_STEPS = [1, 2, 5, 10, 15, 30];
const SCALE_GAP = 40;

/**
 * The elevation scale down the frame's left edge: the finest step that keeps
 * its labels `SCALE_GAP` pixels apart, so every 5° through an ordinary lens,
 * every 1° through a telephoto and every 10° down a tall strip. Each tick sits
 * where that elevation crosses the edge (found by halving, so a tilted or
 * rolled lens still reads true). Level itself is left to the level line,
 * which carries its own "0°".
 *
 * @returns {{ elevation: number, y: number, label: string }[]}
 */
export function elevationTicks(camera, { x = 0, margin = 8 } = {}) {
  const { width, height } = camera;
  if (!(width > 0 && height > 0)) return [];
  const top = rayFor(camera, x, 0).elevation;
  const bottom = rayFor(camera, x, height).elevation;
  if (!(top > bottom)) return [];
  const perDegree = height / verticalFov(camera);
  const step = SCALE_STEPS.find((each) => each * perDegree >= SCALE_GAP) ?? SCALE_STEPS.at(-1);
  const ticks = [];
  for (let k = Math.ceil(bottom / step); k * step <= top; k += 1) {
    const elevation = k * step;
    if (k === 0) continue;
    let low = 0;
    let high = height;
    for (let i = 0; i < 24; i += 1) {
      const middle = (low + high) / 2;
      if (rayFor(camera, x, middle).elevation > elevation) low = middle;
      else high = middle;
    }
    const y = (low + high) / 2;
    if (y < margin || y > height - margin) continue;
    ticks.push({ elevation, y, label: `${elevation > 0 ? '+' : '\u2212'}${Math.abs(elevation)}°` });
  }
  return ticks;
}

/** Steps a ruler may count in, finest first. */
const RULER_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 45, 90];

/**
 * Ticks for the azimuth ruler under the view, left to right.
 *
 * Each sits where its direction crosses the view's middle row, so in a lens
 * that looks up or down the ruler still reads the direction straight above it.
 * The step is the finest that keeps labels `minGap` pixels apart; a tick on a
 * compass point is named. A tick within `clear` pixels of the middle keeps its
 * mark and loses its label, which the heading caret stands over.
 */
export function azimuthTicks(camera, { minGap = 72, clear = 0 } = {}) {
  const { width, height } = camera;
  if (!(width > 0 && height > 0)) return [];
  const middle = height / 2;
  const left = rayFor(camera, 0, middle).azimuth;
  const right = rayFor(camera, width, middle).azimuth;
  let span = wrap360(right - left);
  if (camera.projection === 'panorama' && camera.fov >= 360) span = 360;
  const perPixel = Math.max(span, 1e-6) / width;
  const step = RULER_STEPS.find((candidate) => candidate / perPixel >= minGap) ?? 90;
  const ticks = [];
  const seen = new Set();
  const first = Math.ceil(left / step) * step;
  for (let k = 0; k * step <= span + 1e-9; k += 1) {
    const azimuth = wrap360(Math.round((first + k * step) * 1e6) / 1e6);
    // a whole turn starts and ends on the same direction: one tick for it
    if (seen.has(azimuth)) continue;
    seen.add(azimuth);
    // measured clockwise from the left edge: a strip's span runs past half a turn
    const off = wrap360(azimuth - left);
    if (off > span + 1e-9) continue;
    const at = toScreen(camera, azimuth, camera.tilt);
    if (!at.visible || at.x < -1 || at.x > width + 1) continue;
    const named = cardinal(azimuth);
    const decimals = step < 1 ? 1 : 0;
    ticks.push({
      azimuth,
      x: at.x,
      label: Math.abs(at.x - width / 2) < clear ? '' : named ?? `${Number(azimuth.toFixed(decimals))}°`,
      named: Boolean(named),
    });
  }
  return ticks;
}
