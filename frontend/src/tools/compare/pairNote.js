/**
 * A Compare pair as it goes into a note: the two pictures side by side, each
 * with its date and credit on its half, kept in the case under the comparison.
 *
 * Side by side whatever the screen shows: a swipe or a blink printed is half of
 * each picture, or only the first. A comparison not saved yet is saved under a
 * name made of its place and its two dates, so nothing has to be asked.
 */
import { picturePut } from '../../lib/notes/syntax.js';
import { haversine } from '../../lib/measure.js';

/** How near a saved place has to be to the camera for the pair to be named after it. */
export const NAMING_RADIUS_M = 500;

/**
 * The name of the case's saved place nearest the point, within `radius` metres,
 * or ''. `rows` are the Saved panel's (`/satellite/index`): the case's own, read
 * without the network.
 */
export function nearestPlace(rows, lat, lon, radius = NAMING_RADIUS_M) {
  let best = '';
  let bestM = Infinity;
  for (const row of rows ?? []) {
    if (row?.kind !== 'place' || !String(row.title ?? '').trim()) continue;
    const y = Number(row.lat);
    const x = Number(row.lon);
    if (!Number.isFinite(y) || !Number.isFinite(x)) continue;
    const metres = haversine({ lat, lon }, { lat: y, lon: x });
    if (metres <= radius && metres < bestM) {
      best = String(row.title).trim();
      bestM = metres;
    }
  }
  return best;
}

/** A picture's day as the name writes it: `2024-05-03`, `~2024-05-03` for a release's estimate. */
function day(side) {
  const value = String(side?.imageryWhen ?? '').slice(0, 10);
  if (!value) return 'undated';
  return `${side.imageryExact === false ? '~' : ''}${value}`;
}

/**
 * The name a comparison saved for a note takes: where it is, then its two days.
 * `Water tower, 2024-05-03 to 2026-09-02`, or the point to four places.
 */
export function pairName({ place = '', lat, lon, a = {}, b = {} } = {}) {
  const where = String(place ?? '').trim()
    || (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))
      ? `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`
      : 'Comparison');
  return `${where}, ${day(a)} to ${day(b)}`;
}

/**
 * The pair offered to a pinned note. `keep()` files (or finds) the side-by-side
 * image and answers `{ entity, label, fresh }`; `unsaved()` says whether a
 * comparison will be saved first.
 */
export function pairOffer({ keep, unsaved = () => false }) {
  return {
    id: 'pair',
    label: 'This pair',
    get hint() {
      return unsaved() ? 'Saves the comparison, then keeps both pictures side by side' : 'Both pictures side by side, each dated';
    },
    icon: 'compare',
    picture: true,
    put: async ({ signal } = {}) => {
      const { entity, label, fresh } = await keep({ signal });
      if (!entity?.id) throw new Error('The pair could not be kept in the case');
      return { text: picturePut(entity, { label, width: '100%' }), filed: fresh ? [entity.id] : [] };
    },
  };
}

/**
 * The evolution sheet ticked in the export panel, offered to a pinned note: the
 * pictures of the archive side by side, each dated, one still where a PDF cannot
 * play a GIF. `keep()` draws it, files it (or finds it filed in this very state)
 * and answers `{ entity, label, fresh }`.
 */
export function sheetOffer({ keep, unsaved = () => false }) {
  return {
    id: 'sheet',
    label: 'This evolution sheet',
    get hint() {
      return unsaved() ? 'Saves the comparison, then fetches and files the pictures side by side' : 'Fetches the pictures and files them side by side, each dated';
    },
    icon: 'columns',
    picture: true,
    busy: 'Drawing the pictures…',
    put: async ({ signal } = {}) => {
      const { entity, label, fresh } = await keep({ signal });
      if (!entity?.id) throw new Error('The sheet could not be kept in the case');
      return { text: picturePut(entity, { label, width: '100%' }), filed: fresh ? [entity.id] : [] };
    },
  };
}
