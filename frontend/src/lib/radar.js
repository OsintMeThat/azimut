/**
 * Sentinel-1 radar as a basemap: which pass a map shows.
 *
 * A pass rides on the provider id as a variant, `sentinel1~2026-05-14~054210`,
 * the way a Sentinel-2 day does (`lib/sentinel.js`); `engine/sentinel.py` reads
 * the same shape. A pass is a day *and* a time: the radar can see a place twice
 * on one day, at dawn flying south and at dusk flying north, and those are two
 * pictures of the ground from opposite sides.
 */

export const RADAR_ID = 'sentinel1';
const SEP = '~';
const TIME = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Two looks at one place are the same track when they pass at the same time of
 * day. A track repeats to the second every twelve days, whichever satellite
 * flies it, and the neighbouring track that also sees the place passes about
 * eight minutes off. Mirrors `same_track` in `engine/sentinel.py`.
 */
export const SAME_TRACK_MINUTES = 4;

/** A pass as `{ date, time }`, or null when it is not one. */
export function validPass(pass) {
  return Boolean(pass && DAY.test(pass.date ?? '') && TIME.test(pass.time ?? ''));
}

/** The provider id for one pass, or the plain id for the most recent. */
export function radarId(baseId, pass) {
  if (baseId !== RADAR_ID || !validPass(pass)) return baseId;
  return [baseId, pass.date, pass.time.replace(/:/g, '')].join(SEP);
}

/** …and back: the pass an id names, or null for the plain basemap. */
export function passOf(providerId) {
  const [base, day, time] = String(providerId ?? '').split(SEP);
  if (base !== RADAR_ID || !DAY.test(day ?? '') || !/^\d{6}$/.test(time ?? '')) return null;
  const pass = { date: day, time: `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}` };
  return validPass(pass) ? pass : null;
}

function minutes(time) {
  const [, hours, mins, secs] = TIME.exec(time);
  return Number(hours) * 60 + Number(mins) + (Number(secs) >= 30 ? 1 : 0);
}

/** Whether two pass times are one track: the same look, so comparable. */
export function sameTrack(one, other) {
  if (!TIME.test(one ?? '') || !TIME.test(other ?? '')) return false;
  const gap = Math.abs(minutes(one) - minutes(other)) % 1440;
  return Math.min(gap, 1440 - gap) <= SAME_TRACK_MINUTES;
}

/** How a pass reads: "2026-05-14 · 05:42 UTC". */
export function passLabel(pass) {
  if (!validPass(pass)) return 'Most recent';
  return `${pass.date} · ${pass.time.slice(0, 5)} UTC`;
}

/** The direction as an arrow a list row can carry. */
export function orbitMark(orbit) {
  return orbit === 'descending' ? '↓' : orbit === 'ascending' ? '↑' : '';
}

/** The passes of a list that share `track`'s time of day, newest first. */
export function onTrack(list, track) {
  if (!TIME.test(track ?? '')) return list ?? [];
  return (list ?? []).filter((entry) => sameTrack(entry.time, track));
}
