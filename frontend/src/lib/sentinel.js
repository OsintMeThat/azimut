/**
 * Sentinel-2 basemap choices: which layer, and over which window.
 *
 * Both ride on the provider id as a variant — `sentinel2~SWIR~2026-05-01~2026-05-31`
 * — which is what the tile URL, the capture and the disk cache all key on
 * (engine/sentinel.py owns the same format on the backend). The map only ever
 * has to know the id; nothing downstream can forget the window.
 */

export const SENTINEL_ID = 'sentinel2';
const SEP = '~';

/** Layer ids we know the reason for. The real list comes from the backend
 * (/api/satellite/sentinel/layers) — a user's instance serves whatever its
 * configuration says, and only the instance knows. */
export const DEFAULT_LAYER = 'TRUE_COLOR';

/**
 * Pack a layer + window into a provider id. The plain default (true colour,
 * most recent) stays the bare id: it must not read as a second provider.
 */
export function variantId(baseId, { layer = DEFAULT_LAYER, from = '', to = '' } = {}) {
  if (baseId !== SENTINEL_ID) return baseId;
  const windowed = from && to;
  if ((layer || DEFAULT_LAYER) === DEFAULT_LAYER && !windowed) return baseId;
  const parts = [baseId, layer || DEFAULT_LAYER];
  if (windowed) parts.push(from, to);
  return parts.join(SEP);
}

/** ISO date (YYYY-MM-DD) for a Date, in UTC — the calendar Sentinel-2 passes
 * are dated by, not the viewer's timezone. */
export function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

/** `n` days before `date`, as an ISO day. */
export function daysBefore(n, date = new Date()) {
  const out = new Date(date.getTime());
  out.setUTCDate(out.getUTCDate() - n);
  return isoDay(out);
}

/** True when both ends are ISO days in order — the shape the backend accepts,
 * checked here so a half-typed date never becomes a request. */
export function validWindow(from, to) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(from || '') || !iso.test(to || '')) return false;
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return false;
  return from <= to;
}

/** True for a single well-formed ISO day. */
export function validDay(day) {
  return validWindow(day, day);
}

/** How a window reads in the UI: a day, a range, or the layer's own default. */
export function windowLabel(from, to) {
  if (!validWindow(from, to)) return 'most recent';
  return from === to ? from : `${from} → ${to}`;
}

/**
 * The calendar month a day belongs to, and month arithmetic on 'YYYY-MM'.
 * Day 1 of the target month, so a 31st can never spill into the next one.
 */
export function monthOf(day) {
  return (day || isoDay(new Date())).slice(0, 7);
}

export function addMonths(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return isoDay(d).slice(0, 7);
}

export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** First and last day of a month, as ISO days — the span a pass lookup covers. */
export function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  return {
    from: `${month}-01`,
    to: isoDay(new Date(Date.UTC(y, m, 0))), // day 0 of next month = last of this
  };
}

/**
 * A month as calendar cells, Monday-first, padded with nulls so the first day
 * lands under its weekday. Trailing padding is left out — an empty last row is
 * just whitespace.
 */
export function monthGrid(month) {
  const { to } = monthBounds(month);
  const days = Number(to.slice(8));
  const [y, m] = month.split('-').map(Number);
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Mon = 0
  const cells = Array(firstWeekday).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`);
  return cells;
}

/**
 * How usable a pass is, at a glance. Sentinel-2 revisits every ~5 days but most
 * passes are cloud: the point of showing cover is to skip the ones that cost a
 * tile to discover are white.
 */
export function cloudClass(cloud) {
  if (cloud === null || cloud === undefined) return 'unknown';
  if (cloud < 20) return 'clear';
  if (cloud < 60) return 'part';
  return 'cloudy';
}

/** Cloud cover as a short badge — the reason to skip a date without paying for
 * a tile to find out. */
export function cloudLabel(cloud) {
  if (cloud === null || cloud === undefined) return '';
  return `${Math.round(cloud)}% cloud`;
}

/**
 * The date range a date search should default to: the last `days` days, ending
 * today. Sentinel-2 revisits every ~5 days, so a month is several passes —
 * enough that the list is never empty, short enough to stay readable.
 */
export function defaultSearchWindow(days = 30, now = new Date()) {
  return { from: daysBefore(days, now), to: isoDay(now) };
}
