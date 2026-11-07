/**
 * What a wheel event over a canvas asks for: to zoom, or to pan.
 *
 * A mouse wheel zooms, a notch at a time. On a touchpad two fingers pan and a pinch
 * zooms: browsers send a pinch as a wheel event with Ctrl held, and two fingers as
 * small pixel deltas, often sideways too. A mouse wheel arrives in lines (Firefox,
 * when `deltaMode` is read before the deltas), or in pixels with `wheelDeltaY` a
 * multiple of 120 (Chromium, Edge). A gesture keeps the reading it started with, so
 * a fast swipe that happens to land on 120 does not zoom halfway through a pan.
 *
 * `memory` is the caller's own object, `{ pad: 0 }`, carried from one event to the next.
 */

/** A wheel notch's zoom step. */
export const WHEEL_STEP = 1.1;
/** How long, in ms, a touchpad gesture holds its reading after its last event. */
const GESTURE_MS = 250;
/** A pinch's zoom per pixel of delta, and the most one event counts. */
const PINCH_RATE = 0.01;
const PINCH_MOST = 10;
/** Pixels a line of a horizontal mouse scroll moves the view. */
const LINE_PX = 20;

const notch = (deltaY) => (deltaY > 0 ? 1 / WHEEL_STEP : WHEEL_STEP);

/**
 * `{ kind: 'zoom', factor }` or `{ kind: 'pan', dx, dy }` in screen pixels, or null
 * for an event that moves nothing.
 */
export function readWheel(e, memory = { pad: 0 }, now = Date.now()) {
  // read first: Firefox answers in lines for a mouse wheel only when asked this before the deltas
  const mode = e.deltaMode;
  const dx = e.deltaX || 0;
  const dy = e.deltaY || 0;
  if (!dx && !dy) return null;
  if (e.ctrlKey || e.metaKey) {
    // a pinch, or Ctrl with the wheel: both zoom, a notch at most per event
    const px = mode === 0 ? dy : Math.sign(dy) * PINCH_MOST;
    if (mode === 0 && Math.abs(dy) >= 50) return { kind: 'zoom', factor: notch(dy) };
    return { kind: 'zoom', factor: Math.exp(-Math.max(-PINCH_MOST, Math.min(PINCH_MOST, px)) * PINCH_RATE) };
  }
  if (mode !== 0) {
    if (!dy) return { kind: 'pan', dx: -dx * LINE_PX, dy: 0 };
    return { kind: 'zoom', factor: notch(dy) };
  }
  const recent = now - (memory.pad ?? 0) < GESTURE_MS;
  const wheel = e.wheelDeltaY;
  const mouse = !dx && Number.isFinite(wheel) && wheel !== 0 && wheel % 120 === 0;
  if (mouse && !recent) return { kind: 'zoom', factor: notch(dy) };
  memory.pad = now;
  return { kind: 'pan', dx: -dx, dy: -dy };
}
