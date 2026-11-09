/**
 * A vehicle model on a proof, as one Konva shape.
 *
 * The shape paints the solved polygons itself, so it stays crisp at any export
 * pixel ratio and an export needs nothing new. `heading` turns the model on the
 * ground it stands on and `tilt` is the viewer's: a picture has no camera, so a
 * stamp stores both (absent reads as 0, the view from above). The group's `rotation`
 * stays the stamp's own turn on the page, for rolling it to a picture's horizon.
 *
 * `size` is the model's length on the page, so turning it never resizes it.
 */
import { loadModels, modelsNow } from './icons/loadModels.svelte.js';
import { isModel } from './icons/catalog.js';
import { stampView } from './icons/stampView.svelte.js';
import { ICON_SIZE_DEFAULT, glyphInk } from './proofIcons.js';

/** The name the shape answers to, for a ring that repaints it mid-drag. */
export const MODEL_SHAPE = 'model-view';

/** A model's share of its disc: a nose reaching the rim reads as cut off. */
const IN_DISC = 0.8;

/** Outline and halo in page pixels, in step with the stamp's size within sane bounds. */
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
export const modelLine = (placed) => clamp(placed * 0.009, 0.35, 3);
export const modelHalo = (placed) => clamp(placed * 0.022, 1, 6);

/**
 * The view a model stamp is made with: the picker's View in hand, heading and tilt,
 * written onto the stamp as the tool lays it down. Any other symbol takes none.
 * A stamp is never given a view afterwards, so one saved without the fields keeps
 * drawing as it always did, from above with its nose up.
 */
export function pickedModelView(name) {
  if (!isModel(name)) return {};
  const view = stampView();
  return { heading: view.heading, tilt: view.tilt };
}

/** How a model stamp is painted, in the surface's own pixels. */
export function modelPaint(s, { size, scale = 1, disc = 0, heading = s.heading ?? 0, tilt = s.tilt ?? 0 }) {
  const placed = s.size ?? ICON_SIZE_DEFAULT;
  const onDisc = disc > 0.45;
  return {
    px: disc > 0 ? size * IN_DISC : size,
    fit: 'length',
    heading,
    tilt,
    colour: s.color,
    mode: onDisc ? 'ink' : 'tone',
    disc: s.color,
    paper: glyphInk(s.color, 1),
    line: modelLine(placed) / scale,
    halo: onDisc ? 0 : modelHalo(placed) / scale,
  };
}

/** How many painted models are kept, how many pixels they may hold in all, and the largest one kept. */
export const DRAWN_CAP = 64;
export const DRAWN_BUDGET = 4_000_000;
export const DRAWN_LARGEST = 512 * 512;

const quarter = (v) => Math.round(v * 4) / 4;

/**
 * Painted models kept as pictures, so a canvas drawn again at rest lays each one
 * down rather than painting its polygons again. A drawing is kept for what it
 * shows: the model, its view, its colour and ink, and its size in device pixels,
 * so a zoom, a resize or a recolour paints a new one. The oldest go first past
 * `cap` drawings or `budget` pixels, and one larger than `largest` pixels is painted
 * every time rather than kept. `makeCanvas(w, h)` gives a canvas to paint into.
 *
 * `draw(ctx, engine, model, paint)` lays the model down and answers true, or false
 * when it could not and the caller paints it as before. Upright on the screen, the
 * picture is laid down pixel for pixel, so it is as sharp as the painting it keeps.
 */
export function createModelCache({
  cap = DRAWN_CAP, budget = DRAWN_BUDGET, largest = DRAWN_LARGEST,
  makeCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }),
} = {}) {
  const kept = new Map();
  let pixels = 0;

  function keep(key, entry) {
    kept.set(key, entry);
    pixels += entry.pixels;
    for (const [oldKey, old] of kept) {
      if (kept.size <= cap && pixels <= budget) break;
      kept.delete(oldKey);
      pixels -= old.pixels;
    }
  }

  function paintOnce(engine, model, paint, k) {
    const [x0, y0, x1, y1] = engine.drawnBox(model, paint);
    const w = Math.ceil((x1 - x0) * k) + 2;
    const h = Math.ceil((y1 - y0) * k) + 2;
    if (!(w > 0) || !(h > 0) || w * h > largest) return null;
    const canvas = makeCanvas(w, h);
    const ctx = canvas?.getContext?.('2d');
    if (!ctx) return null;
    ctx.setTransform(k, 0, 0, k, -x0 * k + 1, -y0 * k + 1);
    engine.drawModel(ctx, model, paint);
    return { canvas, x: x0 - 1 / k, y: y0 - 1 / k, w: w / k, h: h / k, k, pixels: w * h };
  }

  function draw(ctx, engine, model, paint) {
    const t = ctx?.getTransform?.();
    if (!t || !engine?.drawnBox) return false;
    const k = Math.hypot(t.a, t.b);
    if (!(k > 0)) return false;
    const key = [
      model.id, Math.round(paint.heading ?? 0), Math.round(paint.tilt ?? 0), paint.colour, paint.mode,
      paint.disc, paint.paper, quarter(paint.px * k), quarter((paint.line ?? 0) * k), quarter((paint.halo ?? 0) * k),
    ].join('|');
    let entry = kept.get(key);
    if (entry) {
      kept.delete(key);
      kept.set(key, entry);
    } else {
      entry = paintOnce(engine, model, paint, k);
      if (!entry) return false;
      keep(key, entry);
    }
    const upright = Math.abs(t.b) < 1e-9 && Math.abs(t.c) < 1e-9 && t.a > 0 && Math.abs(t.a - t.d) < 1e-9;
    if (upright) {
      // pixel for pixel, at the device pixel the drawing starts on
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(entry.canvas, Math.round(t.a * entry.x + t.e), Math.round(t.d * entry.y + t.f));
      ctx.restore();
    } else {
      ctx.drawImage(entry.canvas, entry.x, entry.y, entry.w, entry.h);
    }
    return true;
  }

  return { draw, size: () => kept.size, pixels: () => pixels, clear: () => { kept.clear(); pixels = 0; } };
}

const drawings = createModelCache();

/**
 * The shape drawing a model stamp, its middle on the box's. Until the models land
 * it draws nothing and asks for them, and its layer repaints once they have. On
 * screen a model is laid down from the drawings kept (`createModelCache`); an export,
 * which draws into a canvas of its own, paints it as it always did.
 */
export function modelNode(Konva, s, { size, scale = 1, origin, disc = 0, cache = drawings }) {
  return new Konva.Shape({
    name: MODEL_SHAPE,
    x: origin.x + size / 2,
    y: origin.y + size / 2,
    listening: false,
    viewHeading: s.heading ?? 0,
    viewTilt: s.tilt ?? 0,
    sceneFunc(context, shape) {
      const engine = modelsNow();
      if (!engine) {
        loadModels().then(() => shape.getLayer()?.batchDraw());
        return;
      }
      const model = engine.modelById(s.name);
      if (!model) return;
      const paint = modelPaint(s, {
        size, scale, disc, heading: shape.getAttr('viewHeading'), tilt: shape.getAttr('viewTilt'),
      });
      const onScreen = !!context && context === shape.getLayer?.()?.getCanvas?.()?.getContext?.();
      if (onScreen && cache.draw(context._context, engine, model, paint)) return;
      engine.drawModel(context._context, model, paint);
    },
  });
}
