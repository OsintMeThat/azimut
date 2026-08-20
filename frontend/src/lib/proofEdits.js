/**
 * Edits to what a proof holds, as arithmetic over the document.
 *
 * `composer.js` answers where panels land and what the legend says. This answers
 * the smaller question beside it: given the document and one act — nudge this,
 * delete that, drag this panel to a new row, drop the resize handle here — what
 * does the document become?
 *
 * They are apart from the tool because each is a rule with an edge nobody sees
 * until it is wrong: a nudge that moves a freehand stroke's origin instead of its
 * vertices, a colour whose legend note outlives the last element that used it, a
 * resize that rounds a panel to a scale the buttons cannot get back to. Konva and
 * Svelte are not involved — these take plain objects and answer with plain values,
 * so the caller decides what to write.
 */

import { PANEL_H } from './composer.js';

/** How small and how large a panel may be dragged or stepped. */
export const PANEL_SCALE_MIN = 0.25;
export const PANEL_SCALE_MAX = 2.5;

/**
 * A shape moved by (dx, dy), in panel-natural pixels.
 *
 * Points-based kinds carry their geometry in a flat `[x, y, x, y, …]` list and
 * have no origin to move, so every vertex shifts; everything else moves its
 * corner. Returns the patch to apply rather than mutating, so an undo step can
 * hold the before and after of the same act.
 */
export function nudgeShape(shape, dx, dy) {
  if (Array.isArray(shape.points)) {
    return { points: shape.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)) };
  }
  return { x: (shape.x ?? 0) + dx, y: (shape.y ?? 0) + dy };
}

/**
 * A polyline with a 2×3 affine matrix folded into every vertex.
 *
 * `[a, b, c, d, e, f]` is the shape Konva hands back for a node's own
 * transform: x' = ax + cy + e, y' = bx + dy + f. A freehand stroke is only its
 * samples — there is no width, no radius and no origin to write a resize into —
 * so a corner drag has nowhere to live but the points themselves. Folding it in
 * is what lets the next gesture start from what is drawn instead of from a node
 * still carrying the last one.
 */
export function pointsWithTransform(points, [a, b, c, d, e, f]) {
  const out = [];
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    out.push(a * x + c * y + e, b * x + d * y + f);
  }
  return out;
}

/**
 * The legend after an element is deleted.
 *
 * A note is written against a colour, not against the element that first used
 * it, so it survives deleting one of three red arrows and goes with the last one.
 * A legend line naming a colour nothing on the picture carries is a claim about
 * the proof that the proof does not make.
 */
export function notesAfterRemoval(notes, remaining, gone) {
  if (!gone || remaining.some((s) => s.color === gone.color)) return notes;
  const kept = { ...notes };
  delete kept[gone.color];
  return kept;
}

/**
 * The row a panel moves to, or null when the move is refused.
 *
 * One past the last row is allowed and starts a fresh one — that is how a row is
 * created. Two past is not: it would leave an empty row between, and a grid with
 * a hole in it is a layout nobody asked for.
 */
export function nextPanelRow(panels, index, delta) {
  const panel = panels[index];
  if (!panel) return null;
  const maxRow = Math.max(...panels.map((p) => p.row ?? 0));
  const next = (panel.row ?? 0) + delta;
  if (next < 0 || next > maxRow + 1) return null;
  return next;
}

/**
 * An array with one entry moved by `delta`, or null when it would fall off.
 *
 * In free mode the array order *is* the z-order, front to back, so this is what
 * "bring forward" and "send backward" do.
 */
export function movedBy(list, index, delta) {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return null;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

/**
 * The scale a dropped resize handle means, clamped and rounded.
 *
 * The transformer scales the Konva group, and a group's scale is
 * `(PANEL_H · panelScale) / naturalHeight` — so the panel scale is read back out
 * of it. Rounded to a hundredth so a drag lands on a value the step buttons can
 * also reach; without that, a resized panel can never be stepped back to 1.
 */
export function scaleFromNode(nodeScale, naturalHeight, min = PANEL_SCALE_MIN, max = PANEL_SCALE_MAX) {
  const wanted = (nodeScale * naturalHeight) / PANEL_H;
  return Math.round(Math.min(max, Math.max(min, wanted)) * 100) / 100;
}

/**
 * The document point at the centre of what the analyst is looking at.
 *
 * Where a pasted overlay lands: in the middle of the view rather than the middle
 * of the document, which on a zoomed-in proof is off screen entirely.
 */
export function viewCentrePoint(view, stage) {
  return {
    x: (view.width / 2 - stage.x) / stage.scaleX,
    y: (view.height / 2 - stage.y) / stage.scaleY,
  };
}

/**
 * The padding between a boxed label's frame and its glyph, in the label's own
 * pixels.
 *
 * Read twice: once to draw the box, once to place the inline editor over the
 * glyph inside it. A number that lived in only one of those two put the editor
 * a few pixels off whatever it was editing.
 */
export function textBoxPad(fontSize) {
  return Math.round((fontSize ?? 28) * 0.28);
}

/**
 * Kinds a fill applies to: the closed ones, plus symbols.
 *
 * On a symbol the fill is not inside the glyph but behind it — a disc in the
 * same colour, which is what makes a thin stroked mark survive being laid over
 * aerial imagery. It rides on this control rather than a second one because it
 * answers the same question: how much of its own colour does this element put
 * between the reader and the picture.
 */
export function canFill(kind) {
  return kind === 'rect' || kind === 'ellipse' || kind === 'icon';
}

/**
 * The paint a filled shape uses, or null when it has no fill.
 *
 * A fill is the element's own colour at a chosen opacity, never a second colour:
 * the legend is keyed on colour, so a box outlined in one and filled in another
 * would claim two features where the analyst meant one. Konva has no fill
 * opacity of its own — node opacity would fade the stroke with it — so the alpha
 * rides in the colour. Anything that is not a hex colour gets no fill rather
 * than an opaque one, since a fill that was not asked for hides the evidence.
 */
export function fillPaint(color, opacity) {
  const alpha = Number(opacity);
  if (!Number.isFinite(alpha) || alpha <= 0) return null;
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(String(color ?? '').trim().toLowerCase());
  if (!match) return null;
  const digits = match[1].length === 3 ? match[1].replace(/./g, (c) => c + c) : match[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha)})`;
}
