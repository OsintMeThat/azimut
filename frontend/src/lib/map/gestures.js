/**
 * Drag gestures on the map surface: pull a rectangle, or grab a point and turn.
 *
 * Three tools use these — the capture marquee, the Grid Search area, and the
 * Google-Earth style rotation, which over relief also tilts — and all three are
 * the same two mechanics under different modes. The modes stay with the tool, which decides *whether* a
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
 * one where the tool lets Shift turn. True when it started. Over relief the
 * same press orbits instead, tilting as well as turning (`startOrbitDrag`).
 *
 * @param {object} engine the façade from `engine.js`
 * @param {MouseEvent} event
 * @param {object} [opts]
 * @param {boolean} [opts.shift] whether Shift-drag turns here
 * @param {boolean} [opts.tilt] whether the map has relief to tilt over
 * @param {(pivot: object) => void} [opts.onPivot]
 * @param {() => void} [opts.onEnd]
 */
export function turnFromPress(engine, event, { shift = true, tilt = false, onPivot, onEnd } = {}) {
  const shiftDrag = shift && event.button === 0 && event.shiftKey;
  if (event.button !== 1 && !shiftDrag) return false;
  (tilt ? startOrbitDrag : startRotateDrag)(engine, event, { onPivot, onEnd });
  return true;
}

/** Degrees of tilt per pixel dragged up or down, and of turn per pixel sideways. */
export const ORBIT_TILT_PER_PX = 0.25;
export const ORBIT_TURN_PER_PX = 0.25;
/** px a grabbed point may land from where it was pressed and still be ground. */
const ON_GROUND_SLOP = 4;
/** How close, in px, the grabbed ground is brought back under the pointer. */
const PIVOT_SETTLE = 0.5;
/** Passes of that correction per move. A tilted map is a perspective over
 *  relief, so one shift lands near rather than on the spot; each pass closes
 *  most of what is left, and a few leave nothing a hand can see. */
const PIVOT_PASSES = 8;

/**
 * Move the camera until `pinned` ground is drawn at `grab` again.
 *
 * Only the ground-to-screen projection is trusted here. Over relief the
 * screen-to-ground one reads the depth of the last frame drawn, which in the
 * middle of a gesture is the frame before the turn: corrections aimed with it
 * miss, and the point walks away from the hand. So the camera is nudged a step
 * north and a step east, how the pinned point moves on screen is measured, and
 * the shift that cancels the error is solved from those two readings
 * (Newton's method). A few passes leave nothing a hand can see.
 */
function holdUnder(engine, pinned, grab) {
  const { zoom = 12 } = engine.camera();
  // about two pixels of ground at this zoom, in degrees
  const nudge = 720 / (256 * 2 ** zoom);
  for (let pass = 0; pass < PIVOT_PASSES; pass += 1) {
    const here = engine.latLngToContainerPoint(pinned);
    const ex = grab.x - here.x;
    const ey = grab.y - here.y;
    if (!Number.isFinite(ex) || !Number.isFinite(ey) || Math.hypot(ex, ey) <= PIVOT_SETTLE) return;
    engine.shiftBy({ lat: nudge, lon: 0 });
    const north = engine.latLngToContainerPoint(pinned);
    engine.shiftBy({ lat: -nudge, lon: nudge });
    const east = engine.latLngToContainerPoint(pinned);
    engine.shiftBy({ lat: 0, lon: -nudge });
    const a = (north.x - here.x) / nudge;
    const b = (east.x - here.x) / nudge;
    const c = (north.y - here.y) / nudge;
    const d = (east.y - here.y) / nudge;
    const det = a * d - b * c;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return;
    const lat = (d * ex - b * ey) / det;
    const lon = (-c * ex + a * ey) / det;
    // half a degree in one move is the pivot running off toward the horizon
    if (Math.hypot(lat, lon) > 0.5) return;
    engine.shiftBy({ lat, lon });
  }
}

/**
 * Orbit the camera over the relief, as Google Earth does with the wheel held.
 *
 * Dragging up leans the view toward the horizon and down back toward the
 * ground; sideways turns it, the ground following the hand. Both turn about
 * the point that was grabbed, which stays under the pointer: after each change
 * the map is panned so that point comes back to where it was pressed. A press
 * on the sky has no ground to hold, so the view then turns about its centre.
 *
 * A middle click that never moved puts north back up, as on the flat map.
 *
 * @param {object} engine the façade from `engine.js`
 * @param {MouseEvent} event the mousedown that starts it
 * @param {object} [opts]
 * @param {(pivot: object) => void} [opts.onPivot]
 * @param {() => void} [opts.onEnd]
 */
export function startOrbitDrag(engine, event, { onPivot, onEnd } = {}) {
  event.stopPropagation();
  event.preventDefault();
  const grab = containerPoint(engine, event);
  const pinned = engine.containerPointToLatLng(grab);
  const back = engine.latLngToContainerPoint(pinned);
  // a press on the sky unprojects to some far point that does not come back
  const onGround = Math.hypot(back.x - grab.x, back.y - grab.y) <= ON_GROUND_SLOP;
  const { pitch = 0, bearing = 0 } = engine.camera();
  const start = { x: event.clientX, y: event.clientY };
  const clicked = event.button === 1;
  onPivot?.(grab);
  let moved = false;
  // every jump of the gesture keeps the centre's height, or the engine re-seats
  // it on the slope under the centre and the camera leaps (`holdElevation`)
  const release = engine.holdElevation?.();

  const move = (moved_) => {
    const dx = moved_.clientX - start.x;
    const dy = moved_.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) >= CLICK_SLOP) moved = true;
    if (!moved) return;
    engine.setPitch(pitch - dy * ORBIT_TILT_PER_PX);
    engine.setBearing(bearing - dx * ORBIT_TURN_PER_PX);
    if (!onGround) return;
    holdUnder(engine, pinned, grab);
  };

  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    if (!moved && clicked) engine.setBearing(0);
    release?.();
    onEnd?.();
  };

  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
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
