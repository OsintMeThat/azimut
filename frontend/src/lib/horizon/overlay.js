/**
 * A photo or a video laid over the Horizon view: the arithmetic of matching it.
 *
 * The photo stays fixed on screen and the terrain moves under it, so the frame
 * the view draws into takes the photo's shape (`fitFrame`) and the camera's
 * field of view is the photo's own. What the analyst draws along the photo's
 * skyline is kept in the photo's coordinates, 0 to 1 across and down, so it
 * stays on the photo whatever the window does.
 *
 * Every reading here is an assist, never a verdict: the gap is the angle
 * between the traced skyline and the terrain's, in degrees, over how much of
 * the skyline was traced (`traceGap`); a fit turns the view to close that gap
 * from where the analyst left it (`fitToTrace`), it does not decide where the
 * photo was taken.
 *
 * A video adds time. A pin keeps the view's alignment at a moment of it, and
 * between two pins the view turns as the camera did (`cameraAt`).
 */
import { focal, principal, rayFor, turnBetween } from './camera.js';
import { headingText } from './geometry.js';
import { heightFor } from './view.js';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
/** A point of the photo, 0 to 1, to a millionth: far under a pixel of any photo laid. */
const fraction = (value) => Math.round(clamp(value, 0, 1) * 1e6) / 1e6;

/**
 * The largest box of a photo's shape inside the room there is, centred, in
 * whole CSS pixels: the photo letterboxed.
 *
 * @param {number} aspect width over height of the photo
 * @param {{ width: number, height: number }} room
 */
export function fitFrame(aspect, room) {
  if (!(aspect > 0) || !(room.width > 0) || !(room.height > 0)) return { width: 0, height: 0, left: 0, top: 0 };
  const width = Math.min(room.width, room.height * aspect);
  const height = width / aspect;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return { width: w, height: h, left: Math.round((room.width - w) / 2), top: Math.round((room.height - h) / 2) };
}

// -- the loupe ------------------------------------------------------------------

/** The most the loupe magnifies: well past a photo's own pixels, for a trace drawn to the pixel. */
export const LOUPE_MAX = 16;
/** The whole photo in the frame. */
export const NO_LOUPE = Object.freeze({ zoom: 1, x: 0.5, y: 0.5 });

/**
 * How far a photo pinned to the terrain lets the view go: out to this much
 * wider than the photo, and this many photo widths off its middle, where a
 * straight lens still draws the ground without stretching it past reading.
 */
export const FREE_ZOOM_MIN = 0.3;
export const FREE_REACH = 2;

/**
 * A loupe kept on the photo: never smaller than the frame, never looking past
 * the photo's edges. A photo pinned to the terrain (`free`) lets it go wider
 * and further, the terrain round the photo then showing.
 */
export function clampLoupe({ zoom, x, y }, { free = false } = {}) {
  const z = clamp(Number(zoom) || 1, free ? FREE_ZOOM_MIN : 1, LOUPE_MAX);
  const half = 0.5 / z;
  const within = (value) =>
    free ? clamp(Number.isFinite(value) ? value : 0.5, 0.5 - FREE_REACH, 0.5 + FREE_REACH) : clamp(Number(value) || 0.5, half, 1 - half);
  return { zoom: z, x: within(x), y: within(y) };
}

/** The point of the photo under a point of the screen (CSS pixels), 0 to 1 across and down. */
export function photoAt(loupe, x, y, size) {
  return { u: loupe.x + (x / size.width - 0.5) / loupe.zoom, v: loupe.y + (y / size.height - 0.5) / loupe.zoom };
}

/** Where a point of the photo is on screen, in CSS pixels. */
export function screenAt(loupe, u, v, size) {
  return { x: ((u - loupe.x) * loupe.zoom + 0.5) * size.width, y: ((v - loupe.y) * loupe.zoom + 0.5) * size.height };
}

/** The loupe magnified by a factor about a point of the screen, which keeps the point of the photo under it. */
export function zoomLoupe(loupe, factor, at, size, { free = false } = {}) {
  const under = photoAt(loupe, at.x, at.y, size);
  const zoom = clamp(loupe.zoom * factor, free ? FREE_ZOOM_MIN : 1, LOUPE_MAX);
  return clampLoupe({ zoom, x: under.u - (at.x / size.width - 0.5) / zoom, y: under.v - (at.y / size.height - 0.5) / zoom }, { free });
}

/** The loupe moved with the hand: the photo follows a drag of `dx`, `dy` CSS pixels. */
export function panLoupe(loupe, dx, dy, size, { free = false } = {}) {
  return clampLoupe({ ...loupe, x: loupe.x - dx / size.width / loupe.zoom, y: loupe.y - dy / size.height / loupe.zoom }, { free });
}

/** Whether a loupe shows anything but the whole photo in the frame. */
export const loupeMoved = (loupe) => Boolean(loupe) && (loupe.zoom !== 1 || loupe.x !== 0.5 || loupe.y !== 0.5);


// -- a lens's curve --------------------------------------------------------------

/** The most a photo's lens curve is undone either way: the curve stays one to one out to the corners. */
export const BEND_MAX = 0.3;

/** A photo's half-diagonal in its own coordinates across and down, which the curve is measured in. */
export function bendShape(aspect) {
  const diagonal = Math.hypot(aspect, 1);
  return { across: (2 * aspect) / diagonal, down: 2 / diagonal };
}

const bendRadius = (u, v, shape) => Math.hypot((u - 0.5) * shape.across, (v - 0.5) * shape.down);

/**
 * Where a curving lens put a point a straight one would have put at `point`,
 * both the photo's own (0 to 1): the photo's pixel that belongs there. `k` < 0
 * is a barrel (the edges bowed in, a wide lens, an action camera), `k` > 0 a
 * pincushion; the distance from the middle grows by 1 + k r², r in
 * half-diagonals, so k = −0.1 pulls the corners in by a tenth.
 */
export function bent(point, k, shape) {
  if (!k) return point;
  const r = bendRadius(point.u, point.v, shape);
  const grow = 1 + k * r * r;
  return { u: 0.5 + (point.u - 0.5) * grow, v: 0.5 + (point.v - 0.5) * grow };
}

/** …and back: where a straight lens would have put the photo's pixel at `point`. */
export function straightened(point, k, shape) {
  if (!k) return point;
  const far = bendRadius(point.u, point.v, shape);
  if (!(far > 0)) return point;
  // the radius a straight lens gives, r + k r³ = far, by Newton from the curved one
  let r = far;
  for (let i = 0; i < 12; i += 1) {
    const step = (r + k * r * r * r - far) / (1 + 3 * k * r * r);
    r -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  const shrink = r / far;
  return { u: 0.5 + (point.u - 0.5) * shrink, v: 0.5 + (point.v - 0.5) * shrink };
}

// -- the photo's shape, pulled by its corners ----------------------------------------

/**
 * The photo's four corners where it lies untouched, in the frame's own
 * coordinates (0 to 1 across and down): top left, top right, bottom right,
 * bottom left. A warp is the same four, moved: the photo is drawn between
 * them in perspective, as a collage's piece is, which squares a photo taken
 * at a slant or squeezes a stretched one back.
 */
export const FLAT_CORNERS = Object.freeze([
  Object.freeze({ u: 0, v: 0 }),
  Object.freeze({ u: 1, v: 0 }),
  Object.freeze({ u: 1, v: 1 }),
  Object.freeze({ u: 0, v: 1 }),
]);

/** How far past the frame a corner may be pulled, in frames: far enough to stretch, near enough to find again. */
export const WARP_REACH = 1;

/** A corner kept within reach of the frame. */
export function clampCorner({ u, v }) {
  return { u: clamp(u, -WARP_REACH, 1 + WARP_REACH), v: clamp(v, -WARP_REACH, 1 + WARP_REACH) };
}

/** Whether four corners are where an untouched photo has them. */
export function isFlat(corners) {
  return !corners || corners.every((corner, index) => Math.abs(corner.u - FLAT_CORNERS[index].u) < 1e-9 && Math.abs(corner.v - FLAT_CORNERS[index].v) < 1e-9);
}

/**
 * The 3×3 matrix, row by row, that takes a point of the photo (0 to 1) to
 * where it lies between four corners (Heckbert's square to quad). Null when
 * the corners have folded onto a line.
 */
export function warpMatrix(corners) {
  const [p0, p1, p2, p3] = corners;
  const sx = p0.u - p1.u + p2.u - p3.u;
  const sy = p0.v - p1.v + p2.v - p3.v;
  const dx1 = p1.u - p2.u;
  const dx2 = p3.u - p2.u;
  const dy1 = p1.v - p2.v;
  const dy2 = p3.v - p2.v;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-12) return null;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return [
    p1.u - p0.u + g * p1.u, p3.u - p0.u + h * p3.u, p0.u,
    p1.v - p0.v + g * p1.v, p3.v - p0.v + h * p3.v, p0.v,
    g, h, 1,
  ];
}

/** A 3×3 matrix's inverse, row by row; null for one that has none. */
export function invertMatrix(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

/** A point through a 3×3 matrix, in perspective. */
export function throughMatrix(m, { u, v }) {
  const w = m[6] * u + m[7] * v + m[8];
  return { u: (m[0] * u + m[1] * v + m[2]) / w, v: (m[3] * u + m[4] * v + m[5]) / w };
}

/** Where a point of the photo lies in the frame once its corners are pulled. */
export function warped(point, corners) {
  const m = corners && !isFlat(corners) ? warpMatrix(corners) : null;
  return m ? throughMatrix(m, point) : point;
}

/** …and back: the point of the photo under a point of the frame. */
export function unwarped(point, corners) {
  const m = corners && !isFlat(corners) ? warpMatrix(corners) : null;
  const back = m && invertMatrix(m);
  return back ? throughMatrix(back, point) : point;
}

/**
 * What the GPU reads a pixel of the photo through: the frame to the photo,
 * as a 3×3 matrix column by column (GLSL's order). The identity for none.
 */
export function warpUniform(corners) {
  const m = corners && !isFlat(corners) ? warpMatrix(corners) : null;
  const back = m ? invertMatrix(m) : null;
  if (!back) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return [back[0], back[3], back[6], back[1], back[4], back[7], back[2], back[5], back[8]];
}

/** Whether a point of the frame lies inside the four corners. */
export function insideCorners(point, corners) {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
    const a = corners[i];
    const b = corners[j];
    if (a.v > point.v !== b.v > point.v && point.u < ((b.u - a.u) * (point.v - a.v)) / (b.v - a.v) + a.u) inside = !inside;
  }
  return inside;
}

/**
 * A stroke drawn in CSS pixels, as the photo's own coordinates (0 to 1), close
 * points dropped; through a loupe, the point of the photo under each.
 */
export function strokeFrom(points, size, { spacing = 1.5, loupe = NO_LOUPE } = {}) {
  const kept = [];
  let last = null;
  for (const point of points) {
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < spacing) continue;
    const at = photoAt(loupe, point.x, point.y, size);
    kept.push({ u: fraction(at.u), v: fraction(at.v) });
    last = point;
  }
  return kept;
}

const between = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function pointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / length, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function crosses(a, b, c, d) {
  const side = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

function segmentToSegment(a, b, c, d) {
  if (crosses(a, b, c, d)) return 0;
  return Math.min(pointToSegment(a, c, d), pointToSegment(b, c, d), pointToSegment(c, a, b), pointToSegment(d, a, b));
}

/**
 * Strokes with what lies within `radius` screen pixels of a path rubbed out.
 * Strokes and path are in the photo's coordinates; `scale` is the photo's
 * size on screen (through a loupe, its magnified size). A stroke rubbed
 * through the middle becomes two, and a piece too short to be a line goes.
 * The strokes come back as they were when nothing was rubbed.
 */
export function eraseStrokes(strokes, path, radius, scale) {
  if (!path.length || !(radius > 0)) return strokes;
  const toPx = (p) => ({ x: p.u * scale.width, y: p.v * scale.height });
  const toPhoto = (p) => ({ u: fraction(p.x / scale.width), v: fraction(p.y / scale.height) });
  const rub = path.map(toPx);
  const rubs = rub.length > 1 ? rub.slice(1).map((end, i) => [rub[i], end]) : [[rub[0], rub[0]]];
  const near = (p) => rubs.some(([a, b]) => pointToSegment(p, a, b) < radius);
  const touches = (a, b) => rubs.some(([c, d]) => segmentToSegment(a, b, c, d) < radius);
  let changed = false;
  const kept = [];
  for (const stroke of strokes) {
    const line = stroke.map(toPx);
    let piece = [];
    const close = () => {
      if (piece.length > 1) kept.push(piece);
      piece = [];
    };
    if (near(line[0])) changed = true;
    else piece.push(stroke[0]);
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      if (!touches(a, b)) {
        piece.push(stroke[i]);
        continue;
      }
      // the stretch the rubber crossed, walked finely enough to cut it where it did
      changed = true;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (radius / 3)));
      for (let k = 1; k <= steps; k += 1) {
        const at = k === steps ? b : between(a, b, k / steps);
        if (near(at)) close();
        else piece.push(k === steps ? stroke[i] : toPhoto(at));
      }
    }
    close();
  }
  return changed ? kept : strokes;
}

/** The most points a trace is read at: plenty for a skyline, cheap enough per frame. */
export const TRACE_SAMPLES = 480;

/**
 * Points along every stroke, evenly spaced on screen, in CSS pixels of a frame
 * this size: a stroke drawn slowly weighs no more than one drawn fast.
 */
export function traceSamples(strokes, size, { spacing = 4, most = TRACE_SAMPLES } = {}) {
  if (!(size.width > 0) || !(size.height > 0)) return [];
  const lines = strokes.map((stroke) => stroke.map((p) => ({ x: p.u * size.width, y: p.v * size.height })));
  let length = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) length += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
  }
  const step = Math.max(spacing, length / most);
  const samples = [];
  for (const line of lines) {
    if (line.length === 1) {
      samples.push(line[0]);
      continue;
    }
    let carried = 0;
    samples.push(line[0]);
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      let at = step - carried;
      while (at <= span) {
        const t = at / span;
        samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        at += step;
      }
      carried = span - (at - step);
    }
  }
  return samples.slice(0, most * 2);
}

/**
 * The terrain's skyline at an azimuth, between the two columns either side:
 * degrees, or null where no ground stands (open sea, off a window).
 */
export function skylineBetween(panorama, azimuth) {
  if (!panorama?.skyline?.length) return null;
  const { start, step, count, full } = panorama.azimuth;
  const x = ((((azimuth - start) % 360) + 360) % 360) / step;
  const c0 = Math.floor(x);
  const turn = full === false ? Infinity : count;
  const i0 = c0 % turn;
  const i1 = (c0 + 1) % turn;
  if (i0 >= count || i1 >= count) return null;
  const a = panorama.skyline[i0];
  const b = panorama.skyline[i1];
  if (!Number.isFinite(a) && !Number.isFinite(b)) return null;
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  return a + (b - a) * (x - c0);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** How each sampled point stands against the terrain's skyline, through a camera: degrees, + above it. */
function residuals(samples, camera, skyline) {
  const out = [];
  for (const sample of samples) {
    const ray = rayFor(camera, sample.x, sample.y);
    const top = skyline(ray.azimuth);
    if (top == null) continue;
    out.push({ gap: ray.elevation - top, azimuth: ray.azimuth });
  }
  return out;
}

/** Degrees of the turn the trace covers, counted in quarter-degree slices so a back-and-forth counts once. */
function spanOf(found) {
  const slices = new Set(found.map((r) => Math.floor((((r.azimuth % 360) + 360) % 360) * 4)));
  return slices.size / 4;
}

/** A trace reads nothing below this many points against the terrain. */
export const GAP_MIN_POINTS = 6;

/**
 * How far the traced skyline lies from the terrain's: the median of the
 * angle between them, in degrees, over how many degrees of the turn the trace
 * covers, and the median signed offset (+ the trace stands above the terrain).
 * Null while too little of the trace meets ground.
 *
 * @param {{x:number, y:number}[]} samples from `traceSamples`
 * @param {object} camera the view's camera with its frame's width and height
 * @param {(azimuth: number) => number|null} skyline the terrain's, in degrees
 */
export function traceGap(samples, camera, skyline) {
  const found = residuals(samples, camera, skyline);
  if (found.length < GAP_MIN_POINTS) return null;
  return {
    median: median(found.map((r) => Math.abs(r.gap))),
    offset: median(found.map((r) => r.gap)),
    span: spanOf(found),
    points: found.length,
  };
}

/** The gap's median in degrees as it is written: two decimals under 1°, one under 10°. */
export function gapDegrees(gap) {
  const m = gap.median;
  return m < 1 ? m.toFixed(2) : m < 10 ? m.toFixed(1) : String(Math.round(m));
}

/** How many degrees of skyline the trace covers, as it is written. */
export function gapSpan(gap) {
  return gap.span < 10 ? gap.span.toFixed(1) : String(Math.round(gap.span));
}

/** "Gap 0.41° median over 52° of skyline": the whole reading, for a toast or a label. */
export function gapText(gap) {
  if (!gap) return '';
  return `Gap ${gapDegrees(gap)}° median over ${gapSpan(gap)}° of skyline`;
}

// a robust loss in pixels: square near the line, straight past a few pixels, so
// a stretch traced over a nearer ridge pulls no harder than its length
const HUBER_PX = 3;
function huber(px) {
  const a = Math.abs(px);
  return a <= HUBER_PX ? 0.5 * a * a : HUBER_PX * (a - 0.5 * HUBER_PX);
}

/**
 * The cost of a camera against the trace, in screen pixels so a narrower lens
 * cannot make every point fit by squeezing the trace into one degree.
 */
function costOf(samples, camera, skyline) {
  const found = residuals(samples, camera, skyline);
  if (found.length < GAP_MIN_POINTS) return Infinity;
  const perDegree = (focal(camera) * Math.PI) / 180;
  let sum = 0;
  for (const r of found) sum += huber(r.gap * perDegree);
  // points lost off the terrain count as far off, or a fit could drop the hard ones
  const lost = samples.length - found.length;
  return (sum + lost * huber(HUBER_PX * 4)) / samples.length;
}

/** Nelder–Mead over a few numbers: small, derivative-free, enough for four. */
function minimise(cost, start, steps, { iterations = 220, tolerance = 1e-4 } = {}) {
  const n = start.length;
  let simplex = [start, ...steps.map((step, i) => start.map((v, j) => (j === i ? v + step : v)))].map((point) => ({
    point,
    value: cost(point),
  }));
  for (let k = 0; k < iterations; k += 1) {
    simplex.sort((a, b) => a.value - b.value);
    const best = simplex[0];
    const worst = simplex[n];
    if (Math.abs(worst.value - best.value) <= tolerance * (Math.abs(best.value) + 1e-9)) break;
    const centre = start.map((_, j) => simplex.slice(0, n).reduce((sum, s) => sum + s.point[j], 0) / n);
    const toward = (t) => centre.map((c, j) => c + t * (worst.point[j] - c));
    const reflected = toward(-1);
    const r = cost(reflected);
    if (r < best.value) {
      const expanded = toward(-2);
      const e = cost(expanded);
      simplex[n] = e < r ? { point: expanded, value: e } : { point: reflected, value: r };
    } else if (r < simplex[n - 1].value) {
      simplex[n] = { point: reflected, value: r };
    } else {
      const contracted = toward(r < worst.value ? -0.5 : 0.5);
      const c = cost(contracted);
      if (c < Math.min(r, worst.value)) simplex[n] = { point: contracted, value: c };
      else {
        simplex = simplex.map((s, i) =>
          i === 0 ? s : { point: s.point.map((v, j) => best.point[j] + 0.5 * (v - best.point[j])), value: NaN }
        );
        for (const s of simplex) if (Number.isNaN(s.value)) s.value = cost(s.point);
      }
    }
  }
  simplex.sort((a, b) => a.value - b.value);
  return simplex[0];
}

/** A trace shorter than this many degrees of the turn says too little to fit the lens or the roll. */
export const FIT_MIN_SPAN = 4;

/**
 * The camera that brings the terrain's skyline onto the trace, from where the
 * analyst left it: first the heading slid across a third of the lens with the
 * tilt that best centres the trace at each, then heading, tilt, roll (and the
 * lens, unless the photo said it) refined together. Null when the trace meets
 * too little ground to say.
 *
 * @param {{x:number, y:number}[]} samples
 * @param {object} camera with the frame's width and height
 * @param {(azimuth: number) => number|null} skyline
 * @param {{ lens?: boolean }} [options] `lens`: whether the field of view may change too
 */
export function fitToTrace(samples, camera, skyline, { lens = true } = {}) {
  const before = traceGap(samples, camera, skyline);
  if (!before) return null;
  const at = (heading, tilt, roll, fov) => ({ ...camera, heading, tilt, roll, fov });
  // a slide over the heading, the tilt following the trace's median offset
  let slid = { heading: camera.heading, tilt: camera.tilt, value: Infinity };
  const reach = camera.fov / 3;
  const pace = Math.max(0.02, camera.fov / 240);
  for (let turn = -reach; turn <= reach + 1e-9; turn += pace) {
    const heading = camera.heading + turn;
    const tried = traceGap(samples, at(heading, camera.tilt, camera.roll, camera.fov), skyline);
    if (!tried) continue;
    const tilt = camera.tilt - tried.offset;
    // the nearer of two equal fits wins: the analyst's own placing is a hint
    const value = costOf(samples, at(heading, tilt, camera.roll, camera.fov), skyline) * (1 + 0.15 * Math.abs(turn / camera.fov));
    if (value < slid.value) slid = { heading, tilt, value };
  }
  const wide = before.span >= FIT_MIN_SPAN;
  const free = lens && wide;
  const unpack = (p) => at(p[0], p[1], wide ? p[2] : camera.roll, free ? camera.fov * Math.exp(p[3]) : camera.fov);
  const start = [slid.heading, slid.tilt, ...(wide ? [camera.roll] : []), ...(free ? [0] : [])];
  const steps = [pace * 4, pace * 4, ...(wide ? [1] : []), ...(free ? [0.04] : [])];
  const best = minimise((p) => costOf(samples, unpack(p), skyline), start, steps);
  const fitted = unpack(best.point);
  const after = traceGap(samples, fitted, skyline);
  if (!after || after.median > before.median) return { camera: { ...camera }, gap: before, improved: false };
  return {
    camera: {
      ...camera,
      heading: ((fitted.heading % 360) + 360) % 360,
      tilt: fitted.tilt,
      roll: fitted.roll,
      fov: fitted.fov,
    },
    gap: after,
    improved: true,
  };
}

// -- the whole turn searched -----------------------------------------------------

/**
 * The trace on the picture plane, as the whole-turn search reads it
 * (`/api/horizon/match`, engine/skymatch.py): each point right and up from the
 * lens's middle in half widths of the frame, and that half width on screen.
 * A lens F degrees wide sees a point (x, y) along tangents (x, y)·tan(F/2), so
 * the search can try other lenses on the same points.
 */
export function tracePlane(samples, camera) {
  const half = focal(camera) * Math.tan((camera.fov * Math.PI) / 360);
  const centre = principal(camera);
  return {
    x: samples.map((s) => (s.x - centre.x) / half),
    y: samples.map((s) => -(s.y - centre.y) / half),
    half_width: half,
  };
}

/**
 * What to ask the search: the trace, the camera it starts from, and the turn
 * the view already marched, so it reads the skyline the analyst sees. Null
 * while that turn is not whole (a window of it), when only a fit from here can.
 *
 * @param {{ known?: boolean }} [options] `known`: the photo said its lens, which is then the only one tried
 */
export function matchRequest(samples, camera, panorama, { known = false } = {}) {
  if (!panorama?.skyline?.length || panorama.azimuth?.full === false) return null;
  return {
    skyline: panorama.skyline,
    start: panorama.azimuth.start,
    step: panorama.azimuth.step,
    ...tracePlane(samples, camera),
    fov: camera.fov,
    known,
    tilt: camera.tilt,
    roll: camera.roll ?? 0,
  };
}

/**
 * Each place the search found, brought onto the trace here as Fit brings the
 * analyst's own placing: `{ camera, gap, explained, close }`, best first. A
 * place the refinement cannot improve stays as the search left it.
 *
 * @param {{ fits: object[] }} found the search's answer
 * @param {{ lens?: boolean }} [options] `lens`: whether the field of view may change
 */
export function searchedPlaces(found, samples, camera, skyline, { lens = true } = {}) {
  return (found?.fits ?? []).map((fit) => {
    const start = { ...camera, heading: fit.heading, tilt: fit.tilt, fov: lens ? fit.fov : camera.fov };
    const refined = fitToTrace(samples, start, skyline, { lens });
    const placed = refined?.improved ? refined.camera : start;
    return { camera: placed, gap: traceGap(samples, placed, skyline), explained: fit.explained, close: fit.close };
  });
}

/**
 * The place a Fit turns to: the best, unless another about as good lies
 * within half the lens of where the analyst was looking, whose placing then
 * decides between them. -1 when there is none.
 */
export function placeToTake(places, camera) {
  let pick = places.length ? 0 : -1;
  let nearest = Infinity;
  places.forEach((place, i) => {
    if (!place.close) return;
    const away = Math.abs(turnBetween(camera.heading, place.camera.heading));
    if (away <= camera.fov / 2 && away < nearest) {
      nearest = away;
      pick = i;
    }
  });
  return pick;
}

/**
 * What a Fit does with the search's answer: `take`, the place it turns to (-1
 * for none), `closest`, the place a "Show the closest" offers when it turns to
 * none, and the toast's `text` and `kind`. `before` is the gap the view had.
 */
export function searchOutcome(found, places, camera, { lens = true, before = null } = {}) {
  const at = placeToTake(places, camera);
  const place = places[at];
  const where = (p) => headingText(p.camera.heading, p.camera.fov);
  if (found.verdict === 'none' || !place) {
    const [low, high] = found.lenses ?? [];
    const range = lens && low < high ? ` with a lens of ${Math.round(low)}° to ${Math.round(high)}°` : '';
    return { take: -1, closest: place ? 0 : -1, text: `Nothing on this horizon matches the trace${range}`, kind: 'warn' };
  }
  // the view already stands at that place, and the fit would not bring the trace closer
  const stay = isSamePlace(camera, place) && !closer(place.gap, before);
  const take = stay ? -1 : at;
  if (found.verdict === 'ambiguous') {
    const other = places.find((p, i) => i !== at && p.close);
    const also = other ? `, and ${where(other)} fits about as well` : '';
    return { take, closest: -1, text: `Fitted at ${where(place)}${also}`, kind: 'warn' };
  }
  if (found.verdict === 'loose') {
    return { take, closest: -1, text: `Loose fit at ${where(place)}: compare the ridges with the photo`, kind: 'warn' };
  }
  if (stay) return { take, closest: -1, text: 'The view is already as close to the trace as a fit gets', kind: 'info' };
  const gaps = before && place.gap ? `: gap ${gapDegrees(before)}° to ${gapDegrees(place.gap)}°` : '';
  return { take, closest: -1, text: `Fitted at ${where(place)}${gaps}`, kind: 'ok' };
}

/** Within a tenth of the lens, and never under a degree: the same place on the turn. */
function isSamePlace(camera, place) {
  return Math.abs(turnBetween(camera.heading, place.camera.heading)) < Math.max(1, camera.fov / 10);
}

/** Whether a gap is closer than another by more than a twentieth, which a fit again would not be. */
function closer(gap, before) {
  if (!gap || !before) return true;
  return gap.median < before.median * 0.95;
}

/** Whether the view is at a place: the same heading, tilt and lens to a twentieth of a degree. */
export function isAtPlace(camera, place) {
  const near = (a, b) => Math.abs(a - b) < 0.05;
  return (
    near(turnBetween(camera.heading, place.camera.heading), 0) &&
    near(camera.tilt, place.camera.tilt) &&
    near(camera.fov, place.camera.fov)
  );
}

// -- a video's pins ------------------------------------------------------------

/** Two pins nearer in time than this are the same moment. */
export const PIN_SLACK_S = 0.05;

/** The pins with this camera kept at this moment, replacing one already there; sorted by time. */
export function pinAt(pins, time, camera) {
  const pin = { time, heading: camera.heading, tilt: camera.tilt, roll: camera.roll, fov: camera.fov };
  return [...pins.filter((p) => Math.abs(p.time - time) > PIN_SLACK_S), pin].sort((a, b) => a.time - b.time);
}

/**
 * The camera at a moment of the video, between the pins either side: the
 * heading turns the short way round, the rest moves evenly; before the first
 * pin and after the last the view holds. Null without pins.
 */
export function cameraAt(pins, time) {
  if (!pins.length) return null;
  const pick = ({ heading, tilt, roll, fov }) => ({ heading, tilt, roll, fov });
  if (time <= pins[0].time) return pick(pins[0]);
  const last = pins.at(-1);
  if (time >= last.time) return pick(last);
  const after = pins.findIndex((p) => p.time > time);
  const a = pins[after - 1];
  const b = pins[after];
  const t = (time - a.time) / (b.time - a.time);
  const heading = a.heading + turnBetween(a.heading, b.heading) * t;
  return {
    heading: ((heading % 360) + 360) % 360,
    tilt: a.tilt + (b.tilt - a.tilt) * t,
    roll: a.roll + (b.roll - a.roll) * t,
    // a lens zooms evenly on a log scale, as the eye reads it
    fov: Math.exp(Math.log(a.fov) + (Math.log(b.fov) - Math.log(a.fov)) * t),
  };
}

// -- the eye's height from the wheel ---------------------------------------------

/** How much one notch of the wheel raises or lowers the eye, as a share of its height. */
export const HEIGHT_NOTCH = 0.12;

/**
 * The eye's height after `notches` of the wheel (+ up): by a share of the
 * height, so a walker moves by a hand and an aircraft by a hundred metres,
 * rounded to what each eye is set in, kept within its limits.
 */
export function heightStep(mode, height, notches) {
  const next = height * Math.exp(HEIGHT_NOTCH * notches);
  const grain = mode === 'ground' ? 0.1 : mode === 'drone' ? 1 : 10;
  let rounded = Math.round(next / grain) * grain;
  // a notch always moves the eye, even where rounding would keep it in place
  if (rounded === height && notches) rounded = height + Math.sign(notches) * grain;
  return heightFor(mode, Number(rounded.toFixed(1)));
}

/** What the eye's height is called for each eye, as the inspector names it. */
export const HEIGHT_NAMES = { ground: 'Eye height', drone: 'Height above ground', aircraft: 'Altitude above sea' };

/** "Eye height 1.9 m": the height as the wheel leaves it, in the metres the inspector sets it in. */
export function heightText(mode, height) {
  const shown = mode === 'ground' ? Number(height.toFixed(1)) : Math.round(height);
  return `${HEIGHT_NAMES[mode] ?? HEIGHT_NAMES.ground} ${shown.toLocaleString('en-US')} m`;
}

// -- the photo's own claims ---------------------------------------------------

/**
 * The day and minute a photo says it was taken, on the place's clock, as the
 * sun's day and time are set: `{ date: 'YYYY-MM-DD', time: 'HH:MM' }`, or null.
 *
 * A camera clock with no zone (EXIF) is taken as the local time there, which is
 * what a camera is usually set to. A time with a zone or a Z (a video's
 * container) is turned to the place's clock, which needs its zone's name.
 *
 * @param {string} taken ISO 8601
 * @param {string} [zone] the place's IANA zone
 */
export function localClock(taken, zone) {
  const text = String(taken ?? '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(text);
  if (!match) return null;
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
  if (!zoned) return { date: match[1], time: `${match[2]}:${match[3]}`, camera: true };
  if (!zone) return null;
  const moment = new Date(text);
  if (Number.isNaN(moment.getTime())) return null;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(moment)
        .map((part) => [part.type, part.value])
    );
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, camera: false };
  } catch {
    return null;
  }
}

/** Whether a time names its zone (a video's UTC stamp), so the place's zone is needed to read it. */
export function isZoned(taken) {
  return /(Z|[+-]\d{2}:?\d{2})$/i.test(String(taken ?? '').trim());
}
