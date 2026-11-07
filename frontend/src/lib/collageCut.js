/**
 * A collage's cut: one frame over the whole collage, like a mat. The picture it
 * exports keeps what lies inside the frame; the pieces stay whole on the canvas,
 * each still a piece of its own. The frame is `{ x, y, w, h }` in canvas pixels,
 * kept on the collage as `clip` (engine/inspectwork.py checks it).
 */
import { quadsBounds } from './inspect.js';

/** The smallest side a frame keeps, in screen pixels, so its handles never meet. */
export const CUT_MIN_SCREEN = 24;
/** How near an edge comes to a piece's edge, in screen pixels, before it snaps to it. */
export const CUT_SNAP_SCREEN = 6;

/** The axis-aligned box of the pieces, `{ x, y, w, h }`, or null with none. */
export function piecesFrame(nodes) {
  const b = quadsBounds((nodes ?? []).map((n) => n.quad));
  return b ? { x: b.minX, y: b.minY, w: b.width, h: b.height } : null;
}

/** The frame a cut starts from: the one the collage keeps, else the pieces' box. */
export function cutStart(nodes, clip) {
  return clip ? { ...clip } : piecesFrame(nodes);
}

/**
 * Where an edge can snap: the height and the side of every piece's corners, so a
 * ragged lower edge is cut off at the highest bottom with one drag. A piece turned a
 * little offers both its outer corner and its inner one.
 */
export function snapLines(nodes) {
  const xs = new Set();
  const ys = new Set();
  for (const n of nodes ?? []) {
    for (const [x, y] of n.quad) {
      xs.add(x);
      ys.add(y);
    }
  }
  return { xs: [...xs], ys: [...ys] };
}

function snapped(value, lines, reach) {
  let best = value;
  let gap = reach;
  for (const line of lines) {
    const d = Math.abs(line - value);
    if (d <= gap) {
      gap = d;
      best = line;
    }
  }
  return best;
}

const EDGES = {
  n: { t: true }, s: { b: true }, w: { l: true }, e: { r: true },
  nw: { t: true, l: true }, ne: { t: true, r: true }, sw: { b: true, l: true }, se: { b: true, r: true },
};

/**
 * The frame after a drag: `handle` is an edge (`n`, `s`, `e`, `w`), a corner (`nw`…)
 * or `move`; `by` how far the pointer went since the press, canvas pixels, from the
 * frame `start` as it was then. An edge follows the pointer and snaps to a line of
 * `snaps` within `reach`; the frame keeps at least `min` a side, the opposite edges
 * holding still. A move carries the frame whole, its edges snapping as one.
 */
export function dragCut(start, handle, [dx, dy], { min = 1, snaps = null, reach = 0 } = {}) {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  const xs = snaps?.xs ?? [];
  const ys = snaps?.ys ?? [];
  if (handle === 'move') {
    // the edge nearer a line decides where the whole frame snaps
    const fit = (lo, hi, d, lines) => {
      const a = snapped(lo + d, lines, reach) - lo;
      const b = snapped(hi + d, lines, reach) - hi;
      const moved = [a, b].filter((v) => v !== d);
      if (!moved.length) return d;
      return moved.reduce((p, v) => (Math.abs(v - d) < Math.abs(p - d) ? v : p));
    };
    const mx = fit(left, right, dx, xs);
    const my = fit(top, bottom, dy, ys);
    return { x: left + mx, y: top + my, w: start.w, h: start.h };
  }
  const e = EDGES[handle];
  if (!e) return { ...start };
  if (e.l) left = Math.min(snapped(left + dx, xs, reach), right - min);
  if (e.r) right = Math.max(snapped(right + dx, xs, reach), left + min);
  if (e.t) top = Math.min(snapped(top + dy, ys, reach), bottom - min);
  if (e.b) bottom = Math.max(snapped(bottom + dy, ys, reach), top + min);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * What applying a frame keeps on the collage: the frame, rounded to a hundredth of a
 * pixel, or null when it holds every piece whole and so cuts nothing.
 */
export function cutOf(frame, nodes) {
  if (!frame) return null;
  const box = piecesFrame(nodes);
  const clip = { x: round2(frame.x), y: round2(frame.y), w: round2(frame.w), h: round2(frame.h) };
  if (!(clip.w >= 1 && clip.h >= 1)) return null;
  const holds = box && clip.x <= box.x && clip.y <= box.y && clip.x + clip.w >= box.x + box.w && clip.y + clip.h >= box.y + box.h;
  return holds ? null : clip;
}

/** The four corners of a frame, as a quad (TL, TR, BR, BL). */
export function frameQuad({ x, y, w, h }) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}
