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

/** The ground the frame shows, as its four corners: what an inset outlines. */
export function corners(view, frame) {
  return [[0, 0], [frame.width, 0], [frame.width, frame.height], [0, frame.height]].map((point) => unproject(view, frame, point));
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
 * step, each with the places it meets the frame's edge for its label.
 */
export function graticule(view, frame) {
  const ground = corners(view, frame);
  const lons = ground.map(([lon]) => lon);
  const lats = ground.map(([, lat]) => lat);
  const west = Math.min(...lons);
  const east = Math.max(...lons);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const span = Math.max(east - west, north - south);
  const step = STEPS.find((candidate) => span / candidate >= 3) ?? STEPS.at(-1);
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
