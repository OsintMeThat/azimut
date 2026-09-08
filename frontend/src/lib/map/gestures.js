/**
 * Drag gestures on the map surface: pull a rectangle, or grab a point and turn.
 *
 * Three tools use these — the capture marquee, the Grid Search area, and the
 * Google-Earth style rotation — and all three are the same two mechanics under
 * different modes. The modes stay with the tool, which decides *whether* a
 * gesture starts; the pointer bookkeeping and everything that touches the map
 * live here, so a gesture is written once and re-aimed at the next engine once.
 *
 * Both starters take the `mousedown` that began the gesture, own it (no engine
 * pan, no browser middle-click autoscroll), and track the rest on the window —
 * a drag that leaves the map still finishes, which is what makes a marquee
 * pulled past the edge behave.
 */
import { dragBearing, pivotPanOffset } from '../satRotate.js';

/** px to leave the pivot before the reference spoke is fixed. */
const ROTATE_DEADZONE = 8;

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
 * Grab a point and turn the map around it.
 *
 * A map rotates about its centre, so after each bearing change the grabbed
 * geographic point is panned back under the cursor — which is what pins it
 * exactly where it was grabbed. `onPivot` is handed the grabbed point in
 * container px, for the target the tool draws there.
 *
 * @param {object} engine the façade from `engine.js`
 * @param {MouseEvent} event the middle-button mousedown that starts it
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
  const startScreen = { x: event.clientX, y: event.clientY };
  onPivot?.(grab);
  let spoke = null; // reference direction, fixed once out of the deadzone

  const move = (moved) => {
    if (spoke === null) {
      if (Math.hypot(moved.clientX - startScreen.x, moved.clientY - startScreen.y) < ROTATE_DEADZONE) {
        return;
      }
      spoke = { x: moved.clientX, y: moved.clientY };
      return;
    }
    engine.setBearing(
      dragBearing(startBearing, startScreen, spoke, { x: moved.clientX, y: moved.clientY })
    );
    const now = engine.latLngToContainerPoint(pinned);
    const [dx, dy] = pivotPanOffset(grab, now);
    if (dx || dy) engine.panBy(dx, dy);
  };

  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    onEnd?.();
  };

  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}
