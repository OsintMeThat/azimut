/**
 * Where a map on its card looks while its Draw tab is open (`editor/mapSurface.js`): its own
 * frame at first, then zoomed and moved by the analyst, and never written into the block.
 *
 * A view is `{ k, cx, cy }`: how many times closer than the whole map it looks, and the point
 * of the map at the middle of the stage, in the map's own units (`FRAME` wide, as the engine
 * draws it). The whole map is the frame drawn whole in the middle of the stage, undistorted, so
 * a stage of another shape shows a little more on two sides. Everything is plain arithmetic
 * on the stage's size: `toFrame` and `toStage` undo each other, so a press lands where it was
 * made at any zoom.
 */

/** How far out and in a map's Draw view goes; `most` is raised to what its pictures hold. */
export const LEAST = 0.5;
export const MOST = 16;
export const DEEPEST = 64;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** The view that shows the whole frame `[width, height]`. */
export function wholeView(frame) {
  return { k: 1, cx: frame[0] / 2, cy: frame[1] / 2 };
}

/** Whether `view` is the whole map of `frame`. */
export function isWhole(view, frame) {
  return Math.abs(view.k - 1) < 1e-3 && Math.abs(view.cx - frame[0] / 2) < frame[0] * 1e-4 && Math.abs(view.cy - frame[1] / 2) < frame[1] * 1e-4;
}

/** The stage's pixels one unit of the frame takes at the whole map: the frame fitted whole, undistorted. */
export function fitScale(frame, stage) {
  return Math.min(stage[0] / frame[0], stage[1] / frame[1]);
}

/** A point of the map, in its units, to the stage's pixels from its top left. */
export function toStage(view, frame, stage, [x, y]) {
  const scale = fitScale(frame, stage) * view.k;
  return [(x - view.cx) * scale + stage[0] / 2, (y - view.cy) * scale + stage[1] / 2];
}

/** A point of the stage, in pixels from its top left, to the map's units. */
export function toFrame(view, frame, stage, [x, y]) {
  const scale = fitScale(frame, stage) * view.k;
  return [view.cx + (x - stage[0] / 2) / scale, view.cy + (y - stage[1] / 2) / scale];
}

/** The part of the map the stage shows, in its units: `[x, y, width, height]`, an SVG's viewBox. */
export function windowOf(view, frame, stage) {
  const scale = fitScale(frame, stage) * view.k;
  const width = stage[0] / scale;
  const height = stage[1] / scale;
  return [view.cx - width / 2, view.cy - height / 2, width, height];
}

/** `view` kept in reach: its zoom from `least` to `most`, its middle on the frame. */
export function clampView(view, frame, { least = LEAST, most = MOST } = {}) {
  return { k: clamp(view.k, least, most), cx: clamp(view.cx, 0, frame[0]), cy: clamp(view.cy, 0, frame[1]) };
}

/** `view` zoomed by `factor` about the stage's point `at` (its middle by default), which stays where it is. */
export function zoomAbout(view, factor, frame, stage, at = null, limits = {}) {
  const point = at ?? [stage[0] / 2, stage[1] / 2];
  const under = toFrame(view, frame, stage, point);
  const k = clamp(view.k * factor, limits.least ?? LEAST, limits.most ?? MOST);
  const scale = fitScale(frame, stage) * k;
  return clampView({ k, cx: under[0] - (point[0] - stage[0] / 2) / scale, cy: under[1] - (point[1] - stage[1] / 2) / scale }, frame, limits);
}

/** `view` moved with a drag of `dx`, `dy` stage pixels: the map follows the pointer. */
export function panBy(view, dx, dy, frame, stage, limits = {}) {
  const scale = fitScale(frame, stage) * view.k;
  return clampView({ k: view.k, cx: view.cx - dx / scale, cy: view.cy - dy / scale }, frame, limits);
}

/** The view `t` of the way (0 to 1) from `from` to `to`, the zoom changing at an even pace. */
export function between(from, to, t) {
  return { k: from.k * (to.k / from.k) ** t, cx: from.cx + (to.cx - from.cx) * t, cy: from.cy + (to.cy - from.cy) * t };
}

/** How much a turn of the wheel zooms: a mouse's notch about a quarter, a trackpad's small steps as smoothly. */
export function wheelFactor({ deltaY = 0, deltaMode = 0 } = {}) {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return clamp(Math.exp(-pixels * 0.0022), 0.5, 2);
}

/** A scale bar for `metres` a stage pixel: a round length at most `longest` pixels long, and its words. */
export function rulerOf(metres, longest = 110) {
  if (!(metres > 0) || !Number.isFinite(metres)) return null;
  let length = 0;
  for (let power = -1; power < 8; power += 1) {
    for (const step of [1, 2, 5]) {
      const value = step * 10 ** power;
      if (value / metres <= longest && value > length) length = value;
    }
  }
  if (!length) return null;
  const words = length >= 1000 ? `${length / 1000} km` : `${Number(length.toPrecision(3))} m`;
  return { px: Math.round(length / metres), words };
}
