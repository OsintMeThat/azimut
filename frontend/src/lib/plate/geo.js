/**
 * Where the ground stands in a plate's map frame, worked out the way the engine
 * draws it, so a label, an arrow, the grid and the scale are placed by the same
 * numbers on the screen and in the export without asking the map.
 *
 * A view is the engine's own: its centre, its zoom on 512-pixel tiles (fractional,
 * as a plate frames its ground by the hand) and its bearing, the degrees the map is
 * turned clockwise from north up. A frame is `{ width, height }` in CSS pixels.
 */

const TILE = 512;
const EARTH = 6_378_137;
const RAD = Math.PI / 180;

function world(zoom) {
  return TILE * 2 ** zoom;
}

/** A longitude and a latitude as world pixels at `zoom`. */
export function toWorld([lon, lat], zoom) {
  const size = world(zoom);
  const sin = Math.min(Math.max(Math.sin(lat * RAD), -0.9999), 0.9999);
  return [((lon + 180) / 360) * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
}

export function fromWorld([x, y], zoom) {
  const size = world(zoom);
  const lon = (x / size) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI;
  return [lon, lat];
}

/** Where a point of the ground lands in the frame, in CSS pixels from its top left. */
export function project(view, frame, point) {
  const [cx, cy] = toWorld([view.lon, view.lat], view.zoom);
  let [x, y] = toWorld(point, view.zoom);
  // the shorter way round, so a frame across the antimeridian keeps its points
  const size = world(view.zoom);
  if (x - cx > size / 2) x -= size;
  if (cx - x > size / 2) x += size;
  const turn = -(view.bearing ?? 0) * RAD;
  const dx = x - cx;
  const dy = y - cy;
  return [frame.width / 2 + dx * Math.cos(turn) - dy * Math.sin(turn),
    frame.height / 2 + dx * Math.sin(turn) + dy * Math.cos(turn)];
}

/** …and back: the ground under a point of the frame. */
export function unproject(view, frame, [px, py]) {
  const [cx, cy] = toWorld([view.lon, view.lat], view.zoom);
  const turn = (view.bearing ?? 0) * RAD;
  const dx = px - frame.width / 2;
  const dy = py - frame.height / 2;
  const [lon, lat] = fromWorld([cx + dx * Math.cos(turn) - dy * Math.sin(turn), cy + dx * Math.sin(turn) + dy * Math.cos(turn)], view.zoom);
  return [((((lon + 180) % 360) + 360) % 360) - 180, lat];
}

/** How many metres of ground one CSS pixel of the frame covers, at its centre. */
export function metresPerPixel(view) {
  return (2 * Math.PI * EARTH * Math.cos(view.lat * RAD)) / world(view.zoom);
}

/**
 * True when two views are the same camera, within what a plate keeps of a view
 * (six decimals of a degree, three of a zoom, one of a bearing). The map's own view
 * coming back rounded must not move it again: a jump stops the hand's drag.
 */
export function sameView(a, b) {
  const lon = ((a.lon - b.lon + 540) % 360) - 180;
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(lon) < 1e-6
    && Math.abs(a.zoom - b.zoom) < 1e-3 && Math.abs(((a.bearing ?? 0) - (b.bearing ?? 0) + 540) % 360 - 180) < 0.1
    && Math.abs((a.pitch ?? 0) - (b.pitch ?? 0)) < 0.1;
}

/** The engine's field of view, top to bottom, in degrees: a leaning camera sees the ground through it. */
const FOV = 36.86989764584402;
/** How far beyond the frame's middle a leaning map's outline reaches, as many times as its near edge falls short of it. */
const FAR_REACH = 3;

/**
 * The ground the frame shows, as its four corners: what an inset outlines.
 *
 * A leaning map sees its ground in perspective, from its near edge, at the frame's
 * foot, up to the horizon. Its outline is worked out from the engine's camera over a
 * flat ground through the frame's middle (the heights left out), and stops short of the
 * horizon, `FAR_REACH` times as far beyond the middle as the near edge is before it, so
 * an inset draws where the map looks rather than a wedge to the end of the world.
 */
export function corners(view, frame) {
  const { width: w, height: h } = frame;
  const pitch = Math.min(85, view.pitch ?? 0) * RAD;
  if (pitch < 0.5 * RAD) return [[0, 0], [w, 0], [w, h], [0, h]].map((point) => unproject(view, frame, point));
  // the camera stands back from the middle and above it, looking down the bearing
  const reach = h / 2 / Math.tan((FOV / 2) * RAD);
  const back = reach * Math.sin(pitch);
  const high = reach * Math.cos(pitch);
  /** Where the ray through the frame's point `(u, v)` from its middle, `v` downward, meets the ground: `[right, forward]` pixels. */
  const ground = (u, v) => {
    const down = high + v * Math.sin(pitch);
    if (down <= 0) return null;
    const t = high / down;
    return [t * u, -back + t * (back - v * Math.cos(pitch))];
  };
  const near = ground(0, h / 2)[1];
  // the far edge: the frame's top, or the row that reaches as far as the outline may go
  let far = -h / 2;
  const beyond = (v) => { const hit = ground(0, v); return !hit || hit[1] > -near * FAR_REACH; };
  if (beyond(far)) {
    let [out, inside] = [-h / 2, 0];
    for (let step = 0; step < 24; step += 1) {
      const middle = (out + inside) / 2;
      if (beyond(middle)) out = middle; else inside = middle;
    }
    far = inside;
  }
  const turn = (view.bearing ?? 0) * RAD;
  const [cx, cy] = toWorld([view.lon, view.lat], view.zoom);
  // right and forward on the ground, as world pixels: forward is where the bearing points
  const place = ([right, forward]) => {
    const [lon, lat] = fromWorld([cx + right * Math.cos(turn) + forward * Math.sin(turn), cy + right * Math.sin(turn) - forward * Math.cos(turn)], view.zoom);
    return [((((lon + 180) % 360) + 360) % 360) - 180, lat];
  };
  return [[-w / 2, far], [w / 2, far], [w / 2, h / 2], [-w / 2, h / 2]].map(([u, v]) => place(ground(u, v)));
}

/** A round length a scale bar can say, at most `most` metres. */
export function roundLength(most) {
  if (!(most > 0)) return 0;
  const power = 10 ** Math.floor(Math.log10(most));
  const step = [5, 2, 1].find((factor) => factor * power <= most) ?? 1;
  return step * power;
}

/**
 * A scale bar fitting `width` CSS pixels: how long it is drawn, the length it
 * says, and its ticks. Metric unless `imperial`.
 */
export function scaleBar(view, width, imperial = false) {
  const perPixel = metresPerPixel(view);
  const unit = imperial ? 1609.344 : 1000;
  const most = width * perPixel;
  const inUnits = most >= unit;
  const base = inUnits ? unit : imperial ? 0.3048 : 1;
  const length = roundLength(most / base) * base;
  const pixels = length / perPixel;
  const said = length / base;
  const name = inUnits ? (imperial ? 'mi' : 'km') : (imperial ? 'ft' : 'm');
  // a bar of 5 reads in fifths, of 2 in quarters, of 1 in halves
  const lead = Math.round(said / 10 ** Math.floor(Math.log10(said || 1)));
  return { pixels, label: `${said.toLocaleString('en-GB', { maximumFractionDigits: 2 })} ${name}`,
    segments: lead === 5 ? 5 : lead === 2 ? 4 : 2 };
}

const STEPS = [30, 15, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.025, 0.01, 0.005, 0.0025, 0.001];

/**
 * The graticule over a frame: about four to eight lines each way, at a round
 * step (or `chosen`, in degrees), each with the places it meets the frame's edge
 * for its label.
 */
export function graticule(view, frame, chosen = null) {
  const ground = corners(view, frame);
  const lons = ground.map(([lon]) => lon);
  const lats = ground.map(([, lat]) => lat);
  const west = Math.min(...lons);
  const east = Math.max(...lons);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const span = Math.max(east - west, north - south);
  const step = chosen && span / chosen <= 60 ? chosen : STEPS.find((candidate) => span / candidate >= 3) ?? STEPS.at(-1);
  const lines = [];
  for (let lon = Math.ceil(west / step) * step; lon <= east; lon += step) {
    lines.push({ axis: 'lon', value: lon, points: sample([lon, south], [lon, north]).map((point) => project(view, frame, point)) });
  }
  for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
    lines.push({ axis: 'lat', value: lat, points: sample([west, lat], [east, lat]).map((point) => project(view, frame, point)) });
  }
  return { step, lines };
}

function sample(from, to, count = 24) {
  return Array.from({ length: count + 1 }, (_, index) => [from[0] + ((to[0] - from[0]) * index) / count, from[1] + ((to[1] - from[1]) * index) / count]);
}

/** `48°51′N`, `2°21′E`: a graticule line's label, to the minute its step needs. */
export function degreeLabel(value, axis, step) {
  const hemisphere = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
  const whole = Math.abs(value);
  let degrees = Math.floor(whole + 1e-9);
  let minutes = Math.round((whole - degrees) * 60 * (step < 1 / 60 ? 10 : 1)) / (step < 1 / 60 ? 10 : 1);
  if (minutes >= 60) { degrees += 1; minutes = 0; }
  return step >= 1 ? `${degrees}°${hemisphere}` : `${degrees}°${String(minutes).padStart(2, '0')}′${hemisphere}`;
}

/** A graticule step a plate's inspector offers, in degrees. */
export const GRATICULE_STEPS = STEPS;

// -- what a frame shows ----------------------------------------------------------------

/** Whether a segment between two frame points crosses the frame. */
function crosses([x1, y1], [x2, y2], frame) {
  if (Math.max(x1, x2) < 0 || Math.min(x1, x2) > frame.width || Math.max(y1, y2) < 0 || Math.min(y1, y2) > frame.height) return false;
  // a segment whose box overlaps the frame crosses it unless all four corners lie on one side of its line
  const side = ([px, py]) => Math.sign((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1));
  const signs = [[0, 0], [frame.width, 0], [frame.width, frame.height], [0, frame.height]].map(side);
  return !(signs.every((sign) => sign > 0) || signs.every((sign) => sign < 0));
}

function inside(point, frame, margin) {
  return point[0] >= -margin && point[1] >= -margin && point[0] <= frame.width + margin && point[1] <= frame.height + margin;
}

/** Whether a point of the frame lies inside a ring of frame points (even-odd). */
function within(point, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi || 1e-12) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Whether a feature's geometry is drawn in a map's frame: a point inside it (a marker's
 * half-width of slack, `margin` pixels), a line crossing it, an area overlapping it.
 */
export function inFrame(geometry, view, frame, margin = 6, place = null) {
  if (!geometry || !view || !frame) return false;
  const type = String(geometry.type);
  // a map in 3D places the ground through its own camera (`place`), the flat sum would miss what it shows
  const at = place ?? ((point) => project(view, frame, point));
  if (type === 'Point') return inside(at(geometry.coordinates), frame, margin);
  if (type === 'MultiPoint') return geometry.coordinates.some((point) => inside(at(point), frame, margin));
  if (type === 'GeometryCollection') return (geometry.geometries ?? []).some((part) => inFrame(part, view, frame, margin, place));
  const lines = type === 'LineString' ? [geometry.coordinates]
    : type === 'MultiLineString' || type === 'Polygon' ? geometry.coordinates
      : type === 'MultiPolygon' ? geometry.coordinates.flat() : [];
  for (const line of lines) {
    const points = line.map(at);
    if (points.some((point) => inside(point, frame, margin))) return true;
    for (let index = 1; index < points.length; index += 1) if (crosses(points[index - 1], points[index], frame)) return true;
  }
  // an area wider than the frame on every side holds its middle
  if (type.includes('Polygon')) {
    const middle = [frame.width / 2, frame.height / 2];
    const polygons = type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.some((rings) => rings.length && within(middle, rings[0].map(at)));
  }
  return false;
}

// -- shapes on the ground ----------------------------------------------------------------

const R_EARTH = 6378137;

/** The point `metres` from `[lon, lat]` on a bearing, as `[lon, lat]`. */
export function travel([lon, lat], bearing, metres) {
  const d = metres / R_EARTH;
  const phi = lat * RAD;
  const theta = bearing * RAD;
  const phi2 = Math.asin(Math.sin(phi) * Math.cos(d) + Math.cos(phi) * Math.sin(d) * Math.cos(theta));
  const lambda2 = lon * RAD + Math.atan2(Math.sin(theta) * Math.sin(d) * Math.cos(phi), Math.cos(d) - Math.sin(phi) * Math.sin(phi2));
  return [((((lambda2 / RAD) + 540) % 360) - 180), phi2 / RAD];
}

/** The ground distance between two `[lon, lat]`, in metres. */
export function distance([lon1, lat1], [lon2, lat2]) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** The initial bearing from one `[lon, lat]` to another, degrees from north. */
export function bearingTo([lon1, lat1], [lon2, lat2]) {
  const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
  const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}

/** A circle on the ground, `metres` round a centre, as a ring of `[lon, lat]`. */
export function circle(centre, metres, count = 96) {
  return Array.from({ length: count + 1 }, (_, index) => travel(centre, (index / count) * 360, metres));
}

/** A cone of sight from a point: its bearing, how wide it opens, how far it reaches. */
export function sector(centre, bearing, spread, metres, count = 48) {
  const start = bearing - spread / 2;
  const arc = Array.from({ length: count + 1 }, (_, index) => travel(centre, start + (index / count) * spread, metres));
  return spread >= 360 ? arc : [centre, ...arc, centre];
}

// -- the UTM grid --------------------------------------------------------------------------

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;

/** A UTM point back to `[lon, lat]`: `zone`, `north` (the hemisphere), easting and northing in metres. */
export function fromUTM(zone, north, easting, northing) {
  const x = easting - 500000;
  const y = north ? northing : northing - 10000000;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * RAD;
  const M = y / K0;
  const mu = M / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sin = Math.sin(phi1);
  const cos = Math.cos(phi1);
  const tan = Math.tan(phi1);
  const N1 = A / Math.sqrt(1 - E2 * sin * sin);
  const T1 = tan * tan;
  const C1 = EP2 * cos * cos;
  const R1 = (A * (1 - E2)) / (1 - E2 * sin * sin) ** 1.5;
  const D = x / (N1 * K0);
  const lat = phi1 - ((N1 * tan) / R1) * ((D * D) / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = lon0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6
    + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5) / 120) / cos;
  return [lon / RAD, lat / RAD];
}

/** `[lon, lat]` to `{ zone, north, easting, northing }` in the zone given (no zone change at its edge). */
export function toUTMIn(zone, [lon, lat]) {
  const lon0 = ((zone - 1) * 6 - 180 + 3) * RAD;
  const phi = lat * RAD;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * sin * sin);
  const T = tan * tan;
  const C = EP2 * cos * cos;
  let dLon = lon * RAD - lon0;
  if (dLon > Math.PI) dLon -= 2 * Math.PI;
  if (dLon < -Math.PI) dLon += 2 * Math.PI;
  const a = dLon * cos;
  const M = A * ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256) * phi
    - ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * E2 * E2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));
  const easting = K0 * N * (a + ((1 - T + C) * a ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a ** 5) / 120) + 500000;
  let northing = K0 * (M + N * tan * ((a * a) / 2 + ((5 - T + 9 * C + 4 * C * C) * a ** 4) / 24
    + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a ** 6) / 720));
  if (lat < 0) northing += 10000000;
  return { zone, north: lat >= 0, easting, northing };
}

const UTM_STEPS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50];

/**
 * The UTM grid over a frame, in the zone of its centre: about four to eight lines each
 * way at a round number of metres (or `step`), each line sampled so it bends as the
 * projection does, and labelled by its value in kilometres.
 */
export function utmGrid(view, frame, step = null) {
  const zone = Math.min(60, Math.floor((view.lon + 180) / 6) + 1);
  const ground = corners(view, frame);
  const utm = ground.map((point) => toUTMIn(zone, point));
  const north = view.lat >= 0;
  const eastings = utm.map((point) => point.easting);
  const northings = utm.map((point) => point.northing);
  const [e0, e1] = [Math.min(...eastings), Math.max(...eastings)];
  const [n0, n1] = [Math.min(...northings), Math.max(...northings)];
  const span = Math.max(e1 - e0, n1 - n0);
  const chosen = step ?? UTM_STEPS.find((candidate) => span / candidate >= 3) ?? UTM_STEPS.at(-1);
  const lines = [];
  const sampled = (from, to) => Array.from({ length: 25 }, (_, index) => from + ((to - from) * index) / 24);
  for (let e = Math.ceil(e0 / chosen) * chosen; e <= e1 && lines.length < 60; e += chosen) {
    lines.push({ axis: 'lon', value: e, points: sampled(n0, n1).map((n) => project(view, frame, fromUTM(zone, north, e, n))) });
  }
  for (let n = Math.ceil(n0 / chosen) * chosen; n <= n1 && lines.length < 120; n += chosen) {
    lines.push({ axis: 'lat', value: n, points: sampled(e0, e1).map((e) => project(view, frame, fromUTM(zone, north, e, n))) });
  }
  return { step: chosen, zone, north, lines };
}

/** A UTM grid line's label: kilometres, or the two digits an MGRS reader names inside its 100 km square. */
export function utmLabel(value, step, mgrs = false) {
  const km = Math.round(value / 1000);
  if (mgrs) return String(Math.floor((value % 100000) / 1000)).padStart(2, '0') + (step < 1000 ? `.${Math.round((value % 1000) / 100)}` : '');
  return step < 1000 ? (value / 1000).toFixed(1) : String(km);
}

/** A degree label as decimal degrees, to the places the step needs. */
export function decimalLabel(value, axis, step) {
  const places = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  const hemisphere = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
  return `${Math.abs(value).toFixed(places)}°${hemisphere}`;
}

/**
 * The plate's scale as a ratio, `1:25,000`: the ground one millimetre of paper covers
 * on a map at `view`, drawn at `pxPerMm` frame pixels a millimetre.
 */
export function scaleRatio(view, pxPerMm) {
  const ratio = metresPerPixel(view) * pxPerMm * 1000;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(ratio)) - 1);
  return `1:${(Math.round(ratio / magnitude) * magnitude).toLocaleString('en-GB')}`;
}
