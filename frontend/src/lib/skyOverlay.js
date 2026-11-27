/**
 * The geometry behind the sun/moon overlay drawn on the map.
 *
 * The overlay answers one question — *where was the light coming from, and how
 * high was it* — by drawing each body's track as an arc around the anchor point.
 * The map owns the drawing; what is here is everything that decides *what* to
 * draw, kept apart because it is arithmetic over a day's samples and nothing
 * else. That makes it checkable: an arc that closes through the hours a body
 * spends below the horizon, or an hour tick on a sample that is under it, is a
 * picture that lies about the sky, and neither is visible in a screenshot.
 *
 * The radial convention matches the compass rosette in Coords & Sky: the anchor
 * stands for the zenith, the arc for the horizon, so a body high in the sky sits
 * close to the centre.
 */

import { formatBearing, formatHeight } from './measure.js';
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

/** The wall clock of a moment the backend dated, `HH:MM` as the day's samples are. */
export function clockOf(moment) {
  return String(moment?.local ?? '').slice(11, 16);
}

/** A shadow's answer (`/api/geo/shadow`) as one sentence, or why it has none. */
export function shadowSentence(shadow, units) {
  const [first, second] = shadow.moments ?? [];
  if (!first) return `No hour of ${shadow.date} casts this shadow`;
  const height = `About ${formatHeight(first.height_m, units)} tall`;
  const when = `sun at ${formatBearing(first.sun_azimuth)}, ${first.sun_altitude.toFixed(1)}° up at ${clockOf(first)} ${first.abbreviation}`;
  const also = second ? `, or ${formatHeight(second.height_m, units)} at ${clockOf(second)}` : '';
  return `${height} (${when}${also})`;
}

const turn = (degrees) => ((degrees % 360) + 360) % 360;
/** How far `azimuth` lies past `wanted`, in [-180, 180). */
const gapTo = (azimuth, wanted) => turn(azimuth - wanted + 180) - 180;
const wallClock = (minutes) => {
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
};

/**
 * When the day's sun stood opposite a shadow cast along `bearing`, read off the
 * curve the sky already holds: a preview while the hand aims or drags, before
 * the backend places it to the second. Each moment carries its wall clock, the
 * sun's altitude, and the sample nearest it, for the slider.
 *
 * @param {{ minutes: number[], clock: string[], sun_azimuth: number[], sun_altitude: number[] }} curve
 * @param {number} bearing the shadow's, from its foot to its tip
 */
export function shadowOnCurve(curve, bearing) {
  const wanted = turn(bearing + 180);
  const { sun_azimuth: azimuth, sun_altitude: altitude } = curve;
  const found = [];
  for (let i = 0; i + 1 < azimuth.length; i++) {
    if (altitude[i] <= 0 && altitude[i + 1] <= 0) continue;
    const before = gapTo(azimuth[i], wanted);
    const after = gapTo(azimuth[i + 1], wanted);
    // a sample right on it is the start of the next pair, not the end of this one
    if (after === 0 && i + 2 < azimuth.length) continue;
    if (before !== 0 && Math.sign(before) === Math.sign(after)) continue;
    // the gap jumping by a turn is the sun crossing the opposite azimuth
    if (Math.abs(after - before) > 180) continue;
    const t = before === after ? 0 : before / (before - after);
    const up = altitude[i] + (altitude[i + 1] - altitude[i]) * t;
    if (up <= 0) continue;
    const minutes = minutesOf(curve.clock[i]) + t * (curve.minutes[i + 1] - curve.minutes[i]);
    found.push({ clock: wallClock(minutes), altitude: up, index: t < 0.5 ? i : i + 1 });
  }
  return found;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** A bearing as the side of the sky it points to, in words. */
export function compassWord(bearing) {
  return COMPASS[Math.round(turn(bearing) / 45) % 8];
}

/**
 * Which way a day's shadows fall (`/api/geo/shadow`'s `falls`), for a shadow no
 * hour casts: the way out is to see it was drawn the wrong way round.
 */
export function fallsSentence(falls) {
  if (!falls) return 'The sun stays down all that day.';
  if (falls.whole) return '';
  return `That day, shadows fall between ${formatBearing(falls.from)} and ${formatBearing(falls.to)}, through ${compassWord(falls.middle)}.`;
}

/**
 * Whether the shadow drawn the other way round has an hour. Its bearing is the
 * sun's azimuth the answer asked about, so it only has to lie in the day's arc.
 */
export function castsReversed(answer) {
  const falls = answer?.falls;
  if (!falls || !Number.isFinite(answer.sun_azimuth)) return false;
  if (falls.whole) return true;
  return turn(answer.sun_azimuth - falls.from) <= turn(falls.to - falls.from);
}
