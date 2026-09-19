/**
 * What the GeoConfirmed dialog asks the backend for (`engine/geoconfirmed.py`).
 *
 * A window of days counts back from each read, so a layer asked for the last
 * 30 days is still that a month later; a range of dates stays where it was put;
 * the whole history is every event the conflict has. The area is the map's view
 * at the moment of adding, kept for every refresh.
 */

/** A span of the whole history, as a press. */
export const ALL = 'all';
/** …and of a range of dates, picked below the presses. */
export const RANGE = 'range';

/** The spans offered as one press each: a number of days, or the whole history. */
export const WINDOWS = [
  { span: 7, label: '7 days' },
  { span: 30, label: '30 days' },
  { span: 90, label: '90 days' },
  { span: 365, label: 'A year' },
  { span: ALL, label: 'All history' },
];

export const DEFAULT_SPAN = 30;

/** The conflict the list opens on when it holds it: by far the busiest map. */
export const DEFAULT_CONFLICT = 'Ukraine';

/** Six decimals, about ten centimetres: finer says nothing about a view. */
const round = (value) => Math.round(value * 1e6) / 1e6;

/**
 * The map's view as `[west, south, east, north]`, or null for one that is not a
 * box GeoConfirmed can be asked about — a view across the antimeridian wraps, and
 * its west comes out east of its east.
 */
export function areaOf(bounds) {
  if (!bounds) return null;
  const west = Math.max(-180, bounds.west);
  const east = Math.min(180, bounds.east);
  const south = Math.max(-90, bounds.south);
  const north = Math.min(90, bounds.north);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (!(west < east && south < north)) return null;
  return [round(west), round(south), round(east), round(north)];
}

/**
 * The body the backend is posted, or null while the form cannot be sent.
 *
 * @param {object} form
 * @param {string} form.conflict the conflict's short name
 * @param {number | 'all' | 'range'} form.span a number of days, `ALL` or `RANGE`
 * @param {string} form.start the first day of a range, `YYYY-MM-DD`
 * @param {string} form.end its last day, or '' for "until the day it is read"
 * @param {boolean} form.limited whether to keep to the view
 * @param {object | null} form.bounds the view, as `facade.viewBounds()` gives it
 */
export function layerRequest({ conflict, span, start, end, limited, bounds }) {
  if (!conflict) return null;
  const body = { conflict };
  if (span === ALL) {
    body.everything = true;
  } else if (typeof span === 'number' && span > 0) {
    body.days = span;
  } else if (span === RANGE && start) {
    body.start = start;
    if (end) body.end = end;
  } else {
    return null;
  }
  if (limited) {
    const area = areaOf(bounds);
    if (!area) return null;
    body.area = area;
  }
  return body;
}
