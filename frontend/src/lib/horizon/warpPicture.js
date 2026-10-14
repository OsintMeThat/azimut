/**
 * A photo drawn between four pulled corners, or straightened from its lens's
 * curve, as a picture of its own.
 *
 * The view draws the photo it is handed over the whole frame; a photo pulled
 * by its corners (lib/horizon/overlay.js `warped`) is handed over already
 * drawn in its new shape, so the view needs nothing to know about it. The
 * picture is the frame's, at the photo's own size: what falls outside the
 * corners is left empty, what is pulled past the frame is cut off. Find's
 * photo, drawn on a 2D canvas rather than by the view, is straightened the
 * same way (`paintStraightened`), so the trace lies on it as on the view.
 *
 * A 2D canvas has no perspective, so the photo is cut into a grid of cells,
 * each cell into two triangles, and every triangle is laid with the flat
 * transform that matches its three corners. Fine enough a grid and the eye
 * cannot tell it from a true perspective; each triangle is clipped a little
 * wide so no seam shows between them.
 */
import { straightened, throughMatrix, warpMatrix } from './overlay.js';

/** Cells along each side: fewer while a corner is in the hand, more once it is let go. */
export const WARP_CELLS = { fast: 10, fine: 24 };
/** Cells along each side of a straightened photo: its curve is gentler than a pulled corner, finer once let go. */
export const BEND_CELLS = { fast: 10, fine: 32 };
/** The long side a pulled photo is drawn at while a corner is in the hand. */
export const PULL_PX = 1024;
/** How far each triangle's clip reaches past its edges, in pixels, so neighbours overlap. */
const SEAM_PX = 0.6;

/**
 * The flat transform taking three points to three others, as a canvas's
 * `setTransform(a, b, c, d, e, f)`: x' = a x + c y + e, y' = b x + d y + f.
 * Null for three points on a line.
 */
export function triangleTransform([s0, s1, s2], [d0, d1, d2]) {
  const den = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
  if (Math.abs(den) < 1e-12) return null;
  const solve = (k) => [
    (d0[k] * (s1[1] - s2[1]) + d1[k] * (s2[1] - s0[1]) + d2[k] * (s0[1] - s1[1])) / den,
    (d0[k] * (s2[0] - s1[0]) + d1[k] * (s0[0] - s2[0]) + d2[k] * (s1[0] - s0[0])) / den,
    (d0[k] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[k] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[k] * (s0[0] * s1[1] - s1[0] * s0[1])) / den,
  ];
  const [a, c, e] = solve(0);
  const [b, d, f] = solve(1);
  return [a, b, c, d, e, f];
}

/** A triangle pushed out from its middle by `px`, for a clip that overlaps its neighbours. */
function widened(points, px) {
  const cx = (points[0][0] + points[1][0] + points[2][0]) / 3;
  const cy = (points[0][1] + points[1][1] + points[2][1]) / 3;
  return points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const length = Math.hypot(dx, dy) || 1;
    return [x + (dx / length) * px, y + (dy / length) * px];
  });
}

/**
 * Draw `picture` (`width` × `height` of its pixels) between `corners` (the
 * frame's coordinates, 0 to 1) on a 2D context `out.width` × `out.height`.
 * Says how many triangles were laid; none for corners folded onto a line.
 */
export function drawWarped(ctx, picture, { width, height }, corners, out, cells = WARP_CELLS.fine) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, out.width, out.height);
  const m = warpMatrix(corners);
  if (!m) return 0;
  return drawMesh(ctx, picture, { width, height }, (u, v) => throughMatrix(m, { u, v }), out, cells);
}

/**
 * Draw `picture` straightened from a lens's curve `k` (lib/horizon/overlay.js
 * `straightened`, `shape` its `bendShape`) on a 2D context `out.width` ×
 * `out.height`: each pixel of the photo where a straight lens would have put
 * it. Says how many triangles were laid.
 */
export function drawStraightened(ctx, picture, { width, height }, k, shape, out, cells = BEND_CELLS.fine) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, out.width, out.height);
  return drawMesh(ctx, picture, { width, height }, (u, v) => straightened({ u, v }, k, shape), out, cells);
}

/**
 * Lay `picture` as a grid of `cells` × `cells`, each cell's two triangles
 * where `place(u, v)` (the photo's own point to the frame's, 0 to 1) puts
 * their corners. Says how many triangles were laid.
 */
function drawMesh(ctx, picture, { width, height }, place, out, cells) {
  const to = (u, v) => {
    const p = place(u, v);
    return [p.u * out.width, p.v * out.height];
  };
  const from = (u, v) => [u * width, v * height];
  let laid = 0;
  for (let row = 0; row < cells; row += 1) {
    for (let column = 0; column < cells; column += 1) {
      const u0 = column / cells;
      const u1 = (column + 1) / cells;
      const v0 = row / cells;
      const v1 = (row + 1) / cells;
      // the cell's own pixels, a pixel wide, so the clip has something under its widened edge
      const sx = Math.max(0, Math.floor(u0 * width) - 1);
      const sy = Math.max(0, Math.floor(v0 * height) - 1);
      const sw = Math.min(width, Math.ceil(u1 * width) + 1) - sx;
      const sh = Math.min(height, Math.ceil(v1 * height) + 1) - sy;
      const halves = [
        [from(u0, v0), from(u1, v0), from(u1, v1), to(u0, v0), to(u1, v0), to(u1, v1)],
        [from(u0, v0), from(u1, v1), from(u0, v1), to(u0, v0), to(u1, v1), to(u0, v1)],
      ];
      for (const [s0, s1, s2, d0, d1, d2] of halves) {
        const transform = triangleTransform([s0, s1, s2], [d0, d1, d2]);
        if (!transform) continue;
        const clip = widened([d0, d1, d2], SEAM_PX);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.beginPath();
        ctx.moveTo(clip[0][0], clip[0][1]);
        ctx.lineTo(clip[1][0], clip[1][1]);
        ctx.lineTo(clip[2][0], clip[2][1]);
        ctx.closePath();
        ctx.clip();
        ctx.setTransform(...transform);
        ctx.drawImage(picture, sx, sy, sw, sh, sx, sy, sw, sh);
        ctx.restore();
        laid += 1;
      }
    }
  }
  return laid;
}

/**
 * The photo between its corners as a new canvas: at the photo's own size, or
 * at most `PULL_PX` along its long side while `fast`. Null when this browser
 * offers no canvas or the corners have folded.
 */
export function paintWarped(picture, corners, { fast = false } = {}) {
  return paint(picture, fast, (ctx, size, out) => drawWarped(ctx, picture, size, corners, out, fast ? WARP_CELLS.fast : WARP_CELLS.fine));
}

/**
 * The photo straightened from its lens's curve `k` as a new canvas, the
 * frame's shape at the photo's own size (at most `PULL_PX` along its long side
 * while `fast`, as the curve is being set). A video's frame on show is drawn
 * as a photo. Null when this browser offers no canvas.
 */
export function paintStraightened(picture, k, shape, { fast = false } = {}) {
  return paint(picture, fast, (ctx, size, out) => drawStraightened(ctx, picture, size, k, shape, out, fast ? BEND_CELLS.fast : BEND_CELLS.fine));
}

/** A canvas the picture's size (smaller while `fast`), drawn by `draw`; null when nothing was laid on it. */
function paint(picture, fast, draw) {
  const width = picture?.videoWidth || picture?.width || 0;
  const height = picture?.videoHeight || picture?.height || 0;
  if (!(width > 0 && height > 0)) return null;
  const scale = fast ? Math.min(1, PULL_PX / Math.max(width, height)) : 1;
  const out = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(out.width, out.height)
      : globalThis.document
        ? Object.assign(document.createElement('canvas'), out)
        : null;
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = fast ? 'low' : 'high';
  return draw(ctx, { width, height }, out) ? canvas : null;
}
