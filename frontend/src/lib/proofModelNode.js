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

/**
 * The shape drawing a model stamp, its middle on the box's. Until the models land
 * it draws nothing and asks for them, and its layer repaints once they have.
 */
export function modelNode(Konva, s, { size, scale = 1, origin, disc = 0 }) {
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
      engine.drawModel(context._context, model, modelPaint(s, {
        size, scale, disc, heading: shape.getAttr('viewHeading'), tilt: shape.getAttr('viewTilt'),
      }));
    },
  });
}
