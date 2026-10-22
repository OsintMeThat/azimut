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
 * The analyst may also tick which way the photo faces, one or several of the
 * eight compass directions, those side by side read as one sector (the app's
 * engine/finder.py reads them the same way): the map draws them as a fan. And
 * the ground the eye stands on, a summit, a slope, a valley or a plain, which
 * the app reads off the terrain (engine/landform.py) for every point of the
 * grid before the search: the map shows each point in its ground's colour,
 * grey where it is left out.
 *
 * Once a search is done, `reliability` says how far its best place can be
 * trusted, from what the search already holds: rivals far off that explain the
 * trace nearly as well, the chance fits of the area, a best place standing
 * alone where its neighbours explain little, a trace with too few bumps to
 * name one place, a camera pushed to the edge of what it may be, and the other
 * searches of the same photo.
 *
 * Everything here is a plain function of plain data, so the panel, the map and
 * the search read the same lines.
 */
import { bearingBetween } from './geometry.js';
import { cleanHints, reachText } from './hints.js';
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
export const AREA_MAX = 10_000e6;

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

/** Land standing over the lines said to have only sky above: on what share of them, and how far out (metres). */
export function overText(over, far) {
  return `land rises over the sky-only lines on ${Math.round(over * 100)}%${Number.isFinite(far) ? `, ${reachText(far)} out` : ''}`;
}

/** Why the search ruled a point out, when it did: land over a sky-only line (`over`, `over_far`). */
const ruledTip = (p) => (Number.isFinite(p.over) ? `Ruled out: ${overText(p.over, p.over_far)}` : null);

/**
 * Each scored point's heat on the map, `{ fill, opacity, tip }`: by what it explains, or, where no point
 * explains anything, by how far off the terrain the trace lies there (`gap`, degrees), so the places it lies
 * nearest still show. A point ruled out says why.
 */
export function heatOf(points, best = Math.max(-1, ...points.map((p) => p.explained))) {
  const gaps = points.map((p) => p.gap).filter(Number.isFinite);
  if (best <= 0 && gaps.length) {
    const near = Math.min(...gaps);
    const off = Math.max(...gaps);
    return points.map((p) => ({
      ...heatStyle(Number.isFinite(p.gap) ? -p.gap : -off, -near, -off),
      tip: ruledTip(p) ?? (Number.isFinite(p.gap) ? `Explains 0%: the trace lies ${p.gap.toFixed(1)}° off the terrain` : 'Explains 0%'),
    }));
  }
  const low = Math.max(0, Math.min(...points.map((p) => p.explained)));
  return points.map((p) => ({
    ...heatStyle(p.explained, best, low),
    tip: ruledTip(p) ?? `Explains ${Math.round(Math.max(0, p.explained) * 100)}% of the trace`,
  }));
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

const corner = (p) => (Array.isArray(p) ? p : [p?.lat, p?.lon]).map((x) => Math.round(Number(x) * 1e6));
const farKey = (m) => JSON.stringify(m?.far ?? []);
const zonesKey = (zones) =>
  (zones ?? []).map((zone) => [(zone.area ?? zone.points ?? []).map(corner), zone.out ? null : (zone.spacing ?? null), Boolean(zone.out)]);
const marksKey = (m) => (m && (m.inner?.length || m.pairs?.length || m.cuts?.length) ? JSON.stringify([m.inner ?? [], m.pairs ?? [], m.cuts ?? []]) : '');

/**
 * Whether Find's setup now (`now`, shaped as the search asks it) is still the
 * one a search was asked with (`ask`, as the case keeps it): the same area,
 * who, grid, alignments, photo, trace and what is known of it. Anything that
 * reads differently counts as changed, so work is never taken as kept when it is not.
 */
export function sameAsk(ask, now) {
  if (!ask || !now) return false;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ends = (one) => [corner(one.near), corner(one.far), Boolean(one.tops), one.heights ?? null];
  return (
    same((ask.area ?? []).map(corner), (now.area ?? []).map(corner)) &&
    same(ask.who ?? null, now.who ?? null) &&
    (ask.spacing ?? null) === (now.spacing ?? null) &&
    same((ask.alignments ?? []).map(ends), (now.alignments ?? []).map(ends)) &&
    (ask.photo?.path ?? null) === (now.photo?.path ?? null) &&
    same(ask.photo?.strokes ?? [], now.photo?.strokes ?? []) &&
    marksKey(ask.photo?.marks) === marksKey(now.photo?.marks) &&
    same(cleanHints(ask.hints), cleanHints(now.hints)) &&
    same(cleanFacing(ask.facing), cleanFacing(now.facing)) &&
    same(cleanStands(ask.stands), cleanStands(now.stands)) &&
    same([...(ask.view ?? [])].sort(), [...(now.view ?? [])].sort()) &&
    Boolean(ask.mirror) === Boolean(now.mirror) &&
    Boolean(ask.round) === Boolean(now.round) &&
    farKey(ask.photo?.marks) === farKey(now.photo?.marks) &&
    same(zonesKey(ask.zones), zonesKey(now.zones)) &&
    same(ask.sun ?? null, now.sun ?? null)
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** When a search was made, on this computer's clock: "14 Oct 2026, 21:05"; '' when not known. */
export function searchedWhen(iso) {
  const at = new Date(iso ?? '');
  if (!iso || Number.isNaN(at.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** An area as a search keeps it (`[lat, lon]` pairs) or as Find draws it (`{ lat, lon }`), drawn the second way. */
export function areaPoints(area) {
  return (area ?? []).map((p) => (Array.isArray(p) ? { lat: p[0], lon: p[1] } : { lat: p.lat, lon: p.lon }));
}

/** What to change when no place stands out, in the panel's words. */
export const UNCLEAR_HELP = 'Say the zoom, check how far the photo sees, add an alignment or draw a smaller area.';

// -- which way the photo faces ------------------------------------------------------

/** The compass directions the photo may face, clockwise from north (engine/finder.py DIRECTIONS). */
export const DIRECTIONS = [
  { id: 'n', label: 'N', heading: 0 },
  { id: 'ne', label: 'NE', heading: 45 },
  { id: 'e', label: 'E', heading: 90 },
  { id: 'se', label: 'SE', heading: 135 },
  { id: 's', label: 'S', heading: 180 },
  { id: 'sw', label: 'SW', heading: 225 },
  { id: 'w', label: 'W', heading: 270 },
  { id: 'nw', label: 'NW', heading: 315 },
];

/** Half the sector one direction stands for, degrees: the eight cover the turn. */
export const DIRECTION_HALF = 360 / DIRECTIONS.length / 2;

/** The directions ticked, in the compass's order, once each; anything else left out. */
export function cleanFacing(words) {
  const said = new Set(Array.isArray(words) ? words : []);
  return DIRECTIONS.filter((d) => said.has(d.id)).map((d) => d.id);
}

/** A direction ticked or unticked. */
export function toggleFacing(words, id) {
  const now = cleanFacing(words);
  return cleanFacing(now.includes(id) ? now.filter((one) => one !== id) : [...now, id]);
}

/** Runs of directions side by side round the turn, each a list of indexes, the first after a gap. */
function runs(words) {
  const ticked = new Set(cleanFacing(words).map((id) => DIRECTIONS.findIndex((d) => d.id === id)));
  const count = DIRECTIONS.length;
  if (!ticked.size || ticked.size === count) return [];
  const start = [...ticked].find((i) => !ticked.has((i - 1 + count) % count));
  const out = [];
  for (let k = 0; k < count; k += 1) {
    const i = (start + k) % count;
    if (!ticked.has(i)) continue;
    const last = out.at(-1);
    if (last && (last.at(-1) + 1) % count === i) last.push(i);
    else out.push([i]);
  }
  return out;
}

/** The sectors the directions ticked stand for, `{ centre, half }` in degrees; none for none ticked, or all. */
export function facingSectors(words) {
  const width = 2 * DIRECTION_HALF;
  return runs(words).map((run) => ({ centre: (run[0] * width + ((run.length - 1) * width) / 2) % 360, half: run.length * DIRECTION_HALF }));
}

/** The directions ticked, as words: "NE to E", "N, S"; '' when the photo may face anywhere. */
export function facingText(words) {
  return runs(words)
    .map((run) => (run.length === 1 ? DIRECTIONS[run[0]].label : `${DIRECTIONS[run[0]].label} to ${DIRECTIONS[run.at(-1)].label}`))
    .join(', ');
}

/** Degrees between the points of a fan's arc. */
const FAN_STEP = 5;

/** The fan the map draws from a point: one ring per sector, out to `reach` metres. */
export function facingFan(from, words, reach) {
  return fanOf(from, facingSectors(words), reach);
}

/** The fan of any sectors (`{ centre, half }`), as `facingFan` draws the directions'. */
export function fanOf(from, sectors, reach) {
  return sectors.map(({ centre, half }) => {
    const ring = [from];
    const steps = Math.max(2, Math.ceil((2 * half) / FAN_STEP));
    for (let i = 0; i <= steps; i += 1) ring.push(destination(from, centre - half + (2 * half * i) / steps, reach));
    return ring;
  });
}

/** The distances the fan is ringed at, metres, those within the reach searched. */
export const FAN_RINGS = [2_000, 5_000, 10_000, 20_000, 50_000, 100_000];

/**
 * The fan's rings: an arc across each sector at each distance in `FAN_RINGS`
 * up to `reach`, `{ id, metres, points, label }`, `label` where its words go (the
 * arc's middle).
 */
export function facingRings(from, words, reach) {
  return ringsOf(from, facingSectors(words), reach);
}

/** The rings of any sectors' fan, as `facingRings` rings the directions'. */
export function ringsOf(from, sectors, reach) {
  const out = [];
  for (const [n, { centre, half }] of sectors.entries()) {
    const steps = Math.max(2, Math.ceil((2 * half) / FAN_STEP));
    for (const metres of FAN_RINGS.filter((m) => m <= reach)) {
      const points = [];
      for (let i = 0; i <= steps; i += 1) points.push(destination(from, centre - half + (2 * half * i) / steps, metres));
      out.push({ id: `${n}-${metres}`, metres, points, label: destination(from, centre, metres) });
    }
  }
  return out;
}

/** The middle of an area's corners: where the fan is drawn from. */
export function areaMiddle(points) {
  const list = areaPoints(points);
  if (!list.length) return null;
  return { lat: list.reduce((sum, p) => sum + p.lat, 0) / list.length, lon: list.reduce((sum, p) => sum + p.lon, 0) / list.length };
}

// -- how far a result can be trusted -------------------------------------------------

/** The words for how far a search's best place can be trusted. */
export const TRUST = {
  solid: 'Solid',
  check: 'Check it',
  weak: 'Weak',
};

/** A place far off that explains the trace within this much of the best one is a rival. */
export const RIVAL_MARGIN = 0.1;
/** Metres apart for two places to be separate answers (engine/finder.py SEPARATE_M). */
export const SEPARATE_M = 3_000;
/** The best place must stand this far above the area's chance fits to stand clear of them. */
export const CHANCE_CLEAR = 0.15;
/** A lens found within this ratio of the zoom tried's ends sits at its edge. */
export const LENS_EDGE = 1.05;
/** The most the camera may roll (engine/skymatch.py ROLL_REACH), and how near it reads as pushed to it. */
export const ROLL_LIMIT = 5;
const ROLL_NEAR = 0.2;
/** A decoy of the trace (mirrored, upside down) explaining within this much of it at a place says the place fits any shape. */
export const DECOY_MARGIN = 0.15;
/** A camera on foot tilted this far or more, degrees, is worth a look. */
export const TILT_STEEP = 12;
/**
 * The ground this near the best place, metres: where it is a real answer, the
 * points there explain nearly as much (measured on the owner's solved views: 91
 * to 96% of the best), where it is a chance fit far less (18 to 57%).
 */
export const SPOT_NEAR_M = 150;
/** Below this share of the best, the neighbours say the best stands alone; read from this many of them at the least. */
export const SPOT_SHARE = 0.75;
const SPOT_POINTS = 6;
/** A turn of the trace counts as a bump past this many pixels of the search's plane (1200 wide). */
export const TURN_PX = 6;
/** Fewer turns than this and the trace's shape is too plain to name one place. */
export const TURNS_MIN = 5;

/** The tilts a search allows for who took the photo, degrees down and up (engine/finder.py `TILTS`). */
export const TILTS = { ground: [-20, 25], drone: [-80, 25], aircraft: [-80, 15] };
/** A picture read as one spanning this many degrees or more drifts at its ends: cut, each piece is fitted on its own. */
export const WIDE_SPAN = 90;

/** Degrees up from the plane's middle of a point `v` half widths up, through a `fov` lens or a panorama. */
function angleOf(v, fov, projection) {
  const half = fov / 2;
  return projection === 'panorama' ? v * half : (Math.atan(v * Math.tan((half * Math.PI) / 180)) * 180) / Math.PI;
}

/** How many degrees a trace's plane spans across (`x` in half widths of its `fov`). */
export function traceSpan({ x = [], fov = 0, projection = 'camera' } = {}) {
  if (!x.length || !(fov > 0)) return 0;
  return angleOf(Math.max(...x), fov, projection) - angleOf(Math.min(...x), fov, projection);
}

/** Degrees short of a tilt bound at which the trace already offers to look past it: a ridge stands a few degrees over the horizon. */
export const LOOK_MARGIN = 5;

/**
 * Which way the camera must look for the skyline to stand where it is traced: a far skyline lies about level,
 * so one high in the frame asks the camera down and one low asks it up. 'down' or 'up' once that comes within
 * `LOOK_MARGIN` of what a search allows for who took the photo (`TILTS`), else null.
 */
export function lookingOf({ y = [], fov = 0, projection = 'camera' } = {}, mode = 'ground') {
  if (!y.length || !(fov > 0)) return null;
  const sorted = [...y].sort((a, b) => a - b);
  const tilt = -angleOf(sorted[Math.floor(sorted.length / 2)], fov, projection);
  const [low, high] = TILTS[mode] ?? TILTS.ground;
  if (tilt < low + LOOK_MARGIN) return 'down';
  if (tilt > high - LOOK_MARGIN) return 'up';
  return null;
}

/** How many times the trace turns up or down by `TURN_PX` or more, read across the picture from left to right. */
export function traceTurns(trace) {
  const xs = trace?.x ?? [];
  const ys = trace?.y ?? [];
  const scale = Number(trace?.half_width) > 0 ? Number(trace.half_width) : 600;
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  let turns = 0;
  let way = 0;
  let held = null;
  for (const i of order) {
    const y = ys[i] * scale;
    if (held === null) held = y;
    else if (way >= 0 && y < held - TURN_PX) {
      if (way > 0) turns += 1;
      way = -1;
      held = y;
    } else if (way <= 0 && y > held + TURN_PX) {
      if (way < 0) turns += 1;
      way = 1;
      held = y;
    } else if ((way > 0 && y > held) || (way < 0 && y < held)) held = y;
  }
  return turns;
}

/** What the points scored within `SPOT_NEAR_M` of the best place explain, in the middle; null with too few. */
export function neighbourFit(best, points) {
  const near = (points ?? [])
    .filter((p) => Number.isFinite(p.explained) && p.explained >= 0)
    .filter((p) => {
      const apart = haversine(p, best);
      return apart > 1 && apart <= SPOT_NEAR_M;
    })
    .map((p) => p.explained)
    .sort((a, b) => a - b);
  return near.length >= SPOT_POINTS ? near[Math.floor(near.length / 2)] : null;
}

/** The score most of the area reaches by chance: the top tenth of the points scored, or null with too few. */
export function chanceFit(points) {
  const scores = (points ?? [])
    .map((p) => p.explained)
    .filter((x) => Number.isFinite(x) && x >= 0)
    .sort((a, b) => a - b);
  if (scores.length < 10) return null;
  return scores[Math.floor(0.9 * (scores.length - 1))];
}

const km = (metres) => `${Math.round(metres / 1000)} km`;
const percent = (share) => `${Math.round(Math.max(0, share) * 100)}%`;

/**
 * How far the best place of a search can be trusted: `{ level, reasons, chance }`,
 * `level` a key of TRUST, `reasons` what lowers it in a line each, `chance` the
 * score the area reaches by chance. Read off the search alone and the case's
 * other searches (`others`, rows as the list gives them): no point is scored
 * again. A verdict that names no single place is weak whatever else; one that
 * does is solid with nothing against it, worth a check with one thing, weak
 * with two or more.
 */
export function reliability(result, { ask = null, name = null, others = [] } = {}) {
  const places = result?.places ?? [];
  const best = places[0];
  const chance = chanceFit(result?.points);
  if (!best) return { level: 'weak', reasons: [], chance };
  const reasons = [];
  const verdict = result.verdict;

  if (verdict !== 'ambiguous') {
    const rivals = places.slice(1).filter((p) => haversine(p, best) >= SEPARATE_M && p.explained >= best.explained - RIVAL_MARGIN);
    if (rivals.length) {
      const nearest = Math.min(...rivals.map((p) => haversine(p, best)));
      reasons.push(
        rivals.length === 1
          ? `Another place ${km(nearest)} away explains nearly as much`
          : `${rivals.length} other places, the nearest ${km(nearest)} away, explain nearly as much`
      );
    }
  }
  if (chance !== null && verdict !== 'unclear' && best.explained - chance < CHANCE_CLEAR) {
    reasons.push(`Barely above the chance fits of the area (${percent(chance)})`);
  }
  const around = neighbourFit(best, result?.points);
  if (around !== null && around < SPOT_SHARE * best.explained) {
    reasons.push(`The ground ${SPOT_NEAR_M} m around explains much less (${percent(around)}): a lone spike`);
  }

  const trace = ask?.trace;
  if (trace?.x?.length) {
    const turns = traceTurns(trace);
    if (turns < TURNS_MIN) reasons.push(`The trace turns only ${turns} ${turns === 1 ? 'time' : 'times'}: a plain shape fits many places`);
  }
  const within = trace && !trace.known && Array.isArray(trace.within) ? trace.within : null;
  if (within && Number.isFinite(best.fov) && ask?.hints?.picture !== 'panorama') {
    const [low, high] = [Math.min(...within), Math.max(...within)];
    const lens = best.fov < 10 ? best.fov.toFixed(1) : Math.round(best.fov);
    if (best.fov <= low * LENS_EDGE) reasons.push(`The lens found, ${lens}°, is the narrowest tried`);
    else if (best.fov >= high / LENS_EDGE) reasons.push(`The lens found, ${lens}°, is the widest tried`);
  }
  if (Number.isFinite(best.roll) && Math.abs(best.roll) >= ROLL_LIMIT - ROLL_NEAR) {
    reasons.push(`The camera had to roll ${Math.round(Math.abs(best.roll))}°, the most allowed`);
  }
  if ((ask?.who?.mode ?? 'ground') === 'ground' && Number.isFinite(best.tilt) && Math.abs(best.tilt) >= TILT_STEEP) {
    reasons.push(`The camera tilts ${Math.round(Math.abs(best.tilt))}° ${best.tilt < 0 ? 'down' : 'up'}`);
  }
  if (best.inner != null && best.inner < 0.5) reasons.push('The ridges in front lie off the terrain there');
  if (Number.isFinite(best.decoy) && best.decoy >= best.explained - DECOY_MARGIN) {
    reasons.push(`A decoy of the trace fits there nearly as well (${percent(best.decoy)})`);
  }
  if (Array.isArray(best.pairs) && best.pairs[0] < best.pairs[1]) {
    reasons.push(`${best.pairs[1] - best.pairs[0]} of ${best.pairs[1]} front and behind pairs are out of order`);
  }

  // another search of the same photo that names one place elsewhere, about as strongly
  const photo = ask?.photo?.path;
  if (photo) {
    const elsewhere = (others ?? []).filter(
      (row) =>
        row.name !== name &&
        row.photo === photo &&
        row.status === 'done' &&
        row.verdict === 'match' &&
        row.best &&
        row.best.explained >= best.explained - RIVAL_MARGIN &&
        haversine(row.best, best) >= SEPARATE_M
    );
    if (elsewhere.length) {
      const [first] = elsewhere;
      reasons.push(`“${first.title ?? first.name}” found a place ${km(haversine(first.best, best))} away that explains ${percent(first.best.explained)}`);
    }
  }

  const named = verdict === 'match';
  const level = !named || reasons.length >= 2 ? 'weak' : reasons.length === 1 ? 'check' : 'solid';
  return { level, reasons, chance };
}

// -- where the eye stands -------------------------------------------------------------

/** The ground the eye may stand on, as the app reads it off the terrain (engine/landform.py), and its rule. */
export const GROUNDS = [
  { id: 'summit', label: 'Summit or ridge', title: 'In the top quarter of the ground within 400 m', colour: '#ff8a3d' },
  { id: 'slope', label: 'Slope', title: 'Between the top and bottom quarters of the ground within 400 m', colour: '#e6d35a' },
  { id: 'valley', label: 'Valley', title: 'In the bottom quarter of the ground within 400 m', colour: '#4fc3f7' },
  { id: 'plain', label: 'Plain', title: 'Flat ground: within 8 m over 400 m, or 30 m over 1.5 km', colour: '#9be564' },
  { id: 'water', label: 'Sea or lake', title: 'On a boat: points on the water are searched too', colour: '#2f6fe0' },
];

/** Water on the map's grid: the sea or a lake, left out on foot unless ticked. */
export const WATER_COLOUR = '#2f6fe0';

/** The grounds ticked, in the menu's order, once each; anything else left out. */
export function cleanStands(words) {
  const said = new Set(Array.isArray(words) ? words : []);
  return GROUNDS.filter((g) => said.has(g.id)).map((g) => g.id);
}

/** A ground ticked or unticked. */
export function toggleStand(words, id) {
  const now = cleanStands(words);
  return cleanStands(now.includes(id) ? now.filter((one) => one !== id) : [...now, id]);
}

/** The grounds ticked, as words: "summit or ridge or slope"; '' for any. */
export function standsText(words) {
  const labels = GROUNDS.filter((g) => cleanStands(words).includes(g.id)).map((g) => g.label.toLowerCase());
  return labels.join(' or ');
}

/**
 * What the grid before the search says about the ground (`/api/horizon/finds/preview`):
 * how many points it keeps and why the rest go, '' while it is not read.
 */
export function groundText(preview, stands = []) {
  if (!preview?.total) return '';
  const water = preview.kinds?.water ?? 0;
  const ticked = cleanStands(stands).length;
  const wet = water && !cleanStands(stands).includes('water') ? `${water.toLocaleString('en-US')} on water left out` : '';
  if (!ticked) return wet ? `${wet}.` : '';
  const share = Math.round((100 * preview.kept) / preview.total);
  return `Keeps ${preview.kept.toLocaleString('en-US')} of ${preview.total.toLocaleString('en-US')} points (${share}%)${wet ? `, ${wet}` : ''}.`;
}

/** The size of a search with the grid kept to the ground ticked: its coarse points and their filling-in scaled down alike. */
export function withGround(estimated, preview) {
  if (!estimated || !preview?.total || !(estimated.coarse > 0)) return estimated;
  const dropped = estimated.coarse * (1 - preview.kept / preview.total);
  const points = Math.max(0, Math.round(estimated.points - dropped));
  const most = estimated.most != null ? Math.max(points, Math.round(estimated.most - dropped * 4)) : estimated.most;
  return { ...estimated, points, most };
}

// -- the sun against the camera --------------------------------------------------------

/** Where the sun may have stood against the camera, as Find offers it. */
export const SUN_SIDES = [
  { id: 'ahead', label: 'Ahead', title: 'The sun in front of the camera, in the picture or near it' },
  { id: 'left', label: 'Left', title: 'The sun on the left of the picture: shadows fall to the right' },
  { id: 'right', label: 'Right', title: 'The sun on the right of the picture: shadows fall to the left' },
  { id: 'behind', label: 'Behind', title: 'The sun behind the camera: shadows fall away from it' },
];

/** Nothing said of the sun. */
export const NO_SUN = Object.freeze({ date: '', start: '06:00', end: '18:00', sides: Object.freeze([]) });

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The sun as Find keeps it, whatever it was handed: sides in the menu order, hours as `HH:MM`. */
export function cleanSun(sun) {
  const said = new Set(Array.isArray(sun?.sides) ? sun.sides : []);
  return {
    date: DAY.test(sun?.date ?? '') ? sun.date : '',
    start: HOUR.test(sun?.start ?? '') ? sun.start : NO_SUN.start,
    end: HOUR.test(sun?.end ?? '') ? sun.end : NO_SUN.end,
    sides: SUN_SIDES.filter((side) => said.has(side.id)).map((side) => side.id),
  };
}

/** The sun a search is asked with, or null until a day and a side are said. */
export function sunAsked(sun) {
  const clean = cleanSun(sun);
  return clean.date && clean.sides.length ? clean : null;
}
