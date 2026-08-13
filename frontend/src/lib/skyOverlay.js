/**
 * The geometry behind the sun/moon overlay drawn on the map.
 *
 * The overlay answers one question — *where was the light coming from, and how
 * high was it* — by drawing each body's track as an arc around the anchor point.
 * Leaflet owns the drawing; what is here is everything that decides *what* to
 * draw, kept apart because it is arithmetic over a day's samples and nothing
 * else. That makes it checkable: an arc that closes through the hours a body
 * spends below the horizon, or an hour tick on a sample that is under it, is a
 * picture that lies about the sky, and neither is visible in a screenshot.
 *
 * The radial convention matches the compass rosette in Coords & Sky: the anchor
 * stands for the zenith, the arc for the horizon, so a body high in the sky sits
 * close to the centre.
 */

import { glyphRotation, litPath } from './moonphase.js';

/**
 * Runs of consecutive samples with the body above the horizon.
 *
 * The arc the body actually sweeps, not the whole 24 hours: drawn end to end,
 * the line would close the circle through the bearings the body holds while it
 * is down, which says nothing about where the light came from. A run of one
 * sample is dropped because a polyline needs two points to exist.
 */
export function upRuns(altitudes) {
  const runs = [];
  let run = null;
  altitudes.forEach((altitude, i) => {
    if (altitude >= 0) {
      run = run ?? [];
      run.push(i);
    } else if (run) {
      runs.push(run);
      run = null;
    }
  });
  if (run) runs.push(run);
  return runs.filter((r) => r.length > 1);
}

/**
 * The sample closest to a wall clock, matched against the day's own labels.
 *
 * Not minutes divided by 60: on the two days a year daylight saving moves, the
 * clock skips or repeats an hour, and arithmetic over the sample index lands an
 * hour off the time the analyst typed.
 */
export function nearestSample(clock, wanted) {
  const target = minutesOf(wanted);
  let best = 0;
  let closest = Infinity;
  clock.forEach((stamp, i) => {
    const gap = Math.abs(minutesOf(stamp) - target);
    if (gap < closest) {
      closest = gap;
      best = i;
    }
  });
  return best;
}

function minutesOf(stamp) {
  return Number(stamp.slice(0, 2)) * 60 + Number(stamp.slice(3, 5));
}

/**
 * Which samples carry an hour tick, and which of those are the long ones.
 *
 * On the hour, and only while the body is up — a tick under the horizon would
 * mark a bearing nothing was shining from. Every third hour is drawn longer, so
 * the arc can be read at a glance without labelling all of them.
 */
export function hourTicks(minutes, altitudes) {
  const ticks = [];
  minutes.forEach((minute, i) => {
    if (minute % 60 || altitudes[i] < 0) return;
    ticks.push({ index: i, long: minute % 180 === 0 });
  });
  return ticks;
}

/**
 * Where the body's mark rides on its ray, as a fraction of the arc's radius.
 *
 * At the horizon it sits on the arc, at the zenith on the anchor, so how far up
 * the body is reads as how close to you it is.
 */
export function markScale(altitude) {
  return (90 - altitude) / 90;
}

/** Whether the body is below the horizon, i.e. drawn as a dashed ray and no mark. */
export function isBelow(altitude) {
  return altitude < 0;
}

/**
 * The phase angle a lit fraction implies.
 *
 * `k = (1 + cos i) / 2` by definition, so the illuminated fraction the server
 * already sends is enough to draw the moon — nothing extra is fetched.
 */
export function phaseAngleOf(illuminated) {
  const clamped = Math.min(1, Math.max(-1, 2 * illuminated - 1));
  return (Math.acos(clamped) * 180) / Math.PI;
}

/**
 * The body as an SVG string: a disc for the sun, a phase for the moon.
 *
 * The bright-limb angle belongs to a view of the sky and says nothing in a plan
 * view, so this uses the table convention instead: lit side right when waxing.
 */
export function bodySvg(kind, colour, illuminated, waxing, size = 20) {
  const r = size / 2 - 2;
  let inner = `<circle r="${r}" fill="${colour}" />`;
  if (kind === 'moon') {
    inner =
      `<circle r="${r}" fill="${colour}" opacity="0.25" />` +
      `<g transform="rotate(${glyphRotation(waxing)})">` +
      `<path d="${litPath(r, illuminated, phaseAngleOf(illuminated))}" fill="${colour}" /></g>`;
  }
  return (
    `<svg width="${size}" height="${size}" viewBox="${-size / 2} ${-size / 2} ${size} ${size}">` +
    `<circle r="${r + 1.5}" fill="rgba(0,0,0,0.45)" />${inner}` +
    `<circle r="${r}" fill="none" stroke="#fff" stroke-opacity="0.85" stroke-width="1.5" />` +
    `</svg>`
  );
}

/** One body's reading, as the tooltip states it. */
export function bodyReading(label, clock, azimuth, altitude) {
  return `${label} ${clock} · az ${Math.round(azimuth)}° · alt ${Math.round(altitude)}°`;
}
