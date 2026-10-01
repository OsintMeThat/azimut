import { collageBounds, quadMapUnit } from './inspect.js';

// The picture the collage list shows for a collage. The pieces are already drawn
// in the open tool, so the browser paints them once more onto a small canvas and
// hands that to the case, rather than the server rendering every recipe again.
//
// A 2D canvas only draws affine maps, and a warped piece is projective. Each piece
// is cut into a grid of triangles, each drawn with the affine map its three corners
// fix; at the preview's size the seams are below a pixel.

/** Longest edge of a preview, in pixels. The server shrinks anything larger. */
export const THUMB_EDGE = 480;

/** Cells per side for a warped piece. A parallelogram is exact in one. */
const WARP_CELLS = 8;

/**
 * The affine map sending triangle `s` onto triangle `d`, as the six numbers
 * `setTransform(a, b, c, d, e, f)` takes: x' = a·x + c·y + e, y' = b·x + d·y + f.
 * Null for a triangle with no area, which draws nothing.
 */
export function affineFromTriangles(s, d) {
  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(det) < 1e-12) return null;
  const [[u0, v0], [u1, v1], [u2, v2]] = d;
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
  const c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det;
  const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det;
  const dd = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;
  return [a, b, c, dd, u0 - a * x0 - c * y0, v0 - b * x0 - dd * y0];
}

/** Whether a quad (TL, TR, BR, BL) is a parallelogram, so one affine map draws it. */
export function isParallelogram(quad, eps = 0.5) {
  const [p0, p1, p2, p3] = quad;
  return Math.abs(p0[0] + p2[0] - p1[0] - p3[0]) < eps && Math.abs(p0[1] + p2[1] - p1[1] - p3[1]) < eps;
}

/**
 * The triangles a `w`×`h` picture is drawn in to land on `quad`: pairs of
 * `{ src, dst }`, the source in the picture's pixels, the target in canvas pixels.
 */
export function pieceTriangles(w, h, quad) {
  const n = isParallelogram(quad) ? 1 : WARP_CELLS;
  const unit = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) unit.push([i / n, j / n]);
  const mapped = quadMapUnit(quad, unit);
  const at = (i, j) => j * (n + 1) + i;
  const out = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const cell = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      for (const tri of [[cell[0], cell[1], cell[2]], [cell[0], cell[2], cell[3]]]) {
        out.push({
          src: tri.map((k) => [unit[k][0] * w, unit[k][1] * h]),
          dst: tri.map((k) => mapped[k]),
        });
      }
    }
  }
  return out;
}

/**
 * Where the pieces land on a preview: their bounds, scaled to fit `edge` and
 * never enlarged. Null for a collage with no piece.
 */
export function thumbFrame(nodes, edge = THUMB_EDGE) {
  if (!nodes.length) return null;
  const b = collageBounds(nodes);
  const scale = Math.min(1, edge / Math.max(b.width, b.height));
  return {
    minX: b.minX,
    minY: b.minY,
    scale,
    width: Math.max(1, Math.round(b.width * scale)),
    height: Math.max(1, Math.round(b.height * scale)),
  };
}

// A triangle clipped exactly leaves hairline gaps between its neighbours, so each
// is pushed out a fraction of a pixel from its centre before it clips.
function grown(tri, by) {
  const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
  const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
  return tri.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * by, y + (dy / len) * by];
  });
}

function tracePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
}

/**
 * Paint the pieces bottom to top. `images` maps a piece's id to a loaded image;
 * a piece whose file is gone is drawn as the hatched gap the canvas shows.
 */
export function paintCollage(ctx, nodes, images, frame) {
  const place = ([x, y]) => [(x - frame.minX) * frame.scale, (y - frame.minY) * frame.scale];
  for (const node of nodes) {
    const quad = node.quad.map(place);
    const image = images.get(node.id);
    if (!image) {
      if (!node.missing) continue;
      ctx.save();
      tracePath(ctx, quad);
      ctx.fillStyle = 'rgba(216, 106, 106, 0.18)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(216, 106, 106, 0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      continue;
    }
    const w = image.naturalWidth || node.w;
    const h = image.naturalHeight || node.h;
    if (isParallelogram(quad)) {
      // One affine map lands the whole picture, so it needs no cut and no clip.
      const m = affineFromTriangles([[0, 0], [w, 0], [0, h]], [quad[0], quad[1], quad[3]]);
      if (!m) continue;
      ctx.save();
      ctx.setTransform(...m);
      ctx.drawImage(image, 0, 0);
      ctx.restore();
      continue;
    }
    for (const { src, dst } of pieceTriangles(w, h, quad)) {
      const m = affineFromTriangles(src, dst);
      if (!m) continue;
      ctx.save();
      tracePath(ctx, grown(dst, 0.4));
      ctx.clip();
      ctx.setTransform(...m);
      ctx.drawImage(image, 0, 0);
      ctx.restore();
    }
  }
}

function loadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * The preview of a collage as a PNG blob, or null when there is nothing to show.
 * `nodes` are plain copies of the pieces ({ id, quad, url, w, h, missing }), so the
 * caller can let the open collage go while this finishes.
 */
export async function renderCollageThumb(nodes, { edge = THUMB_EDGE, load = loadImage } = {}) {
  const frame = thumbFrame(nodes, edge);
  if (!frame) return null;
  const images = new Map();
  await Promise.all(
    nodes.filter((n) => n.url).map(async (n) => {
      const image = await load(n.url);
      if (image) images.set(n.id, image);
    }),
  );
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paintCollage(ctx, nodes, images, frame);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}
