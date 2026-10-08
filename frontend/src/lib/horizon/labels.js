/**
 * Summit names on the Horizon view, set in the sky so none hides another.
 *
 * A name sits in a row just above the skyline over it, and a thin leader runs
 * down to its summit, so a near top in front of the range is named as clearly
 * as the range itself and no label covers the ground being read. The highest
 * summit is named first; a name with no free row is left out, and the frame
 * holds at most one name per `LABEL_SPACING` pixels of its width, so a crowded
 * range names its tallest tops rather than a pile of chips, and turning the
 * view never shuffles which ones win. Height and distance are read on hover.
 *
 * OpenStreetMap often holds the same top twice (a summit and its named rock, a
 * name in two spellings): `mergePeaks` keeps the higher of two that share a
 * name or stand within `SAME_PEAK_M` of each other.
 */
import { toScreen } from './camera.js';
import { distanceBetween } from './geometry.js';

/** The frame names at most one summit per this many pixels of its width. */
export const LABEL_SPACING = 110;
/** Two summits this close are one top named twice. */
export const SAME_PEAK_M = 300;
/** A name's text height, and the step between two rows of names. */
export const TEXT_HEIGHT = 12;
export const ROW_STEP = 17;
const ROWS = 3;
/** Room between the skyline and the lowest row, and around a name. */
const OVER_SKYLINE = 10;
const PAD = 6;
const EDGE = 4;

/** About how wide a name is drawn, in pixels. */
export function labelWidth(name) {
  return Math.round(name.length * 6.4 + 4);
}

const heightOf = (peak) => (Number.isFinite(peak.ele) ? peak.ele : -Infinity);
const nameOf = (peak) => String(peak.name_en || peak.name || '').trim();

/** One summit per top: the higher of two that share a name or stand close together. */
export function mergePeaks(peaks) {
  const kept = [];
  for (const peak of [...peaks].sort((a, b) => heightOf(b) - heightOf(a))) {
    const name = nameOf(peak).toLowerCase();
    const twin = kept.some(
      (other) =>
        (name && nameOf(other).toLowerCase() === name) ||
        (Number.isFinite(peak.lat) && Number.isFinite(other.lat) && distanceBetween(peak, other) < SAME_PEAK_M)
    );
    if (!twin) kept.push(peak);
  }
  return kept;
}

const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * @param {object[]} peaks summits in sight, already merged (`{ name, name_en, ele, azimuth, angle }`)
 * @param {object} camera the view's camera with its frame size
 * @param {object} [options]
 * @param {(x: number) => number|null} [options.skylineY] the skyline's height on screen at a column
 * @param {{left:number, top:number, right:number, bottom:number}[]} [options.reserved] boxes no name may cover
 * @returns {{ peak: object, name: string, x: number, y: number, left: number, top: number,
 *   width: number, baseline: number }[]} `x`, `y` the summit, the rest the name's box
 */
export function placeLabels(peaks, camera, { skylineY = () => null, reserved = [] } = {}) {
  const { width, height } = camera;
  if (!(width > 0 && height > 0)) return [];
  const most = Math.max(1, Math.floor(width / LABEL_SPACING));
  const taken = reserved.map((box) => ({ ...box }));
  const placed = [];
  const ordered = [...peaks].sort((a, b) => heightOf(b) - heightOf(a));
  for (const peak of ordered) {
    if (placed.length >= most) break;
    const at = toScreen(camera, peak.azimuth, peak.angle);
    if (!at.visible || at.x < 0 || at.x > width || at.y < 0 || at.y > height) continue;
    const name = nameOf(peak);
    if (!name) continue;
    const span = labelWidth(name);
    const left = Math.max(EDGE, Math.min(width - EDGE - span, at.x - span / 2));
    // the highest the skyline climbs under the name, and the summit itself
    let sky = at.y;
    for (let x = left; x <= left + span; x += 8) {
      const y = skylineY(x);
      if (Number.isFinite(y)) sky = Math.min(sky, y);
    }
    const lowest = sky - OVER_SKYLINE;
    const floor = EDGE + TEXT_HEIGHT;
    // in the sky above the skyline; under a skyline above the frame, from the top down
    const rows = Array.from({ length: ROWS }, (_, row) =>
      lowest >= floor ? lowest - row * ROW_STEP : floor + row * ROW_STEP
    ).filter((baseline) => baseline >= floor && baseline < at.y - 2);
    for (const baseline of rows) {
      const box = { left: left - PAD, right: left + span + PAD, top: baseline - TEXT_HEIGHT, bottom: baseline + 3 };
      if (taken.some((other) => overlaps(box, other))) continue;
      taken.push(box);
      placed.push({ peak, name, x: at.x, y: at.y, left, top: box.top, width: span, baseline });
      break;
    }
  }
  return placed;
}

/** The label under a pointer, on its name or on its summit, or null. */
export function labelAt(labels, x, y, { reach = 7 } = {}) {
  for (const label of labels) {
    const onName = x >= label.left - 2 && x <= label.left + label.width + 2 && y >= label.top - 2 && y <= label.baseline + 4;
    if (onName || Math.hypot(x - label.x, y - label.y) <= reach) return label;
  }
  return null;
}
