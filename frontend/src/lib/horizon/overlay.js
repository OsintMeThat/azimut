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
import { focal, rayFor, turnBetween } from './camera.js';
import { heightFor } from './view.js';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

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

/** A stroke drawn in CSS pixels, as the photo's own coordinates (0 to 1), close points dropped. */
export function strokeFrom(points, size, { spacing = 1.5 } = {}) {
  const kept = [];
  let last = null;
  for (const point of points) {
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < spacing) continue;
    kept.push({ u: clamp(point.x / size.width, 0, 1), v: clamp(point.y / size.height, 0, 1) });
    last = point;
  }
  return kept;
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
