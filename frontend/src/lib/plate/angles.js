/**
 * One event filmed from several places, laid on a plate: a view cone at each place the
 * files stand on, each facing the middle of them all, where the event most likely is.
 * That is a guess, and the plate says so: the analyst turns a cone in its inspector.
 * Files standing on one spot leave no direction to face, so their cones face north.
 */
import { haversine } from '../measure.js';

/** Files closer than this to their middle give it no direction. */
const TOGETHER_M = 20;
/** The reach a cone takes when it cannot be measured to the middle, in kilometres. */
const SHORT_KM = 0.2;

const rad = Math.PI / 180;
const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

/** The compass direction from `a` to `b`, `[lon, lat]` each, in degrees from north. */
export function bearingTo([lon1, lat1], [lon2, lat2]) {
  const y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

/**
 * The cones for `places` (`[lon, lat]` each, in the order the angles are numbered):
 * `{ middle, aimed, cones: [{ at, bearing, reach }] }`, `aimed` false when they all
 * stand on one spot and so face north.
 */
export function anglesOf(places) {
  const middle = places.length
    ? [places.reduce((sum, [lon]) => sum + lon, 0) / places.length, places.reduce((sum, [, lat]) => sum + lat, 0) / places.length]
    : [0, 0];
  const apart = (place) => haversine({ lon: place[0], lat: place[1] }, { lon: middle[0], lat: middle[1] });
  const aimed = places.some((place) => apart(place) > TOGETHER_M);
  const cones = places.map((place) => {
    const metres = apart(place);
    const faces = aimed && metres > TOGETHER_M;
    return { at: place.map((value) => round(value, 6)), bearing: faces ? Math.round(bearingTo(place, middle)) : 0,
      reach: faces ? Math.max(0.05, round((metres * 1.4) / 1000, 2)) : SHORT_KM };
  });
  return { middle: middle.map((value) => round(value, 6)), aimed, cones };
}
