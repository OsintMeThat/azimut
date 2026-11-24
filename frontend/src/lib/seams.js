/**
 * Where the pieces Azimut stitched meet on a collage, as the saved picture has them
 * (engine/seams.py says the rule; the two are held together by
 * `tests/fixtures/collage-seams.json`).
 *
 * Among the stitched pieces, those whose recipe holds the rotation model's `remap`, a
 * point shows the piece whose middle is nearest, so each owns its Voronoi cell among
 * their middles. A stitched piece is hidden only where the owner of a cell, drawn below
 * it, holds its picture: where the owner's warp left a corner empty, the pieces show
 * as they stack. Pieces laid by hand, and planar stitches, keep stack order.
 *
 * The canvas and the list's preview draw it with polygons: each owner's footprint,
 * traced through its warp, cut to its cell, is a hole in every stitched piece above it.
 */
import { quadCentroid, quadMapUnit, quadUnitAt } from './inspect.js';
import { remapModel } from './excludeBrush.js';

/** Whether a piece's recipe holds the rotation model's warp: a piece Azimut stitched. */
export function isStitched(node) {
  return (node?.save?.ops ?? []).some((o) => o?.op === 'remap' && o.params?.r?.length === 9);
}

const near = (a, b) => Math.abs(a - b) <= Math.max(1e-9 * Math.max(Math.abs(a), Math.abs(b)), 1e-9);

/** The part of a polygon where `a·x + b·y <= c` (Sutherland–Hodgman, one edge). */
function clip(poly, a, b, c) {
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = a * p[0] + b * p[1] - c;
    const fq = a * q[0] + b * q[1] - c;
    if (fp <= 0) out.push(p);
    if (fp <= 0 !== fq <= 0) {
      const t = fp / (fp - fq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
}

/** A polygon cut to the cell of `middles[k]`: what of it lies nearer that middle than any other. */
function inCell(poly, middles, k) {
  const [xi, yi] = middles[k];
  let cell = poly;
  for (let j = 0; j < middles.length && cell.length; j += 1) {
    if (j === k) continue;
    const [xj, yj] = middles[j];
    if (near(xi, xj) && near(yi, yj)) {
      // two middles at one place: the piece drawn later owns the cell
      if (j > k) return [];
      continue;
    }
    cell = clip(cell, 2 * (xj - xi), 2 * (yj - yi), xj * xj + yj * yj - xi * xi - yi * yi);
  }
  return cell;
}

/**
 * Each middle's Voronoi cell among the others within `[left, top, right, bottom]`: a
 * convex polygon, empty for a middle another later one sits on.
 */
export function seamCells(middles, [left, top, right, bottom]) {
  const box = [[left, top], [right, top], [right, bottom], [left, bottom]];
  return middles.map((_, k) => inCell(box, middles, k));
}

// Points traced along each side of a warped piece's outline, and how far inside its
// edge, in its own pixels: the saved picture's edge pixel is part transparent, and the
// canvas must never hide a piece there.
const SIDE = 24;
const INSET = 2;
const outlines = new Map();

/** A stitched piece's outline in its own unit square, or null when its warp cannot be read. */
function ownOutline(node) {
  const ops = node.save?.ops ?? [];
  const at = ops.findIndex((o) => o?.op === 'remap');
  if (at < 0 || !(node.w > 0) || !(node.h > 0)) return null;
  const after = ops.slice(at + 1);
  // only a crop moves the picture after the warp; anything else would be guessed at
  if (after.some((o) => o?.op === 'rotate' || o?.op === 'remap')) return null;
  const crops = after.filter((o) => o?.op === 'crop').map((o) => o.params);
  const key = JSON.stringify([ops.slice(at), node.w, node.h]);
  if (outlines.has(key)) return outlines.get(key);
  const fullW = node.w / crops.reduce((k, c) => k * c.w, 1);
  const fullH = node.h / crops.reduce((k, c) => k * c.h, 1);
  const model = remapModel(ops[at].params, fullW, fullH);
  let outline = null;
  if (model) {
    const ex = INSET / fullW;
    const ey = INSET / fullH;
    const border = [];
    for (let i = 0; i < SIDE; i += 1) border.push([ex + ((1 - 2 * ex) * i) / SIDE, ey]);
    for (let i = 0; i < SIDE; i += 1) border.push([1 - ex, ey + ((1 - 2 * ey) * i) / SIDE]);
    for (let i = 0; i < SIDE; i += 1) border.push([1 - ex - ((1 - 2 * ex) * i) / SIDE, 1 - ey]);
    for (let i = 0; i < SIDE; i += 1) border.push([ex, 1 - ey - ((1 - 2 * ey) * i) / SIDE]);
    outline = border.map((p) => crops.reduce((q, c) => [(q[0] - c.x) / c.w, (q[1] - c.y) / c.h], model.toWarped(p)));
  }
  if (outlines.size > 120) outlines.delete(outlines.keys().next().value);
  outlines.set(key, outline);
  return outline;
}

/** Where a stitched piece holds its picture on the canvas, a polygon; null when its warp cannot be read. */
export function footprint(node) {
  const outline = ownOutline(node);
  return outline ? quadMapUnit(node.quad, outline) : null;
}

function bounds(poly) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

const meets = (a, b) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

/**
 * What the stitch hides of each piece, in canvas pixels: for every piece, in order, the
 * polygons drawn over it by owners below. Empty for a piece laid by hand, and for every
 * piece while fewer than two are stitched. An owner with no picture on screen yet (still
 * rendering, or its file gone) hides nothing, so nothing goes blank waiting for it.
 */
export function seamHoles(nodes) {
  const holes = nodes.map(() => []);
  const stitched = [];
  nodes.forEach((node, i) => {
    if (isStitched(node) && quadCentroid(node.quad).every(Number.isFinite)) stitched.push(i);
  });
  if (stitched.length < 2) return holes;
  const middles = stitched.map((i) => quadCentroid(nodes[i].quad));
  const owned = stitched.map((i, k) => {
    const node = nodes[i];
    const outline = node.url && !node.missing ? footprint(node) : null;
    const part = outline ? inCell(outline, middles, k) : [];
    return part.length >= 3 ? { part, box: bounds(part) } : null;
  });
  stitched.forEach((i, k) => {
    const box = bounds(nodes[i].quad);
    for (let j = 0; j < k; j += 1) {
      if (owned[j] && meets(owned[j].box, box)) holes[i].push(owned[j].part);
    }
  });
  return holes;
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * A piece's holes as a CSS `clip-path` in its own pixels (the `w` × `h` box its quad
 * warps), or null with none. The kept area reaches past the box, so the piece's outline
 * still draws.
 */
export function seamClipPath(node, holes) {
  if (!holes?.length) return null;
  const { w, h } = node;
  const parts = [];
  for (const hole of holes) {
    let local = [];
    for (const p of hole) {
      const u = quadUnitAt(node.quad, p);
      if (!u) {
        local = null;
        break;
      }
      local.push([u[0] * w, u[1] * h]);
    }
    if (!local) continue;
    for (const [a, b, c] of [[-1, 0, 0], [1, 0, w], [0, -1, 0], [0, 1, h]]) local = clip(local, a, b, c);
    if (local.length >= 3) parts.push(`M${local.map(([x, y]) => `${round2(x)} ${round2(y)}`).join('L')}Z`);
  }
  if (!parts.length) return null;
  const m = Math.max(w, h);
  return `path(evenodd, "M${-m} ${-m}H${w + m}V${h + m}H${-m}Z${parts.join('')}")`;
}
