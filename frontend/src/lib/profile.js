/**
 * An elevation profile drawn as a chart, from what `/api/terrain/profile`
 * answers.
 *
 * With a line of sight asked for, the ground is drawn with the Earth's bulge
 * between the two ends added to it (`bulge_m`), which is what lets the sight
 * line be drawn straight: a chart of a curved planet with a straight ruler on
 * it. Pure, so the shapes are read off a test.
 */

/** Total climb and descent along the profile, and its lowest and highest points. */
export function climb(elevation) {
  let up = 0;
  let down = 0;
  for (let i = 1; i < elevation.length; i += 1) {
    const step = elevation[i] - elevation[i - 1];
    if (step > 0) up += step;
    else down -= step;
  }
  return { up, down, min: Math.min(...elevation), max: Math.max(...elevation) };
}

/**
 * The gradient in percent at each sample, read over its two neighbours so one
 * noisy pixel of terrain does not read as a cliff.
 */
export function slopes(distance, elevation) {
  const last = distance.length - 1;
  return distance.map((_, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(last, i + 1);
    const run = distance[b] - distance[a];
    return run > 0 ? ((elevation[b] - elevation[a]) / run) * 100 : 0;
  });
}

/** A round step that cuts `span` into about `count` parts: 1, 2 or 5 × 10ⁿ. */
export function niceStep(span, count) {
  if (!(span > 0)) return 1;
  const rough = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(rough));
  for (const unit of [1, 2, 5, 10]) {
    if (unit * power >= rough) return unit * power;
  }
  return 10 * power;
}

/** How an axis counts, per system: a short and a long unit for distance, one for height. */
const AXIS_UNITS = {
  metric: { short: ['m', 1], long: ['km', 0.001], height: ['m', 1] },
  imperial: { short: ['ft', 3.28084], long: ['mi', 1 / 1609.344], height: ['ft', 3.28084] },
  nautical: { short: ['m', 1], long: ['NM', 1 / 1852], height: ['m', 1] },
};

/** A tick's number without trailing zeros: 1, 2.5, 500. */
function plain(value) {
  return String(Number(value.toFixed(3)));
}

/** A slope as a reader takes it: degrees, which stay readable up a cliff. */
export function gradeDegrees(percent) {
  return (Math.atan(Math.abs(percent) / 100) * 180) / Math.PI;
}

/**
 * How steep the ground reads at a glance, in the bands the crest is coloured
 * in: a walk, a climb, a scramble, a cliff. Bounds are in degrees.
 */
export const SLOPE_BANDS = [
  { id: 'flat', below: 3, colour: '#6fcf97', label: 'under 3°' },
  { id: 'gentle', below: 8, colour: '#c6d65e', label: '3 to 8°' },
  { id: 'steep', below: 15, colour: '#efb446', label: '8 to 15°' },
  { id: 'harsh', below: 25, colour: '#e9803f', label: '15 to 25°' },
  { id: 'cliff', below: Infinity, colour: '#e05252', label: '25° and over' },
];

/** The band a grade (in percent) falls in. */
export function slopeBand(percent) {
  const degrees = gradeDegrees(percent);
  return SLOPE_BANDS.find((band) => degrees < band.below);
}

/**
 * How far the line of sight passes over the ground at a sample, in metres:
 * negative where the ground stands in its way. Null without a sight.
 */
export function clearanceAt(profile, index) {
  const sight = profile?.sight;
  if (!sight || index == null || index >= profile.distance_m.length) return null;
  const span = profile.distance_m.at(-1) || 1;
  const along = profile.distance_m[index] / span;
  const line = sight.eye_m + (sight.target_m - sight.eye_m) * along;
  return line - (profile.elevation[index] + (sight.bulge_m?.[index] ?? 0));
}

/** Points through `tops` from `from` to `to` (inclusive) as an SVG path. */
function through(tops, from, to) {
  return `M${tops.slice(from, to + 1).map((point) => `${point.x},${point.y}`).join(' L')}`;
}

/** Consecutive samples sharing a key, as `[key, from, to]`, each run starting where the last ended. */
function runsOf(keys) {
  const runs = [];
  keys.forEach((key, i) => {
    const last = runs.at(-1);
    if (last && last[0] === key) last[2] = i;
    else runs.push([key, last ? last[2] : i, i]);
  });
  return runs.filter(([, from, to]) => to > from);
}

/** The multiples of `step` inside [lo, hi]. */
function ticks(lo, hi, step) {
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    out.push(Math.round(v * 1e6) / 1e6);
  }
  return out;
}

/**
 * Everything the chart draws, in a `width` × `height` box with room left on
 * each side for the axes. The axes count in the analyst's units, on round
 * steps of those units, so an imperial chart reads 1 mi, 2 mi rather than
 * 1609 m.
 *
 * @returns the filled `area` and its top `line`, the straight `sight` line and
 *   its two ends, where the ground is `blocked` in its way, the crest cut into
 *   the stretches the eye `sees` and does not, the axes' labelled ticks, and
 *   `tops`, where each sample's ground is drawn, for a pointer reading the chart.
 */
export function profileChart(
  profile,
  { width, height, units = 'metric', left = 44, right = 10, top = 10, bottom = 22, marks = [] }
) {
  const { distance_m: distance, elevation, sight = null } = profile;
  const axis = AXIS_UNITS[units] ?? AXIS_UNITS.metric;
  const bulge = sight?.bulge_m ?? distance.map(() => 0);
  const ground = elevation.map((h, i) => h + bulge[i]);
  const highest = sight ? Math.max(...ground, sight.eye_m, sight.target_m) : Math.max(...ground);
  const lowest = Math.min(...ground);

  // heights: round steps of the height unit, a little air over the top
  const [heightLabel, perMetre] = axis.height;
  const shownHigh = highest * perMetre;
  const shownLow = lowest * perMetre;
  const yStep = niceStep(shownHigh - shownLow || 10, 4);
  const lo = (Math.floor(shownLow / yStep) * yStep) / perMetre;
  const hiShown = Math.ceil(shownHigh / yStep) * yStep + (shownHigh % yStep === 0 ? yStep * 0.25 : 0);
  const hi = hiShown / perMetre;

  const span = distance.at(-1) || 1;
  const innerW = Math.max(1, width - left - right);
  const innerH = Math.max(1, height - top - bottom);
  const x = (d) => left + (innerW * d) / span;
  const y = (h) => top + innerH - (innerH * (h - lo)) / (hi - lo || 1);
  const r = (n) => Math.round(n * 10) / 10;

  const tops = ground.map((h, i) => ({ x: r(x(distance[i])), y: r(y(h)) }));
  const floor = r(top + innerH);
  const crest = tops.map((point) => `${point.x},${point.y}`).join(' L');
  const area = `M${r(x(0))},${floor} L${crest} L${r(x(span))},${floor} Z`;
  const line = `M${crest}`;

  // the crest again, in the stretches the eye covers and the ones it does not,
  // the hidden ground shaded down to the floor
  const sees = runsOf(sight?.seen ?? []).map(([seen, from, to]) => ({ seen, path: through(tops, from, to) }));
  const hidden = runsOf(sight?.seen ?? [])
    .filter(([seen]) => !seen)
    .map(([, from, to]) => `M${tops[from].x},${floor} L${through(tops, from, to).slice(1)} L${tops[to].x},${floor} Z`);
  // …and in the bands of its slope, each stretch between two samples by its own
  const steepness = [];
  for (let i = 1; i < distance.length; i += 1) {
    const run = distance[i] - distance[i - 1];
    const band = slopeBand(run > 0 ? ((elevation[i] - elevation[i - 1]) / run) * 100 : 0);
    const last = steepness.at(-1);
    if (last?.band === band.id) last.to = i;
    else steepness.push({ band: band.id, colour: band.colour, from: i - 1, to: i });
  }
  for (const run of steepness) run.path = through(tops, run.from, run.to);

  let sightLine = null;
  let blocked = null;
  if (sight) {
    const eye = { x: r(x(0)), y: r(y(sight.eye_m)) };
    const target = { x: r(x(span)), y: r(y(sight.target_m)) };
    sightLine = {
      eye,
      target,
      path: `M${eye.x},${eye.y} L${target.x},${target.y}`,
      // where the eye and the target stand over their ground
      posts: [`M${tops[0].x},${tops[0].y} L${eye.x},${eye.y}`, `M${tops.at(-1).x},${tops.at(-1).y} L${target.x},${target.y}`],
    };
    if (sight.blocked_at_m != null) {
      const at = blockedSample(profile);
      blocked = { x: r(x(distance[at])), y: r(y(ground[at])) };
      // the stretch of sight past the ground in its way
      const share = (distance[at] || 0) / span;
      const cut = { x: r(eye.x + (target.x - eye.x) * share), y: r(eye.y + (target.y - eye.y) * share) };
      sightLine.clear = `M${eye.x},${eye.y} L${cut.x},${cut.y}`;
      sightLine.cut = `M${cut.x},${cut.y} L${target.x},${target.y}`;
    }
  }
  // the corners of the line, where its legs meet
  const corners = marks
    .filter((d) => d > 0 && d < span)
    .map((d, i) => ({ n: i + 1, x: r(x(d)) }));

  // distances: the long unit once the line reaches one of it
  const [longLabel, perLong] = axis.long;
  const [shortLabel, perShort] = axis.short;
  const long = span * perLong >= 1;
  const [distLabel, perDist] = long ? [longLabel, perLong] : [shortLabel, perShort];
  const xStep = niceStep(span * perDist, Math.max(2, Math.round(innerW / 90)));
  const xTicks = ticks(0, span * perDist, xStep).map((value) => ({
    x: r(x(value / perDist)),
    label: value === 0 ? '0' : `${plain(value)} ${distLabel}`,
  }));
  const yTicks = ticks(lo * perMetre, hiShown, yStep).map((value) => ({
    y: r(y(value / perMetre)),
    label: `${plain(value)} ${heightLabel}`,
  }));

  // how much taller than they are the heights are drawn: a chart is never at scale
  const stretch = innerH / (hi - lo || 1) / (innerW / span);
  return {
    area,
    line,
    sight: sightLine,
    blocked,
    sees,
    hidden,
    steepness,
    corners,
    tops,
    floor,
    xTicks,
    yTicks,
    stretch,
  };
}

/** The sample where the ground stands in the way of the sight line, or -1. */
export function blockedSample(profile) {
  const at = profile?.sight?.blocked_at_m;
  if (at == null) return -1;
  const i = profile.distance_m.findIndex((d) => d >= at);
  return i < 0 ? profile.distance_m.length - 1 : i;
}

/** "Heights ×2.4" for a chart drawn taller than the ground, or '' at about real scale. */
export function stretchLabel(stretch) {
  if (!(stretch > 0) || Math.abs(stretch - 1) < 0.15) return '';
  return stretch >= 10 ? `Heights ×${Math.round(stretch)}` : `Heights ×${stretch.toFixed(1)}`;
}

/** The sample whose drawn point is nearest a pointer at `x` across the chart. */
export function sampleNear(tops, x) {
  let best = 0;
  for (let i = 1; i < tops.length; i += 1) {
    if (Math.abs(tops[i].x - x) < Math.abs(tops[best].x - x)) best = i;
  }
  return best;
}
