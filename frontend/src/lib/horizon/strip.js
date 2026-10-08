/**
 * The 360° strip over the Horizon view: the whole turn at once, north at the
 * left edge, so a narrow lens never loses where it is pointing.
 *
 * Across, the strip spans 0–360°. Up, it is fitted to the turn's own skyline
 * (`stripRange`), so the ridges read whether the eye stands among peaks or on
 * a plain: the strip says where to look, the view and its scales say the true
 * angles. Ground nearer than a kilometre is left out of the fit, because the
 * slope under the eye's feet is not its horizon; where it rises past the top,
 * the strip is full there, which is what it is.
 *
 * Under the skyline runs a band of its own for the winds, so no letter sits on
 * a ridge. The lens's field is the part left clear; the rest of the turn is
 * veiled (`outsideSpans`). Where the skyline is ground nearer than
 * `STRIP_NEAR`, the slope the eye stands on, the strip hatches it (`near`),
 * so a full strip there reads as ground close by and not as a fault. The
 * marked point and the sun and moon sit where they are in the turn.
 */
import { wrap360 } from './panorama.js';

/** The strip's height in CSS pixels; the skyline is drawn above `STRIP_GROUND`, the winds under it. */
export const STRIP_HEIGHT = 44;
export const STRIP_GROUND = 30;
/** The row the highest ground of the fit is drawn at, so a summit never touches the edge. */
const STRIP_TOP = 4;
/** Ground nearer than this, in metres, does not set the strip's height. */
export const STRIP_NEAR = 1000;
/** The least span of elevation the strip shows, in degrees, so a plain stays flat. */
export const STRIP_LEAST = 3;

/** Pixels per degree across. */
export const stripScale = (width) => width / 360;

/** Where a direction falls across the strip. */
export function stripX(azimuth, width) {
  return (wrap360(azimuth) / 360) * width;
}

/** …and back: the direction under a column. */
export function stripAzimuth(x, width) {
  return wrap360((x / width) * 360);
}

/**
 * The elevations the strip spans, `{ low, high }` in degrees: the turn's
 * skyline beyond `STRIP_NEAR`, at least `STRIP_LEAST` tall, centred when it
 * was widened. All of the skyline when nothing stands that far; a level
 * horizon without a turn.
 */
export function stripRange(panorama) {
  const skyline = panorama?.skyline ?? [];
  const distance = panorama?.skylineDistance;
  let far = [];
  let all = [];
  skyline.forEach((elevation, index) => {
    if (!Number.isFinite(elevation)) return;
    all.push(elevation);
    if (!distance || !(distance[index] < STRIP_NEAR)) far.push(elevation);
  });
  const seen = far.length ? far : all;
  if (!seen.length) return { low: -STRIP_LEAST / 2, high: STRIP_LEAST / 2 };
  let low = Math.min(...seen);
  let high = Math.max(...seen);
  if (high - low < STRIP_LEAST) {
    const middle = (high + low) / 2;
    low = middle - STRIP_LEAST / 2;
    high = middle + STRIP_LEAST / 2;
  }
  return { low, high };
}

/** Where an elevation falls up the strip, for a range from `stripRange`; may run off either edge. */
export function stripY(elevation, range) {
  return STRIP_TOP + ((range.high - elevation) / (range.high - range.low)) * (STRIP_GROUND - STRIP_TOP);
}

/** The row level (0°) runs at, or null when the range does not reach it. */
export function stripLevel(range) {
  return range.low < 0 && range.high > 0 ? stripY(0, range) : null;
}

/**
 * The skyline as two SVG paths, `fill` closed under it and `line` along its
 * top, one point a pixel column: the highest ground of the turn's azimuths
 * that fall in that column, or of the nearest one where a coarse turn has
 * fewer azimuths than the strip has columns. Where the turn knows no ground
 * the line breaks. `near` holds the spans whose skyline is ground nearer than
 * `STRIP_NEAR`. Null without a turn.
 */
export function silhouette(panorama, width, range = stripRange(panorama)) {
  const columns = Math.max(1, Math.round(width));
  if (!panorama?.skyline?.length) return null;
  const { start, step } = panorama.azimuth;
  const distance = panorama.skylineDistance;
  const isNear = (index) => Boolean(distance) && distance[index] < STRIP_NEAR;
  const tops = new Array(columns).fill(undefined);
  const nearby = new Array(columns).fill(false);
  panorama.skyline.forEach((elevation, index) => {
    const column = Math.min(columns - 1, Math.floor((wrap360(start + index * step) / 360) * columns));
    const value = Number.isFinite(elevation) ? elevation : null;
    if (tops[column] === undefined || (value != null && (tops[column] == null || value > tops[column]))) {
      tops[column] = value;
      nearby[column] = value != null && isNear(index);
    }
  });
  // a column no azimuth fell in reads the nearest one
  const count = panorama.skyline.length;
  for (let column = 0; column < columns; column += 1) {
    if (tops[column] !== undefined) continue;
    const middle = (((column + 0.5) / columns) * 360 - start) / step;
    const nearest = ((Math.round(middle) % count) + count) % count;
    const value = panorama.skyline[nearest];
    tops[column] = Number.isFinite(value) ? value : null;
    nearby[column] = tops[column] != null && isNear(nearest);
  }
  const near = [];
  nearby.forEach((close, column) => {
    if (!close) return;
    const x = (column / columns) * width;
    const last = near.at(-1);
    if (last && Math.abs(last.x + last.width - x) < 1e-6) last.width += width / columns;
    else near.push({ x, width: width / columns });
  });
  const runs = [];
  let run = null;
  tops.forEach((elevation, column) => {
    if (elevation == null) {
      run = null;
      return;
    }
    if (!run) runs.push((run = []));
    const y = Math.max(0, Math.min(STRIP_GROUND, stripY(elevation, range)));
    run.push([((column + 0.5) / columns) * width, y]);
  });
  if (!runs.length) return null;
  const at = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const line = runs.map((points) => `M${points.map(at).join('L')}`).join('');
  const fill = runs
    .map((points) => `M${at([points[0][0], STRIP_GROUND])}L${points.map(at).join('L')}L${at([points.at(-1)[0], STRIP_GROUND])}Z`)
    .join('');
  return { fill, line, near };
}

/**
 * The lens's field as one or two spans across the strip (two when it runs
 * past north), from the direction at its left edge and its width in degrees.
 * None for a whole turn, which the strip already is.
 *
 * @returns {{ x: number, width: number }[]}
 */
export function fieldSpans(left, span, width) {
  if (!(span > 0) || span >= 359.5) return [];
  const from = stripX(left, width);
  const across = (span / 360) * width;
  if (from + across <= width) return [{ x: from, width: across }];
  return [
    { x: from, width: width - from },
    { x: 0, width: from + across - width },
  ];
}

/** What the field leaves of the strip, as spans to veil; nothing for a whole turn. */
export function outsideSpans(spans, width) {
  if (!spans.length) return [];
  const sorted = [...spans].sort((a, b) => a.x - b.x);
  const out = [];
  let from = 0;
  for (const span of sorted) {
    if (span.x > from) out.push({ x: from, width: span.x - from });
    from = Math.max(from, span.x + span.width);
  }
  if (from < width) out.push({ x: from, width: width - from });
  return out;
}

/** The eight winds along the strip, the four cardinal ones marked as such. */
export const WINDS = [
  { azimuth: 0, label: 'N', cardinal: true },
  { azimuth: 45, label: 'NE', cardinal: false },
  { azimuth: 90, label: 'E', cardinal: true },
  { azimuth: 135, label: 'SE', cardinal: false },
  { azimuth: 180, label: 'S', cardinal: true },
  { azimuth: 225, label: 'SW', cardinal: false },
  { azimuth: 270, label: 'W', cardinal: true },
  { azimuth: 315, label: 'NW', cardinal: false },
];
