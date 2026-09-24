/**
 * Drag gestures on the map surface: pull a rectangle, or grab a point and turn.
 *
 * Three tools use these — the capture marquee, the Grid Search area, and the
 * Google-Earth style rotation — and all three are the same two mechanics under
 * different modes. The modes stay with the tool, which decides *whether* a
 * gesture starts; the pointer bookkeeping and everything that touches the map
 * live here, so a gesture is written once and re-aimed at the next engine once.
 *
 * The keyboard turn lives here too, so every map answers the same keys.
 *
 * Both starters take the `mousedown` that began the gesture, own it (no engine
 * pan, no browser middle-click autoscroll), and track the rest on the window —
 * a drag that leaves the map still finishes, which is what makes a marquee
 * pulled past the edge behave.
 */
import { beyondGuide, keyTurn, pivotPanOffset, sweepDelta, turnBearing } from '../turn.js';

/** px the pointer may wander and a middle press still be a click. */
const CLICK_SLOP = 4;

/** Where in the map container an event landed. */
function containerPoint(engine, event) {
  const rect = engine.container.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/**
 * Pull a rectangle out of a drag.
 *
 * `onChange` is handed the live box every move (`{ x0, y0, x1, y1 }` in
 * container px) and `onDone` the last one, or null if the drag never moved.
 *
 * @param {object} engine the façade from `engine.js`
 * @param {MouseEvent} event the mousedown that starts it
 * @param {object} opts
 * @param {number|null} [opts.ratio] width/height the box locks to; null is free
 * @param {(rect: object) => void} [opts.onChange]
 * @param {(rect: object) => void} [opts.onDone]
 */
export function startRectDrag(engine, event, { ratio = null, onChange, onDone } = {}) {
  event.stopPropagation();
  event.preventDefault();
  const start = containerPoint(engine, event);
  let rect = { x0: start.x, y0: start.y, x1: start.x, y1: start.y };
  onChange?.(rect);

  const move = (moved) => {
    const at = containerPoint(engine, moved);
    let { x, y } = at;
    if (ratio) {
      // lock the box to the chosen aspect ratio, sized from the larger delta
      const dx = x - start.x;
      const dy = y - start.y;
      let w = Math.abs(dx);
      let h = Math.abs(dy);
      if (w / h > ratio) h = w / ratio;
      else w = h * ratio;
      x = start.x + (dx < 0 ? -w : w);
      y = start.y + (dy < 0 ? -h : h);
    }
    rect = { x0: start.x, y0: start.y, x1: x, y1: y };
    onChange?.(rect);
  };

  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    onDone?.(rect);
  };

  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

/**
 * Grab a point and turn the map around it, like a wheel.
 *
 * The map turns by the angle the pointer sweeps about the grabbed point, read
 * outside the guide circle only (`lib/turn.js`), with Ctrl laying it on whole
 * steps. A map rotates about its centre, so after each bearing change the
 * grabbed geographic point is panned back under where it was grabbed.
 * `onPivot` is handed that point in container px, for the circle the tool
 * draws there.
 *
 * A middle click that never moved puts north back up.
 *
 * @param {object} engine the façade from `engine.js`
 * @param {MouseEvent} event the mousedown that starts it
 * @param {object} opts
 * @param {(pivot: object) => void} [opts.onPivot]
 * @param {() => void} [opts.onEnd]
 */
export function startRotateDrag(engine, event, { onPivot, onEnd } = {}) {
  event.stopPropagation();
  event.preventDefault();
  const grab = containerPoint(engine, event);
  const pinned = engine.containerPointToLatLng(grab); // the location held still
  const startBearing = engine.camera().bearing;
  const pivot = { x: event.clientX, y: event.clientY };
  const clicked = event.button === 1;
  onPivot?.(grab);
  let moved = false;
  let last = null; // the last point outside the circle, null while inside
  let swept = 0;

  const move = (event) => {
    const at = { x: event.clientX, y: event.clientY };
    if (!moved && Math.hypot(at.x - pivot.x, at.y - pivot.y) >= CLICK_SLOP) moved = true;
    const out = beyondGuide(pivot, at);
    const delta = out && last ? sweepDelta(pivot, last, at) : 0;
    last = out ? at : null;
    if (!delta) return;
    swept += delta;
    engine.setBearing(turnBearing(startBearing, swept, { stepped: event.ctrlKey || event.metaKey }));
    const now = engine.latLngToContainerPoint(pinned);
    const [dx, dy] = pivotPanOffset(grab, now);
    if (dx || dy) engine.panBy(dx, dy);
  };

  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    if (!moved && clicked) engine.setBearing(0);
    onEnd?.();
  };

  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

/**
 * Start a turn if this press is one: the middle button, or Shift and the left
 * one where the tool lets Shift turn. True when it started.
 *
 * @param {object} engine the façade from `engine.js`
 * @param {MouseEvent} event
 * @param {object} [opts]
 * @param {boolean} [opts.shift] whether Shift-drag turns here
 * @param {(pivot: object) => void} [opts.onPivot]
 * @param {() => void} [opts.onEnd]
 */
export function turnFromPress(engine, event, { shift = true, onPivot, onEnd } = {}) {
  const shiftDrag = shift && event.button === 0 && event.shiftKey;
  if (event.button !== 1 && !shiftDrag) return false;
  startRotateDrag(engine, event, { onPivot, onEnd });
  return true;
}

/**
 * Turn the map from the keyboard: Shift and an arrow (`keyTurn`). True when the
 * key was a turn and has been spent. A key a focused control already took, or
 * one typed into a field, is left alone.
 *
 * @param {object} engine the façade from `engine.js`
 * @param {KeyboardEvent} event
 */
export function turnFromKey(engine, event) {
  if (!engine || event.defaultPrevented) return false;
  if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return false;
  const turn = keyTurn(event, engine.camera().bearing);
  if (!turn) return false;
  event.preventDefault();
  engine.setBearing(turn.to);
  return true;
}
