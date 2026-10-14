/**
 * The ring round a selected marker that sets which way it faces.
 *
 * A direction is degrees from north on the ground, and the map may be turned,
 * so north on screen is read from the map at the marker each time: the knob
 * sits where the marker's wedge points, and a drag turns the wedge toward the
 * pointer. Pulled out as far as the target, the knob simply aims the marker at
 * it. A drag goes by steps of five degrees, Shift lets it go free.
 */
import { windOf } from '../horizon/geometry.js';

/** The step a drag turns by, unless Shift is held. */
export const STEP = 5;

const wrap = (degrees) => ((degrees % 360) + 360) % 360;

/** Which way north points on screen at `[lon, lat]`, clockwise from up. */
export function screenNorth(project, lon, lat) {
  const here = project(lon, lat);
  const ahead = project(lon, Math.min(89.9, lat + 1e-4));
  return wrap((Math.atan2(ahead.x - here.x, -(ahead.y - here.y)) * 180) / Math.PI);
}

/** Where on a ring of `radius` round `centre` a direction sits, on a map whose north is at `north`. */
export function knobAt(centre, radius, bearing, north) {
  const turn = ((bearing + north) * Math.PI) / 180;
  return { x: centre.x + radius * Math.sin(turn), y: centre.y - radius * Math.cos(turn) };
}

/** The direction from `centre` toward `pointer`, by steps unless `free`. */
export function bearingToward(centre, pointer, north, free = false) {
  const screen = (Math.atan2(pointer.x - centre.x, -(pointer.y - centre.y)) * 180) / Math.PI;
  const bearing = wrap(screen - north);
  return free ? Math.round(bearing * 10) / 10 : wrap(Math.round(bearing / STEP) * STEP);
}

/** "47° NE", how a direction reads beside the knob and in the sheet. */
export function facingLabel(bearing) {
  if (bearing === '' || bearing === null || bearing === undefined || !Number.isFinite(Number(bearing))) return '';
  const degrees = Math.round(wrap(Number(bearing)));
  return `${degrees % 360}° ${windOf(degrees)}`;
}
