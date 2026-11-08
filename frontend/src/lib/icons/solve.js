/**
 * Solving a view of a model: which faces show, and in which order the solids paint.
 *
 * `heading` turns the model clockwise from up (north on a map, the top of the
 * picture on a proof); `tilt` is the viewer's, 0 looking straight down and 90
 * along the ground from the bottom of the page. Points come out in metres on the
 * page plane, x to the right and y down.
 */
import { dot, rad, unit } from './build.js';

/** Light from the north-west and above, in the viewer's frame. */
export const LIGHT = unit([-0.42, 0.52, 0.74]);

/**
 * Who is in front, settled by a face plane of one solid that has the whole other
 * solid on its outer side: the solid on the viewer's side of it paints last.
 * 1 when A is behind B, -1 when A is in front, 0 when no plane settles it.
 */
export function separated(A, B, v) {
  for (const [P, Q, flip] of [[A, B, 1], [B, A, -1]]) {
    for (const f of P.faces) {
      let out = true;
      for (const p of Q.verts) {
        if (dot(f.n, p) - f.d < -1e-4) { out = false; break; }
      }
      if (!out) continue;
      const side = dot(f.n, v);
      if (side > 1e-4) return flip;
      if (side < -1e-4) return -flip;
    }
  }
  return 0;
}

/** The view's axes: toward the viewer, page right and page up, in model space. */
export function viewAxes(heading, tilt) {
  const H = rad(heading);
  const T = rad(tilt);
  const sH = Math.sin(H);
  const cH = Math.cos(H);
  const sT = Math.sin(T);
  const cT = Math.cos(T);
  return { v: [sT * sH, -sT * cH, cT], ex: [cH, sH, 0], ey: [-sH * cT, cH * cT, sT] };
}

/** Where a model-space point lands on the page plane, in metres, y down. */
export const project = (p, { ex, ey }) => [dot(p, ex), -dot(p, ey)];

export function solve(model, heading, tilt) {
  const axes = viewAxes(heading, tilt);
  const { v, ex, ey } = axes;
  const items = model.prims.map((pr) => {
    const pts = pr.verts.map((p) => [dot(p, ex), -dot(p, ey)]);
    const depth = pr.verts.reduce((s, p) => s + dot(p, v), 0) / pr.verts.length;
    const faces = [];
    for (const f of pr.faces) {
      if (dot(f.n, v) <= 1e-3) continue;
      const nv = [dot(f.n, ex), dot(f.n, ey), dot(f.n, v)];
      faces.push({ poly: f.i.map((i) => pts[i]), ink: f.ink, lit: Math.max(0, dot(nv, LIGHT)) });
    }
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    return { pr, depth, faces, box: [x0, y0, x1, y1], alpha: pr.alpha };
  });
  // Behind before in front; deepest first wherever no plane says.
  const n = items.length;
  const after = items.map(() => []);
  const need = new Array(n).fill(0);
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const A = items[a];
      const B = items[b];
      if (A.box[2] < B.box[0] || B.box[2] < A.box[0] || A.box[3] < B.box[1] || B.box[3] < A.box[1]) continue;
      const r = separated(A.pr, B.pr, v);
      if (r > 0) { after[a].push(b); need[b]++; } else if (r < 0) { after[b].push(a); need[a]++; }
    }
  }
  const done = new Array(n).fill(false);
  const order = [];
  for (let k = 0; k < n; k++) {
    let pick = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!done[i] && need[i] === 0 && items[i].depth < best) { best = items[i].depth; pick = i; }
    }
    // a cycle: break it at the deepest solid left
    if (pick < 0) {
      for (let i = 0; i < n; i++) if (!done[i] && items[i].depth < best) { best = items[i].depth; pick = i; }
    }
    done[pick] = true;
    order.push(items[pick]);
    for (const q of after[pick]) need[q]--;
  }
  return { order, ...axes };
}

const CACHE_CAP = 256;
const cache = new Map();

/** Views to the nearest degree, the last 256 kept: a stamp redrawn at rest costs nothing. */
export function solved(model, heading, tilt) {
  const h = ((Math.round(heading) % 360) + 360) % 360;
  const t = Math.max(0, Math.min(90, Math.round(tilt)));
  const key = `${model.id}|${h}|${t}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const view = solve(model, h, t);
  cache.set(key, view);
  if (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value);
  return view;
}

/** How many views are kept, for the tests that hold the cap. */
export const cachedViews = () => cache.size;
