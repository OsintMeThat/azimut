/**
 * How a drag or a key turns a view: the maps' bearing and the Inspect frame.
 *
 * A drag is a wheel about the grabbed point: the view turns by the angle the
 * pointer sweeps around it. That angle is only read outside a guide circle,
 * because right next to the pivot a pixel is a huge angle and crossing it
 * flips half a turn. Inside the circle the view holds, and leaving it again
 * picks the turn up from there. Near north the view settles on north, and Ctrl
 * lays the turn on whole steps.
 *
 * Angles are clockwise degrees, 0–360, which is the app's bearing.
 */

/** px from the pivot before the sweep is read: the guide circle's radius. */
export const TURN_RADIUS = 30;

/** A turn this close to north settles on north. */
export const NORTH_SNAP = 3;

/** One key press, and the grid Ctrl lays a drag on. */
export const TURN_STEP = 15;

/** 0–360, whatever the caller added up. */
function wrap(deg) {
  return ((deg % 360) + 360) % 360;
}

/** Whether `point` is out of the guide circle about `pivot`, where a sweep is read. */
export function beyondGuide(pivot, point, radius = TURN_RADIUS) {
  return Math.hypot(point.x - pivot.x, point.y - pivot.y) >= radius;
}

/**
 * The signed angle swept about `pivot` from `from` to `to`, clockwise on
 * screen (Y down) positive, and never more than half a turn: moves come a few
 * pixels at a time, so the short way round is the way the hand went.
 * Null when either point is inside the guide circle.
 */
export function sweepDelta(pivot, from, to, radius = TURN_RADIUS) {
  if (!beyondGuide(pivot, from, radius) || !beyondGuide(pivot, to, radius)) return null;
  const angle = (point) => (Math.atan2(point.y - pivot.y, point.x - pivot.x) * 180) / Math.PI;
  const delta = angle(to) - angle(from);
  return delta > 180 ? delta - 360 : delta <= -180 ? delta + 360 : delta;
}

/**
 * Where a turn of `swept` degrees from `start` comes to rest.
 *
 * @param {number} start the angle when the pointer was grabbed
 * @param {number} swept the angle turned since, unwrapped
 * @param {object} [opts]
 * @param {boolean} [opts.stepped] lay the result on whole `TURN_STEP`s
 */
export function turnBearing(start, swept, { stepped = false } = {}) {
  const raw = wrap(start + swept);
  if (stepped) return wrap(Math.round(raw / TURN_STEP) * TURN_STEP);
  return Math.min(raw, 360 - raw) <= NORTH_SNAP ? 0 : raw;
}

/**
 * The next whole step from `bearing` in direction `dir` (1 clockwise, -1 back).
 * An angle between steps goes to the nearer one that way, so a few presses
 * always land on a clean reading.
 */
export function stepBearing(bearing, dir) {
  const at = wrap(bearing) / TURN_STEP;
  const eps = 1e-9;
  const next = dir > 0 ? Math.floor(at + eps) + 1 : Math.ceil(at - eps) - 1;
  return wrap(next * TURN_STEP);
}

/**
 * What a key asks of the turn: `{ to }` an angle, or null for a key it ignores.
 * Shift and an arrow, with no other modifier: left and right step, up is north.
 */
export function keyTurn(event, bearing) {
  if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === 'ArrowLeft') return { to: stepBearing(bearing, -1) };
  if (event.key === 'ArrowRight') return { to: stepBearing(bearing, 1) };
  if (event.key === 'ArrowUp') return { to: 0 };
  return null;
}

/**
 * The `[dx, dy]` to hand `panBy` so a pivot that a bearing change pushed from
 * `grab` to `now` (both container-pixel points) returns exactly under `grab`.
 * A `panBy(offset)` shifts every container point by `-offset`, so to move the
 * pivot by `grab - now` we pan by `now - grab`.
 */
export function pivotPanOffset(grab, now) {
  return [now.x - grab.x, now.y - grab.y];
}
