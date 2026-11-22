/**
 * What a measure on the map reads, apart from the map.
 *
 * A measure is points clicked on the map, open (a line) or closed (an area).
 * A line of two points can also be *used as* something: a range ring round A,
 * a view cone from A toward B, an alignment run on past two things lined up in
 * a picture, a shadow from an object's foot at A to its tip at B, or the reach
 * of a viewshed from A. One gesture and then a choice,
 * rather than a tool per question: each of those is a distance and a bearing
 * from a point, and drawing one is the same two clicks whatever it is for.
 *
 * Everything here is arithmetic over plain data (`{ points, closed, use,
 * rings, aperture, past, reach }`), so the readings, the words on the map and the copied
 * text are read off a test (measures.test.js).
 */
import { bearingBetween } from './horizon/geometry.js';
import {
  angleAt,
  centroid,
  cone,
  crossing,
  destination,
  formatArea,
  formatBearing,
  formatDistance,
  formatHeight,
  haversine,
  midway,
  pathLength,
  perimeter,
  polygonArea,
} from './measure.js';

/** What a line of two points can be used as, in the order the panel offers them. */
export const USES = [
  { id: 'ring', label: 'Ring', title: 'Circles round A, as wide as the line' },
  { id: 'cone', label: 'Cone', title: 'What a camera at A facing B takes in' },
  { id: 'align', label: 'Align', title: 'Two things lined up in a picture, the line run on: the camera stands on it' },
  { id: 'shadow', label: 'Shadow', title: 'A shadow from a foot at A to its tip at B: how tall, and the hour' },
  { id: 'viewshed', label: 'Viewshed', title: 'The ground in sight from A, out as far as B' },
];

/** How many rings a range can carry, and how wide a cone opens by default. */
export const MAX_RINGS = 5;
export const APERTURE = 60;

/** How far an alignment runs on past its ends until the analyst says otherwise, and at most. */
export const REACH = 20_000;
export const MAX_REACH = 500_000;

/** Which way an alignment runs on, in the order the panel offers them. */
export const PAST = [
  { id: 'a', label: 'Past A', title: 'The line runs on past A only' },
  { id: 'both', label: 'Both ways', title: 'The line runs on past both ends' },
  { id: 'b', label: 'Past B', title: 'The line runs on past B only' },
];

/** A fresh measure, starting at one point. */
export function newMeasure(id, at) {
  return { id, points: [{ lat: at.lat, lon: at.lon }], closed: false, use: null, rings: 1, aperture: APERTURE, past: 'both', reach: REACH };
}

/** A distance an alignment runs on, kept between a hundred metres and its ceiling. */
export function clampReach(metres) {
  const value = Number(metres);
  return Number.isFinite(value) && value > 0 ? Math.max(100, Math.min(MAX_REACH, value)) : REACH;
}

/** A line of exactly two points: the one shape with a bearing and a use. */
export function isPair(measure) {
  return Boolean(measure) && !measure.closed && measure.points.length === 2;
}

/** Each straight piece of a measure, closing back to the start for an area. */
export function legs(measure) {
  const points = measure.closed ? [...measure.points, measure.points[0]] : measure.points;
  return points.slice(1).map((to, i) => {
    const from = points[i];
    return { from, to, length: haversine(from, to), bearing: bearingBetween(from, to) };
  });
}

/** The length and bearing of a line of two points, and the bearing back. */
export function pairReading(measure) {
  const [a, b] = measure.points;
  const toward = bearingBetween(a, b);
  return { length: haversine(a, b), bearing: toward, back: bearingBetween(b, a) };
}

/**
 * The measure in one line, for the status bar and the list: an area's size, a
 * line's length, and for a line of two points its bearing or what it is used
 * as. Empty while a measure is one point short of meaning anything.
 */
export function headline(measure, units) {
  const { points } = measure;
  if (points.length < 2) return '';
  if (measure.closed) return points.length >= 3 ? formatArea(polygonArea(points), units) : '';
  if (points.length > 2) return formatDistance(pathLength(points), units);
  const { length, bearing } = pairReading(measure);
  if (measure.use === 'ring') return `Radius ${formatDistance(length, units)}`;
  if (measure.use === 'cone') return `${Math.round(measure.aperture)}° cone · ${formatDistance(length, units)}`;
  if (measure.use === 'align') return `Alignment · ${formatBearing(bearing)}`;
  return `${formatDistance(length, units)} · ${formatBearing(bearing)}`;
}

/**
 * The words written on the map beside a measure: each leg's length and
 * bearing at its middle, the whole length at the end of a line of several
 * legs, the angle at each inner corner of a line, and an area's size in its
 * middle. Rings say their radius on their edge, clear of the line.
 *
 * A leg's label carries its two ends, and a corner's angle its two
 * neighbours, so whoever places them can set them off the line on screen, or
 * leave a leg's out where the leg is too short to hold it.
 */
export function labels(measure, units) {
  const { points } = measure;
  if (points.length < 2) return [];
  const out = legs(measure).map((leg, i) => ({
    id: `leg-${i}`,
    kind: 'leg',
    at: midway(leg.from, leg.to),
    text: `${formatDistance(leg.length, units)} · ${formatBearing(leg.bearing)}`,
    from: leg.from,
    to: leg.to,
  }));
  if (measure.closed && points.length >= 3) {
    out.push({ id: 'area', kind: 'area', at: centroid(points), text: formatArea(polygonArea(points), units) });
  }
  if (!measure.closed && points.length > 2) {
    out.push({ id: 'total', kind: 'total', at: points.at(-1), text: formatDistance(pathLength(points), units), around: [points.at(-2)] });
    for (let i = 1; i < points.length - 1; i++) {
      const deg = angleAt(points[i - 1], points[i], points[i + 1]);
      out.push({ id: `angle-${i}`, kind: 'angle', at: points[i], text: `${Math.round(deg)}°`, around: [points[i - 1], points[i + 1]] });
    }
  }
  if (isPair(measure) && measure.use === 'ring' && measure.rings > 1) {
    const { length, bearing } = pairReading(measure);
    for (let k = 2; k <= measure.rings; k++) {
      out.push({
        id: `ring-${k}`,
        kind: 'ring',
        at: destination(points[0], bearing + 90, length * k),
        text: formatDistance(length * k, units),
      });
    }
  }
  return out;
}

/** The shapes a line's use adds round it: rings, a cone, or the stretches an alignment runs on. */
export function useShapes(measure) {
  if (!isPair(measure)) return [];
  const [a] = measure.points;
  const { length, bearing } = pairReading(measure);
  if (measure.use === 'ring') {
    const count = Math.max(1, Math.min(MAX_RINGS, Math.round(measure.rings) || 1));
    return Array.from({ length: count }, (_, i) => ({ kind: 'circle', at: a, radiusM: length * (i + 1) }));
  }
  if (measure.use === 'cone') return [{ kind: 'polygon', points: cone(a, bearing, measure.aperture, length) }];
  if (measure.use === 'align') return runsOn(measure).map((run) => ({ kind: 'line', points: run.points }));
  return [];
}

/** Steps along each stretch an alignment runs on: enough that its curve on the flat map reads smooth. */
const RUN_STEPS = 48;

/**
 * The stretches an alignment runs on past its ends, each from its end outward.
 *
 * They follow the great circle through A and B, the line the picture was taken
 * along, rather than a straight line on the flat map, which drifts off it by
 * tens of metres over tens of kilometres away from the equator.
 */
export function runsOn(measure) {
  if (!isPair(measure) || measure.use !== 'align') return [];
  const [a, b] = measure.points;
  const { length, bearing } = pairReading(measure);
  const reach = clampReach(measure.reach);
  const past = measure.past ?? 'both';
  const stretch = (end, along, from) => {
    const points = [{ lat: end.lat, lon: end.lon }];
    for (let i = 1; i <= RUN_STEPS; i++) points.push(destination(a, along, from + (reach * i) / RUN_STEPS));
    return points;
  };
  const out = [];
  if (past !== 'b') out.push({ end: 'a', points: stretch(a, bearing + 180, 0) });
  if (past !== 'a') out.push({ end: 'b', points: stretch(b, bearing, length) });
  return out;
}

/** A measure's line as it is drawn: an alignment's with the stretches it runs on. */
export function pathOf(measure) {
  const runs = runsOn(measure);
  const before = runs.find((run) => run.end === 'a')?.points.slice(1).reverse() ?? [];
  const after = runs.find((run) => run.end === 'b')?.points.slice(1) ?? [];
  return [...before, ...measure.points, ...after];
}

/** How wide a cone is where it reaches B: the side a camera there would frame. */
export function coneWidth(measure) {
  const { length } = pairReading(measure);
  return 2 * length * Math.tan(((Math.min(179, measure.aperture) / 2) * Math.PI) / 180);
}

/** Two crossings closer than this are one, and a crossing at a shared end is no crossing. */
const SAME_POINT_M = 0.5;

/**
 * A line as the crossings read it: its pieces as drawn, each with the box round
 * it, so two pieces far apart are passed over without any arithmetic.
 */
function crossable(measure) {
  const path = pathOf(measure);
  const pieces = path.slice(1).map((to, i) => {
    const from = path[i];
    return {
      from,
      to,
      box: [Math.min(from.lat, to.lat), Math.max(from.lat, to.lat), Math.min(from.lon, to.lon), Math.max(from.lon, to.lon)],
    };
  });
  return { id: measure.id, ends: [measure.points[0], measure.points.at(-1)], pieces };
}

const apart = (p, q) => p.box[1] < q.box[0] || q.box[1] < p.box[0] || p.box[3] < q.box[2] || q.box[3] < p.box[2];

/** Where two crossable lines cross, apart from at an end of either. */
function crossingsOf(one, other) {
  const ends = [...one.ends, ...other.ends];
  const found = [];
  for (const p of one.pieces) {
    for (const q of other.pieces) {
      if (apart(p, q)) continue;
      const at = crossing(p.from, p.to, q.from, q.to);
      if (!at || ends.some((end) => haversine(end, at) < SAME_POINT_M)) continue;
      if (found.some((seen) => haversine(seen, at) < SAME_POINT_M)) continue;
      found.push(at);
    }
  }
  return found;
}

/**
 * Where the lines of different measures cross. Two bearings drawn from two
 * places meet at what both point at, so a crossing is marked and named rather
 * than left for the eye to find. An alignment crosses along the whole of its
 * run, and two that share an end, the same steeple lined up twice, do not
 * cross there.
 */
export function crossings(measures) {
  const lines = measures.filter((m) => !m.closed && m.points.length >= 2).map(crossable);
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      for (const at of crossingsOf(lines[i], lines[j])) {
        if (found.some((seen) => haversine(seen.at, at) < SAME_POINT_M)) continue;
        found.push({ at, between: [lines[i].id, lines[j].id] });
      }
    }
  }
  return found;
}

/**
 * Where the alignments meet: the middle of the points where each pair of them
 * crosses, and how far the farthest of those lies from it. Lines lined up on
 * one camera seldom meet in a single point, and that spread says how well they
 * agree. Null until there are two alignments.
 */
export function meeting(measures) {
  const lines = measures.filter((m) => isPair(m) && m.use === 'align').map(crossable);
  if (lines.length < 2) return null;
  const pairs = (lines.length * (lines.length - 1)) / 2;
  const points = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const [at] = crossingsOf(lines[i], lines[j]);
      if (at) points.push(at);
    }
  }
  if (!points.length) return { lines: lines.length, pairs, crossed: 0, at: null, spread: null };
  const at = {
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lon: points.reduce((sum, p) => sum + p.lon, 0) / points.length,
  };
  const spread = Math.max(...points.map((p) => haversine(at, p)));
  return { lines: lines.length, pairs, crossed: points.length, at, spread };
}

/** What the alignments' meeting says, in one sentence, and what is missing from it. */
export function meetingWords(meet, units) {
  if (!meet) return null;
  if (!meet.crossed) return { lead: 'The alignments do not cross: run them on further', missing: '' };
  let lead = `${meet.lines} alignments meet within ${formatDistance(meet.spread, units)}`;
  if (meet.crossed === 1) lead = meet.lines === 2 ? 'The two alignments cross' : 'Two of the alignments cross';
  const left = meet.pairs - meet.crossed;
  const missing = left ? `${left} ${left === 1 ? 'pair does' : 'pairs do'} not cross within reach` : '';
  return { lead, missing };
}

/**
 * The stretches of a profile's line its eye sees and does not, each as the
 * points to draw it through. Neighbouring stretches share their meeting point,
 * so the line is drawn whole in two colours.
 */
export function sightRuns(profile) {
  const seen = profile?.sight?.seen;
  if (!seen?.length) return [];
  const runs = [];
  let current = null;
  seen.forEach((value, i) => {
    const point = { lat: profile.lat[i], lon: profile.lon[i] };
    if (current?.seen === value) {
      current.points.push(point);
      return;
    }
    current = { seen: value, points: current ? [current.points.at(-1), point] : [point] };
    runs.push(current);
  });
  return runs.filter((run) => run.points.length >= 2);
}

/**
 * A viewshed's answer (`/api/terrain/viewshed`) as one shape to fill.
 *
 * Each stretch of a ray in sight is a wedge as wide as the ray's share of the
 * turn, so neighbouring rays tile the ground. Wedges of neighbouring rays that
 * overlap are chained into one outline, out along their far edges and back
 * along their near ones: a thousand wedges side by side would each have their
 * edges smoothed, and the ground in sight would read as a striped fan.
 */
export function viewshedGeometry(answer) {
  const centre = { lat: answer.lat, lon: answer.lon };
  const half = answer.step_deg / 2;
  const strips = [];
  let open = [];
  answer.runs.forEach((run, ray) => {
    const azimuth = ray * answer.step_deg;
    const next = [];
    for (let k = 0; k + 1 < run.length; k += 2) {
      const [near, far] = [run[k], run[k + 1]];
      if (!(far > near)) continue;
      const wedge = { azimuth, near, far };
      // the strip this wedge carries on: one whose last wedge it overlaps, not yet carried on by another
      const strip = open.find((one) => !one.carried && near < one.last.far && one.last.near < far);
      if (strip) {
        strip.wedges.push(wedge);
        strip.last = wedge;
        strip.carried = true;
        next.push(strip);
      } else {
        const fresh = { wedges: [wedge], last: wedge, carried: true };
        strips.push(fresh);
        next.push(fresh);
      }
    }
    for (const strip of next) strip.carried = false;
    open = next;
  });
  const at = (azimuth, metres) => (metres > 0 ? destination(centre, azimuth, metres) : centre);
  const coordinates = strips.map(({ wedges }) => {
    const outer = wedges.flatMap((w) => [at(w.azimuth - half, w.far), at(w.azimuth + half, w.far)]);
    const inner = [...wedges].reverse().flatMap((w) => [at(w.azimuth + half, w.near), at(w.azimuth - half, w.near)]);
    const ring = [...outer, ...inner];
    return [[...ring, ring[0]].map((point) => [point.lon, point.lat])];
  });
  return { type: 'MultiPolygon', coordinates };
}

const METRES_PER = { m: 1, km: 1000, ft: 0.3048, mi: 1609.344, nm: 1852 };

/** The unit a typed distance is read in when it names none, for the analyst's units. */
export function fieldUnit(metres, units) {
  if (units === 'nautical') return 'nm';
  if (units === 'imperial') return metres < METRES_PER.mi ? 'ft' : 'mi';
  return metres < 1000 ? 'm' : 'km';
}

/** A distance written into a field in `unit`: no more decimals than the unit needs. */
export function fieldValue(metres, unit) {
  const value = metres / METRES_PER[unit];
  const short = unit === 'm' || unit === 'ft';
  const decimals = short ? (value >= 100 ? 0 : 1) : 3;
  return String(Number(value.toFixed(decimals)));
}

/**
 * A distance as somebody types it, in metres: "2.5", "2,5 km", "800 m",
 * "1.2 mi", "3 NM", "500 ft". A bare number is in `unit`. Null for anything
 * else, and for nothing at all.
 */
export function parseDistance(text, unit) {
  const typed = String(text ?? '').trim().toLowerCase().replace(',', '.');
  const match = typed.match(/^(\d+(?:\.\d+)?|\.\d+)\s*(m|km|ft|mi|nm)?$/);
  if (!match) return null;
  const metres = Number(match[1]) * METRES_PER[match[2] ?? unit];
  return metres > 0 ? metres : null;
}

/**
 * The measure as text to paste into notes: what it reads, then where it is,
 * with the ground and the answer of its use when they are known. `coords`
 * writes a point the way the analyst's coordinates read everywhere else.
 */
export function summary(measure, units, { coords, ground = null, shadow = null, viewshed = null } = {}) {
  const { points } = measure;
  const at = (point) => coords(point.lat, point.lon);
  const lines = [];
  if (measure.closed) {
    lines.push(`Area ${formatArea(polygonArea(points), units)}, perimeter ${formatDistance(perimeter(points), units)}`);
    lines.push(`Corners: ${points.map(at).join('; ')}`);
    return lines.join('\n');
  }
  if (!isPair(measure)) {
    lines.push(`Distance ${formatDistance(pathLength(points), units)} over ${points.length - 1} legs`);
    lines.push(`Through: ${points.map(at).join('; ')}`);
    return lines.join('\n');
  }
  const { length, bearing, back } = pairReading(measure);
  lines.push(`Distance ${formatDistance(length, units)}, bearing ${formatBearing(bearing, 1)} (back ${formatBearing(back, 1)})`);
  lines.push(`From ${at(points[0])} to ${at(points[1])}`);
  if (ground?.corners?.length === 2) {
    const [from, to] = ground.corners;
    lines.push(`Ground ${formatHeight(from, units)} to ${formatHeight(to, units)} (${signed(to - from, units)})`);
  }
  if (ground?.sight) lines.push(sightSentence(ground.sight, units));
  if (measure.use === 'ring') {
    const count = Math.max(1, measure.rings);
    lines.push(`Rings every ${formatDistance(length, units)}, out to ${formatDistance(length * count, units)}`);
  }
  if (measure.use === 'cone') {
    lines.push(`Cone ${Math.round(measure.aperture)}° wide, ${formatDistance(coneWidth(measure), units)} across at B`);
  }
  if (measure.use === 'align') {
    const where = { a: 'past A', b: 'past B' }[measure.past] ?? 'past both ends';
    lines.push(`Alignment run on ${formatDistance(clampReach(measure.reach), units)} ${where}`);
  }
  if (measure.use === 'shadow' && shadow) lines.push(shadowSentence(shadow, units));
  if (measure.use === 'viewshed' && viewshed) {
    lines.push(`Viewshed: ${Math.round(viewshed.share * 100)}% of the ground within ${formatDistance(viewshed.radius_m, units)} in sight`);
  }
  return lines.join('\n');
}

/** A rise or a fall with its sign, in the analyst's height unit. */
export function signed(metres, units) {
  const text = formatHeight(Math.abs(metres), units);
  return `${metres >= 0 ? '+' : '−'}${text}`;
}

/** Whether B is in sight from A, as one sentence. */
function sightSentence(sight, units) {
  return sight.visible
    ? 'B is in sight from A'
    : `B is out of sight from A: ground in the way at ${formatDistance(sight.blocked_at_m, units)}`;
}

/** A shadow's answer (`/api/geo/shadow`) as one sentence, or why it has none. */
export function shadowSentence(shadow, units) {
  const [first, second] = shadow.moments ?? [];
  if (!first) return `No hour of ${shadow.date} casts this shadow`;
  const clock = (moment) => moment.local.slice(11, 16);
  const height = `About ${formatHeight(first.height_m, units)} tall`;
  const when = `sun at ${formatBearing(first.sun_azimuth)}, ${first.sun_altitude.toFixed(1)}° up at ${clock(first)} ${first.abbreviation}`;
  const also = second ? `, or ${formatHeight(second.height_m, units)} at ${clock(second)}` : '';
  return `${height} (${when}${also})`;
}
