/**
 * Middle-drag map rotation for the Satellite tab — the same Google-Earth
 * "grab & turn" as the Frame viewer, but driving a Leaflet map bearing.
 *
 * Leaflet's `setBearing` always rotates about the map centre, so to turn around
 * an arbitrary grabbed point we set the bearing and then pan the map so the
 * grabbed location slides back under the cursor. These two pure helpers hold the
 * bits that are easy to get subtly wrong (the swept-angle bearing and, above
 * all, the *sign* of the compensating pan); the Leaflet glue lives in the tool.
 */

import { pointerAngleDeg } from './frameRotate.js';

/**
 * New map bearing after sweeping the pointer around a fixed screen `pivot`,
 * from `start` to `cur` (all `{x, y}` in screen px). The turn tracks the angle
 * the cursor sweeps about the pivot — grab, then circle to rotate.
 */
export function dragBearing(startBearing, pivot, start, cur) {
  const delta =
    pointerAngleDeg(pivot.x, pivot.y, cur.x, cur.y) -
    pointerAngleDeg(pivot.x, pivot.y, start.x, start.y);
  return startBearing + delta;
}

/**
 * The `[dx, dy]` to `map.panBy` so a pivot that a bearing change pushed from
 * `grab` to `now` (both container-pixel points) returns exactly under `grab`.
 * Leaflet's `panBy(offset)` shifts every container point by `-offset`, so to
 * move the pivot by `grab - now` we pan by `now - grab`.
 */
export function pivotPanOffset(grab, now) {
  return [now.x - grab.x, now.y - grab.y];
}
