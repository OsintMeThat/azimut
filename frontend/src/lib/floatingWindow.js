/**
 * A window floating over a map: moved by its title bar, resized from its edges
 * and its lower corners, and kept whole inside the map it floats on.
 *
 * Pure geometry, so the rules are read off a test (`FloatingWindow.svelte` is
 * the pointer glue). A rectangle is `{ x, y, w, h }` in px from the top-left of
 * the element the window floats in; bounds are that element's `{ w, h }`.
 *
 * Where a window was left is remembered in the browser, per window, so a chart
 * dragged out of the way stays out of the way the next time it opens. That is
 * a habit of this screen, not case state, which is why it lives there.
 */

/** What every window keeps between itself and the edge of the map. */
export const MARGIN = 8;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** The rectangle shrunk to fit the bounds if it must, then moved inside them. */
export function fitWindow(rect, bounds, min) {
  const room = { w: Math.max(min.w, bounds.w - 2 * MARGIN), h: Math.max(min.h, bounds.h - 2 * MARGIN) };
  const w = clamp(Math.round(rect.w), min.w, room.w);
  const h = clamp(Math.round(rect.h), min.h, room.h);
  return {
    x: clamp(Math.round(rect.x), MARGIN, Math.max(MARGIN, bounds.w - w - MARGIN)),
    y: clamp(Math.round(rect.y), MARGIN, Math.max(MARGIN, bounds.h - h - MARGIN)),
    w,
    h,
  };
}

/** The window carried by a drag of (dx, dy) from where it started. */
export function dragWindow(start, dx, dy, bounds, min) {
  return fitWindow({ ...start, x: start.x + dx, y: start.y + dy }, bounds, min);
}

/**
 * The window resized from one of its handles. `edge` names the sides that
 * move: 'e' and 's' grow it away from its corner, 'w' moves its left side, so
 * its right side stays where it was.
 */
export function resizeWindow(start, edge, dx, dy, bounds, min) {
  let { x, w, h } = start;
  const { y } = start;
  if (edge.includes('e')) w = clamp(start.w + dx, min.w, bounds.w - start.x - MARGIN);
  if (edge.includes('s')) h = clamp(start.h + dy, min.h, bounds.h - start.y - MARGIN);
  if (edge.includes('w')) {
    const right = start.x + start.w;
    x = clamp(start.x + dx, MARGIN, right - min.w);
    w = right - x;
  }
  return fitWindow({ x, y, w, h }, bounds, min);
}

const KEY = (id) => `azimut.window.${id}`;

/** Where this window was last left, or null. Never throws: storage is a nicety. */
export function savedWindow(id) {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(id)) ?? 'null');
    if (raw && ['x', 'y', 'w', 'h'].every((key) => Number.isFinite(raw[key]))) return raw;
  } catch {
    // a private window, cleared storage, a hand-edited value: start fresh
  }
  return null;
}

export function saveWindow(id, rect) {
  try {
    localStorage.setItem(KEY(id), JSON.stringify(rect));
  } catch {
    // remembered for this view only
  }
}
