/**
 * Drag gestures on the map surface: pull a rectangle, or grab a point and turn.
 *
 * Three tools use these — the capture marquee, the Grid Search area, and the
 * Google-Earth style rotation — and all three are the same two mechanics under
 * different modes. The modes stay with the tool, which decides *whether* a
 * gesture starts; the pointer bookkeeping and everything that touches the map
 * live here, so a gesture is written once and re-aimed at the next engine once.
 * The 3D view's own gestures are the globe's (`lib/globe/globe.js`).
 *
 * The keyboard turn and tilt live here too, so every map answers the same keys.
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
 * Start a turn if this press is one: the middle button, Shift and the left
 * one where the tool lets Shift turn, or the second press of a double click
 * held down where the tool lets it (for a hand with no middle button). True
 * when it started.
 *
 * A double click that never moved is still the engine's zoom; one that turned
 * the map zooms nothing (`swallowDoubleClick`).
 *
 * @param {object} engine the façade from `engine.js`
 * @param {MouseEvent} event
 * @param {object} [opts]
 * @param {boolean} [opts.shift] whether Shift-drag turns here
 * @param {boolean} [opts.double] whether a held double click turns here
 * @param {(pivot: object) => void} [opts.onPivot]
 * @param {() => void} [opts.onEnd]
 */
export function turnFromPress(engine, event, { shift = true, double = false, onPivot, onEnd } = {}) {
  const shiftDrag = shift && event.button === 0 && event.shiftKey;
  const held = double && event.button === 0 && event.detail === 2;
  if (event.button !== 1 && !shiftDrag && !held) return false;
  if (held) swallowDoubleClick(event);
  startRotateDrag(engine, event, { onPivot, onEnd });
  return true;
}

/**
 * The double click that ends a press held and dragged, kept from the engine,
 * which would zoom on it. One that never moved past a click goes through.
 *
 * The watch ends on that double click, or on the next press when none came:
 * never on a timer, which a busy page runs after the input already queued, so
 * a quick double click next would be swallowed too.
 */
export function swallowDoubleClick(event, target = window) {
  const from = { x: event.clientX, y: event.clientY };
  let moved = false;
  let released = false;
  let timer = null;
  const watch = (e) => {
    if (Math.hypot(e.clientX - from.x, e.clientY - from.y) >= CLICK_SLOP) moved = true;
  };
  const stop = () => {
    clearTimeout(timer);
    target.removeEventListener('mousemove', watch, true);
    target.removeEventListener('dblclick', swallow, true);
    target.removeEventListener('mouseup', release, true);
    target.removeEventListener('mousedown', press, true);
  };
  const swallow = (e) => {
    stop();
    if (!moved) return;
    e.stopPropagation();
    e.preventDefault();
  };
  const release = () => {
    released = true;
    // a release far from the press may bring no double click at all
    timer = setTimeout(stop, 1000);
  };
  const press = () => {
    if (released) stop();
  };
  target.addEventListener('mousemove', watch, true);
  target.addEventListener('dblclick', swallow, true);
  target.addEventListener('mouseup', release, true);
  target.addEventListener('mousedown', press, true);
}

/** Degrees a press of Page Up or Page Down tilts the 3D view. */
export const KEY_TILT_STEP = 10;

/**
 * The tilt a key asks of the 3D view, or null when it asks none: Page Up
 * leans toward the horizon and Page Down back toward the ground, a step at a
 * time, as they do in Horizon. The engine holds it under its own ceiling.
 */
export function keyTilt(event, pitch) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (event.key === 'PageUp') return pitch + KEY_TILT_STEP;
  if (event.key === 'PageDown') return Math.max(0, pitch - KEY_TILT_STEP);
  return null;
}

/**
 * Tilt the 3D view from the keyboard (`keyTilt`). True when the key was a tilt
 * and has been spent; a key a focused
 * control already took, or one typed into a field, is left alone.
 *
 * @param {object} engine the façade from `engine.js`
 * @param {KeyboardEvent} event
 */
export function tiltFromKey(engine, event) {
  if (!engine || event.defaultPrevented) return false;
  if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return false;
  const to = keyTilt(event, engine.camera().pitch ?? 0);
  if (to == null) return false;
  event.preventDefault();
  engine.setPitch(to);
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
