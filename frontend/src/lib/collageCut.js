/**
 * A collage's cut: one frame over the whole collage, like a mat. The picture it
 * exports keeps what lies inside the frame; the pieces stay whole on the canvas,
 * each still a piece of its own. The frame is `{ x, y, w, h }` in canvas pixels,
 * kept on the collage as `clip` (engine/inspectwork.py checks it).
 */
import { quadsBounds } from './inspect.js';
import { loadImage, paintCollage } from './collageThumb.js';

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

/** Whether two cuts keep the same frame, to a hundredth of a pixel; no cut is one too. */
export function sameCut(a, b) {
  if (!a || !b) return !a && !b;
  return ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) < 0.01);
}

// -- trimming the empty edges -------------------------------------------------------
// A panorama leaves its corners empty. Trim cuts the collage to the largest frame its
// pieces fill: they are painted as drawn, at most `TRIM_EDGE` cells a side, and read back.

/** The longest side, in cells, the pieces are read at. */
export const TRIM_EDGE = 512;
/** The cover, of 255, a cell counts as filled from: a seam between two triangles of a warped piece reaches it. */
const FILLED = 250;

/**
 * Which cells of a `cols` × `rows` picture (its RGBA bytes, row by row) the pieces fill:
 * filled themselves, and every neighbour within the grid too, as a cell beside an empty
 * one may be read fuller than it is. The grid's own sides are the pieces' bounds, exact.
 */
export function filledCells(rgba, cols, rows) {
  const full = new Uint8Array(cols * rows);
  for (let i = 0; i < cols * rows; i += 1) full[i] = rgba[i * 4 + 3] >= FILLED ? 1 : 0;
  const out = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      let ok = full[y * cols + x] === 1;
      for (let dy = -1; ok && dy <= 1; dy += 1) {
        for (let dx = -1; ok && dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !full[ny * cols + nx]) ok = false;
        }
      }
      out[y * cols + x] = ok ? 1 : 0;
    }
  }
  return out;
}

/**
 * The largest rectangle of filled cells in a `cols` × `rows` grid, `{ x, y, w, h }` in
 * cells, or null with none. Each row's runs of filled cells down to it make a
 * histogram, whose largest rectangle one stack reads.
 */
export function largestFilled(filled, cols, rows) {
  const heights = new Int32Array(cols);
  const stack = new Int32Array(cols + 1);
  let best = null;
  let most = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) heights[x] = filled[y * cols + x] ? heights[x] + 1 : 0;
    let top = 0;
    for (let x = 0; x <= cols; x += 1) {
      const h = x < cols ? heights[x] : 0;
      while (top > 0 && heights[stack[top - 1]] >= h) {
        const tall = heights[stack[top - 1]];
        top -= 1;
        const left = top > 0 ? stack[top - 1] + 1 : 0;
        if (tall * (x - left) > most) {
          most = tall * (x - left);
          best = { x: left, y: y - tall + 1, w: x - left, h: tall };
        }
      }
      stack[top] = x;
      top += 1;
    }
  }
  return best;
}

const newCanvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });

/**
 * The largest frame the pieces fill as drawn, `{ x, y, w, h }` in canvas pixels, or null
 * when they fill none. `load` turns a piece's address into its picture; `canvas` makes
 * the small one they are painted on.
 */
export async function trimFrame(nodes, { load = loadImage, edge = TRIM_EDGE, canvas = newCanvas } = {}) {
  const box = piecesFrame(nodes);
  if (!box || !(box.w > 0) || !(box.h > 0)) return null;
  const s = Math.min(1, edge / Math.max(box.w, box.h));
  const cols = Math.max(1, Math.round(box.w * s));
  const rows = Math.max(1, Math.round(box.h * s));
  const images = new Map();
  await Promise.all(
    nodes.filter((n) => n.url && !n.missing).map(async (n) => {
      const image = await load(n.url);
      if (image) images.set(n.id, image);
    }),
  );
  const ctx = canvas(cols, rows).getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  const frame = { minX: box.x, minY: box.y, scale: cols / box.w, scaleY: rows / box.h, width: cols, height: rows };
  // what the pieces cover does not hang on where they meet
  paintCollage(ctx, nodes, images, frame, { seams: false });
  const cells = largestFilled(filledCells(ctx.getImageData(0, 0, cols, rows).data, cols, rows), cols, rows);
  if (!cells) return null;
  const kx = box.w / cols;
  const ky = box.h / rows;
  return { x: box.x + cells.x * kx, y: box.y + cells.y * ky, w: cells.w * kx, h: cells.h * ky };
}
