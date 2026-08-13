/**
 * The camera over the graph canvas: what a screen point means, and what a zoom
 * does to where you were looking.
 *
 * Konva owns the stage; these are the four bits of arithmetic that decide what it
 * is pointed at. They are here rather than in the tool because each of them is a
 * claim that is easy to get subtly wrong and impossible to see: a zoom that does
 * not hold its anchor drifts the case out from under the cursor a few pixels at a
 * time, and a cull margin that is too tight pops cards in at the edge of a pan.
 * Neither shows up in a screenshot; both show up here.
 *
 * Everything is in canvas units unless it says screen.
 */

/** How far in and out the canvas may be taken. */
export const ZOOM_MIN = 0.12;
export const ZOOM_MAX = 3.2;

/** Clamp a wanted scale into the range the canvas allows. */
export function clampZoom(scale) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

/**
 * A screen point in canvas units, given where the group sits and how far it is
 * zoomed. The inverse of what Konva does when it draws.
 */
export function toCanvasPoint(point, { x, y, scale }) {
  const factor = scale || 1;
  return { x: (point.x - x) / factor, y: (point.y - y) / factor };
}

/**
 * Where the group has to move so a zoom leaves one point where it was.
 *
 * The anchor is the whole of it: zoom around the middle of the window and the
 * node under the cursor slides away, which turns "look closer at this" into
 * "look closer, then go find it again". Returns null when the scale is already
 * at the bound, so a caller can skip a redraw that would change nothing.
 */
export function zoomAround(factor, anchor, { x, y, scale }) {
  const next = clampZoom(scale * factor);
  if (next === scale) return null;
  const local = toCanvasPoint(anchor, { x, y, scale });
  return {
    scale: next,
    x: anchor.x - local.x * next,
    y: anchor.y - local.y * next,
  };
}

/**
 * The rectangle on screen, in canvas units, grown by a margin.
 *
 * The margin is slack for panning: cards are only built once they are in view, so
 * without it a drag would reveal the bare dots that sit under cards which do not
 * exist yet — the scene is only redressed when the drag ends.
 */
export function visibleRect({ x, y, scale }, width, height, margin = 0) {
  const left = -x / scale;
  const top = -y / scale;
  return {
    left: left - margin,
    top: top - margin,
    right: left + width / scale + margin,
    bottom: top + height / scale + margin,
  };
}

/** Whether a canvas point falls inside a rect from `visibleRect`. */
export function within(rect, x, y) {
  return x > rect.left && x < rect.right && y > rect.top && y < rect.bottom;
}
