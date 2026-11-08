/**
 * The geometry a vehicle model is made of: a list of convex solids, in metres.
 *
 * x runs to the vehicle's right, y forward and z up, with the ground point at the
 * origin. Every solid is convex, which is what lets `solve.js` order them by a
 * separating plane rather than by depth alone: a depth sort of faces broke on the
 * first long barrel lying over a short hull.
 *
 * A face names an ink rather than a colour (`body`, `light`, `metal`, `dark`,
 * `glass`), so one model is drawn in whatever colour the analyst picked.
 */

export const TAU = Math.PI * 2;
export const rad = (d) => (d * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const range = (n) => Array.from({ length: n }, (_, k) => k);
const mean = (points, axis) => points.reduce((s, p) => s + p[axis], 0) / points.length;

export const INKS = ['body', 'light', 'metal', 'dark', 'glass'];

export class Build {
  constructor() {
    this.prims = [];
  }

  /**
   * One solid from its corners and faces. Each face's normal is turned to point
   * away from the solid's middle, so a face can be listed in either winding.
   */
  raw(verts, faces, o = {}) {
    const centre = [0, 1, 2].map((a) => mean(verts, a));
    const out = [];
    for (const f of faces) {
      let i = f.i;
      let n = [0, 0, 0];
      for (let k = 0; k < i.length; k++) {
        const a = verts[i[k]];
        const b = verts[i[(k + 1) % i.length]];
        n[0] += (a[1] - b[1]) * (a[2] + b[2]);
        n[1] += (a[2] - b[2]) * (a[0] + b[0]);
        n[2] += (a[0] - b[0]) * (a[1] + b[1]);
      }
      if (Math.hypot(n[0], n[1], n[2]) < 1e-9) continue;
      n = unit(n);
      const fc = [0, 1, 2].map((a) => i.reduce((s, q) => s + verts[q][a], 0) / i.length);
      if (dot(n, sub(fc, centre)) < 0) {
        i = [...i].reverse();
        n = n.map((x) => -x);
      }
      out.push({ i, ink: f.ink, n, d: dot(n, verts[i[0]]) });
    }
    this.prims.push({ verts, faces: out, alpha: o.alpha ?? 1 });
    return this;
  }

  /** A solid between a lower and an upper outline of the same length. */
  ring(lo, up, z0, z1, o = {}) {
    const n = lo.length;
    const v = [...lo.map((p) => [p[0], p[1], z0]), ...up.map((p) => [p[0], p[1], z1])];
    const ink = o.ink || 'body';
    const side = o.side || ink;
    const f = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      f.push({ i: [i, j, n + j, n + i], ink: o.sides?.[i] || side });
    }
    f.push({ i: range(n).map((k) => n + k), ink: o.top || ink }, { i: range(n), ink: o.under || 'dark' });
    return this.raw(v, f, o);
  }

  /** A rectangle in plan, `c` cutting its corners. */
  rect(x, y, w, l, c = 0) {
    const a = w / 2;
    const b = l / 2;
    return c
      ? [[x - a + c, y - b], [x + a - c, y - b], [x + a, y - b + c], [x + a, y + b - c],
        [x + a - c, y + b], [x - a + c, y + b], [x - a, y + b - c], [x - a, y - b + c]]
      : [[x - a, y - b], [x + a, y - b], [x + a, y + b], [x - a, y + b]];
  }

  /**
   * A box `w` wide and `l` long. Its top can be drawn in: `tx` from each side,
   * `tf` from the front and `tb` from the back, which is how a windscreen slopes.
   */
  box(x, y, w, l, z0, z1, o = {}) {
    const c = o.c || 0;
    const tx = o.tx || 0;
    const tf = o.tf || 0;
    const tb = o.tb || 0;
    // `front` and `back` ink those faces alone (a windscreen, a tailgate); on a
    // cut box the cut corners beside the front go with it, as a wrapped screen does
    let sides = o.sides;
    if (o.front || o.back) {
      sides = c ? [o.back, null, null, o.front, o.front, o.front, null, null] : [o.back, null, o.front, null];
    }
    return this.ring(this.rect(x, y, w, l, c), this.rect(x, y + (tb - tf) / 2, w - 2 * tx, l - tf - tb, c), z0, z1, { ...o, sides });
  }

  /** An outline in plan raised from z0 to z1, its top scaled by `s` and its foot by `b`. */
  prism(poly, z0, z1, o = {}) {
    const cx = mean(poly, 0);
    const cy = mean(poly, 1);
    const s = o.s ?? 1;
    const b = o.b ?? 1;
    const at = (k) => (p) => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k];
    return this.ring(poly.map(at(b)), poly.map(at(s)), z0, z1, o);
  }

  /** A side profile `[y, z][]` pushed across from x0 to x1. `edge` inks each profile edge. */
  extX(p, x0, x1, o = {}) {
    const n = p.length;
    const v = [...p.map((q) => [x0, q[0], q[1]]), ...p.map((q) => [x1, q[0], q[1]])];
    const ink = o.ink || 'body';
    const f = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      f.push({ i: [i, j, n + j, n + i], ink: (o.edge && o.edge[i]) || ink });
    }
    f.push({ i: range(n), ink: o.cap || ink }, { i: range(n).map((k) => n + k), ink: o.cap || ink });
    return this.raw(v, f, o);
  }

  /** A front profile `[x, z][]` pushed along from y0 to y1. */
  extY(p, y0, y1, o = {}) {
    const n = p.length;
    const v = [...p.map((q) => [q[0], y0, q[1]]), ...p.map((q) => [q[0], y1, q[1]])];
    const ink = o.ink || 'body';
    const f = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      f.push({ i: [i, j, n + j, n + i], ink: (o.edge && o.edge[i]) || ink });
    }
    f.push({ i: range(n), ink: o.cap || ink }, { i: range(n).map((k) => n + k), ink: o.capF || o.cap || ink });
    return this.raw(v, f, o);
  }

  /** A tube from a to b, `r` at a and `r1` at b, `n` sided. */
  tube(a, b, r, o = {}) {
    const n = o.n || 10;
    const r1 = o.r1 ?? r;
    const ax = unit(sub(b, a));
    const h = Math.abs(ax[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    const u = unit(cross(ax, h));
    const w = cross(ax, u);
    const circle = (c, R) => range(n).map((k) => {
      const t = (k / n) * TAU + (o.phase || 0);
      const p = Math.cos(t) * R;
      const q = Math.sin(t) * R;
      return [c[0] + u[0] * p + w[0] * q, c[1] + u[1] * p + w[1] * q, c[2] + u[2] * p + w[2] * q];
    });
    const v = [...circle(a, r), ...circle(b, r1)];
    const ink = o.ink || 'body';
    const f = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      f.push({ i: [i, j, n + j, n + i], ink });
    }
    f.push({ i: range(n), ink: o.capA || ink }, { i: range(n).map((k) => n + k), ink: o.capB || ink });
    return this.raw(v, f, o);
  }

  /** An upright cylinder standing on (x, y). */
  cyl(x, y, r, z0, z1, o = {}) {
    return this.tube([x, y, z0], [x, y, z1], r, o);
  }

  /** A body of revolution along y, from rings `{ y, rx, rz, z, x?, ink? }`. */
  loft(rings, o = {}) {
    const n = o.n || 12;
    const v = [];
    const f = [];
    const ink = o.ink || 'body';
    for (const r of rings) {
      for (let k = 0; k < n; k++) {
        const t = ((k + 0.5) / n) * TAU;
        v.push([(r.x || 0) + Math.cos(t) * r.rx, r.y, r.z + Math.sin(t) * r.rz]);
      }
    }
    for (let s = 0; s < rings.length - 1; s++) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = s * n;
        const b = (s + 1) * n;
        f.push({ i: [a + i, a + j, b + j, b + i], ink: rings[s].ink || ink });
      }
    }
    f.push({ i: range(n), ink: o.capA || ink }, { i: range(n).map((k) => (rings.length - 1) * n + k), ink: o.capB || ink });
    return this.raw(v, f, o);
  }

  /** A thin slab from four corners, so a wing or a blade can sit at any slope. */
  slab(q, t, o = {}) {
    const v = [...q, ...q.map((p) => [p[0], p[1], p[2] + t])];
    const ink = o.ink || 'body';
    const f = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      f.push({ i: [i, j, 4 + j, 4 + i], ink });
    }
    f.push({ i: [4, 5, 6, 7], ink: o.top || ink }, { i: [0, 1, 2, 3], ink: o.under || ink });
    return this.raw(v, f, o);
  }

  /** A box pitched up by `p` degrees about its own middle `c`. */
  pitched(c, w, l, h, p, o = {}) {
    const s = Math.sin(rad(p));
    const k = Math.cos(rad(p));
    const v = [];
    for (const z of [-h / 2, h / 2]) {
      for (const y of [-l / 2, l / 2]) {
        for (const x of [-w / 2, w / 2]) v.push([c[0] + x, c[1] + y * k - z * s, c[2] + y * s + z * k]);
      }
    }
    const ink = o.ink || 'body';
    return this.raw(v, [
      { i: [0, 1, 3, 2], ink }, { i: [4, 5, 7, 6], ink: o.top || ink },
      { i: [0, 1, 5, 4], ink: o.back || ink }, { i: [2, 3, 7, 6], ink: o.front || ink },
      { i: [0, 2, 6, 4], ink }, { i: [1, 3, 7, 5], ink },
    ], o);
  }

  /** A pair of wheels on the axle at `y`, their outer faces `half` from the middle. */
  wheels(y, half, r, w, o = {}) {
    for (const s of [-1, 1]) {
      this.tube([s * (half - w / 2), y, r], [s * (half + w / 2), y, r], r, { n: 12, ink: 'dark', capA: 'metal', capB: 'metal', ...o });
    }
    return this;
  }
}

/**
 * A finished model: its solids, and the sizes the painters fit it by. `len` is the
 * longer side in plan, which is the side a stamp's size names; `R` the farthest
 * corner from the ground point; `centre` the middle of its bounding box.
 */
export function finish(id, build) {
  let R = 0;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of build.prims) {
    for (const v of p.verts) {
      R = Math.max(R, Math.hypot(v[0], v[1], v[2]));
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], v[a]);
        hi[a] = Math.max(hi[a], v[a]);
      }
    }
  }
  return {
    id,
    prims: build.prims,
    R,
    len: Math.max(hi[0] - lo[0], hi[1] - lo[1]),
    width: hi[0] - lo[0],
    length: hi[1] - lo[1],
    height: hi[2],
    centre: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
  };
}
