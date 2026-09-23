/**
 * Every dated picture of one point, in a row, and the bracket that dates a change.
 *
 * Compare reads two pictures. Dating an event asks a different question: not
 * "what changed between A and B" but "between which two pictures did it
 * appear". The strip lists every picture the archive A and B share holds for
 * the point in the middle of the view, oldest to newest, and the bracket halves
 * the gap between a picture where the thing is absent and one where it is
 * present until they are neighbours, a question at a time: log2 of the gap
 * rather than the whole of it.
 *
 * Three archives answer it: Sentinel-2 days, Sentinel-1 passes of one track,
 * and the Esri Wayback releases that changed the point. The lookups are the
 * routes the pickers already use; everything here is pure.
 */

import { RADAR_ID, sameTrack, validPass } from '../radar.js';
import { WAYBACK_ID } from '../wayback.js';
import { daysBefore, isoDay, overCloudCeiling } from '../sentinel.js';

export const SENTINEL_ID = 'sentinel2';
export const STRIP_ARCHIVES = Object.freeze([SENTINEL_ID, RADAR_ID, WAYBACK_ID]);

/** How much of the calendar a lookup covers around the pair, in days. */
export const LEAD_DAYS = 90;
export const TRAIL_DAYS = 30;
export const EMPTY_WINDOW_DAYS = 180;
export const MAX_WINDOW_DAYS = 400;

/** The archive both sides show, when they show the same one. */
export function stripArchive(a, b) {
  if (!a?.present || !b?.present || a.provider !== b.provider) return null;
  return STRIP_ARCHIVES.includes(a.provider) ? a.provider : null;
}

/** The day a side names, '' when it shows the most recent. */
export function sideDay(side) {
  if (side?.provider === RADAR_ID) return side.radar?.date ?? '';
  if (side?.provider === SENTINEL_ID) return side.sentinel?.date ?? '';
  return '';
}

/**
 * The window to look in: some months before the older side and a month after
 * the newer, capped at a year and a bit so one lookup keeps it whole (the
 * catalogue answers up to 100 granules).
 */
export function lookupWindow(a, b, today = new Date()) {
  const now = isoDay(today);
  const days = [sideDay(a), sideDay(b)].filter(Boolean).sort();
  if (!days.length) return { start: daysBefore(EMPTY_WINDOW_DAYS, today), end: now };
  const shift = (day, delta) => {
    const moment = new Date(`${day}T00:00:00Z`);
    moment.setUTCDate(moment.getUTCDate() + delta);
    return isoDay(moment);
  };
  let start = shift(days[0], -LEAD_DAYS);
  const end = [shift(days.at(-1), TRAIL_DAYS), now].sort()[0];
  if (shift(start, MAX_WINDOW_DAYS) < end) start = shift(end, -MAX_WINDOW_DAYS);
  return { start, end };
}

/**
 * The lookup route for an archive over a point.
 *
 * A Wayback history is read at the view's zoom: which releases changed is a
 * question about the tile the analyst is looking at.
 */
export function lookupPath(archive, { lat, lon, zoom }, window) {
  if (archive === WAYBACK_ID) {
    return `/api/satellite/wayback/changes?lat=${lat}&lon=${lon}&zoom=${Math.max(1, Math.min(22, Math.round(zoom)))}`;
  }
  const collection = archive === RADAR_ID ? '&collection=sentinel1' : '';
  return `/api/satellite/sentinel/dates?lat=${lat}&lon=${lon}&start=${window.start}&end=${window.end}${collection}`;
}

/**
 * The strip's rows, oldest first, whatever archive answered.
 *
 * `usable` is false for a Sentinel-2 day over the cloud ceiling, and for a
 * radar pass off the track the pair is read on: both are shown, neither is
 * offered to the bracket.
 */
export function stripEntries(archive, answer, { maxcc = 100, track = '' } = {}) {
  if (archive === WAYBACK_ID) {
    return (answer?.changes ?? [])
      .map((entry) => ({
        key: `r${entry.release}`,
        date: entry.acquired || entry.date || '',
        note: entry.acquired ? 'taken' : '',
        release: entry.release,
        usable: true,
      }))
      .reverse();
  }
  const rows = (answer?.dates ?? []).map((entry) => {
    if (archive === RADAR_ID) {
      return {
        key: `${entry.date}T${entry.time}`,
        date: entry.date,
        time: entry.time,
        orbit: entry.orbit ?? '',
        note: `${String(entry.time ?? '').slice(0, 5)} UTC`,
        usable: !track || sameTrack(entry.time, track),
      };
    }
    return {
      key: entry.date,
      date: entry.date,
      cloud: entry.cloud,
      note: entry.cloud == null ? '' : `${Math.round(entry.cloud)}% cloud`,
      usable: !overCloudCeiling(entry.cloud, maxcc),
    };
  });
  return rows.filter((row) => row.date).sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}

/** The row a side shows, if the strip holds it. */
export function entryOf(entries, archive, side) {
  if (!side) return null;
  if (archive === WAYBACK_ID) {
    if (side.wayback_release == null) return entries.at(-1) ?? null;
    return entries.find((entry) => entry.release === side.wayback_release) ?? null;
  }
  if (archive === RADAR_ID) {
    const pass = side.radar;
    return validPass(pass) ? entries.find((entry) => entry.key === `${pass.date}T${pass.time}`) ?? null : null;
  }
  const day = side.sentinel?.date;
  return day ? entries.find((entry) => entry.key === day) ?? null : null;
}

/** What a side becomes when the strip shows a row on it. */
export function sidePatch(archive, entry) {
  if (archive === WAYBACK_ID) return { wayback_release: entry.release };
  if (archive === RADAR_ID) return { radar: { date: entry.date, time: entry.time } };
  return { sentinel: { date: entry.date } };
}

// -- the bracket ------------------------------------------------------------------

/**
 * A bracket from what A and B show: A before the thing, B after it.
 * Null when they do not make one — a side the strip does not hold, or A not
 * older than B.
 */
export function startBracket(entries, before, after) {
  if (!before || !after) return null;
  const from = entries.indexOf(before);
  const to = entries.indexOf(after);
  if (from < 0 || to < 0 || from >= to) return null;
  return { before: before.key, after: after.key, probe: null, skipped: [], history: [] };
}

/** The usable rows strictly between the bracket's ends. */
export function between(entries, bracket) {
  const from = entries.findIndex((entry) => entry.key === bracket.before);
  const to = entries.findIndex((entry) => entry.key === bracket.after);
  if (from < 0 || to < 0) return [];
  return entries.slice(from + 1, to)
    .filter((entry) => entry.usable && !bracket.skipped.includes(entry.key));
}

/** The next row to look at: the middle of what is left, or null when done. */
export function nextProbe(entries, bracket) {
  const left = between(entries, bracket);
  return left.length ? left[Math.floor((left.length - 1) / 2)] : null;
}

/**
 * The bracket after one answer about the probe.
 *
 * `there` moves the "after" end to the probe, `absent` the "before" end, and
 * `unclear` (cloud, a smear, a look that settles nothing) drops the probe
 * without moving either. Every answer can be taken back.
 */
export function answerProbe(bracket, verdict) {
  const probe = bracket.probe;
  if (!probe) return bracket;
  const history = [...bracket.history, { before: bracket.before, after: bracket.after, skipped: bracket.skipped }];
  if (verdict === 'there') return { ...bracket, after: probe, probe: null, history };
  if (verdict === 'absent') return { ...bracket, before: probe, probe: null, history };
  return { ...bracket, skipped: [...bracket.skipped, probe], probe: null, history };
}

/** Take the last answer back. */
export function undoAnswer(bracket) {
  const last = bracket.history.at(-1);
  if (!last) return bracket;
  return { ...bracket, ...last, probe: null, history: bracket.history.slice(0, -1) };
}

/** Whether nothing usable is left between the ends. */
export function settled(entries, bracket) {
  return !nextProbe(entries, bracket);
}

/**
 * The finding, in a sentence the analyst can paste into a note. It says how
 * many pictures between the ends could not settle it, because "between the
 * 3rd and the 18th" hides a cloudy week that "no clear pass between" does not.
 */
export function bracketSentence(entries, bracket, label) {
  const before = entries.find((entry) => entry.key === bracket.before);
  const after = entries.find((entry) => entry.key === bracket.after);
  if (!before || !after) return '';
  const name = (entry) => (entry.time ? `${entry.date} ${entry.time.slice(0, 5)} UTC` : entry.date);
  const from = entries.indexOf(before);
  const to = entries.indexOf(after);
  const unread = entries.slice(from + 1, to).length;
  const tail = unread
    ? `; ${unread === 1 ? 'one picture' : `${unread} pictures`} between them could not tell`
    : '';
  return `Absent on ${name(before)}, present on ${name(after)} (${label})${tail}.`;
}

// -- pictures ------------------------------------------------------------------------

/** How big a picture of the view is drawn in the strip, in CSS px. */
export const THUMB = Object.freeze({ width: 132, height: 84 });

/**
 * The tiles that draw the view, shrunk into one picture of the strip.
 *
 * The level is the deepest at which the whole view still fits a thumbnail at
 * one tile pixel per screen pixel or more, capped at the provider's native
 * level so nothing is bought that is only upsampled. That keeps a picture to
 * one tile, two or four where the view straddles a tile edge: each is one
 * request through the tile proxy, which caches it on disk.
 */
export function thumbTiles({ lat, lon, zoom, viewWidth }, provider, box = THUMB) {
  const size = provider?.tile_size ?? 256;
  const shift = Math.log2(size / 256);
  const native = (provider?.max_native_zoom ?? provider?.max_zoom ?? 18) - shift;
  const viewGrid = zoom - shift;
  const wanted = Math.floor(viewGrid - Math.log2(Math.max(1, viewWidth) / box.width));
  const grid = Math.max(0, Math.min(Math.floor(native), wanted));
  const scale = box.width / (Math.max(1, viewWidth) * 2 ** (grid - viewGrid));
  const count = 2 ** grid;
  const world = count * size;
  const x = ((lon + 180) / 360) * world;
  const sin = Math.min(0.9999, Math.max(-0.9999, Math.sin((lat * Math.PI) / 180)));
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world;
  const left = x - box.width / 2 / scale;
  const top = y - box.height / 2 / scale;
  const tiles = [];
  for (let ty = Math.floor(top / size); ty <= Math.floor((top + box.height / scale) / size); ty++) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = Math.floor(left / size); tx <= Math.floor((left + box.width / scale) / size); tx++) {
      tiles.push({
        z: grid,
        x: ((tx % count) + count) % count,
        y: ty,
        left: (tx * size - left) * scale,
        top: (ty * size - top) * scale,
        size: size * scale,
      });
    }
  }
  return tiles;
}
