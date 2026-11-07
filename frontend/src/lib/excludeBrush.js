/**
 * The areas painted on a collage piece that auto-stitch must not match on: a person
 * walking, a car, a watermark. Kept on the piece in the collage document, never in
 * its picture, as `exclude: [{ points: [[x, y], …], radius }]`.
 *
 * The points are 0–1 in the picture the stitch receives, the piece as `pinholeOps`
 * renders it (its crop in, a panorama remap left out), and the radius a fraction of
 * that picture's width (`engine/inspectwork._clean_exclude` bounds both). A piece a
 * panorama stitch remapped shows another picture than the one stitched, so a stroke
 * painted on it is carried back through the remap (`remapModel`).
 */
/** What a piece holds at most, as the server keeps it. */
export const MAX_STROKES = 200;
export const MAX_POINTS = 400;
/** The brush's size, in screen pixels across, and where it starts. */
export const BRUSH_MIN = 8;
export const BRUSH_MAX = 160;
export const BRUSH_DEFAULT = 40;

const round4 = (v) => Math.round(v * 1e4) / 1e4;

// -- the panorama remap ------------------------------------------------------------
// OpenCV's rotation warpers (`engine/stitch.apply_warp`), point by point: a pixel of
// the piece goes through R·K⁻¹ onto the cylinder or the sphere, and the warped picture
// is the box of the piece's border there. Lengths are in pinhole widths (W = 1, the
// height `a`), which is how the op stores them, so only the piece's shape is needed,
// and it is read off the warped picture's size.

function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det) return null;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

function mul3(m, n) {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) for (let k = 0; k < 3; k += 1) out[3 * r + c] += m[3 * r + k] * n[3 * k + c];
  return out;
}

const apply3 = (m, [x, y, z]) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];

function camera(params, a) {
  const f = Number(params.focal);
  const fy = f * Number(params.aspect ?? 1);
  const K = [f, 0, Number(params.ppx), 0, fy, Number(params.ppy) * a, 0, 0, 1];
  const R = params.r.map(Number);
  const Kinv = inv3(K);
  const Rinv = inv3(R);
  if (!Kinv || !Rinv) return null;
  return { rk: mul3(R, Kinv), kr: mul3(K, Rinv), s: Number(params.scale) };
}

function forward(warp, cam, x, y) {
  const [px, py, pz] = apply3(cam.rk, [x, y, 1]);
  const u = cam.s * Math.atan2(px, pz);
  if (warp === 'spherical') {
    const w = py / Math.hypot(px, py, pz);
    return [u, cam.s * (Math.PI - Math.acos(Math.max(-1, Math.min(1, w))))];
  }
  return [u, (cam.s * py) / Math.hypot(px, pz)];
}

function backward(warp, cam, u, v) {
  const uu = u / cam.s;
  const vv = v / cam.s;
  let ray;
  if (warp === 'spherical') {
    const sinv = Math.sin(Math.PI - vv);
    ray = [sinv * Math.sin(uu), Math.cos(Math.PI - vv), sinv * Math.cos(uu)];
  } else {
    ray = [Math.sin(uu), vv, Math.cos(uu)];
  }
  const [x, y, z] = apply3(cam.kr, ray);
  return z > 0 ? [x / z, y / z] : null;
}

/** The warped picture's box, for a piece `a` pinhole widths high. */
function warpedBox(warp, cam, a, n = 40) {
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  const see = (x, y) => {
    const [u, v] = forward(warp, cam, x, y);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  };
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    see(t, 0);
    see(t, a);
    see(0, t * a);
    see(1, t * a);
  }
  return { u: minU, v: minV, w: maxU - minU, h: maxV - minV };
}

const models = new Map();

/**
 * How a remap op moves a piece's points, given the warped picture's size:
 * `toWarped` and `toPinhole` between the two pictures in 0–1 coordinates, and
 * `ratio`, the warped picture's width in pinhole widths. Null when the op cannot be read.
 */
export function remapModel(params, warpedW, warpedH) {
  const warp = params?.warp;
  if ((warp !== 'cylindrical' && warp !== 'spherical') || params.r?.length !== 9 || !(warpedW > 0) || !(warpedH > 0)) return null;
  const key = JSON.stringify([params, Math.round(warpedW), Math.round(warpedH)]);
  if (models.has(key)) return models.get(key);
  const target = warpedW / warpedH;
  const shape = (a) => {
    const cam = camera(params, a);
    if (!cam) return null;
    const box = warpedBox(warp, cam, a);
    return Number.isFinite(box.w) && box.h > 0 ? { cam, box, ratio: box.w / box.h } : null;
  };
  // The piece's height in widths, where its warped box has the shape the picture has:
  // walked from a wide strip to a tall one until the shape crosses it, then narrowed.
  // A very tall piece reaches past the sphere's pole, where the box stops meaning
  // anything, so the walk stops at ten widths.
  const off = (at) => at.ratio - target;
  let lo = null;
  let hi = null;
  let low = null;
  for (let i = 0, prev = null; i <= 64 && hi == null; i += 1) {
    const t = Math.log(0.1) + (Math.log(10) - Math.log(0.1)) * (i / 64);
    const at = shape(Math.exp(t));
    if (at && prev && off(prev.at) * off(at) <= 0) {
      [lo, hi, low] = [prev.t, t, prev.at];
    }
    prev = at ? { t, at } : null;
  }
  if (hi == null) return null;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const at = shape(Math.exp(mid));
    if (!at) return null;
    if (off(at) * off(low) > 0) lo = mid;
    else hi = mid;
  }
  const a = Math.exp((lo + hi) / 2);
  const { cam, box } = shape(a);
  const model = {
    ratio: box.w,
    toWarped([x, y]) {
      const [u, v] = forward(warp, cam, x, y * a);
      return [(u - box.u) / box.w, (v - box.v) / box.h];
    },
    toPinhole([x, y]) {
      const back = backward(warp, cam, box.u + x * box.w, box.v + y * box.h);
      return back ? [back[0], back[1] / a] : null;
    },
  };
  if (models.size > 60) models.delete(models.keys().next().value);
  models.set(key, model);
  return model;
}

// -- a piece's two pictures ---------------------------------------------------------

const IDENTITY = { ratio: 1, toStitch: (p) => p, toShown: (p) => p };

const uncrop = (p, c) => [c.x + p[0] * c.w, c.y + p[1] * c.h];
const crop = (p, c) => [(p[0] - c.x) / c.w, (p[1] - c.y) / c.h];

/**
 * How a point moves between the piece as the canvas shows it and the picture the
 * stitch receives, both 0–1: `toStitch`, `toShown`, and `ratio`, the stitched
 * picture's width over the shown one's (a radius divides by it on the way to the screen).
 */
export function pieceFrame(node) {
  const ops = node?.save?.ops ?? [];
  const at = ops.findIndex((o) => o.op === 'remap');
  if (at < 0) return IDENTITY;
  const after = ops.slice(at + 1);
  // only a crop moves the picture after the remap; anything else would be guessed at
  if (after.some((o) => o.op === 'rotate' || o.op === 'remap')) return IDENTITY;
  const crops = after.filter((o) => o.op === 'crop').map((o) => o.params);
  const across = crops.reduce((k, c) => k * c.w, 1);
  const down = crops.reduce((k, c) => k * c.h, 1);
  const model = remapModel(ops[at].params, (node.w || 0) / across, (node.h || 0) / down);
  if (!model) return IDENTITY;
  const unshown = (p) => crops.reduceRight((q, c) => uncrop(q, c), p);
  const shown = (p) => crops.reduce((q, c) => crop(q, c), p);
  return {
    ratio: model.ratio,
    toStitch(p) {
      const back = model.toPinhole(unshown(p));
      return back ? shown(back) : null;
    },
    toShown(p) {
      return shown(model.toWarped(unshown(p)));
    },
  };
}

// -- painting -----------------------------------------------------------------------

/**
 * A point of a stroke, kept inside the picture: a brush hanging over the edge still
 * paints the edge, a point further out paints nothing.
 */
export function strokePoint(p, radius) {
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  const x = Math.min(1, Math.max(0, p[0]));
  const y = Math.min(1, Math.max(0, p[1]));
  if (Math.max(Math.abs(x - p[0]), Math.abs(y - p[1])) > radius) return null;
  return [round4(x), round4(y)];
}

/** A radius the server keeps: above 0, at most the picture's width. */
export const strokeRadius = (r) => Math.min(1, Math.max(0.0001, round4(r)));

/**
 * The piece's strokes with `point` added to the one in hand, or a new one begun
 * (`start`). A stroke full of points carries on as the next. Answers null when
 * nothing changed: a point too close to the last, or a piece holding all it can.
 */
export function paint(strokes, point, radius, { start = false, step = radius / 3 } = {}) {
  const list = strokes ?? [];
  const last = list.at(-1);
  const near = last && !start && last.points.length
    ? Math.hypot(point[0] - last.points.at(-1)[0], point[1] - last.points.at(-1)[1]) < step
    : false;
  if (near) return null;
  if (start || !last || last.points.length >= MAX_POINTS) {
    if (list.length >= MAX_STROKES) return null;
    const from = !start && last ? [last.points.at(-1)] : [];
    return [...list, { points: [...from, point], radius: strokeRadius(radius) }];
  }
  return [...list.slice(0, -1), { ...last, points: [...last.points, point] }];
}

/**
 * The strokes with what lies under the eraser taken out, a stroke cut in two where it
 * crossed it. `aspect` is the picture's height over its width, so the eraser is round.
 * Null when it touched nothing.
 */
export function erase(strokes, point, radius, aspect = 1) {
  let touched = false;
  const out = [];
  for (const stroke of strokes ?? []) {
    const reach = radius + stroke.radius * 0.5;
    let run = [];
    const runs = [];
    for (const p of stroke.points) {
      if (Math.hypot(p[0] - point[0], (p[1] - point[1]) * aspect) < reach) {
        touched = true;
        if (run.length) runs.push(run);
        run = [];
      } else {
        run.push(p);
      }
    }
    if (run.length) runs.push(run);
    for (const points of runs) if (out.length < MAX_STROKES) out.push({ points, radius: stroke.radius });
  }
  return touched ? out : null;
}

/**
 * The strokes of a piece whose crop changed from `prev` to `next` (`{x, y, w, h}` of
 * the uncropped picture, null for all of it), where they were on the picture. A point
 * the new crop leaves out goes with it.
 */
export function recrop(strokes, prev, next) {
  if (!strokes?.length) return strokes ?? [];
  const p = prev ?? { x: 0, y: 0, w: 1, h: 1 };
  const n = next ?? { x: 0, y: 0, w: 1, h: 1 };
  const out = [];
  for (const stroke of strokes) {
    const points = stroke.points
      .map((pt) => crop(uncrop(pt, p), n))
      .filter(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1)
      .map(([x, y]) => [round4(x), round4(y)]);
    if (points.length) out.push({ points, radius: strokeRadius((stroke.radius * p.w) / n.w) });
  }
  return out;
}

/**
 * The auto-stitch request's `exclude`, one entry a piece in its order (its strokes,
 * or null), or null when no piece has any, so the request leaves the field out.
 */
export function excludeRequest(nodes) {
  const list = (nodes ?? []).map((n) => (n.exclude?.length ? n.exclude : null));
  return list.some(Boolean) ? list : null;
}
