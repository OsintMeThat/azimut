/**
 * An evolution: the dated pictures of one point, played in order.
 *
 * A comparison reads two pictures. An evolution reads every picture the archive
 * A and B share holds between them, so a building going up or a burn greening
 * again shows as it happened rather than as two ends. The list is the one the
 * pictures strip reads (`passStrip.js`); this module chooses among its rows and
 * lays each picture out on the ground.
 *
 * Each picture is drawn from the tile proxy, not from the maps on screen: A and
 * B keep what they show while the export runs, and every picture of one export
 * covers exactly the same ground at the same scale. The pixels are kept as the
 * archive gives them, tones unmatched, since matching them can erase the change
 * being shown. Only reference layers are left out: the export is the imagery,
 * its date and the marks pinned to the ground.
 *
 * Everything here is pure; `evolutionExport.js` fetches and draws.
 */

import { SENTINEL_ID } from '../sentinel.js';
import { WAYBACK_ID } from '../wayback.js';
import { entryOf } from './passStrip.js';
import {
  apply, compassAngle, compose, fromMercator, invert, mercatorPerPixel, scale,
  screenToMercator, turnedBox,
} from './groundFrame.js';

export const EVOLUTION_ARCHIVES = Object.freeze([SENTINEL_ID, WAYBACK_ID]);
export const WORLD_IMAGERY_ID = 'esri-world-imagery';
/** The first month Sentinel-2 imaged the ground: Sentinel-2A began in June 2015. */
export const SENTINEL2_FIRST_MONTH = '2015-06';

/** A month the Sentinel-2 picker can open, `YYYY-MM`, held between 2015 and `today`; null for no month. */
export function pickerMonth(month, today) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month ?? ''))) return null;
  if (month < SENTINEL2_FIRST_MONTH) return SENTINEL2_FIRST_MONTH;
  return month > today ? today : month;
}

/** The most pictures one export holds; `MAX_SEQUENCE_FRAMES` in `api/compare.py`. */
export const MAX_EVOLUTION_FRAMES = 40;
/** The widest a GIF frame is drawn; `MAX_GIF_EDGE` in `api/compare.py`. */
export const GIF_EDGE = 1280;
/** The width a contact sheet aims at, gaps included. */
export const SHEET_WIDTH = 2400;
/** The most pixels the pictures of a sheet add up to. */
export const SHEET_PIXELS = 8_000_000;
/** A picture needing more tiles than this is refused rather than fetched. */
export const MAX_PICTURE_TILES = 128;
/** How long each picture of a GIF stays up by default, in ms. */
export const DEFAULT_INTERVAL = 800;

const WORLD = mercatorPerPixel(0) * 512;
const HALF = WORLD / 2;

/**
 * The archive an evolution plays, when A and B allow one: Sentinel-2 or Wayback
 * on both sides, or Wayback against World Imagery, whose history Wayback is.
 */
export function evolutionArchive(a, b) {
  if (!a?.present || !b?.present) return null;
  if (a.provider === b.provider) return EVOLUTION_ARCHIVES.includes(a.provider) ? a.provider : null;
  const pair = [a.provider, b.provider];
  return pair.includes(WAYBACK_ID) && pair.includes(WORLD_IMAGERY_ID) ? WAYBACK_ID : null;
}

/**
 * The row a side shows. World Imagery stands for the newest Wayback release.
 *
 * The Wayback list holds only the releases that first published a picture of
 * the point, and a side usually shows a release that republished one: it shows
 * the picture of the last listed release published on or before its own, so
 * the side carries its release's date as `wayback_date`.
 */
export function sideEntry(entries, archive, side) {
  if (!side) return null;
  if (archive !== WAYBACK_ID) return entryOf(entries, archive, side);
  if (side.provider !== WAYBACK_ID || side.wayback_release == null) return entries.at(-1) ?? null;
  const exact = entryOf(entries, archive, side);
  if (exact) return exact;
  const day = side.wayback_date;
  if (!day) return null;
  return entries.filter((entry) => entry.released && entry.released <= day).at(-1) ?? null;
}

/**
 * The rows in the order an evolution plays them: by the day each picture was
 * taken. The Wayback list comes in release order, and a later release can carry
 * an older picture; a row with no acquisition date stands at its release's.
 */
export function playOrder(entries) {
  return entries
    .map((entry, index) => [entry, index])
    .sort(([x, i], [y, j]) => (x.date < y.date ? -1 : x.date > y.date ? 1 : i - j))
    .map(([entry]) => entry);
}

/** Evenly spaced keys, both ends kept, when there are more than `max`. */
export function spreadKeys(keys, max = MAX_EVOLUTION_FRAMES) {
  if (keys.length <= max) return [...keys];
  if (max < 2) return keys.slice(0, Math.max(0, max));
  const picked = [];
  for (let index = 0; index < max; index += 1) {
    picked.push(keys[Math.round((index * (keys.length - 1)) / (max - 1))]);
  }
  return picked;
}

/**
 * The usable rows from A's picture to B's, both included, in the list's order
 * (release order for Wayback). A side the list does not hold (a Sentinel-2 side
 * on its latest pass) stands at that end.
 */
export function rangeKeys(entries, first, last) {
  if (!entries.length) return [];
  let from = first ? entries.indexOf(first) : 0;
  let to = last ? entries.indexOf(last) : entries.length - 1;
  if (from < 0) from = 0;
  if (to < 0) to = entries.length - 1;
  if (from > to) [from, to] = [to, from];
  return entries.slice(from, to + 1).filter((entry) => entry.usable).map((entry) => entry.key);
}

/** Every usable row. */
export const allKeys = (entries) => entries.filter((entry) => entry.usable).map((entry) => entry.key);

/**
 * What an export starts on: A to B, or every usable picture when A and B are one
 * row, spread down to the most one export holds.
 */
export function defaultKeys(entries, first, last) {
  const range = rangeKeys(entries, first, last);
  return spreadKeys(range.length >= 2 ? range : allKeys(entries));
}

const cloudOf = (entry) => (Number.isFinite(entry.cloud) ? entry.cloud : 101);

/**
 * One picture per calendar month or year among `keys`: the clearest, or the
 * earliest of equally clear ones. Wayback states no cloud, so it keeps the first.
 */
export function thinKeys(entries, keys, period) {
  const chosen = new Set(keys);
  const best = new Map();
  for (const entry of entries) {
    if (!chosen.has(entry.key)) continue;
    const bucket = String(entry.date).slice(0, period === 'year' ? 4 : 7);
    const held = best.get(bucket);
    if (!held || cloudOf(entry) < cloudOf(held)) best.set(bucket, entry);
  }
  const kept = new Set([...best.values()].map((entry) => entry.key));
  return entries.filter((entry) => kept.has(entry.key)).map((entry) => entry.key);
}

/** The chosen rows, in the order they play whatever order they were ticked in. */
export function chosenEntries(entries, keys) {
  const chosen = new Set(keys);
  return playOrder(entries).filter((entry) => chosen.has(entry.key));
}

/**
 * How a picture is dated on the export. A Wayback date is Esri's estimate of when
 * the pixels were taken, or only the release date when it has none.
 */
export function pictureLabel(archive, entry) {
  if (archive !== WAYBACK_ID) return entry.date;
  if (entry.note === 'taken') return `~${entry.date}`;
  return entry.date ? `Release ${entry.date}` : 'Release, undated';
}

/**
 * The ground an evolution shows, as a frame in CSS pixels: the view, or the
 * export frame at the view's scale, upright at the bearing it was drawn at.
 * Nothing needs to be on screen, since every picture is fetched for it.
 */
export function evolutionFrame(view, exportFrame) {
  if (!exportFrame?.points) return { ...view };
  const angle = compassAngle(exportFrame.angle);
  const box = turnedBox(exportFrame.points, angle);
  const perPixel = mercatorPerPixel(view.zoom);
  const [lng, lat] = fromMercator(...box.centre);
  return {
    ...view,
    lng,
    lat,
    width: Math.max(1, Math.round(Math.abs(box.width) / perPixel)),
    height: Math.max(1, Math.round(Math.abs(box.height) / perPixel)),
    bearing: angle,
  };
}

/**
 * How many output pixels one CSS pixel of the frame becomes: the screen's density,
 * held under `edge` on the longer side.
 */
export function pictureScale(frame, edge, density = 1) {
  const most = edge / Math.max(1, frame.width, frame.height);
  return Math.max(Number.EPSILON, Math.min(Math.max(1, density), most));
}

/**
 * The tiles that draw one picture of `frame` at `pixelScale`, each with the
 * matrix that lays its pixels on the output.
 *
 * The level holds about one tile pixel per output pixel, capped at the
 * provider's native level so nothing is bought that is only upsampled; the proxy
 * magnifies past it for free. Only tiles that touch the output are listed, which
 * matters on a turned frame. The matrices are composed in doubles here and handed
 * to the canvas in output pixels, never as Mercator metres.
 */
export function pictureTiles(frame, provider, pixelScale) {
  const size = provider?.tile_size ?? 256;
  const shift = Math.log2(size / 256);
  const native = Math.floor((provider?.max_native_zoom ?? provider?.max_zoom ?? 18) - shift);
  const perOutputPixel = mercatorPerPixel(frame.zoom) / pixelScale;
  const wanted = Math.round(Math.log2(WORLD / (size * perOutputPixel)));
  const z = Math.max(0, Math.min(native, wanted));
  const count = 2 ** z;
  const span = WORLD / count;
  const width = Math.max(1, Math.round(frame.width * pixelScale));
  const height = Math.max(1, Math.round(frame.height * pixelScale));
  const toGround = compose(screenToMercator(frame), scale(1 / pixelScale));
  const toOutput = invert(toGround);
  const corners = [[0, 0], [width, 0], [0, height], [width, height]];
  const ground = corners.map(([x, y]) => apply(toGround, x, y));
  const columns = ground.map(([x]) => (x + HALF) / span);
  const rows = ground.map(([, y]) => (HALF - y) / span);
  const tiles = [];
  const firstRow = Math.max(0, Math.floor(Math.min(...rows)));
  const lastRow = Math.min(count - 1, Math.floor(Math.max(...rows)));
  for (let ty = firstRow; ty <= lastRow; ty += 1) {
    for (let tx = Math.floor(Math.min(...columns)); tx <= Math.floor(Math.max(...columns)); tx += 1) {
      const matrix = compose(toOutput, {
        a: span / size, b: 0, c: 0, d: -span / size, e: tx * span - HALF, f: HALF - ty * span,
      });
      if (!touches(matrix, size, width, height)) continue;
      tiles.push({ z, x: ((tx % count) + count) % count, y: ty, size, matrix });
    }
  }
  return { width, height, z, tiles };
}

/**
 * Whether a tile laid by `matrix` overlaps the output. Two rectangles are apart
 * only along one of their own sides, so it is enough to look from each.
 */
function touches(matrix, size, width, height) {
  const square = [[0, 0], [size, 0], [0, size], [size, size]].map(([x, y]) => apply(matrix, x, y));
  if (!overlaps(square, width, height)) return false;
  const back = invert(matrix);
  const output = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => apply(back, x, y));
  return overlaps(output, size, size);
}

function overlaps(points, width, height) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return Math.max(...xs) > 0 && Math.min(...xs) < width && Math.max(...ys) > 0 && Math.min(...ys) < height;
}

/** Whether two pictures hold the same pixels: one Wayback release can repeat another. */
export function samePixels(first, second) {
  if (!first || !second || first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

/** How many columns a contact sheet of `count` pictures is laid in. */
export function sheetColumns(count) {
  return Math.max(1, Math.min(6, Math.ceil(Math.sqrt(count))));
}

/**
 * The output scale of one sheet cell: the sheet's width shared out, never finer
 * than the screen, and small enough that the whole sheet stays a PNG the plates
 * route takes (24 MB) when a tall frame stacks its rows.
 */
export function sheetCellScale(frame, count, density = 1, gap = 8) {
  const columns = sheetColumns(count);
  const rows = Math.ceil(Math.max(1, count) / columns);
  const width = Math.max(1, frame.width);
  const height = Math.max(1, frame.height);
  const byWidth = (SHEET_WIDTH - gap * (columns + 1)) / columns / width;
  const byArea = Math.sqrt(SHEET_PIXELS / (columns * rows * width * height));
  return Math.max(Number.EPSILON, Math.min(Math.max(1, density), byWidth, byArea));
}

/** Where each picture's day sits on a line from the first to the last, 0 to 1. */
export function timelinePositions(dates) {
  const times = dates.map((date) => Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`));
  const known = times.filter(Number.isFinite);
  if (!known.length) return dates.map((_, index) => (dates.length > 1 ? index / (dates.length - 1) : 0));
  const first = Math.min(...known);
  const last = Math.max(...known);
  return times.map((time, index) => {
    if (!Number.isFinite(time)) return dates.length > 1 ? index / (dates.length - 1) : 0;
    return last > first ? (time - first) / (last - first) : 0;
  });
}
