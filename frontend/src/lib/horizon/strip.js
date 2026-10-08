/**
 * The 360° strip over the Horizon view: the whole turn at once, north at the
 * left edge, so a narrow lens never loses where it is pointing.
 *
 * Across, the strip spans 0–360°; up, it keeps the same scale, so a ridge
 * stands in it as tall as it stands in the world against its width. The
 * skyline is drawn from the turn the app sent (the top ground cell of every
 * azimuth), the lens's field is a bracket over it, and the marked point and
 * the sun and moon sit where they are in the turn.
 */
import { wrap360 } from './panorama.js';

/** The strip's height in CSS pixels, and the row where level (0°) runs. */
export const STRIP_HEIGHT = 32;
export const STRIP_LEVEL = 22;

/** Pixels per degree, the same both ways. */
export const stripScale = (width) => width / 360;

/** Where a direction falls across the strip. */
export function stripX(azimuth, width) {
  return (wrap360(azimuth) / 360) * width;
}

/** …and back: the direction under a column. */
export function stripAzimuth(x, width) {
  return wrap360((x / width) * 360);
}

/** Where an elevation falls up the strip; may run off either edge. */
export function stripY(elevation, width) {
  return STRIP_LEVEL - elevation * stripScale(width);
}

/**
 * The skyline as two SVG paths, `fill` closed under it and `line` along its
 * top, one point a pixel column: the highest ground of the turn's azimuths
 * that fall in that column, or of the nearest one where a coarse turn has
 * fewer azimuths than the strip has columns. Where the turn knows no ground
 * the line breaks. Null without a turn.
 */
export function silhouette(panorama, width) {
  const columns = Math.max(1, Math.round(width));
  if (!panorama?.skyline?.length) return null;
  const { start, step } = panorama.azimuth;
  const tops = new Array(columns).fill(undefined);
  panorama.skyline.forEach((elevation, index) => {
    const column = Math.min(columns - 1, Math.floor((wrap360(start + index * step) / 360) * columns));
    const value = Number.isFinite(elevation) ? elevation : null;
    if (tops[column] === undefined || (value != null && (tops[column] == null || value > tops[column]))) {
      tops[column] = value;
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
  }
  const runs = [];
  let run = null;
  tops.forEach((elevation, column) => {
    if (elevation == null) {
      run = null;
      return;
    }
    if (!run) runs.push((run = []));
    const y = Math.max(-1, Math.min(STRIP_HEIGHT + 1, stripY(elevation, width)));
    run.push([((column + 0.5) / columns) * width, y]);
  });
  if (!runs.length) return null;
  const at = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const line = runs.map((points) => `M${points.map(at).join('L')}`).join('');
  const fill = runs
    .map((points) => `M${at([points[0][0], STRIP_HEIGHT])}L${points.map(at).join('L')}L${at([points.at(-1)[0], STRIP_HEIGHT])}Z`)
    .join('');
  return { fill, line };
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
