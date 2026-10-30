/**
 * The wheel, read the way the flat map reads it.
 *
 * Over relief the wheel is the tool's own (`gestures.js` createReliefWheel),
 * and it has to go as far for the same hand as the engine's wheel does on the
 * flat map: a mouse notch a level, a trackpad's slivers a little each. So the
 * engine's own reading is kept here (MapLibre's scroll zoom): which device it
 * is, and how far a frame's worth of it zooms.
 */

/** The grid macOS reports a mouse wheel's notches on. */
export const WHEEL_NOTCH = 4.000244140625;

/**
 * The rate a mouse wheel zooms at, which `engine.js` hands the engine: a notch
 * lands within a few thousandths of a level, as one level a notch did on the
 * map this replaced.
 */
export const WHEEL_ZOOM_RATE = 1 / 15;

/** The engine's own rate for a trackpad, and for a notch too small to be a mouse's. */
export const TRACKPAD_ZOOM_RATE = 1 / 100;

/** ms of quiet after which the next event begins a new gesture. */
const NEW_GESTURE_MS = 400;
/** A first event at least this big is a mouse notch, not a trackpad's sliver. */
const NOTCH_AT_LEAST = 40;

/** What a wheel event moves, in the engine's units: a line is 40, and Shift slows it to a quarter. */
export function wheelValue(event) {
  const value = event.deltaMode === 1 ? event.deltaY * 40 : event.deltaY;
  return event.shiftKey ? value / 4 : value;
}

/**
 * Tell a mouse wheel from a trackpad, one gesture at a time: a notch on the
 * macOS grid is a mouse, a sliver under four is a trackpad, and otherwise the
 * size of the gesture's first event decides for the rest of it.
 *
 * @param {() => number} now the clock, in ms
 * @returns {(value: number) => 'wheel' | 'trackpad'}
 */
export function createWheelKind(now) {
  let kind = null;
  let last = -Infinity;
  return (value) => {
    const at = now();
    const fresh = at - last > NEW_GESTURE_MS;
    last = at;
    if (value !== 0 && value % WHEEL_NOTCH === 0) kind = 'wheel';
    else if (value !== 0 && Math.abs(value) < 4) kind = 'trackpad';
    else if (fresh || !kind) kind = Math.abs(value) >= NOTCH_AT_LEAST ? 'wheel' : 'trackpad';
    return kind;
  };
}

/**
 * The levels a frame's worth of the wheel zooms by, as the engine works it
 * out: positive in. `delta` is the frame's events added up with their sign
 * turned (a wheel rolled away from the hand reads negative and zooms in).
 */
export function wheelLevels(delta, kind) {
  if (!delta) return 0;
  const rate = kind === 'wheel' && Math.abs(delta) > WHEEL_NOTCH ? WHEEL_ZOOM_RATE : TRACKPAD_ZOOM_RATE;
  const scale = 2 / (1 + Math.exp(-Math.abs(delta * rate)));
  return Math.sign(delta) * Math.log2(scale);
}
