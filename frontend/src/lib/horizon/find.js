/**
 * Find where a photo was taken: the area searched and the alignments that
 * narrow it, worked out in the browser.
 *
 * The area is a polygon the analyst draws on the map. An **alignment** is two
 * things that stand one behind the other in the photo (a mast in front of a
 * peak, a building's corner against a ridge), clicked on the photo and then on
 * the map: seen from above, the camera stands on the line through them, on the
 * near one's side. Two alignments cross where the photo was taken; one already
 * says which way the photo faces.
 *
 * The two may not stand exactly one behind the other in the photo. When the
 * lens is known, how far apart they stand across it is an angle, and the line
 * turns about the near one by it: exact when the far one is far beyond the near
 * one, which is when an alignment says the most. Each line has a tolerance,
 * drawn as a narrow wedge, for the clicks and the maps being a little off.
 *
 * Everything here is a plain function of plain data, so the panel, the map and
 * the search read the same lines.
 */
import { bearingBetween } from './geometry.js';
import { containsPoint, destination, haversine, polygonArea } from '../measure.js';

/** Degrees either side of an alignment's line the camera may stand, by default. */
export const ALIGN_TOLERANCE = 1;

/** The tolerances the settings offer, degrees either side. */
export const ALIGN_TOLERANCES = [0.5, 1, 2, 4];

/** How far behind its near point an alignment's line is drawn, metres. */
export const ALIGN_REACH = 40_000;

/** Two lines meeting at less than this angle cross too far out to say where. */
export const CROSSING_MIN_ANGLE = 4;

/** The colours alignments take in turn, on the photo and on the map alike. */
export const ALIGN_COLOURS = ['#4dd6ff', '#ff7ad9', '#9be564', '#ffb547', '#b69cff', '#ff6b6b'];

/** The guided clicks that make an alignment, in order. */
export const ALIGN_STEPS = [
  { on: 'photo', end: 'near', text: 'On the photo, click something near' },
  { on: 'photo', end: 'far', text: 'On the photo, click what stands right behind it' },
  { on: 'map', end: 'near', text: 'On the map, click the near one' },
  { on: 'map', end: 'far', text: 'On the map, click the far one' },
];

/** The least area worth searching, and the most, in square metres. */
/**
 * A reach the analyst gives is searched about that far (engine/finder.py
 * `reaches`): cut there, and on to twice as far within Auto's farthest, so a
 * ridge just past it still counts. How far the search then reads, metres.
 */
export const REACH_PAST = 2;
export const searchedReach = (reach, auto = 50_000) => Math.max(reach, Math.min(reach * REACH_PAST, auto));

export const AREA_MIN = 0.01e6;
export const AREA_MAX = 2_500e6;

const RAD = Math.PI / 180;

/** Metres east and north of `origin`, on the plane touching the Earth there. */
export function local(origin, point) {
  const x = (point.lon - origin.lon) * RAD * 6_371_008.8 * Math.cos(origin.lat * RAD);
  const y = (point.lat - origin.lat) * RAD * 6_371_008.8;
  return { x, y };
}

/** The point `{ x, y }` metres east and north of `origin`. */
export function fromLocal(origin, { x, y }) {
  return {
    lat: origin.lat + y / (RAD * 6_371_008.8),
    lon: origin.lon + x / (RAD * 6_371_008.8 * Math.cos(origin.lat * RAD)),
  };
}

/** Whether the polygon can be searched: three corners at least, and an area within reason. */
export function areaProblem(points) {
  if (!points || points.length < 3) return 'Draw at least three corners';
  const m2 = polygonArea(points);
  if (m2 < AREA_MIN) return 'The area is too small to search';
  if (m2 > AREA_MAX) return `The area is too large: keep it under ${Math.round(AREA_MAX / 1e6)} km²`;
  return '';
}

/** The polygon's size in words: "12 × 9 km · 87 km²". */
export function areaText(points) {
  if (!points || points.length < 3) return '';
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const middle = (Math.min(...lats) + Math.max(...lats)) / 2;
  const wide = haversine({ lat: middle, lon: Math.min(...lons) }, { lat: middle, lon: Math.max(...lons) });
  const tall = haversine({ lat: Math.min(...lats), lon: lons[0] }, { lat: Math.max(...lats), lon: lons[0] });
  const km = (m) => (m < 10_000 ? (m / 1000).toFixed(1) : String(Math.round(m / 1000)));
  const m2 = polygonArea(points);
  const area = m2 < 1e6 ? `${(m2 / 1e6).toFixed(2)} km²` : `${Math.round(m2 / 1e6)} km²`;
  return `${km(wide)} × ${km(tall)} km · ${area}`;
}

/** Whether a point lies in the area. */
export function inArea(points, point) {
  return containsPoint(points, point);
}

/**
 * How far across the photo two clicks may stand, as a share of its width, and
 * still be read as one above the other when its lens is unknown: a hand's
 * click is never on the very same column.
 */
export const LINED_UP_SHARE = 0.01;

/**
 * How many degrees right of the near point the far one stands across the
 * photo, read through its lens; null when the lens is unknown and they do not
 * stand one above the other (within `LINED_UP_SHARE` of its width). `near` and
 * `far` are `{ u, v }` across and down the photo, `fov` its width in degrees,
 * `projection` the view's.
 */
export function photoOffset(near, far, { fov = null, projection = 'camera' } = {}) {
  const across = (far.u - near.u) * 2;
  if (Math.abs(across) < 1e-9) return 0;
  if (!(fov > 0)) return Math.abs(far.u - near.u) <= LINED_UP_SHARE ? 0 : null;
  if (projection === 'panorama') return (across * fov) / 2;
  const t = Math.tan((fov * RAD) / 2);
  const toNear = Math.atan((near.u * 2 - 1) * t) / RAD;
  const toFar = Math.atan((far.u * 2 - 1) * t) / RAD;
  return toFar - toNear;
}

/**
 * The bearing from the near point along which the camera stands: away from the
 * far one, turned by how far apart the two stand across the photo.
 */
export function alignmentBearing(alignment) {
  const { near, far } = alignment.map;
  const offset = Number.isFinite(alignment.offset) ? alignment.offset : 0;
  return (((bearingBetween(near, far) + 180 - offset) % 360) + 360) % 360;
}

/** The line the camera stands on: from the near point out to `reach` metres behind it. */
export function alignmentLine(alignment, reach = ALIGN_REACH) {
  const { near } = alignment.map;
  return [near, destination(near, alignmentBearing(alignment), reach)];
}

/** The wedge `tolerance` degrees either side of the line. */
export function alignmentWedge(alignment, tolerance = ALIGN_TOLERANCE, reach = ALIGN_REACH) {
  const { near } = alignment.map;
  const bearing = alignmentBearing(alignment);
  return [near, destination(near, bearing - tolerance, reach), destination(near, bearing + tolerance, reach)];
}

/** Whether a point lies within an alignment's wedge, on its camera side. */
export function onAlignment(alignment, point, tolerance = ALIGN_TOLERANCE) {
  const { near } = alignment.map;
  if (haversine(near, point) < 1) return true;
  const off = (((bearingBetween(near, point) - alignmentBearing(alignment)) % 360) + 540) % 360 - 180;
  return Math.abs(off) <= tolerance;
}

/** Where two alignments' lines cross, or null: parallel, too shallow to say, or behind either near point. */
export function crossing(a, b) {
  const origin = a.map.near;
  const p = local(origin, a.map.near);
  const q = local(origin, b.map.near);
  const da = direction(alignmentBearing(a));
  const db = direction(alignmentBearing(b));
  const across = da.x * db.y - da.y * db.x;
  if (Math.abs(across) < Math.sin(CROSSING_MIN_ANGLE * RAD)) return null;
  const t = ((q.x - p.x) * db.y - (q.y - p.y) * db.x) / across;
  const s = ((q.x - p.x) * da.y - (q.y - p.y) * da.x) / across;
  if (t < 0 || s < 0) return null;
  return fromLocal(origin, { x: p.x + t * da.x, y: p.y + t * da.y });
}

function direction(bearing) {
  return { x: Math.sin(bearing * RAD), y: Math.cos(bearing * RAD) };
}

/**
 * Where all the alignments meet best: the point nearest every line (least
 * squares on the plane), and how far it lies from them, the spread, in metres.
 * Null with fewer than two that cross.
 */
export function meeting(alignments) {
  if (!alignments || alignments.length < 2) return null;
  const pairs = [];
  for (let i = 0; i < alignments.length; i += 1) {
    for (let j = i + 1; j < alignments.length; j += 1) {
      const at = crossing(alignments[i], alignments[j]);
      if (at) pairs.push(at);
    }
  }
  if (!pairs.length) return null;
  const origin = alignments[0].map.near;
  // the normal equations of the distances to each line
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b1 = 0;
  let b2 = 0;
  const lines = alignments.map((alignment) => {
    const p = local(origin, alignment.map.near);
    const d = direction(alignmentBearing(alignment));
    const n = { x: -d.y, y: d.x };
    const c = n.x * p.x + n.y * p.y;
    a11 += n.x * n.x;
    a12 += n.x * n.y;
    a22 += n.y * n.y;
    b1 += n.x * c;
    b2 += n.y * c;
    return { n, c };
  });
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-9) return null;
  const x = (b1 * a22 - b2 * a12) / det;
  const y = (a11 * b2 - a12 * b1) / det;
  const spread = Math.sqrt(lines.reduce((sum, { n, c }) => sum + (n.x * x + n.y * y - c) ** 2, 0) / lines.length);
  return { at: fromLocal(origin, { x, y }), spread, crossings: pairs.length };
}

/**
 * Which way the photo faces from a place, read off an alignment: the bearing to
 * the near point, less how far right of the photo's middle it stands. Null when
 * the lens is unknown.
 */
export function facingFrom(alignment, place, { fov = null, projection = 'camera' } = {}) {
  if (!(fov > 0)) return null;
  const toNear = bearingBetween(place, alignment.map.near);
  const middle = { u: 0.5, v: alignment.photo.near.v };
  const off = photoOffset(middle, alignment.photo.near, { fov, projection });
  return (((toNear - off) % 360) + 360) % 360;
}

/**
 * The ramp the heatmap is drawn in, low to high: blue to yellow (viridis from
 * its blue on), even to the eye and read alike by colour-blind eyes, the score
 * in its lightness and its opacity, so the best ground stands out over any imagery.
 */
export const HEAT_RAMP = ['#3b528b', '#21918c', '#3fbc73', '#a0da39', '#fde725'];

/**
 * How a point of the search is drawn: its colour and opacity from how much of
 * the trace it explains against the best point (`best`) and the worst kept (`low`).
 */
export function heatStyle(explained, best, low = 0) {
  const span = best - low;
  const t = span > 1e-9 ? Math.min(1, Math.max(0, (explained - low) / span)) : 1;
  const step = HEAT_RAMP[Math.min(HEAT_RAMP.length - 1, Math.floor(t * HEAT_RAMP.length))];
  return { fill: step, opacity: Math.round((0.12 + 0.6 * t * t) * 100) / 100 };
}

/** A search's verdict in the panel's words. */
export const VERDICTS = {
  match: 'One place stands out',
  ambiguous: 'Two places more than 3 km apart explain it about as well',
  loose: 'The best place explains less than half of the trace',
  none: 'Nothing in the area explains the trace',
  flat: 'The trace is too flat to tell places apart',
  unclear: 'No place stands out: many explain the trace about as well',
};

/** What to change when no place stands out, in the panel's words. */
export const UNCLEAR_HELP = 'Say the zoom, check how far the photo sees, add an alignment or draw a smaller area.';
