/**
 * Painting a solved model as flat polygons: one list of paint operations, then an
 * SVG string or a 2D canvas drawing of that list, so the picker, the gallery, a
 * proof stamp and a map sprite all show the same drawing.
 *
 * Every model is drawn from one colour. Its inks are derived from it: `light`
 * mixes 30% white (more turns saturated colours pink), `metal` 42% black, `dark`
 * 74% black, and glass is a fixed blue-black. A dark outline runs round each solid,
 * never round each face, so panels read as one body and solids as parts.
 *
 * Three looks:
 * - `tone`: the shaded model in its colour, for imagery and the gallery.
 * - `ink`: one flat silhouette in `paper` over a disc of `disc`, the map badge.
 * - `mono`: shaded from `currentColor`, for interface previews that follow the
 *   theme. SVG only.
 */
import { rad } from './build.js';
import { project, solved } from './solve.js';

export { MODEL_VIEWS as VIEWS } from './modelMeta.js';

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const GLASS = [27, 34, 43];
/** The halo every free model wears, so it holds over snow, sand and roofs. */
export const HALO = 'rgba(0, 0, 0, 0.62)';

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const css = (c) => `rgb(${c.map((v) => Math.round(Math.max(0, Math.min(255, v)))).join(',')})`;

export function rgbOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return [255, 82, 82];
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}

/** The five inks of one colour, as RGB. */
export function inksOf(colour) {
  const c = rgbOf(colour);
  return { body: c, light: mix(c, WHITE, 0.3), metal: mix(c, BLACK, 0.42), dark: mix(c, BLACK, 0.74), glass: GLASS };
}

/** Lambert light from the north-west: faces turned to it brighten, others darken. */
const toneOf = (lit) => 0.68 + 0.46 * lit;
const lightened = (base, t) => (t <= 1 ? base.map((v) => v * t) : mix(base, WHITE, t - 1));

/** An ink shaded from `currentColor`, for the theme-following previews. */
const MONO_DARK = { body: 0, light: 0, metal: 0.42, dark: 0.74, glass: 0.82 };
function monoOf(ink, t) {
  const k = 1 - MONO_DARK[ink];
  let base = ink === 'light'
    ? 'color-mix(in srgb, currentColor 70%, white)'
    : k < 1 ? `color-mix(in srgb, currentColor ${Math.round(k * 100)}%, black)` : 'currentColor';
  if (t < 0.995) base = `color-mix(in srgb, ${base} ${Math.round(t * 100)}%, black)`;
  else if (t > 1.005) base = `color-mix(in srgb, ${base} ${Math.round((2 - t) * 100)}%, white)`;
  return base;
}

/** The drawn box of a view, solids only, in metres on the page plane. */
export function viewBox(view) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const it of view.order) {
    if (!it.faces.length) continue;
    x0 = Math.min(x0, it.box[0]); x1 = Math.max(x1, it.box[2]);
    y0 = Math.min(y0, it.box[1]); y1 = Math.max(y1, it.box[3]);
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : [-1, -1, 1, 1];
}

/**
 * The paint operations of a model at a view, in metres on the page plane.
 *
 * `line` and `halo` are in page pixels and `ppm` is pixels per metre, so an
 * outline keeps its weight whatever the model's size. `sun` is the shadow cast per
 * metre of height, east and north, or null for none.
 */
export function paintOps(model, {
  heading = 0, tilt = 0, colour = '#ff5252', mode = 'tone', disc = '#0072b2', paper = '#ffffff',
  ppm = 10, line = 0.5, halo = 0, sun = null,
} = {}) {
  const view = solved(model, heading, tilt);
  const u = 1 / ppm; // metres per pixel
  const inks = inksOf(colour);
  const edge = css(inks.dark);
  const ops = [];

  if (sun) {
    // the cast shadow, on the ground, as one flat piece
    const cT = Math.cos(rad(tilt));
    const H = rad(heading);
    const sH = Math.sin(H);
    const cH = Math.cos(H);
    const polys = [];
    for (const pr of model.prims) {
      if (pr.alpha < 0.5) continue;
      const flat = pr.verts.map((p) => {
        const x = p[0] * cH + p[1] * sH + p[2] * sun[0];
        const y = -p[0] * sH + p[1] * cH + p[2] * sun[1];
        return [x, -y * cT];
      });
      for (const f of pr.faces) {
        const poly = f.i.map((i) => flat[i]);
        let a = 0;
        for (let i = 0; i < poly.length; i++) {
          const q = poly[(i + 1) % poly.length];
          a += poly[i][0] * q[1] - q[0] * poly[i][1];
        }
        // one winding for every piece, so the nonzero rule fills their union
        if (Math.abs(a) > 1e-7) polys.push(a < 0 ? [...poly].reverse() : poly);
      }
    }
    ops.push({ polys, fill: 'rgb(12,10,8)', alpha: 0.42 });
  }

  const solid = view.order.filter((it) => it.alpha > 0.5 && it.faces.length);
  if (halo) {
    const polys = solid.flatMap((it) => it.faces.map((f) => f.poly));
    ops.push({ polys, fill: HALO, stroke: HALO, width: halo * 2 * u });
  }

  if (mode === 'ink') {
    for (const it of solid) {
      ops.push({ polys: it.faces.map((f) => f.poly), stroke: disc, width: line * 2 * u });
      const body = it.faces.filter((f) => f.ink !== 'glass').map((f) => f.poly);
      const cut = it.faces.filter((f) => f.ink === 'glass').map((f) => f.poly);
      if (body.length) ops.push({ polys: body, fill: paper, stroke: paper, width: 0.2 * u });
      if (cut.length) ops.push({ polys: cut, fill: disc });
    }
    return { ops, view };
  }

  const mono = mode === 'mono';
  for (const it of view.order) {
    if (!it.faces.length) continue;
    if (it.alpha < 0.5) {
      for (const f of it.faces) {
        ops.push({ polys: [f.poly], fill: mono ? monoOf(f.ink, 1) : css(inks[f.ink]), alpha: it.alpha });
      }
      continue;
    }
    if (line) {
      ops.push({
        polys: it.faces.map((f) => f.poly),
        stroke: mono ? monoOf('dark', 0.7) : edge,
        width: line * 2 * u,
      });
    }
    for (const f of it.faces) {
      const t = toneOf(f.lit);
      const fill = mono ? monoOf(f.ink, t) : css(lightened(inks[f.ink], t));
      ops.push({ polys: [f.poly], fill, stroke: fill, width: 0.3 * u });
    }
  }
  return { ops, view };
}

/**
 * Where a model sits in its box, in metres: the page point at the box's middle,
 * and the side of the box. `fit` is 'bbox' to fill the box with the drawing,
 * 'length' to make the model's length the side (a stamp, so a turn never resizes
 * it), or a number of pixels per metre with the model's middle at the centre.
 */
export function frameOf(model, view, px, fit = 'bbox', pad = 1.1) {
  if (fit === 'bbox') {
    const [x0, y0, x1, y1] = viewBox(view);
    const side = Math.max(x1 - x0, y1 - y0, 1e-3) * pad;
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, side, ppm: px / side };
  }
  const ppm = fit === 'length' ? px / model.len : fit;
  const [cx, cy] = project(model.centre, view);
  return { cx, cy, side: px / ppm, ppm };
}

const num = (v) => (Math.abs(v) < 5e-5 ? '0' : v.toFixed(4).replace(/\.?0+$/, ''));
export const pathOf = (polys) => polys
  .map((p) => `M${p.map((q) => `${num(q[0])} ${num(q[1])}`).join('L')}Z`)
  .join('');

/** One operation as an SVG path. A theme colour goes in a style, where CSS reads it. */
function svgOp(op) {
  const attrs = [`d="${pathOf(op.polys)}"`];
  const style = [];
  const paint = (name, value) => {
    if (value.includes('currentColor')) style.push(`${name}:${value}`);
    else attrs.push(`${name}="${value}"`);
  };
  paint('fill', op.fill ?? 'none');
  if (op.stroke) {
    paint('stroke', op.stroke);
    attrs.push(`stroke-width="${num(op.width)}"`, 'stroke-linejoin="round"');
  }
  if (op.alpha != null && op.alpha < 1) attrs.push(`opacity="${op.alpha}"`);
  if (style.length) attrs.push(`style="${style.join(';')}"`);
  return `<path ${attrs.join(' ')}/>`;
}

/**
 * A model as an SVG string `px` wide. Options are `paintOps`' plus `fit` and
 * `pad` (`frameOf`) and `label`, the accessible name; without one it is hidden.
 */
export function modelSvg(model, { px = 56, fit = 'bbox', pad = 1.1, label = '', ...opts } = {}) {
  const view = solved(model, opts.heading ?? 0, opts.tilt ?? 0);
  const frame = frameOf(model, view, px, fit, pad);
  const { ops } = paintOps(model, { ...opts, ppm: frame.ppm });
  const vb = [frame.cx - frame.side / 2, frame.cy - frame.side / 2, frame.side, frame.side].map(num).join(' ');
  const name = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg width="${px}" height="${px}" viewBox="${vb}" ${name} focusable="false">${ops.map(svgOp).join('')}</svg>`;
}

/**
 * Draws a model into a 2D context, its middle at the context's origin, `ppm`
 * pixels to the metre. Options are `paintOps'`, plus `fit` for where the middle is
 * (`length` by default: the model's own middle, as a stamp is anchored).
 */
export function drawModel(ctx, model, { fit = 'length', px = 56, ...opts } = {}) {
  const view = solved(model, opts.heading ?? 0, opts.tilt ?? 0);
  const frame = frameOf(model, view, px, fit);
  const { ops } = paintOps(model, { ...opts, ppm: frame.ppm });
  ctx.save();
  ctx.scale(frame.ppm, frame.ppm);
  ctx.translate(-frame.cx, -frame.cy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const op of ops) {
    ctx.beginPath();
    for (const poly of op.polys) {
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
    }
    ctx.globalAlpha = op.alpha ?? 1;
    if (op.stroke) {
      ctx.strokeStyle = op.stroke;
      ctx.lineWidth = op.width;
      // a filled face's own thin stroke goes under its fill, closing the seams
      // without widening the face past its neighbours
      if (!op.fill) ctx.stroke();
    }
    if (op.fill) {
      ctx.fillStyle = op.fill;
      if (op.stroke) ctx.stroke();
      ctx.fill();
    }
  }
  ctx.restore();
  return frame;
}
