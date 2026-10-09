/**
 * Drag gestures on the map surface: pull a rectangle, or grab a point and turn.
 *
 * Three tools use these — the capture marquee, the Grid Search area, and the
 * Google-Earth style rotation, which over relief also tilts — and all three are
 * the same two mechanics under different modes. Over relief a plain drag is
 * ours too (`startGroundPan`): the engine's own pan lets far ground slip. The modes stay with the tool, which decides *whether* a
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
import { haversine } from '../measure.js';
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
/** px down the screen a press on the sky looks for the ground under it, a step at a time. */
const GROUND_SEEK_STEP = 6;
/** …and how far down the orbit looks: further, the press was on the sky, and turns about the centre. */
const ORBIT_SEEK = 48;
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
 * miss, and the point walks away from the hand. So a copy of the camera is
 * nudged a step north and a step east, how the pinned point moves on screen is
 * read off it, and the shift that cancels the error is solved from those two
 * readings (Newton's method). Only that shift moves the real camera: each jump
 * is a frame's worth of work for the engine and everything drawn over it. A few
 * passes leave nothing a hand can see.
 *
 * Near the horizon a pixel is kilometres, and past it no shift at all brings
 * the point back. So a pass that would carry the camera more than half a
 * degree is not taken, or, given a `budget` in degrees, the move goes as far
 * as the budget allows toward the point and stops there.
 */
function holdUnder(engine, pinned, grab, budget = null) {
  const { zoom = 12 } = engine.camera();
  // about two pixels of ground at this zoom, in degrees
  const nudge = 720 / (256 * 2 ** zoom);
  let left = budget;
  for (let pass = 0; pass < PIVOT_PASSES; pass += 1) {
    const here = engine.latLngToContainerPoint(pinned);
    const ex = grab.x - here.x;
    const ey = grab.y - here.y;
    if (!Number.isFinite(ex) || !Number.isFinite(ey) || Math.hypot(ex, ey) <= PIVOT_SETTLE) return;
    // all three off the copy, so whatever the engine adds to a real jump (an
    // eye lifted clear of the ground) cannot leak into the slopes
    const still = engine.pointAfterShift(pinned, { lat: 0, lon: 0 });
    const north = engine.pointAfterShift(pinned, { lat: nudge, lon: 0 });
    const east = engine.pointAfterShift(pinned, { lat: 0, lon: nudge });
    if (!still || !north || !east) return;
    const a = (north.x - still.x) / nudge;
    const b = (east.x - still.x) / nudge;
    const c = (north.y - still.y) / nudge;
    const d = (east.y - still.y) / nudge;
    const det = a * d - b * c;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return;
    let lat = (d * ex - b * ey) / det;
    let lon = (-c * ex + a * ey) / det;
    const step = Math.hypot(lat, lon);
    if (left == null) {
      // half a degree in one move is the pivot running off toward the horizon
      if (step > 0.5) return;
      engine.shiftBy({ lat, lon });
      continue;
    }
    if (step > left) {
      if (left > 0) engine.shiftBy({ lat: (lat * left) / step, lon: (lon * left) / step });
      return;
    }
    engine.shiftBy({ lat, lon });
    left -= step;
  }
}

/** How much more than the orbit's own arc a correction may move the camera. */
const ORBIT_SLACK = 2;

/**
 * Degrees the camera may move to hold the pivot after turning by `angle`
 * radians about it: the arc an orbit of that angle sweeps, with room to spare.
 * A tilted view looks a long way past the pivot, where a small turn swings the
 * ground under the middle of the view by kilometres; held to the arc, the
 * correction can never throw the camera tens of kilometres in one move.
 */
function orbitBudget(engine, pinned, angle) {
  const camera = engine.camera();
  const box = engine.container.getBoundingClientRect();
  const reach = haversine(camera, pinned) + viewReach(camera, box.width, box.height);
  return (reach * angle * ORBIT_SLACK + metresPerPixel(camera) * 2) / METRES_PER_DEGREE;
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
  const press = containerPoint(engine, event);
  // A press on the sky unprojects to some far point that does not come back.
  // Ground so far off that a metre of height is pixels reads back wrong as
  // well, so the first ground a few pixels below it is held instead.
  const box = engine.container.getBoundingClientRect();
  const held = groundBelow(engine, press, Math.min(box.height, press.y + ORBIT_SEEK));
  const pinned = held?.pinned ?? null;
  const grab = held ? { x: press.x + held.offset.x, y: press.y + held.offset.y } : press;
  const { pitch = 0, bearing = 0 } = engine.camera();
  const start = { x: event.clientX, y: event.clientY };
  const clicked = event.button === 1;
  onPivot?.(grab);
  let moved = false;
  let turned = { pitch, bearing };
  // every jump of the gesture keeps the centre's height, or the engine re-seats
  // it on the slope under the centre and the camera leaps (`holdElevation`)
  const release = engine.holdElevation?.();

  const move = (moved_) => {
    const dx = moved_.clientX - start.x;
    const dy = moved_.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) >= CLICK_SLOP) moved = true;
    if (!moved) return;
    const asked = { pitch: pitch - dy * ORBIT_TILT_PER_PX, bearing: bearing - dx * ORBIT_TURN_PER_PX };
    engine.setPitch(asked.pitch);
    engine.setBearing(asked.bearing);
    const angle = (Math.abs(asked.pitch - turned.pitch) + Math.abs(asked.bearing - turned.bearing)) * (Math.PI / 180);
    turned = asked;
    if (!pinned) return;
    holdUnder(engine, pinned, grab, orbitBudget(engine, pinned, angle));
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

/** ms a hand may rest before letting go and still fling the ground. */
export const GLIDE_GRACE = 60;
/** How long a fling glides on. */
export const GLIDE_MS = 450;
/** How far a fling carries: the speed of the last moves for this many ms… */
export const GLIDE_CARRY = 280;
/** …and never further than this share of what a flat view of this zoom spans from its centre. */
export const GLIDE_REACH = 0.25;
/** How much of the hand's last moves the fling's speed is read from, in ms. */
const GLIDE_TRAIL = 100;
const EARTH_CIRCUMFERENCE = 40075016.686;
const METRES_PER_DEGREE = 111320;

/** Metres of ground a pixel covers on a flat view at this app zoom (256 px tiles). */
export function metresPerPixel({ lat = 0, zoom = 12 }) {
  return (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** zoom);
}

/** How far a flat view at this app zoom reaches from its centre, in metres: half its diagonal. */
export function viewReach(camera, width, height) {
  return (metresPerPixel(camera) * Math.hypot(width, height)) / 2;
}

/**
 * How much faster than the ground of a flat view a dragged point may travel:
 * this many times, or twice what a pixel covers at the middle of the tilted
 * view when that is more. So the ground up to a little past the middle keeps
 * under the hand at any tilt; further toward the horizon a pixel is ever more
 * ground, and the far ground slips rather than throw the view kilometres a
 * pixel.
 */
export const FAR_PAN = 6;
const FAR_PAN_MIDDLE = 2;

/** Degrees of ground one pixel of the hand may move at most (`FAR_PAN`). */
export function panSpeedCap(camera) {
  const tilt = Math.cos((Math.min(89, camera.pitch ?? 0) * Math.PI) / 180);
  return (metresPerPixel(camera) * Math.max(FAR_PAN, FAR_PAN_MIDDLE / tilt)) / METRES_PER_DEGREE;
}

/**
 * The fling a drag ends in, as the shift in degrees it glides over in all, or
 * null when the hand had stopped before letting go.
 *
 * Read off the camera's last moves, so it is the ground's own speed: a drag near
 * the horizon moves kilometres a second. Capped to a share of the view's reach,
 * so letting go of far ground never throws the view out of the valley.
 *
 * @param {{ t: number, lat: number, lon: number }[]} trail where the camera was, oldest first
 * @param {number} now ms, on the trail's clock
 * @param {number} reach metres, `viewReach` of the view
 */
export function flingOf(trail, now, reach) {
  if (trail.length < 2) return null;
  const last = trail.at(-1);
  if (now - last.t > GLIDE_GRACE) return null;
  const first = trail.find((point) => point.t >= last.t - GLIDE_TRAIL) ?? trail[0];
  const dt = last.t - first.t;
  if (!(dt > 0)) return null;
  let lat = ((last.lat - first.lat) / dt) * GLIDE_CARRY;
  let lon = ((last.lon - first.lon) / dt) * GLIDE_CARRY;
  const metres = Math.hypot(lat, lon * Math.cos((last.lat * Math.PI) / 180)) * METRES_PER_DEGREE;
  if (!(metres > 0)) return null;
  const cap = reach * GLIDE_REACH;
  if (metres > cap) {
    lat *= cap / metres;
    lon *= cap / metres;
  }
  return { lat, lon };
}

/**
 * The ground a press holds: the point under it when that reads back true, else
 * the first one below it that does, and how far from the press it is drawn.
 *
 * Relief that has not arrived yet reads back wrong all the way down: the
 * screen-to-ground reading falls back on a flat plane while the ground-to-screen
 * one does not. The press's own reading is then held where it is drawn, as long
 * as that is on the map; each gesture bounds how far a correction aimed at it
 * may move the camera. Null on the sky.
 */
function groundBelow(engine, press, bottom) {
  let loose = null;
  for (let y = press.y; y < bottom; y += GROUND_SEEK_STEP) {
    const pinned = engine.containerPointToLatLng({ x: press.x, y });
    if (!Number.isFinite(pinned?.lat) || !Number.isFinite(pinned?.lon)) continue;
    const back = engine.latLngToContainerPoint(pinned);
    const offset = { x: back.x - press.x, y: back.y - press.y };
    if (Math.hypot(back.x - press.x, back.y - y) <= ON_GROUND_SLOP) return { pinned, offset };
    if (y === press.y && Number.isFinite(back.x) && Number.isFinite(back.y)) loose = { pinned, offset, back };
  }
  if (!loose) return null;
  const box = engine.container.getBoundingClientRect();
  const { back } = loose;
  const onMap = back.x >= 0 && back.x <= box.width && back.y >= 0 && back.y <= box.height;
  return onMap ? { pinned: loose.pinned, offset: loose.offset } : null;
}

/**
 * Drag the ground over relief: the point grabbed stays under the hand.
 *
 * The engine's own pan solves each move on a flat plane through the grabbed
 * point, and gives up on that plane for ground well above the centre or far
 * toward the horizon: the ground then slides away from the hand, by tens of
 * pixels near the horizon. This holds the grabbed point the way the orbit does
 * (`holdUnder`), from the ground-to-screen projection only, with the centre's
 * height held so tiles landing meanwhile move nothing. Letting go while the
 * hand still moves glides on (`flingOf`).
 *
 * A press that moves less than a click's slop is left to the map's own click.
 * A press with no ground under it that reads back true (the sky, or ground so
 * far off that a metre of height is pixels) holds the first ground below it,
 * which then keeps its distance from the hand: no jump when the drag starts.
 * With no ground anywhere down the screen it is not started: false. The press
 * is not stopped, so the engine still tells a click from a drag; the tool turns
 * the engine's own mouse pan off while this one is in use (`relief.js`).
 *
 * @param {object} engine the façade from `engine.js`
 * @param {MouseEvent} event the mousedown that starts it
 * @param {object} [opts]
 * @param {() => void} [opts.onEnd]
 * @param {() => number} [opts.now] the clock, in ms
 * @param {(run: () => void) => unknown} [opts.nextFrame] how a glide waits for the next frame
 */
export function startGroundPan(engine, event, { onEnd, now, nextFrame } = {}) {
  const clock = now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const later =
    nextFrame ??
    ((run) => (globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(run) : setTimeout(run, 16)));
  const grab = containerPoint(engine, event);
  const box = engine.container.getBoundingClientRect();
  const held = groundBelow(engine, grab, box.height);
  if (!held) return false;
  const { pinned, offset } = held;
  // no text selection or native drag under the hand; the map keeps the keyboard
  event.preventDefault();
  engine.focus?.();
  let release = null;
  // degrees of ground a pixel of the hand may move at most
  let perPixel = 0;
  let last = grab;
  const trail = [];

  const move = (moved) => {
    const at = containerPoint(engine, moved);
    if (!release) {
      if (Math.hypot(at.x - grab.x, at.y - grab.y) < CLICK_SLOP) return;
      release = engine.holdElevation?.() ?? (() => {});
      perPixel = panSpeedCap(engine.camera());
    }
    const hand = Math.hypot(at.x - last.x, at.y - last.y);
    last = at;
    holdUnder(engine, pinned, { x: at.x + offset.x, y: at.y + offset.y }, hand * perPixel);
    const { lat, lon } = engine.camera();
    trail.push({ t: clock(), lat, lon });
    while (trail.length > 2 && trail[0].t < trail.at(-1).t - GLIDE_TRAIL * 2) trail.shift();
  };

  const finish = () => {
    release?.();
    onEnd?.();
  };

  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    if (!release) {
      onEnd?.();
      return;
    }
    const camera = engine.camera();
    const fling = flingOf(trail, clock(), viewReach(camera, box.width, box.height));
    if (!fling) {
      finish();
      return;
    }
    glide(fling);
  };

  /** The fling, eased out over `GLIDE_MS`; any other press, wheel or key stops it. */
  function glide(fling) {
    const start = clock();
    let done = 0;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      for (const name of ['mousedown', 'wheel', 'keydown']) window.removeEventListener(name, stop, true);
      finish();
    };
    for (const name of ['mousedown', 'wheel', 'keydown']) window.addEventListener(name, stop, true);
    const step = () => {
      if (stopped) return;
      const k = Math.min(1, (clock() - start) / GLIDE_MS);
      const eased = 1 - (1 - k) ** 3;
      const part = eased - done;
      done = eased;
      if (part > 0) engine.shiftBy({ lat: fling.lat * part, lon: fling.lon * part });
      if (k < 1) later(step);
      else stop();
    };
    later(step);
  }

  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  return true;
}

/** Wheel delta that makes one level, as a notch does on the flat map (`engine.js`). */
const WHEEL_LEVEL = 100;
/** Lines a level is, for a wheel that counts in lines. */
const WHEEL_LEVEL_LINES = 3;
/** Share of what is left of the wheel's zoom taken at each frame: a notch eases in. */
const WHEEL_EASE = 0.35;
/** Levels left that are not worth another frame. */
const WHEEL_DONE = 0.002;
/** px of ground the zoom may shift the camera by to put right what its own step missed. */
const WHEEL_TRIM = 8;

/**
 * Zoom over relief toward the ground under the pointer, as the flat map zooms
 * about the point under it.
 *
 * The engine's own wheel zooms about a plane through the point under the
 * pointer, and at a steep tilt loses that point by hundreds or thousands of
 * pixels: the ground swings away while the hand stays still. This one moves
 * the eye straight toward the ground under the pointer (or the first below it,
 * `facade.dollyToward`), half the way a level, eased over a few frames, so that
 * ground stays where it is drawn; a small shift puts right what the step
 * missed. Over the sky, with no ground to aim at, it zooms about the middle of
 * the view. The centre's height is held for the burst, as for every gesture of
 * ours over relief, and the tool turns the engine's own wheel off while this
 * one is in use (`relief.js`).
 *
 * @param {object} engine the façade from `engine.js`
 * @param {object} [opts]
 * @param {(run: () => void) => unknown} [opts.nextFrame]
 * @returns {{ wheel: (event: WheelEvent) => void, stop: () => void }}
 */
export function createReliefWheel(engine, { nextFrame } = {}) {
  const later =
    nextFrame ??
    ((run) => (globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(run) : setTimeout(run, 16)));
  let burst = null;

  function stop() {
    if (!burst) return;
    const { release } = burst;
    burst = null;
    window.removeEventListener('mousedown', stop, true);
    release();
  }

  function step() {
    if (!burst) return;
    const levels = Math.abs(burst.left) < WHEEL_DONE ? burst.left : burst.left * WHEEL_EASE;
    burst.left -= levels;
    const before = engine.exactZoom();
    const deeper = levels > 0;
    // at the map's ceiling a step in has nowhere to go
    if (!(deeper && before >= engine.maxZoom() - WHEEL_DONE)) {
      if (burst.pinned && engine.dollyToward?.(burst.pinned, levels)) {
        const trim = (metresPerPixel(engine.camera()) * WHEEL_TRIM) / METRES_PER_DEGREE;
        holdUnder(engine, burst.pinned, { x: burst.at.x + burst.offset.x, y: burst.at.y + burst.offset.y }, trim);
      } else {
        engine.setZoom(Math.min(engine.maxZoom(), before + levels));
      }
    }
    if (Math.abs(burst.left) < WHEEL_DONE / 10) stop();
    else later(step);
  }

  function wheel(event) {
    const levels = -event.deltaY / (event.deltaMode === 1 ? WHEEL_LEVEL_LINES : WHEEL_LEVEL);
    if (!levels) return;
    event.preventDefault();
    event.stopPropagation();
    const at = containerPoint(engine, event);
    const fresh = !burst;
    if (fresh) {
      burst = { release: engine.holdElevation?.() ?? (() => {}), left: 0, at: null };
      window.addEventListener('mousedown', stop, true);
    }
    // the hand moved between notches: zoom toward what is under it now
    if (fresh || Math.hypot(at.x - burst.at.x, at.y - burst.at.y) > ON_GROUND_SLOP) {
      const box = engine.container.getBoundingClientRect();
      const held = groundBelow(engine, at, box.height);
      burst.pinned = held?.pinned ?? null;
      burst.offset = held?.offset ?? { x: 0, y: 0 };
      burst.at = at;
    }
    // notches past the ceiling are not kept for the way back out
    const room = engine.maxZoom() - engine.exactZoom() - burst.left;
    burst.left += Math.min(levels, Math.max(0, room));
    if (fresh) later(step);
  }

  return { wheel, stop };
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
