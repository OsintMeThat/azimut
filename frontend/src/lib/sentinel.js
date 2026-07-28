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
 * The cloud ceiling in percent, sent on every request. 100 means no filter,
 * which is the default because a configuration instance ships one of its own
 * (20% in the standard template) and a scene above it renders as nothing at
 * all. Lower it and cloudy passes drop out of the calendar, out of "most
 * recent" and out of the tiles together — one number, one meaning.
 */
export const DEFAULT_MAXCC = 100;

/**
 * Pack a layer + window + cloud ceiling into a provider id. The plain default
 * (true colour, most recent, no ceiling) stays the bare id: it must not read as
 * a second provider.
 */
export function variantId(
  baseId,
  { layer = DEFAULT_LAYER, from = '', to = '', maxcc = DEFAULT_MAXCC } = {}
) {
  if (baseId !== SENTINEL_ID) return baseId;
  const windowed = from && to;
  const ceiling = validMaxcc(maxcc) ? Math.round(maxcc) : DEFAULT_MAXCC;
  if ((layer || DEFAULT_LAYER) === DEFAULT_LAYER && !windowed && ceiling === DEFAULT_MAXCC) {
    return baseId;
  }
  const parts = [baseId, layer || DEFAULT_LAYER];
  if (windowed) parts.push(from, to);
  if (ceiling !== DEFAULT_MAXCC) parts.push(`CC${ceiling}`);
  return parts.join(SEP);
}

/** True for a cloud ceiling the backend will accept: a whole 0…100. */
export function validMaxcc(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100 && Number.isInteger(value);
}

/** How a ceiling reads in the UI. */
export function maxccLabel(maxcc) {
  return maxcc >= DEFAULT_MAXCC ? 'Any cloud' : `Up to ${maxcc}%`;
}

/**
 * Is this pass above the ceiling? Sentinel Hub drops such a scene before
 * rendering, so the day is not selectable — the calendar says so rather than
 * spending a tile on a black square. A pass the service gave no figure for is
 * never filtered: an unknown is not a reason to hide real imagery.
 */
export function overCloudCeiling(cloud, maxcc = DEFAULT_MAXCC) {
  if (cloud === null || cloud === undefined) return false;
  return cloud > maxcc;
}

/**
 * The newest pass at or before `today` that the ceiling still allows — what
 * "most recent" actually renders once a ceiling is set. `days` is the
 * `{ 'YYYY-MM-DD': {cloud} }` map a month lookup returns.
 */
export function latestAllowedPass(days, today, maxcc = DEFAULT_MAXCC) {
  return (
    Object.keys(days || {})
      .filter((day) => day <= today && !overCloudCeiling(days[day]?.cloud, maxcc))
      .sort()
      .at(-1) ?? ''
  );
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

/** Stable place bucket for pass and coverage caches (about 100 m). */
export function sentinelPlaceKey(lat, lon) {
  return `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
}

/** Local API request that verifies rendered coverage for one candidate day. */
export function coverageRequestPath({ lat, lon, layer, date, maxcc = DEFAULT_MAXCC }) {
  const query = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    layer,
    date,
    maxcc: String(validMaxcc(maxcc) ? maxcc : DEFAULT_MAXCC),
  });
  return `/api/satellite/sentinel/coverage?${query}`;
}

/** Keep the working map unless the candidate day passed its coverage check. */
export function dateAfterCoverage(current, candidate, available) {
  return available ? candidate : current;
}

/**
 * The date range a date search should default to: the last `days` days, ending
 * today. Sentinel-2 revisits every ~5 days, so a month is several passes —
 * enough that the list is never empty, short enough to stay readable.
 */
export function defaultSearchWindow(days = 30, now = new Date()) {
  return { from: daysBefore(days, now), to: isoDay(now) };
}
