/**
 * Every dated picture of one point, in a row.
 *
 * Compare reads two pictures. The strip lists every picture the archive A and
 * B share holds for the point in the middle of the view, oldest to newest, so
 * either side can be set to any of them with one press.
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
 * radar pass off the track the pair is read on: both are shown greyed.
 */
export function stripEntries(archive, answer, { maxcc = 100, track = '' } = {}) {
  if (archive === WAYBACK_ID) {
    return (answer?.changes ?? [])
      .map((entry) => ({
        key: `r${entry.release}`,
        date: entry.acquired || entry.date || '',
        note: entry.acquired ? 'taken' : '',
        release: entry.release,
        // when the release was published, which dates a picture with no acquisition date
        released: entry.date || '',
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
